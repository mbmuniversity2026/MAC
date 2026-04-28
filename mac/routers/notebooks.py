"""Notebook CRUD + execution router.

Endpoints:
  POST   /notebooks              — Create notebook
  GET    /notebooks               — List user's notebooks
  GET    /notebooks/:id           — Get notebook with cells
  PATCH  /notebooks/:id           — Update notebook title/desc/visibility
  DELETE /notebooks/:id           — Delete notebook
  POST   /notebooks/:id/cells     — Add cell
  PATCH  /notebooks/cells/:id     — Update cell source
  DELETE /notebooks/cells/:id     — Delete cell
  POST   /notebooks/cells/:id/run — Execute cell
  GET    /notebooks/cells/:id/executions — Cell execution history
  POST   /notebooks/:id/reorder   — Reorder cells
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from mac.database import get_db
from mac.middleware.auth_middleware import get_current_user
from mac.middleware.feature_gate import feature_required
from mac.models.user import User
from mac.services import notebook_service as svc

router = APIRouter(prefix="/notebooks", tags=["notebooks"],
                   dependencies=[Depends(feature_required("mbm_book"))])


def _nb_to_dict(nb, include_cells=False) -> dict:
    d = {
        "id": nb.id,
        "owner_id": nb.owner_id,
        "title": nb.title,
        "description": nb.description,
        "language": nb.language,
        "visibility": nb.visibility,
        "is_archived": nb.is_archived,
        "cell_count": nb.cell_count,
        "created_at": nb.created_at.isoformat() if nb.created_at else None,
        "updated_at": nb.updated_at.isoformat() if nb.updated_at else None,
    }
    if include_cells and hasattr(nb, "cells"):
        d["cells"] = [
            {
                "id": c.id,
                "cell_type": c.cell_type,
                "language": c.language,
                "source": c.source,
                "position": c.position,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "updated_at": c.updated_at.isoformat() if c.updated_at else None,
            }
            for c in sorted(nb.cells, key=lambda x: x.position)
        ]
    return d


def _exec_to_dict(ex) -> dict:
    return {
        "id": ex.id,
        "cell_id": ex.cell_id,
        "user_id": ex.user_id,
        "status": ex.status,
        "source_snapshot": ex.source_snapshot,
        "stdout": ex.stdout,
        "stderr": ex.stderr,
        "result": ex.result,
        "exit_code": ex.exit_code,
        "duration_ms": ex.duration_ms,
        "created_at": ex.created_at.isoformat() if ex.created_at else None,
    }


# ── Notebook CRUD ─────────────────────────────────────────

@router.post("")
async def create_notebook(
    body: dict,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    nb = await svc.create_notebook(
        db, owner_id=user.id,
        title=body.get("title", "Untitled Notebook"),
        description=body.get("description", ""),
        language=body.get("language", "python"),
    )
    await db.commit()
    return {"notebook": _nb_to_dict(nb)}


@router.get("")
async def list_notebooks(
    include_archived: bool = False,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    notebooks = await svc.list_notebooks(db, user.id, include_archived)
    return {"notebooks": [_nb_to_dict(nb) for nb in notebooks]}


@router.get("/{notebook_id}")
async def get_notebook(
    notebook_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    nb = await svc.get_notebook(db, notebook_id)
    if not nb:
        raise HTTPException(404, "Notebook not found")
    if nb.owner_id != user.id and nb.visibility == "private":
        raise HTTPException(403, "Access denied")
    return _nb_to_dict(nb, include_cells=True)


@router.patch("/{notebook_id}")
async def update_notebook(
    notebook_id: str,
    body: dict,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    nb = await svc.get_notebook(db, notebook_id)
    if not nb:
        raise HTTPException(404, "Notebook not found")
    if nb.owner_id != user.id:
        raise HTTPException(403, "Access denied")

    allowed_fields = {"title", "description", "language", "visibility", "is_archived"}
    updates = {k: v for k, v in body.items() if k in allowed_fields}
    nb = await svc.update_notebook(db, notebook_id, **updates)
    await db.commit()
    return {"notebook": _nb_to_dict(nb)}


@router.delete("/{notebook_id}")
async def delete_notebook(
    notebook_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    nb = await svc.get_notebook(db, notebook_id)
    if not nb:
        raise HTTPException(404, "Notebook not found")
    if nb.owner_id != user.id:
        raise HTTPException(403, "Access denied")
    await svc.delete_notebook(db, notebook_id)
    await db.commit()
    return {"deleted": True}


# ── Cell operations ───────────────────────────────────────

@router.post("/{notebook_id}/cells")
async def add_cell(
    notebook_id: str,
    body: dict,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    nb = await svc.get_notebook(db, notebook_id)
    if not nb:
        raise HTTPException(404, "Notebook not found")
    if nb.owner_id != user.id:
        raise HTTPException(403, "Access denied")

    try:
        cell = await svc.add_cell(
            db, notebook_id,
            cell_type=body.get("cell_type", "code"),
            source=body.get("source", ""),
            position=body.get("position", -1),
            language=body.get("language"),
        )
        await db.commit()
        return {
            "cell": {
                "id": cell.id, "cell_type": cell.cell_type,
                "source": cell.source, "position": cell.position,
            }
        }
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/cells/{cell_id}")
async def update_cell(
    cell_id: str,
    body: dict,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cell = await svc.update_cell(
        db, cell_id,
        source=body.get("source"),
        cell_type=body.get("cell_type"),
    )
    if not cell:
        raise HTTPException(404, "Cell not found")
    await db.commit()
    return {"cell": {"id": cell.id, "source": cell.source, "cell_type": cell.cell_type}}


@router.delete("/cells/{cell_id}")
async def delete_cell(
    cell_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    deleted = await svc.delete_cell(db, cell_id)
    if not deleted:
        raise HTTPException(404, "Cell not found")
    await db.commit()
    return {"deleted": True}


@router.post("/cells/{cell_id}/run")
async def execute_cell(
    cell_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Execute a code cell and return the result."""
    try:
        execution = await svc.execute_cell(db, cell_id, user.id)
        await db.commit()
        return {"execution": _exec_to_dict(execution)}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/cells/{cell_id}/executions")
async def cell_executions(
    cell_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    execs = await svc.get_cell_executions(db, cell_id)
    return {"executions": [_exec_to_dict(e) for e in execs]}


@router.post("/{notebook_id}/reorder")
async def reorder_cells(
    notebook_id: str,
    body: dict,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    nb = await svc.get_notebook(db, notebook_id)
    if not nb:
        raise HTTPException(404, "Notebook not found")
    if nb.owner_id != user.id:
        raise HTTPException(403, "Access denied")

    cell_ids = body.get("cell_ids", [])
    if not cell_ids:
        raise HTTPException(400, "cell_ids required")

    await svc.reorder_cells(db, notebook_id, cell_ids)
    await db.commit()
    return {"reordered": True}
