"""MBM Book IDE — container lifecycle, load balancer, file operations.

Each user gets exactly one Docker workspace container.
Container is created on session start and removed on logout.
Workspace volume persists so files survive between sessions.

Load balancer scores active cluster nodes by CPU + RAM headroom
and provisions the container on the best available node.
Falls back to the local Docker socket if no remote nodes are reachable.
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import re
import tarfile
import uuid
from datetime import datetime, timezone, timedelta
from typing import AsyncGenerator

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mac.database import async_session
from mac.models.mbmbook_session import MBMBookSession
from mac.models.node import WorkerNode

# ── Docker SDK (optional — graceful fallback if not installed) ─
try:
    import docker as _docker_sdk
    _docker_available = True
except ImportError:
    _docker_available = False

WORKSPACE_IMAGE = os.environ.get("MBMBOOK_IMAGE", "mbmbook-workspace:latest")
CONTAINER_PREFIX = "mbmbook-"
VOLUME_PREFIX = "mbmbook-ws-"
IDLE_TIMEOUT_MINUTES = int(os.environ.get("MBMBOOK_IDLE_TIMEOUT", "60"))


# ── Docker client helpers ──────────────────────────────────────

def _local_client():
    """Return a Docker client for the local socket."""
    if not _docker_available:
        raise RuntimeError("docker-py not installed — run: pip install docker")
    return _docker_sdk.from_env(timeout=10)


def _remote_client(node_ip: str):
    """Return a Docker client that talks to a remote node over TCP."""
    if not _docker_available:
        raise RuntimeError("docker-py not installed — run: pip install docker")
    return _docker_sdk.DockerClient(base_url=f"tcp://{node_ip}:2375", timeout=10)


def _client_for_session(session: MBMBookSession):
    """Return the right Docker client for a given session."""
    if session.node_ip == "local" or not session.node_ip:
        return _local_client()
    return _remote_client(session.node_ip)


# ── Node scoring / load balancer ──────────────────────────────

async def _pick_best_node(db: AsyncSession) -> tuple[str, str | None]:
    """
    Return (node_ip, node_id) of the least-loaded active worker node.
    Falls back to ("local", None) if none are reachable or registered.
    """
    result = await db.execute(
        select(WorkerNode).where(WorkerNode.status == "active")
    )
    nodes: list[WorkerNode] = list(result.scalars().all())

    if not nodes:
        return "local", None

    best_node = None
    best_score = -1.0

    for node in nodes:
        # Skip nodes without heartbeat in last 5 minutes
        if node.last_heartbeat:
            age = (datetime.now(timezone.utc) - node.last_heartbeat).total_seconds()
            if age > 300:
                continue

        # Score: average of free CPU% and free RAM%
        cpu_free = (100.0 - (node.cpu_util_pct or 50.0))
        ram_free = 50.0
        if node.ram_total_mb and node.ram_total_mb > 0:
            ram_free = 100.0 * (1.0 - (node.ram_used_mb or 0) / node.ram_total_mb)

        # Penalise nodes already at max resource threshold
        if cpu_free < (100 - node.max_resource_pct):
            continue

        score = cpu_free * 0.5 + ram_free * 0.5

        # Quick reachability probe (optional, runs in background)
        try:
            c = _remote_client(node.ip_address)
            await asyncio.get_event_loop().run_in_executor(None, c.ping)
        except Exception:
            continue

        if score > best_score:
            best_score = score
            best_node = node

    if best_node:
        return best_node.ip_address, best_node.id
    return "local", None


# ── Session lifecycle ─────────────────────────────────────────

async def get_session(db: AsyncSession, user_id: str) -> MBMBookSession | None:
    result = await db.execute(
        select(MBMBookSession).where(MBMBookSession.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def start_session(db: AsyncSession, user_id: str, username: str) -> MBMBookSession:
    """
    Ensure the user has a running container.
    Creates one if it doesn't exist or was previously stopped.
    """
    session = await get_session(db, user_id)

    # Reuse running session
    if session and session.status == "running":
        session.last_activity = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(session)
        return session

    # Determine target node
    node_ip, node_id = await _pick_best_node(db)

    safe_name = re.sub(r"[^a-z0-9]", "", username.lower())[:12] or user_id[:8]
    container_name = f"{CONTAINER_PREFIX}{safe_name}-{user_id[:6]}"
    volume_name = f"{VOLUME_PREFIX}{user_id[:8]}"

    if not session:
        session = MBMBookSession(
            user_id=user_id,
            container_name=container_name,
            volume_name=volume_name,
            node_ip=node_ip,
            node_id=node_id,
            status="starting",
        )
        db.add(session)
    else:
        session.status = "starting"
        session.container_id = None
        session.node_ip = node_ip
        session.node_id = node_id
        session.error_message = None

    await db.commit()
    await db.refresh(session)

    # Spawn container in background
    asyncio.create_task(_provision_container(session.id, container_name, volume_name, node_ip))
    return session


async def _provision_container(
    session_id: str,
    container_name: str,
    volume_name: str,
    node_ip: str,
):
    """Background task: actually start the Docker container."""
    async with async_session() as db:
        result = await db.execute(select(MBMBookSession).where(MBMBookSession.id == session_id))
        session = result.scalar_one_or_none()
        if not session:
            return

        try:
            loop = asyncio.get_event_loop()
            cid = await loop.run_in_executor(
                None,
                lambda: _create_and_start_container(container_name, volume_name, node_ip),
            )
            session.container_id = cid
            session.status = "running"
        except Exception as exc:
            session.status = "error"
            session.error_message = str(exc)[:500]

        await db.commit()


def _create_and_start_container(container_name: str, volume_name: str, node_ip: str) -> str:
    """Synchronous Docker operations (run in executor)."""
    client = _remote_client(node_ip) if node_ip != "local" else _local_client()

    # Remove any stale container with the same name
    try:
        old = client.containers.get(container_name)
        old.remove(force=True)
    except Exception:
        pass

    # Ensure volume exists
    try:
        client.volumes.get(volume_name)
    except Exception:
        client.volumes.create(name=volume_name)

    container = client.containers.run(
        WORKSPACE_IMAGE,
        name=container_name,
        command=["/bin/bash", "--login"],
        stdin_open=True,
        tty=True,
        detach=True,
        network_mode="bridge",
        volumes={volume_name: {"bind": "/workspace", "mode": "rw"}},
        working_dir="/workspace",
        mem_limit="4g",
        nano_cpus=int(2e9),     # 2 CPU cores
        pids_limit=512,
        environment={
            "TERM": "xterm-256color",
            "HOME": "/home/user",
            "USER": "user",
        },
        restart_policy={"Name": "no"},
        auto_remove=False,
    )
    return container.id


async def stop_session(db: AsyncSession, user_id: str) -> None:
    """Stop and remove the user's container. Volume is kept."""
    session = await get_session(db, user_id)
    if not session:
        return

    if session.container_id:
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                lambda: _stop_and_remove(session.container_name, session.node_ip),
            )
        except Exception:
            pass

    session.status = "stopped"
    session.container_id = None
    session.stopped_at = datetime.now(timezone.utc)
    await db.commit()


