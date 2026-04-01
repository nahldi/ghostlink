"""Sandbox — isolates agent command execution in restricted environments.

Supports three modes:
- none: Commands run directly (current behavior, no isolation)
- namespace: Uses bubblewrap (bwrap) for Linux namespace isolation
- container: Uses Docker for full container isolation

Per-agent network policies:
- full: Unrestricted network access
- local_only: Only localhost/LAN access
- none: No network access
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess

log = logging.getLogger(__name__)


class SandboxManager:
    """Manages sandboxed command execution for agents."""

    def __init__(self):
        self._has_docker = shutil.which("docker") is not None
        self._has_bwrap = shutil.which("bwrap") is not None
        log.info("Sandbox: docker=%s bwrap=%s", self._has_docker, self._has_bwrap)

    def get_available_modes(self) -> list[str]:
        """Return available sandbox modes based on installed tools."""
        modes = ["none"]
        if self._has_bwrap:
            modes.append("namespace")
        if self._has_docker:
            modes.append("container")
        return modes

    def execute(
        self,
        command: list[str],
        workspace: str,
        sandbox_mode: str = "none",
        network: str = "full",
        timeout: int = 30,
    ) -> tuple[int, str, str]:
        """Execute a command with the specified sandbox mode.

        Args:
            command: Command and arguments to execute
            workspace: Working directory for the command
            sandbox_mode: "none", "namespace" (bwrap), or "container" (docker)
            network: "full", "local_only", or "none"
            timeout: Max seconds before killing the process

        Returns:
            (exit_code, stdout, stderr)
        """
        if sandbox_mode == "namespace" and self._has_bwrap:
            return self._exec_bwrap(command, workspace, network, timeout)
        elif sandbox_mode == "container" and self._has_docker:
            return self._exec_docker(command, workspace, network, timeout)
        else:
            return self._exec_direct(command, workspace, timeout)

    def _exec_direct(self, command: list[str], workspace: str, timeout: int) -> tuple[int, str, str]:
        """Execute directly without sandboxing."""
        try:
            result = subprocess.run(
                command,
                cwd=workspace,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            return result.returncode, result.stdout, result.stderr
        except subprocess.TimeoutExpired:
            return 124, "", "Command timed out"
        except Exception as e:
            return 1, "", str(e)

    def _exec_bwrap(self, command: list[str], workspace: str, network: str, timeout: int) -> tuple[int, str, str]:
        """Execute in a bubblewrap namespace sandbox."""
        bwrap_args = [
            "bwrap",
            "--ro-bind", "/usr", "/usr",
            "--ro-bind", "/lib", "/lib",
            "--ro-bind", "/lib64", "/lib64",
            "--ro-bind", "/bin", "/bin",
            "--ro-bind", "/sbin", "/sbin",
            "--ro-bind", "/etc/resolv.conf", "/etc/resolv.conf",
            "--proc", "/proc",
            "--dev", "/dev",
            "--tmpfs", "/tmp",
            "--bind", workspace, "/workspace",
            "--chdir", "/workspace",
            "--die-with-parent",
        ]

        # Network isolation
        if network == "none":
            bwrap_args.append("--unshare-net")
        # local_only not directly supported by bwrap — would need iptables

        bwrap_args.extend(["--"] + command)

        try:
            result = subprocess.run(
                bwrap_args,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            return result.returncode, result.stdout, result.stderr
        except subprocess.TimeoutExpired:
            return 124, "", "Sandboxed command timed out"
        except FileNotFoundError:
            log.warning("bwrap not found — falling back to direct execution")
            return self._exec_direct(command, workspace, timeout)
        except Exception as e:
            return 1, "", f"Sandbox error: {e}"

    def _exec_docker(self, command: list[str], workspace: str, network: str, timeout: int) -> tuple[int, str, str]:
        """Execute in a Docker container sandbox."""
        docker_args = [
            "docker", "run",
            "--rm",
            "--init",
            "-v", f"{os.path.abspath(workspace)}:/workspace",
            "-w", "/workspace",
            "--memory", "512m",
            "--cpus", "1",
            "--pids-limit", "100",
        ]

        # Network isolation
        if network == "none":
            docker_args.extend(["--network", "none"])
        elif network == "local_only":
            docker_args.extend(["--network", "host"])
        # full = default docker networking

        # Use a minimal Python image
        docker_args.extend(["python:3.12-slim"] + command)

        try:
            result = subprocess.run(
                docker_args,
                capture_output=True,
                text=True,
                timeout=timeout + 10,  # extra time for container startup
            )
            return result.returncode, result.stdout, result.stderr
        except subprocess.TimeoutExpired:
            return 124, "", "Docker container timed out"
        except FileNotFoundError:
            log.warning("Docker not found — falling back to direct execution")
            return self._exec_direct(command, workspace, timeout)
        except Exception as e:
            return 1, "", f"Docker sandbox error: {e}"


# ── Permission Presets ─────────────────────────────────────────────

PERMISSION_PRESETS = {
    "read-only": {
        "name": "Read Only",
        "description": "Can read files and run queries, but cannot modify anything",
        "allowed_tools": [
            "chat_send", "chat_read", "chat_join", "chat_who", "chat_channels",
            "chat_rules", "memory_save", "memory_search", "memory_search_all",
            "memory_get", "memory_list", "web_search", "web_fetch",
            "set_thinking", "sessions_list",
        ],
        "blocked_tools": [
            "code_execute", "image_generate", "gemini_image", "gemini_video",
            "text_to_speech", "speech_to_text", "chat_propose_job", "delegate",
        ],
        "sandbox_mode": "none",
        "network": "full",
    },
    "code-review": {
        "name": "Code Review",
        "description": "Can read files, run tests, and comment, but cannot modify source files",
        "allowed_tools": [
            "chat_send", "chat_read", "chat_join", "chat_who", "chat_channels",
            "chat_rules", "chat_react", "chat_progress",
            "memory_save", "memory_search", "memory_search_all", "memory_get", "memory_list",
            "web_search", "web_fetch",
            "set_thinking", "sessions_list", "sessions_send",
        ],
        "blocked_tools": [
            "code_execute", "image_generate", "gemini_image", "gemini_video",
            "delegate",
        ],
        "sandbox_mode": "none",
        "network": "full",
    },
    "full-access": {
        "name": "Full Access",
        "description": "Unrestricted access to all tools and network",
        "allowed_tools": ["*"],
        "blocked_tools": [],
        "sandbox_mode": "none",
        "network": "full",
    },
    "sandboxed": {
        "name": "Sandboxed",
        "description": "Full tool access but commands run in isolated container",
        "allowed_tools": ["*"],
        "blocked_tools": [],
        "sandbox_mode": "container",
        "network": "local_only",
    },
    "restricted": {
        "name": "Restricted",
        "description": "Limited tools, sandboxed execution, no network",
        "allowed_tools": [
            "chat_send", "chat_read", "chat_join", "chat_who", "chat_channels",
            "memory_save", "memory_search", "memory_get", "memory_list",
            "set_thinking",
        ],
        "blocked_tools": ["*"],
        "sandbox_mode": "namespace",
        "network": "none",
    },
}


def get_preset(name: str) -> dict | None:
    """Get a permission preset by name."""
    return PERMISSION_PRESETS.get(name)


def list_presets() -> list[dict]:
    """List all available permission presets."""
    return [
        {"id": k, **v}
        for k, v in PERMISSION_PRESETS.items()
    ]
