"""Hardware introspection endpoints (public — no auth required)."""

from fastapi import APIRouter

from mac.services import hardware as hw_service

router = APIRouter(prefix="/hardware", tags=["Hardware"])


@router.get("/local")
async def local_hardware():
    """Return CPU/RAM/disk/GPU/Docker profile of THIS machine."""
    return await hw_service.get_hardware_profile()


@router.get("/recommendations")
async def model_recommendations():
    """Recommend models that fit this machine's resources."""
    return await hw_service.get_model_recommendations()
