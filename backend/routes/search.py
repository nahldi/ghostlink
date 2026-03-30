"""Search, activity, and logs routes."""
from __future__ import annotations

import logging
import deps
from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()
log = logging.getLogger(__name__)


@router.get("/api/search")
async def search_messages(q: str = "", channel: str = "", sender: str = "", limit: int = 50):
    """Full-text search across messages using FTS5 with LIKE fallback."""
    if not q.strip():
        return {"results": []}
    if deps.store._db is None:
        raise RuntimeError("Database not initialized. Call init() first.")
    limit = max(1, min(limit, 200))

    # Try FTS5 first (much faster)
    try:
        fts_query = "SELECT m.* FROM messages m JOIN messages_fts f ON m.id = f.rowid WHERE messages_fts MATCH ?"
        fts_params: list = [q.strip()]
        if channel:
            fts_query += " AND m.channel = ?"
            fts_params.append(channel)
        if sender:
            fts_query += " AND m.sender = ?"
            fts_params.append(sender)
        fts_query += " ORDER BY m.id DESC LIMIT ?"
        fts_params.append(limit)
        cursor = await deps.store._db.execute(fts_query, fts_params)
        try:
            rows = await cursor.fetchall()
        finally:
            await cursor.close()
    except Exception as fts_err:
        # FTS5 not available or query syntax error — fall back to LIKE
        log.warning("FTS5 search failed, falling back to LIKE: %s", fts_err)
        # Escape SQL LIKE wildcards in user input
        escaped_q = q.replace("%", "\\%").replace("_", "\\_")
        query = "SELECT * FROM messages WHERE text LIKE ? ESCAPE '\\' COLLATE NOCASE"
        params: list = [f"%{escaped_q}%"]
        if channel:
            query += " AND channel = ?"
            params.append(channel)
        if sender:
            query += " AND sender = ?"
            params.append(sender)
        query += " ORDER BY id DESC LIMIT ?"
        params.append(limit)
        cursor = await deps.store._db.execute(query, params)
        try:
            rows = await cursor.fetchall()
        finally:
            await cursor.close()
    return {"results": [deps.store._row_to_dict(r) for r in rows], "query": q}


@router.get("/api/activity")
async def get_activity(limit: int = 50):
    return {"events": list(deps._activity_log)[-limit:]}


@router.get("/api/logs")
async def get_server_logs(limit: int = 100, level: str = ""):
    """Get recent server log entries for the UI log viewer."""
    logs = list(deps._server_logs)
    if level:
        logs = [l for l in logs if l["level"] == level.upper()]
    return {"logs": logs[-limit:]}
