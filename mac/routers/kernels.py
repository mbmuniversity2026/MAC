"""Kernel lifecycle management API.

Endpoints for launching, listing, and managing code execution kernels.
"""

from fastapi import APIRouter, Depends, HTTPException
from mac.middleware.auth_middleware import get_current_user
from mac.models.user import User
from mac.services.kernel_manager import kernel_manager
from mac.schemas.auth import KernelLaunchRequest

router = APIRouter(prefix="/kernels", tags=["kernels"])


@router.post("/launch")
async def launch_kernel(
    body: KernelLaunchRequest,
    user: User = Depends(get_current_user),
):
    """Launch a new kernel for the specified language."""
    language = body.language
    notebook_id = body.notebook_id
    try:
        kernel = await kernel_manager.launch_kernel(language, notebook_id)
        return {"kernel": kernel}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("")
async def list_kernels(user: User = Depends(get_current_user)):
    """List all active kernels."""
    return {"kernels": kernel_manager.list_kernels()}


@router.get("/languages/available")
async def available_languages(user: User = Depends(get_current_user)):
    """List all supported programming languages with their capabilities."""
    return {
        "languages": kernel_manager.get_available_languages(),
        "execution_mode": kernel_manager.get_execution_mode(),
    }


@router.get("/{kernel_id}")
async def get_kernel(kernel_id: str, user: User = Depends(get_current_user)):
    """Get kernel details."""
    kernel = kernel_manager.get_kernel(kernel_id)
    if not kernel:
        raise HTTPException(404, "Kernel not found")
    return {"kernel": kernel}


@router.post("/{kernel_id}/interrupt")
async def interrupt_kernel(kernel_id: str, user: User = Depends(get_current_user)):
    """Interrupt a running kernel."""
    success = await kernel_manager.interrupt_kernel(kernel_id)
    if not success:
        raise HTTPException(404, "Kernel not found")
    return {"interrupted": True}


@router.post("/{kernel_id}/restart")
async def restart_kernel(kernel_id: str, user: User = Depends(get_current_user)):
    """Restart a kernel."""
    kernel = await kernel_manager.restart_kernel(kernel_id)
    if not kernel:
        raise HTTPException(404, "Kernel not found")
    return {"kernel": kernel}


@router.delete("/{kernel_id}")
async def shutdown_kernel(kernel_id: str, user: User = Depends(get_current_user)):
    """Shutdown and remove a kernel."""
    success = await kernel_manager.shutdown_kernel(kernel_id)
    if not success:
        raise HTTPException(404, "Kernel not found")
    return {"shutdown": True}
