"""Agent mode router — plan-and-execute workflows with streaming progress."""

import json
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from mac.database import get_db
from mac.middleware.auth_middleware import require_faculty_or_admin
from mac.middleware.rate_limit import check_rate_limit
from mac.models.user import User
from mac.services import agent_service, notification_service

router = APIRouter(prefix="/agent", tags=["agent"])


def _session_to_dict(s) -> dict:
    """Convert AgentSession ORM model to API dict."""
    return {
        "id": s.id,
        "query": s.query,
        "status": s.status,
        "final_response": s.final_response,
        "error_message": s.error_message,
        "plan": s.plan,
        "step_count": s.step_count,
        "current_step": s.current_step,
        "tokens_used": s.tokens_used,
        "latency_ms": s.latency_ms,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
        "steps": [
            {
                "id": st.id,
                "step_number": st.step_number,
                "title": st.title,
                "description": st.description,
                "tool": st.tool,
                "status": st.status,
                "result": st.result,
                "error_message": st.error_message,
                "started_at": st.started_at.isoformat() if st.started_at else None,
                "completed_at": st.completed_at.isoformat() if st.completed_at else None,
            }
            for st in sorted(getattr(s, "steps", []), key=lambda x: x.step_number)
        ],
    }


@router.post("/run")
async def run_agent(
    body: dict,
    request: Request,
    user: User = Depends(require_faculty_or_admin),
    _rate_limit_user: User = Depends(check_rate_limit),
    db: AsyncSession = Depends(get_db),
):
    """Start an agent execution session. Returns SSE stream with progress events."""
    query = body.get("query", "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query is required")

    session = await agent_service.create_agent_session(db, user.id, query)
    await db.commit()

    await notification_service.log_audit(
        db, action="agent.run", resource_type="agent_session",
        resource_id=session.id, actor_id=user.id, actor_role=user.role,
        details=f"Query: {query[:200]}",
    )

    session_id = session.id

    async def event_stream():
        async for event in agent_service.run_agent_session(session_id, db):
            yield f"data: {json.dumps(event)}\n\n"
        await db.commit()
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/sessions/{session_id}/cancel")
async def cancel_session(
    session_id: str,
    user: User = Depends(require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Cancel a running agent session."""
    session = await agent_service.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    cancelled = await agent_service.cancel_session(db, session_id)
    if cancelled:
        await db.commit()
    return {"cancelled": cancelled}


@router.get("/sessions")
async def list_sessions(
    user: User = Depends(require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """List current user's agent sessions."""
    sessions = await agent_service.list_user_sessions(db, user.id)
    return {
        "sessions": [
            {
                "id": s.id,
                "query": s.query[:100],
                "status": s.status,
                "steps": s.step_count,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s in sessions
        ]
    }


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: str,
    user: User = Depends(require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get agent session details with all steps."""
    session = await agent_service.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    return _session_to_dict(session)


@router.get("/tools")
async def list_tools(user: User = Depends(require_faculty_or_admin)):
    """List available agent tools."""
    return {"tools": list(agent_service.AVAILABLE_TOOLS.values())}
