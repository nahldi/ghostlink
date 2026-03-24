"""Mac/Linux agent injection via tmux send-keys.

Adapted from reference-agentchattr/wrapper_unix.py.
Creates a tmux session running the agent CLI, injects MCP read prompts
when @mentioned, and lets users attach/detach.
"""

import os
import shlex
import shutil
import subprocess
import sys
import time


def _session_exists(session_name: str) -> bool:
    result = subprocess.run(
        ["tmux", "has-session", "-t", session_name],
        capture_output=True,
    )
    return result.returncode == 0


def _check_tmux():
    if shutil.which("tmux"):
        return
    print("\n  Error: tmux is required.")
    print("  Install: apt install tmux")
    sys.exit(1)


def inject(text: str, *, tmux_session: str, delay: float = 0.3):
    """Send text + Enter to a tmux session via send-keys."""
    subprocess.run(
        ["tmux", "send-keys", "-t", tmux_session, "-l", text],
        capture_output=True,
    )
    time.sleep(max(delay, len(text) * 0.001))
    subprocess.run(
        ["tmux", "send-keys", "-t", tmux_session, "Enter"],
        capture_output=True,
    )


def get_activity_checker(session_name, trigger_flag=None):
    """Return a callable that detects tmux pane output changes."""
    last_hash = [None]

    def check():
        if trigger_flag is not None and trigger_flag[0]:
            trigger_flag[0] = False
            return True
        try:
            result = subprocess.run(
                ["tmux", "capture-pane", "-t", session_name, "-p"],
                capture_output=True, timeout=2,
            )
            h = hash(result.stdout)
            changed = last_hash[0] is not None and h != last_hash[0]
            last_hash[0] = h
            return changed
        except Exception:
            return False

    return check


def run_agent(
    command,
    extra_args,
    cwd,
    env,
    queue_file,
    agent,
    no_restart,
    start_watcher,
    strip_env=None,
    pid_holder=None,
    session_name=None,
    inject_env=None,
    inject_delay: float = 0.3,
    headless: bool = False,
):
    """Run agent inside a tmux session, inject via tmux send-keys."""
    _check_tmux()

    session_name = session_name or f"ghostlink-{agent}"

    # Build the full command as a proper shell command string
    cmd_parts = [shlex.quote(command)] + [shlex.quote(a) for a in extra_args]

    # Build env(1) prefix for vars inside the tmux session
    env_parts = []
    if strip_env:
        env_parts.extend(f"-u {shlex.quote(v)}" for v in strip_env)
    if inject_env:
        env_parts.extend(
            f"{shlex.quote(k)}={shlex.quote(v)}"
            for k, v in inject_env.items()
        )

    if env_parts:
        agent_cmd = f"env {' '.join(env_parts)} {' '.join(cmd_parts)}"
    else:
        agent_cmd = " ".join(cmd_parts)

    from pathlib import Path
    abs_cwd = str(Path(cwd).resolve())

    inject_fn = lambda text: inject(text, tmux_session=session_name, delay=inject_delay)
    start_watcher(inject_fn)

    print(f"  Using tmux session: {session_name}")
    print(f"  Command: {agent_cmd}")
    if not headless:
        print(f"  Detach: Ctrl+B, D  (agent keeps running)")
        print(f"  Reattach: tmux attach -t {session_name}\n")

    while True:
        try:
            # Clean up stale session
            subprocess.run(
                ["tmux", "kill-session", "-t", session_name],
                capture_output=True,
            )

            # v3.9.1: Pass entire command as a single shell string to tmux.
            # tmux new-session expects a single command string when using shell execution.
            result = subprocess.run(
                ["tmux", "new-session", "-d", "-s", session_name,
                 "-c", abs_cwd, agent_cmd],
                env=env,
            )
            if result.returncode != 0:
                print(f"  Error: failed to create tmux session (exit {result.returncode})")
                break

            if headless:
                # No TTY — keep wrapper alive without attaching
                print(f"  Agent running headless in tmux: {session_name}")
                while _session_exists(session_name):
                    time.sleep(2)
            else:
                # Attach — blocks until exit or detach
                subprocess.run(["tmux", "attach-session", "-t", session_name])

                if _session_exists(session_name):
                    print(f"\n  Detached. {agent} still running in tmux.")
                    print(f"  Reattach: tmux attach -t {session_name}")
                    while _session_exists(session_name):
                        time.sleep(1)
                    break

            if no_restart:
                break

            print(f"\n  {agent} exited. Restarting in 3s... (Ctrl+C to quit)")
            time.sleep(3)
        except KeyboardInterrupt:
            subprocess.run(
                ["tmux", "kill-session", "-t", session_name],
                capture_output=True,
            )
            break
