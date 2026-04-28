"""Agent mode service — enterprise-grade plan-and-execute with DB persistence.

Lifecycle: planning → executing → completed | failed | cancelled | timeout
Sessions and steps persisted to PostgreSQL via AgentSession / AgentStep models.
In-memory cancellation tokens allow mid-flight abort.
"""

import asyncio
import json
import time
import uuid
import httpx
from typing import Optional, AsyncIterator
from datetime import datetime, timezone
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from mac.config import settings
from mac.models.agent import AgentSession, AgentStep
from mac.utils.security import generate_request_id


def _utcnow():
    return datetime.now(timezone.utc)


# ── Cancellation tokens (in-memory, keyed by session ID) ─
_cancel_tokens: dict[str, bool] = {}

# Agent execution limits
MAX_STEPS = 8
STEP_TIMEOUT_SECONDS = 60
SESSION_TIMEOUT_SECONDS = 300  # 5 minutes total


AVAILABLE_TOOLS = {
    "web_search": {
        "name": "web_search",
        "description": "Search the web for current information",
        "category": "search",
    },
    "wikipedia": {
        "name": "wikipedia",
        "description": "Search Wikipedia for factual information",
        "category": "search",
    },
    "python_execute": {
        "name": "python_execute",
        "description": "Execute Python code in sandbox",
        "category": "code",
    },
    "generate_document": {
        "name": "generate_document",
        "description": "Generate a document (text, markdown, report)",
        "category": "output",
    },
}

ALLOWED_TOOLS = set(AVAILABLE_TOOLS.keys()) | {"none"}


# ── Session CRUD ──────────────────────────────────────────

async def create_agent_session(db: AsyncSession, user_id: str, query: str) -> AgentSession:
    """Create a persistent agent session."""
    session = AgentSession(user_id=user_id, query=query, status="planning")
    db.add(session)
    await db.flush()
    _cancel_tokens[session.id] = False
    return session


async def get_session(db: AsyncSession, session_id: str) -> Optional[AgentSession]:
    result = await db.execute(
        select(AgentSession)
        .options(selectinload(AgentSession.steps))
        .where(AgentSession.id == session_id)
    )
    return result.scalar_one_or_none()


