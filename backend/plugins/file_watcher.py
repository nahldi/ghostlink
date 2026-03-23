"""File Change Feed — monitors agent workspaces for file changes.

Watches directories where agents work and reports changes in real-time
via WebSocket. Shows which files agents create, modify, or delete.
"""

import json
import os
import threading
import time
import logging
from pathlib import Path

log = logging.getLogger(__name__)

_watchers: dict[str, dict] = {}  # path → watcher state
_changes: list[dict] = []  # recent changes
_changes_lock = threading.Lock()
MAX_CHANGES = 200


def _scan_directory(directory: str) -> dict[str, float]:
    """Get modification times for all files in a directory (non-recursive top 2 levels)."""
    files = {}
    try:
        root = Path(directory)
        if not root.exists():
            return files
        for item in root.iterdir():
            try:
                if item.is_file() and not item.name.startswith('.'):
                    files[str(item)] = item.stat().st_mtime
                elif item.is_dir() and not item.name.startswith('.') and item.name not in ('node_modules', '__pycache__', '.git', '.venv', 'venv'):
                    for sub in item.iterdir():
                        if sub.is_file() and not sub.name.startswith('.'):
                            files[str(sub)] = sub.stat().st_mtime
            except (PermissionError, OSError):
                continue
    except Exception:
        pass
    return files


def _watch_loop(directory: str, broadcast_fn, interval: float = 3.0):
    """Background loop that detects file changes."""
    state = _scan_directory(directory)
    while _watchers.get(directory, {}).get("active", False):
        time.sleep(interval)
        try:
            new_state = _scan_directory(directory)

            # Detect changes
            for path, mtime in new_state.items():
                if path not in state:
                    _record_change("created", path, directory)
                elif state[path] != mtime:
                    _record_change("modified", path, directory)

            for path in state:
                if path not in new_state:
                    _record_change("deleted", path, directory)

            state = new_state
        except Exception as e:
            log.debug("File watcher error for %s: %s", directory, e)


def _record_change(action: str, filepath: str, directory: str):
    """Record a file change."""
    change = {
        "action": action,
        "file": os.path.basename(filepath),
        "path": filepath,
        "directory": directory,
        "timestamp": time.time(),
    }
    with _changes_lock:
        _changes.append(change)
        if len(_changes) > MAX_CHANGES:
            _changes.pop(0)


def setup(app, store=None, registry=None, mcp_bridge=None):
    """Register file watcher endpoints."""

    @app.get("/api/file-changes")
    async def get_file_changes(since: float = 0, limit: int = 50):
        """Get recent file changes, optionally since a timestamp."""
        with _changes_lock:
            if since:
                filtered = [c for c in _changes if c["timestamp"] > since]
            else:
                filtered = list(_changes)
            return {"changes": filtered[-limit:]}

    @app.post("/api/file-watch")
    async def start_watching(request):
        """Start watching a directory for file changes."""
        from fastapi import Request
        body = await request.json()
        directory = body.get("directory", "")
        if not directory or not Path(directory).is_dir():
            from fastapi.responses import JSONResponse
            return JSONResponse({"error": "valid directory path required"}, 400)
        if directory in _watchers and _watchers[directory].get("active"):
            return {"ok": True, "already_watching": True}
        _watchers[directory] = {"active": True, "thread": None}
        t = threading.Thread(target=_watch_loop, args=(directory, None), daemon=True)
        _watchers[directory]["thread"] = t
        t.start()
        return {"ok": True, "directory": directory}

    @app.post("/api/file-watch/stop")
    async def stop_watching(request):
        """Stop watching a directory."""
        from fastapi import Request
        body = await request.json()
        directory = body.get("directory", "")
        if directory in _watchers:
            _watchers[directory]["active"] = False
        return {"ok": True}

    @app.get("/api/file-watch/status")
    async def watch_status():
        """Get current watch status."""
        return {
            "watching": [d for d, w in _watchers.items() if w.get("active")],
            "total_changes": len(_changes),
        }

    log.info("File watcher plugin loaded")
