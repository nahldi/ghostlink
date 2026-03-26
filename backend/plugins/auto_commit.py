"""Auto-Commit Plugin — creates git commits after agent file edits.

When enabled, after an agent modifies files and lint passes, this plugin
stages the changes and creates a commit with a descriptive message
generated from the diff summary.

Opt-in per session or per agent via settings.
"""

import logging
import subprocess
import threading
from pathlib import Path

log = logging.getLogger(__name__)

_AUTO_COMMIT_ENABLED = False  # Off by default — opt-in via settings
_commit_lock = threading.Lock()


def _git_diff_summary(workspace: str) -> str | None:
    """Get a short summary of uncommitted changes."""
    try:
        result = subprocess.run(
            ["git", "diff", "--cached", "--stat", "--no-color"],
            cwd=workspace,
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except Exception:
        pass
    return None


def _git_has_changes(workspace: str) -> bool:
    """Check if there are uncommitted changes."""
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=workspace,
            capture_output=True,
            text=True,
            timeout=10,
        )
        return bool(result.stdout.strip())
    except Exception:
        return False


def _generate_commit_message(diff_summary: str, agent: str) -> str:
    """Generate a commit message from diff summary."""
    lines = diff_summary.strip().split('\n')
    # Last line is the summary (e.g., "3 files changed, 45 insertions(+), 12 deletions(-)")
    summary_line = lines[-1].strip() if lines else "changes"
    # Count files
    file_lines = [l for l in lines[:-1] if '|' in l]
    file_names = [l.split('|')[0].strip() for l in file_lines[:5]]

    if len(file_names) == 1:
        msg = f"Update {file_names[0]}"
    elif len(file_names) <= 3:
        msg = f"Update {', '.join(file_names)}"
    else:
        msg = f"Update {len(file_lines)} files"

    return f"{msg}\n\nAuto-committed by {agent} via GhostLink\n{summary_line}"


def _do_auto_commit(workspace: str, agent: str):
    """Stage all changes and commit."""
    try:
        # Stage all tracked changes (not untracked)
        subprocess.run(
            ["git", "add", "-u"],
            cwd=workspace,
            capture_output=True,
            timeout=10,
        )

        diff = _git_diff_summary(workspace)
        if not diff:
            return

        message = _generate_commit_message(diff, agent)
        result = subprocess.run(
            ["git", "commit", "-m", message],
            cwd=workspace,
            capture_output=True,
            text=True,
            timeout=15,
        )

        if result.returncode == 0:
            log.info("Auto-commit created for %s: %s", agent, message.split('\n')[0])
            # Notify via system message
            try:
                import deps
                if deps.store:
                    from mcp_bridge import _run_async
                    short_msg = message.split('\n')[0]
                    _run_async(deps.store.add(
                        "system",
                        f"[Auto-Commit] {agent}: `{short_msg}`",
                        "system", "general",
                    ))
            except Exception:
                pass
        else:
            log.debug("Auto-commit failed: %s", result.stderr)
    except Exception as e:
        log.debug("Auto-commit error: %s", e)


def on_post_tool_use(data: dict):
    """Hook handler: after a tool call, check if auto-commit is enabled and commit."""
    if not _AUTO_COMMIT_ENABLED:
        return

    tool = data.get("tool", "")
    # Trigger on any tool that may write files
    if tool not in ("code_execute", "delegate", "gemini_image", "image_generate", "text_to_speech"):
        return

    agent = data.get("agent", "unknown")
    threading.Thread(
        target=_background_commit,
        args=(agent,),
        daemon=True,
    ).start()


def _background_commit(agent: str):
    """Background commit runner."""
    with _commit_lock:
        try:
            import deps
            inst = deps.registry.get(agent) if deps.registry else None
            workspace = getattr(inst, 'workspace', None) if inst else None
            if not workspace or not Path(workspace).is_dir():
                return
            if not _git_has_changes(workspace):
                return
            _do_auto_commit(workspace, agent)
        except Exception as e:
            log.debug("Auto-commit background error: %s", e)


def setup(app, store=None, registry=None, mcp_bridge=None):
    """Register the auto-commit plugin with lifecycle hooks."""
    try:
        from plugin_sdk import event_bus
        event_bus.on("post_tool_use", on_post_tool_use)
        log.info("Auto-commit plugin loaded (disabled by default — enable in settings)")
    except Exception as e:
        log.warning("Auto-commit plugin failed to register: %s", e)