async def list_user_sessions(db: AsyncSession, user_id: str, limit: int = 50) -> list[AgentSession]:
    result = await db.execute(
        select(AgentSession)
        .where(AgentSession.user_id == user_id)
        .order_by(AgentSession.created_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


async def cancel_session(db: AsyncSession, session_id: str) -> bool:
    """Request cancellation of a running session."""
    _cancel_tokens[session_id] = True
    stmt = (
        update(AgentSession)
        .where(AgentSession.id == session_id, AgentSession.status.in_(["planning", "executing"]))
        .values(status="cancelled", updated_at=_utcnow())
    )
    result = await db.execute(stmt)
    return result.rowcount > 0


def _is_cancelled(session_id: str) -> bool:
    return _cancel_tokens.get(session_id, False)


# ── Plan generation ───────────────────────────────────────

async def generate_plan(query: str) -> list[dict]:
    """Use LLM to generate an execution plan for the query."""
    plan_prompt = (
        "You are a task planner. Given the user query, break it down into 2-5 clear, actionable steps.\n"
        "Each step should have: step_number, title, description, tool "
        "(one of: web_search, wikipedia, python_execute, generate_document, none).\n\n"
        f"User query: {query}\n\n"
        "Respond in JSON array format:\n"
        '[{"step": 1, "title": "...", "description": "...", "tool": "web_search"}]'
    )
    try:
        from mac.services.llm_service import chat_completion
        result = await chat_completion(
            model="auto",
            messages=[{"role": "user", "content": plan_prompt}],
            temperature=0.3,
            max_tokens=1024,
        )
        content = result["choices"][0]["message"]["content"]
        start = content.find("[")
        end = content.rfind("]") + 1
        if start >= 0 and end > start:
            plan = json.loads(content[start:end])
            plan = plan[:MAX_STEPS]
            for step in plan:
                if step.get("tool") not in ALLOWED_TOOLS:
                    step["tool"] = "none"
            return plan
    except Exception:
        pass
    # Fallback plan
    return [
        {"step": 1, "title": "Analyze Query", "description": "Understanding the request", "tool": "none"},
        {"step": 2, "title": "Research", "description": "Gathering information", "tool": "web_search"},
        {"step": 3, "title": "Generate Response", "description": "Creating the final output", "tool": "generate_document"},
    ]


# ── Tool execution ────────────────────────────────────────

async def execute_tool(tool_name: str, query: str, context: str = "") -> dict:
    """Execute a tool with timeout protection."""
    if tool_name not in ALLOWED_TOOLS or tool_name == "none":
        return {"type": "none", "content": "No tool execution needed"}
    try:
        return await asyncio.wait_for(
            _execute_tool_inner(tool_name, query, context),
            timeout=STEP_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        return {"type": tool_name, "error": f"Tool execution timed out after {STEP_TIMEOUT_SECONDS}s"}


async def _execute_tool_inner(tool_name: str, query: str, context: str) -> dict:
    if tool_name == "web_search":
        return await _tool_web_search(query)
    elif tool_name == "wikipedia":
        return await _tool_wikipedia(query)
    elif tool_name == "python_execute":
        return await _tool_python_sandbox(query, context)
    elif tool_name == "generate_document":
        return {"type": "document", "content": context, "format": "markdown"}
    return {"type": "none", "content": "Unknown tool"}


async def _tool_web_search(query: str) -> dict:
    try:
        from mac.services.search_service import web_search
        results = await web_search(query, num_results=5)
        return {"type": "search", "results": results, "source": "searxng"}
    except Exception as e:
        return {"type": "search", "results": [], "error": str(e)}


async def _tool_wikipedia(query: str) -> dict:
    try:
        from mac.services.search_service import wikipedia_search
        results = await wikipedia_search(query)
        return {"type": "wikipedia", "results": results}
    except Exception as e:
        return {"type": "wikipedia", "results": [], "error": str(e)}


async def _tool_python_sandbox(code: str, context: str = "") -> dict:
    """Execute Python code in a restricted sandbox."""
    BLOCKED = [
        "os.system", "subprocess", "shutil.rmtree", "__import__", "eval(", "exec(",
        "open(", "socket", "requests", "urllib", "importlib", "ctypes", "pickle",
        "compile(", "globals(", "locals(", "getattr(", "setattr(", "delattr(",
    ]
    for blocked in BLOCKED:
        if blocked in code:
            return {"type": "code", "output": "", "error": f"Blocked operation: {blocked}"}
    if len(code) > 10000:
        return {"type": "code", "output": "", "error": "Code too long (max 10000 chars)"}

    try:
        import io
        import contextlib
        output_buffer = io.StringIO()
        safe_globals = {"__builtins__": {
            "print": print, "len": len, "range": range, "int": int, "float": float,
            "str": str, "list": list, "dict": dict, "set": set, "tuple": tuple,
            "sum": sum, "min": min, "max": max, "sorted": sorted, "enumerate": enumerate,
            "zip": zip, "map": map, "filter": filter, "abs": abs, "round": round,
            "True": True, "False": False, "None": None, "bool": bool,
            "isinstance": isinstance, "type": type, "repr": repr,
        }}
        with contextlib.redirect_stdout(output_buffer):
            exec(code, safe_globals)
        output = output_buffer.getvalue()
        if len(output) > 50000:
            output = output[:50000] + "\n...[truncated]"
        return {"type": "code", "output": output, "error": None}
    except Exception as e:
        return {"type": "code", "output": "", "error": str(e)}


# ── Main execution engine ─────────────────────────────────

async def run_agent_session(session_id: str, db: AsyncSession) -> AsyncIterator[dict]:
    """Execute an agent session step by step, yielding SSE progress events.
    Persists state to DB at each checkpoint."""
    session = await get_session(db, session_id)
    if not session:
        yield {"event": "error", "message": "Session not found"}
        return

    start_time = time.time()

    # ── Planning phase ────────────────────────────────────
    session.status = "planning"
    yield {"event": "status", "status": "planning", "message": "Generating execution plan..."}

    plan = await generate_plan(session.query)
    session.plan = plan
    session.step_count = len(plan)

    for i, step_data in enumerate(plan):
        step = AgentStep(
            session_id=session_id,
            step_number=i + 1,
            title=step_data.get("title", f"Step {i + 1}"),
            description=step_data.get("description", ""),
            tool=step_data.get("tool", "none"),
            status="pending",
        )
        db.add(step)
    await db.flush()

    yield {"event": "plan", "plan": plan}

    if _is_cancelled(session_id):
        session.status = "cancelled"
        yield {"event": "cancelled", "message": "Session cancelled"}
        return

    # ── Execution phase ───────────────────────────────────
    session.status = "executing"
    accumulated_context = session.query

    session = await get_session(db, session_id)
    steps = sorted(session.steps, key=lambda s: s.step_number)

    for step in steps:
        if _is_cancelled(session_id):
            step.status = "skipped"
            session.status = "cancelled"
            yield {"event": "cancelled", "message": "Session cancelled during execution"}
            return

        elapsed = time.time() - start_time
        if elapsed > SESSION_TIMEOUT_SECONDS:
            step.status = "skipped"
            session.status = "timeout"
            session.error_message = f"Session exceeded {SESSION_TIMEOUT_SECONDS}s limit"
            yield {"event": "timeout", "message": session.error_message}
            return

        session.current_step = step.step_number
        step.status = "running"
        step.started_at = _utcnow()
        yield {
            "event": "step_start",
            "step": step.step_number,
            "title": step.title,
            "description": step.description or "",
        }

        tool = step.tool or "none"
        if tool != "none":
            result = await execute_tool(tool, session.query, accumulated_context)
            step.result = result

            if result.get("error"):
                step.status = "failed"
                step.error_message = result["error"]
            else:
                step.status = "completed"

            if result.get("type") == "search" and isinstance(result.get("results"), list):
                search_context = "\n".join([
                    f"- {r.get('title', '')}: {r.get('content', r.get('snippet', ''))}"
                    for r in result["results"][:5]
                ])
                accumulated_context += f"\n\nSearch results:\n{search_context}"

            yield {"event": "tool_result", "step": step.step_number, "tool": tool, "result": result}
        else:
            step.status = "completed"

        step.completed_at = _utcnow()
        yield {"event": "step_complete", "step": step.step_number}
        await db.flush()

    # ── Finalization ──────────────────────────────────────
    if _is_cancelled(session_id):
        session.status = "cancelled"
        yield {"event": "cancelled", "message": "Cancelled before finalization"}
        return

    yield {"event": "status", "status": "finalizing", "message": "Generating final response..."}

    try:
        from mac.services.llm_service import chat_completion
        final = await chat_completion(
            model="auto",
            messages=[{
                "role": "user",
                "content": (
                    f"Based on this research and context, provide a comprehensive answer:\n\n"
                    f"Original question: {session.query}\n\n"
                    f"Context gathered:\n{accumulated_context[:4000]}"
                ),
            }],
            temperature=0.7,
            max_tokens=2048,
        )
        final_content = final["choices"][0]["message"]["content"]
        session.final_response = final_content
        session.tokens_used = final.get("usage", {}).get("total_tokens", 0)
    except Exception as e:
        final_content = f"Agent completed research but could not generate final summary: {str(e)}"
        session.final_response = final_content

    session.status = "completed"
    session.latency_ms = int((time.time() - start_time) * 1000)
    session.updated_at = _utcnow()
    await db.flush()
    _cancel_tokens.pop(session_id, None)

    yield {"event": "complete", "response": final_content, "artifacts": []}
