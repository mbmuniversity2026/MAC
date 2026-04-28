"""Notebook CRUD and execution service."""

import asyncio
import logging
from typing import Optional
from datetime import datetime, timezone
from sqlalchemy import select, update, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from mac.models.notebook import Notebook, NotebookCell, CellExecution

logger = logging.getLogger(__name__)

EXECUTION_TIMEOUT = 30  # seconds per cell


def _utcnow():
    return datetime.now(timezone.utc)


# ── Notebook CRUD ─────────────────────────────────────────

async def create_notebook(
    db: AsyncSession, owner_id: str, title: str = "Untitled Notebook",
    description: str = "", language: str = "python",
) -> Notebook:
    nb = Notebook(owner_id=owner_id, title=title, description=description, language=language)
    db.add(nb)
    await db.flush()
    return nb


async def get_notebook(db: AsyncSession, notebook_id: str) -> Optional[Notebook]:
    result = await db.execute(
        select(Notebook)
        .options(selectinload(Notebook.cells))
        .where(Notebook.id == notebook_id)
    )
    return result.scalar_one_or_none()


async def list_notebooks(
    db: AsyncSession, owner_id: str, include_archived: bool = False, limit: int = 50,
) -> list[Notebook]:
    query = (
        select(Notebook)
        .where(Notebook.owner_id == owner_id)
        .order_by(Notebook.updated_at.desc())
        .limit(limit)
    )
    if not include_archived:
        query = query.where(Notebook.is_archived == False)
    result = await db.execute(query)
    return list(result.scalars().all())


async def update_notebook(
    db: AsyncSession, notebook_id: str, **kwargs,
) -> Optional[Notebook]:
    nb = await get_notebook(db, notebook_id)
    if not nb:
        return None
    for key, value in kwargs.items():
        if hasattr(nb, key) and key not in ("id", "owner_id", "created_at"):
            setattr(nb, key, value)
    nb.updated_at = _utcnow()
    await db.flush()
    return nb


async def delete_notebook(db: AsyncSession, notebook_id: str) -> bool:
    nb = await get_notebook(db, notebook_id)
    if not nb:
        return False
    await db.delete(nb)
    await db.flush()
    return True


# ── Cell CRUD ─────────────────────────────────────────────

async def add_cell(
    db: AsyncSession, notebook_id: str, cell_type: str = "code",
    source: str = "", position: int = -1, language: str | None = None,
) -> NotebookCell:
    nb = await get_notebook(db, notebook_id)
    if not nb:
        raise ValueError("Notebook not found")

    if position < 0:
        position = nb.cell_count

    # Shift existing cells down
    cells = sorted(nb.cells, key=lambda c: c.position)
    for cell in cells:
        if cell.position >= position:
            cell.position += 1

    cell = NotebookCell(
        notebook_id=notebook_id, cell_type=cell_type,
        source=source, position=position, language=language,
    )
    db.add(cell)
    nb.cell_count += 1
    nb.updated_at = _utcnow()
    await db.flush()
    return cell


async def update_cell(
    db: AsyncSession, cell_id: str, source: str | None = None, cell_type: str | None = None,
) -> Optional[NotebookCell]:
    result = await db.execute(select(NotebookCell).where(NotebookCell.id == cell_id))
    cell = result.scalar_one_or_none()
    if not cell:
        return None
    if source is not None:
        cell.source = source
    if cell_type is not None:
        cell.cell_type = cell_type
    cell.updated_at = _utcnow()
    await db.flush()
    return cell


async def delete_cell(db: AsyncSession, cell_id: str) -> bool:
    result = await db.execute(
        select(NotebookCell).options(selectinload(NotebookCell.notebook)).where(NotebookCell.id == cell_id)
    )
    cell = result.scalar_one_or_none()
    if not cell:
        return False

    nb = cell.notebook
    position = cell.position
    await db.delete(cell)

    # Shift remaining cells up
    remaining = await db.execute(
        select(NotebookCell)
        .where(NotebookCell.notebook_id == nb.id, NotebookCell.position > position)
    )
    for c in remaining.scalars():
        c.position -= 1

    nb.cell_count = max(0, nb.cell_count - 1)
    nb.updated_at = _utcnow()
    await db.flush()
    return True


