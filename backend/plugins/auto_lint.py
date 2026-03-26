"""Auto-Lint Plugin — runs linters after agent file edits.

When an agent modifies a file via MCP tools, this plugin automatically
detects the project's linter (ruff, eslint, pyright, etc.) and runs it.
Errors are fed back to the agent as a system message.

Registered via the lifecycle hooks system (pre_tool_use / post_tool_use).
"""

import json
import logging
import os
import shutil
import subprocess
import threading
from pathlib import Path

log = logging.getLogger(__name__)

# Linter detection: config file → command + args
_LINTER_MAP = {
    "ruff.toml": ["ruff", "check", "--fix"],
    ".ruff.toml": ["ruff", "check", "--fix"],
    "pyproject.toml": ["ruff", "check", "--fix"],  # if ruff section exists
    ".eslintrc.json": ["npx", "eslint", "--fix"],
    ".eslintrc.js": ["npx", "eslint", "--fix"],
    "eslint.config.js": ["npx", "eslint", "--fix"],
    "eslint.config.mjs": ["npx", "eslint", "--fix"],
    "biome.json": ["npx", "biome", "check", "--apply"],
}

_AUTO_LINT_ENABLED = True
_lint_lock = threading.Lock()

# Test runner detection: config file → command + args
_TEST_RUNNER_MAP = {
    "pytest.ini": ["python", "-m", "pytest", "-x", "-q", "--tb=short"],
    "pyproject.toml": ["python", "-m", "pytest", "-x", "-q", "--tb=short"],
    "vitest.config.ts": ["npx", "vitest", "run", "--reporter=verbose"],
    "vitest.config.js": ["npx", "vitest", "run", "--reporter=verbose"],
    "jest.config.js": ["npx", "jest", "--bail"],
    "jest.config.ts": ["npx", "jest", "--bail"],
}

# Tools that may write files — expanded to cover all write paths
_FILE_WRITE_TOOLS = {
    "code_execute", "delegate",
    "chat_send",           # agents may include file content in messages
    "gemini_image",        # generates image files
    "image_generate",      # generates image files
    "text_to_speech",      # generates audio files
}


def _detect_linter(workspace: str) -> tuple[list[str], str] | None:
    """Detect which linter is available in a workspace.
    Returns (command, config_file) or None."""
    ws = Path(workspace)
    for config_file, cmd in _LINTER_MAP.items():
        if (ws / config_file).exists():
            # Verify the tool is installed
            tool = cmd[0]
            if tool == "npx" or shutil.which(tool):
                return cmd, config_file
    return None


def _run_lint(workspace: str, changed_file: str) -> str | None:
    """Run the detected linter on a workspace. Returns error output or None."""
    result = _detect_linter(workspace)
    if not result:
        return None

    cmd, config = result
    try:
        proc = subprocess.run(
            cmd + [changed_file] if changed_file else cmd,
            cwd=workspace,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if proc.returncode != 0:
            output = (proc.stdout + proc.stderr).strip()
            if output:
                return output[:2000]  # Cap at 2000 chars
    except subprocess.TimeoutExpired:
        return "Lint timed out after 30s"
    except FileNotFoundError:
        return None
    except Exception as e:
        log.debug("Auto-lint error: %s", e)
    return None


def _detect_test_runner(workspace: str) -> tuple[list[str], str] | None:
    """Detect which test runner is available in a workspace."""
    ws = Path(workspace)
    for config_file, cmd in _TEST_RUNNER_MAP.items():
        if (ws / config_file).exists():
            tool = cmd[0]
            if tool in ("python", "npx") or shutil.which(tool):
                return cmd, config_file
    return None


def _run_tests(workspace: str) -> str | None:
    """Run the detected test runner on a workspace. Returns failure output or None."""
    result = _detect_test_runner(workspace)
    if not result:
        return None
    cmd, config = result
    try:
        proc = subprocess.run(
            cmd,
            cwd=workspace,
            capture_output=True,
            text=True,
            timeout=60,
        )
        if proc.returncode != 0:
            output = (proc.stdout + proc.stderr).strip()
            if output:
                return output[:2000]
    except subprocess.TimeoutExpired:
        return "Tests timed out after 60s"
    except FileNotFoundError:
        return None
    except Exception as e:
        log.debug("Auto-test error: %s", e)
    return None


def on_post_tool_use(data: dict):
    """Hook handler: after a tool call, check if it was a file write and lint."""
    if not _AUTO_LINT_ENABLED:
        return

    tool = data.get("tool", "")
    # Only trigger on tools that write files
    if tool not in _FILE_WRITE_TOOLS:
        return

    # Run lint in background to not block the tool response
    agent = data.get("agent", "unknown")
    threading.Thread(
        target=_lint_after_edit,
        args=(agent,),
        daemon=True,
    ).start()


def _lint_after_edit(agent: str):
    """Background lint runner after an agent edit."""
    with _lint_lock:
        try:
            import deps
            # Find the agent's workspace
            inst = deps.registry.get(agent) if deps.registry else None
            workspace = getattr(inst, 'workspace', None) if inst else None
            if not workspace or not Path(workspace).is_dir():
                return

            errors = _run_lint(workspace, "")
            if errors and deps.store:
                from mcp_bridge import _run_async
                msg = f"[Auto-Lint] Errors found in {agent}'s workspace:\n```\n{errors}\n```"
                _run_async(deps.store.add("system", msg, "system", "general"))
                log.info("Auto-lint found errors for %s", agent)
                return  # Don't run tests if lint fails

            # Run tests if lint passed
            test_errors = _run_tests(workspace)
            if test_errors and deps.store:
                from mcp_bridge import _run_async
                msg = f"[Auto-Test] Failures in {agent}'s workspace:\n```\n{test_errors}\n```"
                _run_async(deps.store.add("system", msg, "system", "general"))
                log.info("Auto-test found failures for %s", agent)
        except Exception as e:
            log.debug("Auto-lint background error: %s", e)


def setup(app, store=None, registry=None, mcp_bridge=None):
    """Register the auto-lint plugin with the lifecycle hooks."""
    try:
        from plugin_sdk import event_bus
        event_bus.on("post_tool_use", on_post_tool_use)
        log.info("Auto-lint plugin loaded — will run linters after agent file edits")
    except Exception as e:
        log.warning("Auto-lint plugin failed to register: %s", e)
