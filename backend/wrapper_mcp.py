"""MCP-native agent runner — persistent pipe mode.

Replaces tmux-based wrapper_unix.py with a long-lived subprocess
communicating via structured JSON on stdin/stdout.

Architecture:
    GhostLink spawns: claude -p --input-format stream-json --output-format stream-json --verbose
    → Process stays alive as long as stdin is open
    → User messages sent as JSON on stdin
    → Responses, tool use, and approval events read from stdout
    → Approvals handled via control_request/control_response protocol
    → Session context persists across turns (no restart per message)

Benefits over tmux wrapper:
    - No tmux dependency
    - Structured JSON instead of terminal scraping
    - Approval events as data (not regex on pane output)
    - Cleaner process lifecycle (one subprocess, stdin/stdout pipes)
    - Works natively on Windows (no WSL tmux needed)
    - Cost/usage tracking per turn from structured result data
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable

log = logging.getLogger(__name__)

# How long to wait for a result after sending a message (seconds)
TURN_TIMEOUT = 300
# How long to wait for process startup / init message
STARTUP_TIMEOUT = 30
# Max invocations to keep in the log ring buffer
MAX_LOG_ENTRIES = 100


class MCPAgentProcess:
    """Manages a persistent Claude CLI subprocess with stream-json I/O."""

    def __init__(
        self,
        command: str,
        extra_args: list[str],
        cwd: str,
        env: dict[str, str],
        agent_name: str,
        server_port: int = 8300,
        mcp_config: str | None = None,
        resume_session: str | None = None,
    ):
        self.command = command
        self.extra_args = extra_args
        self.cwd = str(Path(cwd).resolve())
        self.env = dict(env)
        self.agent_name = agent_name
        self.server_port = server_port
        self.mcp_config = mcp_config
        # If resume_session is set, use --resume to pick up previous context.
        # Otherwise start a fresh session with a new ID.
        self._resume_id = resume_session
        self.session_id = resume_session or str(uuid.uuid4())

        self._proc: subprocess.Popen | None = None
        self._alive = False
        self._lock = threading.Lock()
        self._stdout_thread: threading.Thread | None = None
        self._pending_results: dict[str, threading.Event] = {}
        self._last_result: dict[str, Any] | None = None
        self._init_event = threading.Event()
        self._init_data: dict[str, Any] | None = None
        self._turn_active = threading.Event()

        # Invocation log for frontend display
        self._invocation_log: list[dict] = []

        # Approval callback — set by the wrapper to route approvals to chat
        self.on_approval_request: Callable[[dict], dict | None] | None = None
        # Thinking/streaming callback
        self.on_stream_event: Callable[[dict], None] | None = None
        # Assistant message callback
        self.on_assistant_message: Callable[[dict], None] | None = None

    def _build_cmd(self) -> list[str]:
        cmd = [
            self.command, "-p",
            "--input-format", "stream-json",
            "--output-format", "stream-json",
            "--verbose",
        ]
        if self._resume_id:
            cmd.extend(["--resume", self._resume_id])
        else:
            cmd.extend(["--session-id", self.session_id])
        if self.mcp_config:
            cmd.extend(["--mcp-config", self.mcp_config])
        for arg in self.extra_args:
            if arg in ("--headless", "--print", "--output-format", "--input-format"):
                continue  # Skip flags we're already setting
            cmd.append(arg)
        return cmd

    def start(self) -> bool:
        """Start the persistent Claude subprocess."""
        cmd = self._build_cmd()
        log.info("Starting MCP agent %s: %s", self.agent_name, " ".join(cmd))
        log.info("  CWD: %s, Session: %s", self.cwd, self.session_id)

        try:
            self._proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=self.cwd,
                env=self.env,
                text=True,
                bufsize=1,  # Line-buffered
            )
        except FileNotFoundError:
            log.error("Command not found: %s", self.command)
            return False
        except Exception as e:
            log.error("Failed to start MCP agent %s: %s", self.agent_name, e)
            return False

        self._alive = True

        # Start stdout reader thread
        self._stdout_thread = threading.Thread(
            target=self._read_stdout_loop,
            name=f"mcp-stdout-{self.agent_name}",
            daemon=True,
        )
        self._stdout_thread.start()

        # Start stderr drain thread
        threading.Thread(
            target=self._drain_stderr,
            name=f"mcp-stderr-{self.agent_name}",
            daemon=True,
        ).start()

        # Wait briefly for init message — but don't block startup on it.
        # Some Claude versions emit init only after the first user message,
        # so treat init as informational, not required.
        if self._init_event.wait(timeout=5):
            log.info("MCP agent %s started. Model: %s, Tools: %d",
                     self.agent_name,
                     self._init_data.get("model", "?") if self._init_data else "?",
                     len(self._init_data.get("tools", [])) if self._init_data else 0)
        else:
            # Process is alive but init hasn't arrived yet — that's OK.
            # Init may come after first user message.
            if self._proc.poll() is not None:
                log.error("MCP agent %s process exited during startup (code %d)",
                          self.agent_name, self._proc.returncode)
                self._alive = False
                return False
            log.info("MCP agent %s started (init pending — will arrive on first message)",
                     self.agent_name)
        return True

    def _write_stdin(self, obj: dict):
        """Write a JSON line to the subprocess stdin."""
        if not self._proc or not self._proc.stdin:
            return
        try:
            line = json.dumps(obj, separators=(",", ":")) + "\n"
            self._proc.stdin.write(line)
            self._proc.stdin.flush()
        except (BrokenPipeError, OSError) as e:
            log.warning("MCP agent %s stdin write failed: %s", self.agent_name, e)
            self._alive = False

    def send_message(self, content: str) -> dict | None:
        """Send a user message and wait for the turn to complete.

        Returns the result dict or None on timeout/error.
        """
        if not self._alive:
            log.warning("MCP agent %s is not alive, cannot send message", self.agent_name)
            return None

        msg = {
            "type": "user",
            "message": {
                "role": "user",
                "content": content,
            },
        }

        start_time = time.time()
        self._last_result = None
        self._turn_active.clear()

        self._write_stdin(msg)

        # Wait for result message
        self._turn_active.wait(timeout=TURN_TIMEOUT)
        duration_ms = int((time.time() - start_time) * 1000)

        result = self._last_result
        entry = {
            "timestamp": time.time(),
            "duration_ms": duration_ms,
            "prompt": content[:200],
            "session_id": self.session_id,
            "agent": self.agent_name,
        }

        if result:
            entry.update({
                "status": "success",
                "result_type": result.get("subtype", "unknown"),
                "result_text": str(result.get("result", ""))[:500],
                "cost_usd": result.get("total_cost_usd"),
                "num_turns": result.get("num_turns"),
                "usage": result.get("usage"),
            })
        else:
            entry["status"] = "timeout" if not self._alive else "no_result"

        self._log_invocation(entry)
        return result

    def respond_to_approval(self, request_id: str, behavior: str, message: str = ""):
        """Send a control_response for an approval request."""
        response: dict[str, Any] = {"behavior": behavior}
        if message:
            response["message"] = message

        self._write_stdin({
            "type": "control_response",
            "request_id": request_id,
            "response": {
                "subtype": "success",
                "response": response,
            },
        })

    def _read_stdout_loop(self):
        """Read NDJSON lines from stdout and dispatch by type."""
        assert self._proc and self._proc.stdout
        try:
            for line in self._proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    log.debug("MCP agent %s non-JSON stdout: %s", self.agent_name, line[:200])
                    continue

                msg_type = msg.get("type", "")
                self._dispatch_message(msg_type, msg)
        except Exception as e:
            log.error("MCP agent %s stdout reader error: %s", self.agent_name, e)
        finally:
            self._alive = False
            self._init_event.set()  # Unblock startup wait if still waiting
            self._turn_active.set()  # Unblock any pending send_message
            log.info("MCP agent %s stdout reader exited", self.agent_name)

    def _dispatch_message(self, msg_type: str, msg: dict):
        """Route a parsed stdout message to the appropriate handler."""
        if msg_type == "system":
            subtype = msg.get("subtype", "")
            if subtype == "init":
                self._init_data = msg
                self._init_event.set()
                log.info("MCP agent %s init: model=%s", self.agent_name, msg.get("model"))
            elif subtype == "api_retry":
                log.warning("MCP agent %s API retry: attempt %d, error %s",
                            self.agent_name, msg.get("attempt"), msg.get("error"))

        elif msg_type == "assistant":
            if self.on_assistant_message:
                try:
                    self.on_assistant_message(msg)
                except Exception as e:
                    log.error("on_assistant_message callback error: %s", e)
            # Post thinking/output to terminal stream
            self._post_terminal_output(msg)

        elif msg_type == "user":
            # Tool result from the CLI — informational
            pass

        elif msg_type == "control_request":
            self._handle_approval(msg)

        elif msg_type == "stream_event":
            if self.on_stream_event:
                try:
                    self.on_stream_event(msg)
                except Exception as e:
                    log.debug("on_stream_event callback error: %s", e)

        elif msg_type == "result":
            self._last_result = msg
            self._turn_active.set()  # Unblock send_message
            denials = msg.get("permission_denials", [])
            if denials:
                log.info("MCP agent %s: %d permission denials: %s",
                         self.agent_name, len(denials),
                         ", ".join(str(d) for d in denials[:5]))
                self._post_permission_denials(denials)
            log.info("MCP agent %s turn complete: subtype=%s cost=$%.4f",
                     self.agent_name,
                     msg.get("subtype", "?"),
                     msg.get("total_cost_usd", 0))

    def _handle_approval(self, msg: dict):
        """Handle a control_request (permission prompt) from the agent."""
        request_id = msg.get("request_id", "")
        request = msg.get("request", {})
        tool_name = request.get("tool_name", "")
        tool_input = request.get("input", {})

        log.info("MCP agent %s approval request: %s for tool %s",
                 self.agent_name, request_id, tool_name)

        # Check if GhostLink MCP tools should be auto-approved
        ghostlink_tools = {
            "chat_send", "chat_read", "chat_join", "chat_who", "chat_rules",
            "chat_propose_job", "memory_save", "memory_load", "memory_search",
            "web_fetch", "web_search", "image_generate", "set_thinking",
        }
        if tool_name in ghostlink_tools:
            self.respond_to_approval(request_id, "allow")
            log.debug("Auto-approved GhostLink tool: %s", tool_name)
            return

        # Route to external approval handler (posts to chat)
        if self.on_approval_request:
            try:
                response = self.on_approval_request({
                    "request_id": request_id,
                    "tool_name": tool_name,
                    "input": tool_input,
                    "agent": self.agent_name,
                })
                if response:
                    behavior = response.get("behavior", "deny")
                    self.respond_to_approval(request_id, behavior, response.get("message", ""))
                    return
            except Exception as e:
                log.error("Approval callback error: %s", e)

        # Default: deny if no handler responded
        self.respond_to_approval(request_id, "deny", "No approval handler configured")

    def _post_permission_denials(self, denials: list):
        """Post permission denial info to the chat so users know what was blocked."""
        if not denials:
            return
        denied_tools = []
        for d in denials[:10]:
            if isinstance(d, dict):
                denied_tools.append(d.get("tool", d.get("tool_name", str(d))))
            else:
                denied_tools.append(str(d))
        text = f"Permission denied for: {', '.join(denied_tools)}. To allow these tools, adjust the agent's permission preset in Settings."
        try:
            import urllib.request
            body = json.dumps({
                "sender": self.agent_name,
                "text": text,
                "type": "system",
                "channel": "general",
            }).encode()
            req = urllib.request.Request(
                f"http://127.0.0.1:{self.server_port}/api/send",
                data=body, method="POST",
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=5)
        except Exception:
            pass

    def _post_terminal_output(self, msg: dict):
        """Post assistant message content to the terminal stream endpoint."""
        message = msg.get("message", {})
        content_blocks = message.get("content", [])
        text_parts = []
        for block in content_blocks:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    text_parts.append(block.get("text", ""))
                elif block.get("type") == "tool_use":
                    text_parts.append(f"[tool: {block.get('name', '?')}]")
        if not text_parts:
            return

        output = "\n".join(text_parts)
        try:
            import urllib.request
            body = json.dumps({
                "agent": self.agent_name,
                "output": output[-12000:],
                "active": True,
                "updated_at": time.time(),
                "runner": "mcp",
            }).encode()
            req = urllib.request.Request(
                f"http://127.0.0.1:{self.server_port}/api/agents/{self.agent_name}/terminal/stream",
                data=body, method="POST",
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=5)
        except Exception:
            pass

    def _drain_stderr(self):
        """Read and log stderr to prevent pipe buffer deadlock."""
        assert self._proc and self._proc.stderr
        try:
            for line in self._proc.stderr:
                line = line.rstrip()
                if line:
                    log.debug("MCP agent %s stderr: %s", self.agent_name, line[:500])
        except Exception:
            pass

    def _log_invocation(self, entry: dict):
        """Store invocation result and POST to server for frontend display."""
        self._invocation_log.append(entry)
        while len(self._invocation_log) > MAX_LOG_ENTRIES:
            self._invocation_log.pop(0)
        try:
            import urllib.request
            body = json.dumps(entry).encode()
            req = urllib.request.Request(
                f"http://127.0.0.1:{self.server_port}/api/agents/{self.agent_name}/mcp/log",
                data=body, method="POST",
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=5)
        except Exception:
            pass

    @property
    def is_alive(self) -> bool:
        if not self._proc:
            return False
        if self._proc.poll() is not None:
            self._alive = False
        return self._alive

    def stop(self):
        """Gracefully stop the agent process and ensure it's fully reaped."""
        self._alive = False
        if not self._proc:
            return
        # Close stdin first to signal the process to exit
        try:
            if self._proc.stdin and not self._proc.stdin.closed:
                self._proc.stdin.close()
        except Exception:
            pass
        # Try graceful termination
        if self._proc.poll() is None:
            try:
                self._proc.terminate()
                self._proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    self._proc.kill()
                    self._proc.wait(timeout=5)
                except Exception:
                    pass
            except Exception:
                pass
        # Always reap to avoid zombie processes
        try:
            self._proc.wait(timeout=1)
        except Exception:
            pass
        self._proc = None
        log.info("MCP agent %s stopped and reaped", self.agent_name)