async def reorder_cells(db: AsyncSession, notebook_id: str, cell_ids: list[str]) -> bool:
    """Reorder cells by providing the cell IDs in desired order."""
    nb = await get_notebook(db, notebook_id)
    if not nb:
        return False

    id_to_pos = {cid: i for i, cid in enumerate(cell_ids)}
    for cell in nb.cells:
        if cell.id in id_to_pos:
            cell.position = id_to_pos[cell.id]

    nb.updated_at = _utcnow()
    await db.flush()
    return True


# ── Cell Execution ────────────────────────────────────────

BLOCKED_OPS = [
    "os.system", "subprocess", "shutil.rmtree", "__import__('os')",
    "open(", "socket", "requests.get", "urllib", "importlib",
    "ctypes", "pickle", "compile(", "globals(", "locals(",
]


async def execute_cell(db: AsyncSession, cell_id: str, user_id: str) -> CellExecution:
    """Execute a code cell in a restricted sandbox and persist results."""
    result = await db.execute(select(NotebookCell).where(NotebookCell.id == cell_id))
    cell = result.scalar_one_or_none()
    if not cell:
        raise ValueError("Cell not found")
    if cell.cell_type != "code":
        raise ValueError("Can only execute code cells")

    execution = CellExecution(
        cell_id=cell_id,
        user_id=user_id,
        status="running",
        source_snapshot=cell.source,
    )
    db.add(execution)
    await db.flush()

    import time
    start = time.time()

    code = cell.source
    # Security check
    for blocked in BLOCKED_OPS:
        if blocked in code:
            execution.status = "failed"
            execution.stderr = f"Blocked operation: {blocked}"
            execution.exit_code = 1
            execution.duration_ms = int((time.time() - start) * 1000)
            await db.flush()
            return execution

    if len(code) > 50000:
        execution.status = "failed"
        execution.stderr = "Code too long (max 50000 chars)"
        execution.exit_code = 1
        execution.duration_ms = int((time.time() - start) * 1000)
        await db.flush()
        return execution

    try:
        import io
        import contextlib
        import math

        stdout_buf = io.StringIO()
        stderr_buf = io.StringIO()
        safe_globals = {"__builtins__": {
            "print": print, "len": len, "range": range, "int": int, "float": float,
            "str": str, "list": list, "dict": dict, "set": set, "tuple": tuple,
            "sum": sum, "min": min, "max": max, "sorted": sorted, "enumerate": enumerate,
            "zip": zip, "map": map, "filter": filter, "abs": abs, "round": round,
            "True": True, "False": False, "None": None, "bool": bool,
            "isinstance": isinstance, "type": type, "repr": repr,
            "math": math, "pow": pow, "divmod": divmod, "hex": hex, "oct": oct, "bin": bin,
        }}

        async def _run():
            with contextlib.redirect_stdout(stdout_buf), contextlib.redirect_stderr(stderr_buf):
                exec(code, safe_globals)

        await asyncio.wait_for(_run(), timeout=EXECUTION_TIMEOUT)

        stdout = stdout_buf.getvalue()
        stderr = stderr_buf.getvalue()
        if len(stdout) > 100000:
            stdout = stdout[:100000] + "\n...[truncated]"

        execution.stdout = stdout
        execution.stderr = stderr if stderr else None
        execution.status = "completed"
        execution.exit_code = 0

    except asyncio.TimeoutError:
        execution.status = "timeout"
        execution.stderr = f"Execution timed out after {EXECUTION_TIMEOUT}s"
        execution.exit_code = 124
    except Exception as e:
        execution.status = "failed"
        execution.stderr = str(e)
        execution.exit_code = 1

    execution.duration_ms = int((time.time() - start) * 1000)
    await db.flush()
    return execution


async def get_cell_executions(
    db: AsyncSession, cell_id: str, limit: int = 10,
) -> list[CellExecution]:
    result = await db.execute(
        select(CellExecution)
        .where(CellExecution.cell_id == cell_id)
        .order_by(CellExecution.created_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())
