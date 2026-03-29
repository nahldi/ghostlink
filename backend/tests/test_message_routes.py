"""Route-level tests for message validation and reactions."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import deps


class _DummyRequest:
    def __init__(self, body: dict, host: str = "127.0.0.1"):
        self._body = body
        self.client = SimpleNamespace(host=host)

    async def json(self) -> dict:
        return self._body


def _configure_message_route_deps(tmp_path: Path):
    from registry import AgentRegistry
    from router import MessageRouter
    from store import MessageStore

    async def _setup():
        store = MessageStore(tmp_path / "messages.db")
        await store.init()
        deps.store = store
        deps.registry = AgentRegistry()
        deps.router_inst = MessageRouter()
        deps.DATA_DIR = tmp_path
        deps.bridge_manager = SimpleNamespace(handle_ghostlink_message=lambda *_args, **_kwargs: None)

        async def _broadcast(*_args, **_kwargs):
            return None

        deps.broadcast = _broadcast
        return store

    return asyncio.run(_setup())


def _configure_bridge_capture_deps(tmp_path: Path):
    from registry import AgentRegistry
    from router import MessageRouter
    from store import MessageStore

    captured: dict = {}

    async def _setup():
        store = MessageStore(tmp_path / "messages.db")
        await store.init()
        deps.store = store
        deps.registry = AgentRegistry()
        deps.router_inst = MessageRouter()
        deps.DATA_DIR = tmp_path

        def _handle_ghostlink_message(sender, text, channel, **kwargs):
            captured.update({
                "sender": sender,
                "text": text,
                "channel": channel,
                **kwargs,
            })

        deps.bridge_manager = SimpleNamespace(handle_ghostlink_message=_handle_ghostlink_message)

        async def _broadcast(*_args, **_kwargs):
            return None

        deps.broadcast = _broadcast
        return store

    store = asyncio.run(_setup())
    return store, captured


def test_send_message_rejects_missing_reply_target(tmp_path: Path):
    from routes import messages

    store = _configure_message_route_deps(tmp_path)
    try:
        response = asyncio.run(
            messages.send_message(
                _DummyRequest({
                    "sender": "alice",
                    "text": "replying to nothing",
                    "channel": "general",
                    "reply_to": 9999,
                })
            )
        )
        assert response.status_code == 400
        assert json.loads(response.body) == {"error": "reply_to message not found"}
    finally:
        asyncio.run(store.close())


def test_send_message_accepts_existing_reply_target(tmp_path: Path):
    from routes import messages

    store = _configure_message_route_deps(tmp_path)
    try:
        parent = asyncio.run(store.add("alice", "parent", channel="general"))
        response = asyncio.run(
            messages.send_message(
                _DummyRequest({
                    "sender": "bob",
                    "text": "valid reply",
                    "channel": "general",
                    "reply_to": parent["id"],
                })
            )
        )
        assert response["reply_to"] == parent["id"]
        assert response["text"] == "valid reply"
    finally:
        asyncio.run(store.close())


def test_send_message_forwards_approval_metadata_to_bridges(tmp_path: Path):
    from routes import messages

    store, captured = _configure_bridge_capture_deps(tmp_path)
    try:
        response = asyncio.run(
            messages.send_message(
                _DummyRequest({
                    "sender": "codex",
                    "text": "Permission prompt from codex",
                    "channel": "general",
                    "type": "approval_request",
                    "metadata": {
                        "agent": "codex",
                        "prompt": "Run rm -rf?",
                        "options": ["allow_once", "allow_session", "deny"],
                    },
                })
            )
        )
        assert response["type"] == "approval_request"
        assert captured["msg_type"] == "approval_request"
        assert captured["message_id"] == response["id"]
        assert captured["metadata"]["agent"] == "codex"
    finally:
        asyncio.run(store.close())


def test_respond_approval_can_resolve_agent_from_message_metadata(tmp_path: Path):
    from routes import agents

    store = _configure_message_route_deps(tmp_path)
    try:
        approval_msg = asyncio.run(
            store.add(
                "codex",
                "Permission prompt from codex",
                msg_type="approval_request",
                channel="general",
                metadata=json.dumps({"agent": "codex", "prompt": "Run command?"}),
            )
        )

        response = asyncio.run(
            agents.respond_approval(
                _DummyRequest({
                    "message_id": approval_msg["id"],
                    "response": "allow_once",
                })
            )
        )

        assert response["ok"] is True
        approval_file = tmp_path / "codex_approval.json"
        assert approval_file.exists()
        saved = json.loads(approval_file.read_text())
        assert saved["response"] == "allow_once"
        assert saved["message_id"] == approval_msg["id"]
    finally:
        asyncio.run(store.close())


def test_react_message_rejects_non_emoji_text(tmp_path: Path):
    from routes import messages

    store = _configure_message_route_deps(tmp_path)
    try:
        msg = asyncio.run(store.add("alice", "hello", channel="general"))
        response = asyncio.run(
            messages.react_message(
                msg["id"],
                _DummyRequest({"emoji": "—", "sender": "bob"}),
            )
        )
        assert response.status_code == 400
        assert json.loads(response.body) == {"error": "invalid emoji"}
    finally:
        asyncio.run(store.close())


def test_react_message_accepts_real_emoji(tmp_path: Path):
    from routes import messages

    store = _configure_message_route_deps(tmp_path)
    try:
        msg = asyncio.run(store.add("alice", "hello", channel="general"))
        response = asyncio.run(
            messages.react_message(
                msg["id"],
                _DummyRequest({"emoji": "😀", "sender": "bob"}),
            )
        )
        assert response["message_id"] == msg["id"]
        assert response["reactions"] == {"😀": ["bob"]}
    finally:
        asyncio.run(store.close())


def test_create_channel_rejects_special_chars():
    from routes import channels

    async def _run():
        deps._settings = {"channels": ["general"]}
        deps._settings_lock = asyncio.Lock()
        deps.broadcast = lambda *_args, **_kwargs: asyncio.sleep(0)
        response = await channels.create_channel(_DummyRequest({"name": "../oops"}))
        assert response.status_code == 400
        assert json.loads(response.body) == {"error": "invalid name"}

    asyncio.run(_run())