def _stop_and_remove(container_name: str, node_ip: str) -> None:
    """Synchronous: stop + rm container, keep volume."""
    try:
        client = _remote_client(node_ip) if node_ip != "local" else _local_client()
        c = client.containers.get(container_name)
        c.stop(timeout=5)
        c.remove(force=True)
    except Exception:
        pass


async def delete_workspace_volume(db: AsyncSession, user_id: str) -> None:
    """Permanently delete the workspace volume (all files gone)."""
    session = await get_session(db, user_id)
    if not session:
        return
    if session.status == "running":
        await stop_session(db, user_id)

    try:
        loop = asyncio.get_event_loop()
        node_ip = session.node_ip
        vol_name = session.volume_name
        await loop.run_in_executor(
            None,
            lambda: _remove_volume(vol_name, node_ip),
        )
    except Exception:
        pass

    await db.delete(session)
    await db.commit()


def _remove_volume(volume_name: str, node_ip: str) -> None:
    try:
        client = _remote_client(node_ip) if node_ip != "local" else _local_client()
        vol = client.volumes.get(volume_name)
        vol.remove(force=True)
    except Exception:
        pass


# ── File operations ───────────────────────────────────────────

def _exec_in_container(container, cmd: list[str], workdir: str = "/workspace") -> tuple[int, str, str]:
    """Run a command in a container and return (exit_code, stdout, stderr)."""
    result = container.exec_run(
        cmd,
        workdir=workdir,
        user="user",
        demux=True,
        environment={"HOME": "/home/user"},
    )
    exit_code = result.exit_code or 0
    stdout = (result.output[0] or b"").decode("utf-8", errors="replace")
    stderr = (result.output[1] or b"").decode("utf-8", errors="replace")
    return exit_code, stdout, stderr


