"""
Kernel Manager — Multi-language code execution engine for MAC Notebooks.

Dual-backend architecture:
  1. Docker containers (production) — isolated, resource-limited, GPU-capable
  2. Subprocess fallback (dev) — runs code on the host directly

Worker nodes in the MAC cluster can execute notebook cells via the same engine.
"""

import asyncio
import os
import sys
import shutil
import time
import uuid
import tempfile
import logging
from datetime import datetime, timezone
from typing import AsyncGenerator
from mac.services.kernel_registry import KERNEL_REGISTRY

logger = logging.getLogger(__name__)


def _docker_available() -> bool:
    """Check if Docker CLI exists AND daemon is responding."""
    if shutil.which("docker") is None:
        return False
    try:
        import subprocess
        result = subprocess.run(
            ["docker", "info"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
        )
        return result.returncode == 0
    except Exception:
        return False


class KernelInstance:
    """Represents a running kernel instance."""

    def __init__(self, kernel_id: str, language: str, node_id: str | None = None):
        self.id = kernel_id
        self.language = language
        self.node_id = node_id
        self.container_id: str | None = None
        self.status: str = "starting"
        self.started_at = datetime.now(timezone.utc)
        self.last_activity = datetime.now(timezone.utc)
        self.resource_usage: dict = {}
        self.execution_count = 0
        self._process: asyncio.subprocess.Process | None = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "language": self.language,
            "status": self.status,
            "node_id": self.node_id,
            "container_id": self.container_id,
            "resource_usage": self.resource_usage,
            "started_at": self.started_at.isoformat(),
            "last_activity": self.last_activity.isoformat(),
            "execution_count": self.execution_count,
        }


