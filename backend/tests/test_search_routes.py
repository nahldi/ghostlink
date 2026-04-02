"""Route-level tests for search, activity, and server log endpoints."""

from __future__ import annotations

import asyncio
import collections
import logging
from pathlib import Path
from types import SimpleNamespace

import pytest

import deps


@pytest.fixture
async def search_store(tmp_path: Path):
    from store import MessageStore

    store = MessageStore(tmp_path / "messages.db")
    await store.init()
    deps.store = store
    try:
        yield store
    finally:
        await store.close()


@pytest.mark.asyncio
async def test_search_messages_returns_empty_results_for_blank_query(search_store):
    from routes.search import search_messages

    result = await search_messages(q="   ")

    assert result == {"results": []}


@pytest.mark.asyncio
async def test_search_messages_raises_when_database_not_initialized():
    from routes.search import search_messages

    original_store = deps.store
    deps.store = SimpleNamespace(_db=None)
    try:
        with pytest.raises(RuntimeError, match="Database not initialized"):
            await search_messages(q="hello")
    finally:
        deps.store = original_store


@pytest.mark.asyncio
async def test_search_messages_filters_by_channel_and_sender(search_store):
    from routes.search import search_messages

    await search_store.add("alice", "deploy complete", channel="general")
    await search_store.add("bob", "deploy complete", channel="general")
    await search_store.add("alice", "deploy complete", channel="random")

    result = await search_messages(q="deploy", channel="general", sender="alice")

    assert [row["sender"] for row in result["results"]] == ["alice"]
    assert [row["channel"] for row in result["results"]] == ["general"]
    assert result["query"] == "deploy"


@pytest.mark.asyncio
async def test_search_messages_clamps_limit_to_200(search_store):
    from routes.search import search_messages

    for index in range(205):
        await search_store.add("alice", f"limit test entry {index}", channel="general")

    result = await search_messages(q="limit", limit=999)

    assert len(result["results"]) == 200
    assert result["results"][0]["text"] == "limit test entry 204"
    assert result["results"][-1]["text"] == "limit test entry 5"


@pytest.mark.asyncio
async def test_search_messages_falls_back_to_like_and_escapes_wildcards(search_store, monkeypatch):
    from routes.search import search_messages

    await search_store.add("alice", "literal 100%_match term", channel="general")
    await search_store.add("alice", "literal 100xxmatch term", channel="general")

    db = search_store._db
    assert db is not None
    original_execute = db.execute

    async def flaky_execute(query, params=None):
        if "messages_fts MATCH" in query:
            raise RuntimeError("fts syntax error")
        return await original_execute(query, params or [])

    monkeypatch.setattr(db, "execute", flaky_execute)

    result = await search_messages(q="100%_match")

    assert [row["text"] for row in result["results"]] == ["literal 100%_match term"]


@pytest.mark.asyncio
async def test_get_activity_returns_most_recent_entries():
    from routes.search import get_activity

    original_log = deps._activity_log
    deps._activity_log = collections.deque(
        [{"id": 1}, {"id": 2}, {"id": 3}],
        maxlen=100,
    )
    try:
        result = await get_activity(limit=2)
    finally:
        deps._activity_log = original_log

    assert result == {"events": [{"id": 2}, {"id": 3}]}


@pytest.mark.asyncio
async def test_get_server_logs_filters_by_level_and_applies_limit():
    from routes.search import get_server_logs

    original_logs = deps._server_logs
    deps._server_logs = collections.deque(
        [
            {"level": "INFO", "message": "boot"},
            {"level": "ERROR", "message": "first"},
            {"level": "ERROR", "message": "second"},
        ],
        maxlen=500,
    )
    try:
        result = await get_server_logs(limit=1, level="error")
    finally:
        deps._server_logs = original_logs

    assert result == {"logs": [{"level": "ERROR", "message": "second"}]}