async def list_files(session: MBMBookSession, path: str = "/workspace") -> list[dict]:
    """List files and directories in the container workspace."""
    if not _docker_available or not session.container_id:
        return []

    # Clean path
    path = _safe_path(path)
    cmd = ["find", path, "-maxdepth", "3", "-printf", "%y|%P|%s|%TY-%Tm-%Td %TH:%TM\\n"]

    def _run():
        client = _client_for_session(session)
        container = client.containers.get(session.container_name)
        _, stdout, _ = _exec_in_container(container, cmd, workdir=path)
        return stdout

    try:
        loop = asyncio.get_event_loop()
        output = await loop.run_in_executor(None, _run)
    except Exception:
        return []

    entries = []
    for line in output.strip().splitlines():
        parts = line.split("|", 3)
        if len(parts) < 2:
            continue
        ftype, fpath = parts[0], parts[1]
        size = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 0
        mtime = parts[3] if len(parts) > 3 else ""
        if not fpath:
            continue
        entries.append({
            "path": fpath,
            "type": "dir" if ftype == "d" else "file",
            "size": size,
            "mtime": mtime,
        })
    return entries


async def read_file(session: MBMBookSession, file_path: str) -> bytes:
    """Read a file from the container and return its raw bytes."""
    safe = _safe_path(file_path)

    def _run():
        client = _client_for_session(session)
        container = client.containers.get(session.container_name)
        bits, _ = container.get_archive(safe)
        buf = io.BytesIO()
        for chunk in bits:
            buf.write(chunk)
        buf.seek(0)
        with tarfile.open(fileobj=buf) as tf:
            members = tf.getmembers()
            if not members:
                return b""
            f = tf.extractfile(members[-1])
            return f.read() if f else b""

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _run)


async def write_file(session: MBMBookSession, file_path: str, content: bytes | str) -> None:
    """Write content to a file in the container (creates directories as needed)."""
    safe = _safe_path(file_path)
    if isinstance(content, str):
        content = content.encode("utf-8")

    # Build an in-memory tar with just this file
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tf:
        info = tarfile.TarInfo(name=os.path.basename(safe))
        info.size = len(content)
        tf.addfile(info, io.BytesIO(content))
    buf.seek(0)
    tar_data = buf.read()

    dest_dir = os.path.dirname(safe) or "/workspace"

    def _run():
        client = _client_for_session(session)
        container = client.containers.get(session.container_name)
        # Ensure directory exists
        container.exec_run(["mkdir", "-p", dest_dir], user="user")
        container.put_archive(dest_dir, tar_data)

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _run)


async def delete_path(session: MBMBookSession, file_path: str) -> None:
    """Delete a file or directory inside the container workspace."""
    safe = _safe_path(file_path)

    def _run():
        client = _client_for_session(session)
        container = client.containers.get(session.container_name)
        _exec_in_container(container, ["rm", "-rf", safe])

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _run)


async def create_directory(session: MBMBookSession, dir_path: str) -> None:
    safe = _safe_path(dir_path)

    def _run():
        client = _client_for_session(session)
        container = client.containers.get(session.container_name)
        _exec_in_container(container, ["mkdir", "-p", safe])

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _run)


# ── Background cleanup ────────────────────────────────────────

async def cleanup_idle_sessions():
    """Stop containers that have been idle longer than IDLE_TIMEOUT_MINUTES."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=IDLE_TIMEOUT_MINUTES)
    async with async_session() as db:
        result = await db.execute(
            select(MBMBookSession).where(
                MBMBookSession.status == "running",
                MBMBookSession.last_activity < cutoff,
            )
        )
        idle = result.scalars().all()
        for s in idle:
            await stop_session(db, s.user_id)


async def cleanup_loop():
    """Run idle-session cleanup every 15 minutes."""
    while True:
        await asyncio.sleep(900)
        try:
            await cleanup_idle_sessions()
        except Exception:
            pass


# ── Path safety ───────────────────────────────────────────────

def _safe_path(path: str) -> str:
    """Ensure path is inside /workspace and has no traversal."""
    path = path.strip()
    if not path.startswith("/"):
        path = "/workspace/" + path
    # Resolve relative traversal segments
    clean = os.path.normpath(path)
    if not clean.startswith("/workspace"):
        clean = "/workspace"
    return clean