def run_agent_mcp(
    command: str,
    extra_args: list[str],
    cwd: str,
    env: dict[str, str],
    queue_file: Path,
    agent: str,
    no_restart: bool,
    start_watcher,
    strip_env: list[str] | None = None,
    session_name: str | None = None,
    inject_env: dict[str, str] | None = None,
    inject_delay: float = 0.3,
    headless: bool = False,
    mcp_config: str | None = None,
    server_port: int = 8300,
    on_approval_request: Callable[[dict], dict | None] | None = None,
):
    """Run an agent as a persistent MCP subprocess with stream-json I/O.

    The process stays alive across turns. Queue triggers send user messages
    via stdin, responses come back on stdout as structured JSON.
    """
    session_name = session_name or f"ghostlink-{agent}"

    # Build env with stripped/injected vars
    run_env = dict(env)
    if strip_env:
        for var in strip_env:
            run_env.pop(var, None)
    if inject_env:
        run_env.update(inject_env)

    # Filter extra args — remove wrapper-specific flags
    filtered_args = [a for a in extra_args if a not in ("--headless",)]

    # Mutable reference so inject_fn always talks to the current process
    proc_ref: list[MCPAgentProcess | None] = [None]

    def _make_proc(resume_session: str | None = None) -> MCPAgentProcess:
        p = MCPAgentProcess(
            command=command,
            extra_args=filtered_args,
            cwd=cwd,
            env=run_env,
            agent_name=agent,
            server_port=server_port,
            mcp_config=mcp_config,
            resume_session=resume_session,
        )
        if on_approval_request:
            p.on_approval_request = on_approval_request
        proc_ref[0] = p
        return p

    agent_proc = _make_proc()

    # Inject function uses proc_ref so it always targets the live process
    def inject_fn(prompt_text: str):
        current = proc_ref[0]
        if not current or not current.is_alive:
            log.warning("MCP agent %s dead, cannot inject", agent)
            return
        log.info("MCP message for %s: %s", agent, prompt_text[:100])
        result = current.send_message(prompt_text)
        if result:
            log.info("MCP turn complete for %s: %s, cost=$%.4f",
                     agent, result.get("subtype", "?"), result.get("total_cost_usd", 0))

    # Start with restart logic
    max_restarts = 0 if no_restart else 5
    restart_count = 0
    watcher_started = False

    while True:
        if not agent_proc.start():
            if restart_count < max_restarts:
                restart_count += 1
                log.warning("MCP agent %s failed to start, retry %d/%d",
                            agent, restart_count, max_restarts)
                time.sleep(2)
                agent_proc = _make_proc()
                continue
            log.error("MCP agent %s failed to start after %d retries", agent, max_restarts)
            raise RuntimeError(f"MCP agent {agent} failed to start")

        print(f"  MCP agent active: {session_name}")
        print(f"  Session: {agent_proc.session_id}")
        print(f"  Mode: persistent pipe (stream-json)")

        # Start queue watcher once — inject_fn uses proc_ref so it
        # automatically picks up restarted processes
        if not watcher_started:
            start_watcher(inject_fn)
            watcher_started = True

        # Keep alive — monitor process health
        try:
            while agent_proc.is_alive:
                time.sleep(2)
        except KeyboardInterrupt:
            break

        agent_proc.stop()

        if no_restart or restart_count >= max_restarts:
            break

        # Restart with session resume — wait for session file lock release
        restart_count += 1
        log.info("MCP agent %s process exited, restarting (%d/%d)",
                 agent, restart_count, max_restarts)
        time.sleep(5)  # Give session file time to release after process death
        old_session = agent_proc.session_id
        if restart_count <= 2:
            # First 2 retries: try to resume the existing session for context continuity
            log.info("MCP agent %s: attempting resume of session %s", agent, old_session)
            agent_proc = _make_proc(resume_session=old_session)
        else:
            # After 2 failed resumes: start fresh — agent catches up via chat_read
            log.info("MCP agent %s: resume failed, starting fresh session", agent)
            agent_proc = _make_proc()