class KernelManager:
    """Manages kernel lifecycles with Docker and subprocess backends."""

    def __init__(self):
        self._kernels: dict[str, KernelInstance] = {}
        self._language_kernels: dict[str, list[str]] = {}
        self._docker_ok: bool | None = None
        self._docker_checked_at: float = 0
        self._data_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data"))
        os.makedirs(self._data_dir, exist_ok=True)

    @property
    def docker_available(self) -> bool:
        now = time.monotonic()
        if self._docker_ok is None or (now - self._docker_checked_at) > 60:
            self._docker_ok = _docker_available()
            self._docker_checked_at = now
        return self._docker_ok

    async def _docker_image_exists(self, image: str) -> bool:
        import subprocess as _sp
        try:
            result = await asyncio.to_thread(
                _sp.run,
                ["docker", "image", "inspect", image],
                stdout=_sp.DEVNULL, stderr=_sp.DEVNULL, timeout=10,
            )
            return result.returncode == 0
        except Exception:
            return False

    # ──── Kernel Lifecycle ──────────────────────────────────

    async def launch_kernel(self, language: str, notebook_id: str | None = None) -> dict:
        lang_lower = language.lower()
        kernel_spec = KERNEL_REGISTRY.get(lang_lower)
        if not kernel_spec:
            raise ValueError(f"Unsupported language: {language}. Available: {list(KERNEL_REGISTRY.keys())}")

        kernel_id = str(uuid.uuid4())
        kernel = KernelInstance(kernel_id=kernel_id, language=lang_lower)
        kernel.status = "idle"

        self._kernels[kernel_id] = kernel
        self._language_kernels.setdefault(lang_lower, []).append(kernel_id)
        return kernel.to_dict()

    def list_kernels(self) -> list[dict]:
        return [k.to_dict() for k in self._kernels.values()]

    def get_kernel(self, kernel_id: str) -> dict | None:
        kernel = self._kernels.get(kernel_id)
        return kernel.to_dict() if kernel else None

    async def execute_code(
        self, kernel_id: str | None, code: str, language: str = "python"
    ) -> AsyncGenerator[dict, None]:
        """Execute code and yield output messages (stream/error/result)."""
        lang_lower = language.lower()
        kernel_spec = KERNEL_REGISTRY.get(lang_lower)
        if not kernel_spec:
            yield {
                "type": "error",
                "ename": "UnsupportedLanguage",
                "evalue": f"No kernel for '{language}'",
                "traceback": [],
            }
            return

        # Auto-launch kernel if needed
        kernel = self._kernels.get(kernel_id) if kernel_id else None
        if not kernel:
            result = await self.launch_kernel(language)
            kernel = self._kernels[result["id"]]

        kernel.status = "busy"
        kernel.last_activity = datetime.now(timezone.utc)
        kernel.execution_count += 1

        try:
            docker_image = kernel_spec.get("docker_image", "")
            use_docker = (
                self.docker_available
                and docker_image
                and await self._docker_image_exists(docker_image)
            )

            if use_docker:
                async for output in self._execute_docker(kernel, kernel_spec, code):
                    yield output
            else:
                async for output in self._execute_subprocess(kernel, kernel_spec, code):
                    yield output
        except Exception as e:
            yield {"type": "error", "ename": type(e).__name__, "evalue": str(e), "traceback": []}
        finally:
            kernel.status = "idle"

    # ──── Docker Execution (Production / Colab-style) ──────

    async def _execute_docker(
        self, kernel: KernelInstance, spec: dict, code: str
    ) -> AsyncGenerator[dict, None]:
        import subprocess as _sp

        file_ext = spec.get("file_extension", ".txt")
        docker_image = spec["docker_image"]

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=file_ext, delete=False, dir=self._data_dir
        ) as f:
            f.write(code)
            temp_path = f.name
            temp_name = os.path.basename(temp_path)

        try:
            base_args = [
                "docker", "run", "--rm",
                "--network", "none",
                "--memory", "4g",
                "--cpus", "2",
                "--pids-limit", "256",
            ]

            if self._has_nvidia_docker():
                base_args += ["--gpus", "all"]

            base_args += [
                "-v", f"{self._data_dir}:/workspace:rw",
                "-w", "/workspace",
                docker_image,
            ]

            compile_cmd = spec.get("compile_cmd")
            run_cmd = spec.get("run_cmd")

            if compile_cmd:
                compile_parts = " ".join(
                    c.replace("{file}", f"/workspace/{temp_name}")
                     .replace("{output}", f"/workspace/{temp_name}.out")
                    for c in compile_cmd
                )
                run_parts = " ".join(
                    c.replace("{file}", f"/workspace/{temp_name}")
                     .replace("{output}", f"/workspace/{temp_name}.out")
                    for c in (run_cmd or [f"/workspace/{temp_name}.out"])
                )
                cmd = base_args + ["bash", "-c", f"{compile_parts} && {run_parts}"]
            elif run_cmd:
                cmd_parts = [
                    c.replace("{file}", f"/workspace/{temp_name}")
                     .replace("{output}", f"/workspace/{temp_name}.out")
                    for c in run_cmd
                ]
                cmd = base_args + cmd_parts
            else:
                cmd = base_args + [spec.get("binary", "echo"), f"/workspace/{temp_name}"]

            try:
                result = await asyncio.to_thread(
                    _sp.run, cmd, capture_output=True, timeout=120,
                )
            except _sp.TimeoutExpired:
                yield {"type": "error", "ename": "TimeoutError", "evalue": "Execution timed out (120s)", "traceback": []}
                return

            stdout_text = result.stdout.decode("utf-8", errors="replace")
            stderr_text = result.stderr.decode("utf-8", errors="replace")

            if stdout_text:
                for line in stdout_text.splitlines(keepends=True):
                    yield {"type": "stream", "name": "stdout", "text": line}
            if stderr_text:
                for line in stderr_text.splitlines(keepends=True):
                    yield {"type": "stream", "name": "stderr", "text": line}

            if result.returncode != 0 and not stderr_text and not stdout_text:
                yield {
                    "type": "error",
                    "ename": "RuntimeError",
                    "evalue": f"Container exited with code {result.returncode}",
                    "traceback": [],
                }
        finally:
            for p in [temp_path, temp_path + ".out"]:
                try:
                    os.unlink(p)
                except OSError:
                    pass

    # ──── Subprocess Execution (Dev / Fallback) ────────────

    async def _execute_subprocess(
        self, kernel: KernelInstance, spec: dict, code: str
    ) -> AsyncGenerator[dict, None]:
        import subprocess as _sp

        file_ext = spec.get("file_extension", ".txt")
        compile_cmd = spec.get("compile_cmd")
        run_cmd_template = spec.get("run_cmd")

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=file_ext, delete=False, dir=self._data_dir
        ) as f:
            f.write(code)
            temp_path = f.name

        try:
            # Compile step (if needed)
            if compile_cmd:
                cmd = [
                    c.replace("{file}", temp_path).replace("{output}", temp_path + ".out")
                    for c in compile_cmd
                ]
                cmd = self._resolve_cmd(cmd)
                try:
                    result = await asyncio.to_thread(
                        _sp.run, cmd, capture_output=True, timeout=60,
                    )
                except FileNotFoundError:
                    binary = cmd[0] if cmd else "unknown"
                    yield {
                        "type": "error",
                        "ename": "CompilerNotFound",
                        "evalue": f"'{binary}' is not installed. Ask admin to install it.",
                        "traceback": [],
                    }
                    return
                if result.returncode != 0:
                    yield {
                        "type": "error",
                        "ename": "CompilationError",
                        "evalue": result.stderr.decode("utf-8", errors="replace"),
                        "traceback": [],
                    }
                    return

            # Run step
            if run_cmd_template:
                cmd = [
                    c.replace("{file}", temp_path).replace("{output}", temp_path + ".out")
                    for c in run_cmd_template
                ]
                cmd = self._resolve_cmd(cmd)
            else:
                binary = self._resolve_binary(spec.get("binary", "echo"))
                cmd = [binary, temp_path]

            try:
                result = await asyncio.to_thread(
                    _sp.run, cmd, capture_output=True, timeout=120,
                )
            except FileNotFoundError:
                binary = cmd[0] if cmd else "unknown"
                yield {
                    "type": "error",
                    "ename": "RuntimeNotFound",
                    "evalue": f"'{binary}' is not installed. Ask admin to install it.",
                    "traceback": [],
                }
                return
            except _sp.TimeoutExpired:
                yield {"type": "error", "ename": "TimeoutError", "evalue": "Execution timed out (120s)", "traceback": []}
                return

            stdout_text = result.stdout.decode("utf-8", errors="replace")
            stderr_text = result.stderr.decode("utf-8", errors="replace")

            if stdout_text:
                for line in stdout_text.splitlines(keepends=True):
                    yield {"type": "stream", "name": "stdout", "text": line}
            if stderr_text:
                for line in stderr_text.splitlines(keepends=True):
                    yield {"type": "stream", "name": "stderr", "text": line}

            if result.returncode != 0 and not stderr_text and not stdout_text:
                yield {
                    "type": "error",
                    "ename": "RuntimeError",
                    "evalue": f"Process exited with code {result.returncode}",
                    "traceback": [],
                }
        finally:
            for p in [temp_path, temp_path + ".out"]:
                try:
                    os.unlink(p)
                except OSError:
                    pass

    # ──── Helpers ──────────────────────────────────────────

    def _has_nvidia_docker(self) -> bool:
        if not hasattr(self, "_nvidia_docker_ok"):
            import subprocess as _sp
            try:
                result = _sp.run(
                    ["docker", "run", "--rm", "--gpus", "all", "hello-world"],
                    capture_output=True, timeout=15,
                )
                self._nvidia_docker_ok = result.returncode == 0
            except Exception:
                self._nvidia_docker_ok = False
        return self._nvidia_docker_ok

    def _resolve_binary(self, binary: str) -> str:
        if binary in ("python", "python3"):
            return sys.executable
        found = shutil.which(binary)
        return found if found else binary

    def _resolve_cmd(self, cmd: list[str]) -> list[str]:
        if not cmd:
            return cmd
        exe = cmd[0]
        if os.sep in exe or "/" in exe or exe.startswith("{") or exe.startswith("."):
            return cmd
        resolved = self._resolve_binary(exe)
        return [resolved] + cmd[1:]

    async def interrupt_kernel(self, kernel_id: str) -> bool:
        kernel = self._kernels.get(kernel_id)
        if not kernel:
            return False
        if kernel._process and kernel._process.returncode is None:
            kernel._process.terminate()
        kernel.status = "idle"
        return True

    async def restart_kernel(self, kernel_id: str) -> dict | None:
        kernel = self._kernels.get(kernel_id)
        if not kernel:
            return None
        await self.shutdown_kernel(kernel_id)
        return await self.launch_kernel(kernel.language)

    async def shutdown_kernel(self, kernel_id: str) -> bool:
        kernel = self._kernels.get(kernel_id)
        if not kernel:
            return False
        if kernel._process and kernel._process.returncode is None:
            kernel._process.terminate()
            try:
                await asyncio.wait_for(kernel._process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                kernel._process.kill()
        kernel.status = "dead"
        del self._kernels[kernel_id]
        lang_list = self._language_kernels.get(kernel.language, [])
        if kernel_id in lang_list:
            lang_list.remove(kernel_id)
        return True

    async def get_completions(self, kernel_id: str | None, code: str, cursor_pos: int) -> list[str]:
        return []

    def get_available_languages(self) -> list[dict]:
        result = []
        for lang, spec in KERNEL_REGISTRY.items():
            result.append({
                "language": lang,
                "display_name": spec.get("display_name", lang.title()),
                "file_extension": spec.get("file_extension", ""),
                "mime_type": spec.get("mime_type", "text/plain"),
                "docker_image": spec.get("docker_image", ""),
                "icon": spec.get("icon", ""),
                "color": spec.get("color", "#666"),
                "docker_available": self.docker_available,
            })
        return result

    def get_execution_mode(self) -> str:
        return "docker" if self.docker_available else "subprocess"


# Singleton
kernel_manager = KernelManager()
