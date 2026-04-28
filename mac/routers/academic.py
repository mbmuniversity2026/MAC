"""
Academic management API (branches and sections).
Admin-only write operations; read operations available to all authenticated users.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from mac.database import get_db
from mac.middleware.auth_middleware import require_admin, get_current_user
from mac.models.academic import Branch, Section
from mac.models.user import User

router = APIRouter(prefix="/academic", tags=["Academic"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class BranchCreate(BaseModel):
    name: str
    code: str
    hod_id: str | None = None


class BranchUpdate(BaseModel):
    name: str | None = None
    hod_id: str | None = None


class SectionCreate(BaseModel):
    branch_id: str
    name: str
    year: int
    faculty_id: str | None = None


class SectionUpdate(BaseModel):
    name: str | None = None
    year: int | None = None
    faculty_id: str | None = None


# ── Branches ──────────────────────────────────────────────────────────────────

@router.get("/branches")
async def list_branches(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    branches = (await db.execute(select(Branch).order_by(Branch.code))).scalars().all()
    return [
        {"id": b.id, "name": b.name, "code": b.code, "hod_id": b.hod_id,
         "created_at": b.created_at.isoformat()}
        for b in branches
    ]


@router.post("/branches", status_code=201)
async def create_branch(
    body: BranchCreate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    existing = (await db.execute(
        select(Branch).where(Branch.code == body.code.upper())
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail={"code": "duplicate_code", "message": "Branch code already exists."})

    branch = Branch(name=body.name, code=body.code.upper(), hod_id=body.hod_id)
    db.add(branch)
    await db.commit()
    return {"id": branch.id, "name": branch.name, "code": branch.code}


@router.patch("/branches/{branch_id}")
async def update_branch(
    branch_id: str,
    body: BranchUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    branch = (await db.execute(
        select(Branch).where(Branch.id == branch_id)
    )).scalar_one_or_none()
    if not branch:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Branch not found."})

    if body.name is not None:
        branch.name = body.name
    if body.hod_id is not None:
        branch.hod_id = body.hod_id
    await db.commit()
    return {"ok": True, "id": branch.id}


@router.delete("/branches/{branch_id}", status_code=204)
async def delete_branch(
    branch_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    branch = (await db.execute(
        select(Branch).where(Branch.id == branch_id)
    )).scalar_one_or_none()
    if not branch:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Branch not found."})
    await db.delete(branch)
    await db.commit()


# ── Sections ──────────────────────────────────────────────────────────────────

@router.get("/branches/{branch_id}/sections")
async def list_sections(
    branch_id: str,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    sections = (await db.execute(
        select(Section)
        .where(Section.branch_id == branch_id)
        .order_by(Section.year, Section.name)
    )).scalars().all()
    return [
        {"id": s.id, "name": s.name, "year": s.year, "faculty_id": s.faculty_id,
         "branch_id": s.branch_id}
        for s in sections
    ]


@router.get("/sections")
async def list_all_sections(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    sections = (await db.execute(
        select(Section).order_by(Section.branch_id, Section.year, Section.name)
    )).scalars().all()
    return [
        {"id": s.id, "name": s.name, "year": s.year, "faculty_id": s.faculty_id,
         "branch_id": s.branch_id}
        for s in sections
    ]


@router.post("/sections", status_code=201)
async def create_section(
    body: SectionCreate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    section = Section(
        branch_id=body.branch_id,
        name=body.name,
        year=body.year,
        faculty_id=body.faculty_id,
    )
    db.add(section)
    await db.commit()
    return {"id": section.id, "name": section.name, "year": section.year}


@router.patch("/sections/{section_id}")
async def update_section(
    section_id: str,
    body: SectionUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    section = (await db.execute(
        select(Section).where(Section.id == section_id)
    )).scalar_one_or_none()
    if not section:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Section not found."})

    if body.name is not None:
        section.name = body.name
    if body.year is not None:
        section.year = body.year
    if body.faculty_id is not None:
        section.faculty_id = body.faculty_id
    await db.commit()
    return {"ok": True, "id": section.id}


@router.delete("/sections/{section_id}", status_code=204)
async def delete_section(
    section_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    section = (await db.execute(
        select(Section).where(Section.id == section_id)
    )).scalar_one_or_none()
    if not section:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Section not found."})
    await db.delete(section)
    await db.commit()
