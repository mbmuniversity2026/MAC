"""First-boot setup endpoints.

GET  /setup/status        — public, is_first_run + JWT secret presence
POST /setup/create-admin  — public, only allowed when is_first_run is true
GET  /setup/recovery      — localhost-only password recovery probe
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from mac.database import get_db
from mac.schemas.setup import CreateAdminRequest, CreateAdminResponse, SetupStatus
from mac.services import setup_service, updater

router = APIRouter(prefix="/setup", tags=["Setup"])


@router.get("/status", response_model=SetupStatus)
async def setup_status(db: AsyncSession = Depends(get_db)):
    return SetupStatus(
        is_first_run=await setup_service.is_first_run(db),
        has_jwt_secret=await setup_service.has_jwt_secret(db),
        version=updater.get_current_version(),
    )


@router.post("/create-admin", response_model=CreateAdminResponse)
async def create_admin(
    body: CreateAdminRequest,
    db: AsyncSession = Depends(get_db),
):
    user, token, error = await setup_service.create_founder_admin(
        db,
        name=body.name,
        email=body.email,
        password=body.password,
    )
    if error or not user or not token:
        raise HTTPException(status_code=409, detail={
            "code": "setup_closed",
            "message": error or "Setup already completed.",
        })
    return CreateAdminResponse(
        access_token=token,
        token_type="bearer",
        user={
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role,
            "is_founder": user.is_founder,
            "roll_number": user.roll_number,
        },
    )


@router.get("/recovery")
async def recovery(request: Request):
    """Localhost-only password recovery surface. Refuses non-loopback callers.
    Real recovery flow is a Session 3 deliverable; this session just proves
    the gating works."""
    client_host = request.client.host if request.client else ""
    if client_host not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(status_code=403, detail={
            "code": "localhost_required",
            "message": "Recovery is only accessible from the host machine (127.0.0.1).",
        })
    return {
        "ok": True,
        "message": "Localhost recovery endpoint is reachable. Full flow lands in Session 3.",
    }
