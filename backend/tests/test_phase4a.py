from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import aiosqlite
import pytest
import pytest_asyncio

import deps
import mcp_bridge
from plugin_sdk import event_bus


class _DummyRequest:
    def __init__(self, body: dict | None = None):
        self._body = body or {}
        self.headers: dict[str, str] = {}

    async def json(self) -> dict:
        return self._body


@pytest_asyncio.fixture
async def phase4a_env(tmp_path: Path):
    from audit_store import AuditStore
    from policy import PolicyEngine
    from profiles import init_profiles_db
    from registry import AgentRegistry, init_registry_db
    from router import MessageRouter
    from security import AuditLog, DataManager, ExecPolicy, SecretsManager
    from store import MessageStore
    from task_store import TaskStore

    db_path = tmp_path / "ghostlink_v2.db"
    message_store = MessageStore(db_path)
    await message_store.init()

    db = await aiosqlite.connect(str(db_path))
    db.row_factory = aiosqlite.Row
    await init_registry_db(db)
    await init_profiles_db(db)

    deps.DATA_DIR = tmp_path
    deps.BASE_DIR = tmp_path
    deps.runtime_db = db
    deps.store = message_store
    deps.registry = AgentRegistry()
    deps.router_inst = MessageRouter(max_hops=4, default_routing="none")
    deps.task_store = TaskStore(db)
    await deps.task_store.init()
    deps.audit_store = AuditStore(db)
    await deps.audit_store.init()
    deps.checkpoint_store = None
    deps.policy_engine = PolicyEngine(db, tmp_path)
    await deps.policy_engine.init()
    deps.secrets_manager = SecretsManager(tmp_path)
    deps.exec_policy = ExecPolicy(tmp_path)
    deps.audit_log = AuditLog(tmp_path)
    deps.data_manager = DataManager(tmp_path, store=message_store, audit_store=deps.audit_store)
    deps._settings = {"channels": ["general"], "channel_context": {}, "username": "You"}
    deps._main_loop = __import__("asyncio").get_running_loop()
    deps._webhooks = []

    async def _broadcast(_event: str, _payload: dict):
        return None

    deps.broadcast = _broadcast
    mcp_bridge.configure(
        store=message_store,
        registry=deps.registry,
        settings=deps._settings,
        data_dir=tmp_path,
        task_store=deps.task_store,
    )
    for handlers in event_bus._handlers.values():
        handlers.clear()
    try:
        yield {"db": db, "data_dir": tmp_path}
    finally:
        for handlers in event_bus._handlers.values():
            handlers.clear()
        if getattr(message_store, "_db", None) is not None:
            await message_store._db.close()
        await db.close()
        deps.runtime_db = None
        deps.policy_engine = None
        deps.secrets_manager = None
        deps.exec_policy = None
        deps.audit_log = None
        deps.data_manager = None
        deps.checkpoint_store = None


@pytest.mark.asyncio
async def test_task_creation_snapshots_policy_rules(phase4a_env):
    from routes import tasks

    inst = deps.registry.register("codex")
    created = await tasks.create_task(_DummyRequest({"title": "Policy snapshot", "agent_name": inst.name, "metadata": {"sandbox_tier": "worktree_only", "sandbox_root": str(phase4a_env["data_dir"])}}))
    snapshot = created["metadata"].get("policy_snapshot", {})
    assert snapshot["context"]["agent_name"] == inst.name
    assert snapshot["context"]["sandbox_tier"] == "worktree_only"
    assert snapshot["rules"]


@pytest.mark.asyncio
async def test_shell_policy_and_sandbox_escape_are_enforced(phase4a_env):
    await deps.policy_engine.upsert_rule(
        scope_type="agent",
        scope_id="codex",
        action="shell_exec",
        tier="shell_exec",
        behavior="deny",
        priority=90,
        conditions={"command_pattern": r"curl\s+"},
    )
    denied = await deps.exec_policy.check_command_async("codex", "curl https://example.com")
    assert denied["allowed"] is False
    assert denied["decision"] == "deny"

    blocked = await deps.exec_policy.check_command_async(
        "codex",
        r"type ..\..\secret.txt",
        sandbox_tier="worktree_only",
        sandbox_root=str(phase4a_env["data_dir"] / "sandbox"),
    )
    assert blocked["allowed"] is False
    assert "sandbox path escape" in blocked["reason"]


@pytest.mark.asyncio
async def test_ssrf_and_egress_allowlist_are_real(phase4a_env):
    from policy import PolicyContext

    await deps.policy_engine.add_egress_rule(
        scope_type="environment",
        scope_id="*",
        rule_type="allow",
        domain="example.com",
    )
    context = PolicyContext(agent_name="codex", workspace_id=str(phase4a_env["data_dir"]))
    allowed = await deps.policy_engine.check_egress("https://example.com/api", context)
    denied = await deps.policy_engine.check_egress("https://localhost/admin", context)
    off_allowlist = await deps.policy_engine.check_egress("https://openai.com", context)
    assert allowed["allowed"] is True
    assert denied["allowed"] is False and denied["reason"] == "ssrf_blocked"
    assert off_allowlist["allowed"] is False and off_allowlist["reason"] == "not_in_allowlist"


@pytest.mark.asyncio
async def test_mcp_wrapper_cannot_bypass_policy_and_circuit_breaker(phase4a_env):
    await deps.policy_engine.upsert_rule(
        scope_type="agent",
        scope_id="codex",
        action="tool_call",
        tier="low_risk_write",
        behavior="deny",
        priority=80,
        conditions={"tool_name": "chat_send"},
    )

    def chat_send(sender: str, channel: str = "general") -> str:
        return "sent"

    wrapped = mcp_bridge._wrap_tool_with_hooks(chat_send)
    result = wrapped("codex", channel="general")
    assert "Blocked by policy engine: deny" in result

    for _ in range(5):
        await deps.policy_engine.record_circuit_event(__import__("policy").PolicyContext(agent_name="codex"), "tool_failure", event_key="chat_send")
    breaker_result = wrapped("codex", channel="general")
    assert "Blocked by circuit breaker" in breaker_result


@pytest.mark.asyncio
async def test_secret_redaction_hits_audit_and_export(phase4a_env):
    secret = "TOPSECRET42"
    deps.secrets_manager.set("api_token", secret)
    deps.audit_log.log("secret_test", {"value": secret, "token": secret}, actor="user")
    entries = deps.audit_log.get_recent(10, "secret_test")
    assert secret not in json.dumps(entries)
    await deps.store.add("alice", f"using {secret}", channel="general")
    exported = await deps.data_manager.export_all_data()
    with zipfile.ZipFile(io.BytesIO(exported)) as zf:
        messages = zf.read("messages.json").decode()
    assert secret not in messages
    assert "***REDACTED***" in messages


@pytest.mark.asyncio
async def test_untrusted_block_hooks_do_not_register(phase4a_env):
    from plugin_sdk import HookManager

    manager = HookManager(phase4a_env["data_dir"])
    hook = {
        "id": "hook-1",
        "name": "Block Dangerous",
        "event": "pre_tool_use",
        "action": "block",
        "config": {},
        "enabled": True,
        "created_at": 0,
        "trigger_count": 0,
        "signature": "sig-1",
    }
    manager._hooks = [hook]
    before = event_bus.handler_count("pre_tool_use")
    await manager.register_all_async()
    assert event_bus.handler_count("pre_tool_use") == before

    await deps.policy_engine.trust_hook_signature("Block Dangerous", "sig-1")
    await manager.register_all_async()
    assert event_bus.handler_count("pre_tool_use") == before + 1
