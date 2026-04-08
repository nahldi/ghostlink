from __future__ import annotations

import json
from pathlib import Path

import aiosqlite
import pytest
import pytest_asyncio

import deps
from cost import CostTracker
from policy import PolicyEngine
from providers import ProviderRegistry
from security import AuditLog, ExecPolicy, SecretsManager
from transport import BudgetExceededError, ProviderRequest, ProviderResponse, ProviderTransportManager, TransportError


class _DummyTransport:
    def __init__(self, provider: str, responses: list[object]):
        self.provider = provider
        self.responses = list(responses)
        self.calls = 0

    async def send(self, request: ProviderRequest) -> ProviderResponse:
        self.calls += 1
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


@pytest_asyncio.fixture
async def phase4b_env(tmp_path: Path):
    db_path = tmp_path / "ghostlink_v2.db"
    db = await aiosqlite.connect(str(db_path))
    db.row_factory = aiosqlite.Row

    deps.DATA_DIR = tmp_path
    deps.BASE_DIR = tmp_path
    deps.runtime_db = db
    deps._usage_log = []
    deps._USAGE_LOG_MAX = 10000
    deps._settings = {"budgets": {}, "channels": ["general"]}
    deps.secrets_manager = SecretsManager(tmp_path)
    deps.exec_policy = ExecPolicy(tmp_path)
    deps.audit_log = AuditLog(tmp_path)
    deps.policy_engine = PolicyEngine(db, tmp_path)
    await deps.policy_engine.init()
    deps.provider_registry = ProviderRegistry(tmp_path)
    deps.cost_tracker = CostTracker(db)
    await deps.cost_tracker.init()
    deps.transport_manager = ProviderTransportManager(deps.provider_registry, cost_tracker=deps.cost_tracker)
    events: list[tuple[str, dict]] = []

    async def _broadcast(event_type: str, payload: dict):
        events.append((event_type, payload))

    deps.broadcast = _broadcast
    try:
        yield {"db": db, "tmp_path": tmp_path, "events": events}
    finally:
        await db.close()
        deps.runtime_db = None
        deps.policy_engine = None
        deps.cost_tracker = None
        deps.transport_manager = None


@pytest.mark.asyncio
async def test_provider_override_builds_real_transport_config(phase4b_env):
    deps.provider_registry.save_config(
        {
            "overrides": {
                "openai": {
                    "base_url": "https://proxy.example/v1",
                    "headers": {"X-Team": "ghostlink"},
                    "proxy": "http://proxy.internal:8080",
                    "tls_cert_path": str(phase4b_env["tmp_path"] / "corp.pem"),
                    "timeout": 77,
                    "max_retries": 4,
                }
            }
        }
    )
    cfg = deps.provider_registry.build_transport_config("openai", capability="chat")
    assert cfg.base_url == "https://proxy.example/v1"
    assert cfg.headers["X-Team"] == "ghostlink"
    assert cfg.proxy == "http://proxy.internal:8080"
    assert cfg.tls_cert_path.endswith("corp.pem")
    assert cfg.timeout == 77
    assert cfg.max_retries == 4


@pytest.mark.asyncio
async def test_transport_failover_and_promotion_are_logged(monkeypatch: pytest.MonkeyPatch, phase4b_env):
    manager = deps.transport_manager
    first_openai = _DummyTransport("openai", [TransportError("primary down")])
    google = _DummyTransport(
        "google",
        [ProviderResponse("google", "gemini-2.5-pro", "api", 200, {}, b'{"ok":true}', {"ok": True}, 12)],
    )
    recovered_openai = _DummyTransport(
        "openai",
        [ProviderResponse("openai", "gpt-5.4", "api", 200, {}, b'{"ok":true}', {"ok": True}, 10)],
    )
    call_count = {"openai": 0}

    def _fake_iter(_capability: str, preferred_provider: str = "", exclude=None):
        return ["openai", "google"]

    def _fake_default(provider_id: str, capability: str = ""):
        return "gpt-5.4" if provider_id == "openai" else "gemini-2.5-pro"

    def _fake_build(provider_id: str, capability: str = ""):
        if provider_id == "openai":
            call_count["openai"] += 1
            return first_openai if call_count["openai"] == 1 else recovered_openai
        return google

    monkeypatch.setattr(deps.provider_registry, "iter_providers_for_capability", _fake_iter)
    monkeypatch.setattr(deps.provider_registry, "default_model_for", _fake_default)
    monkeypatch.setattr(deps.provider_registry, "build_transport", _fake_build)
    monkeypatch.setattr(deps.provider_registry, "extract_usage", lambda *args, **kwargs: {"input_tokens": 10, "output_tokens": 5, "accounting_mode": "direct"})

    first = await manager.execute("chat", ProviderRequest(capability="chat", agent_id="codex", session_id="s1", task_id="t1", input_tokens=10))
    second = await manager.execute("chat", ProviderRequest(capability="chat", agent_id="codex", session_id="s1", task_id="t1", input_tokens=10))

    assert first.provider == "google"
    assert second.provider == "openai"
    assert any(event == "provider_failover" for event, _ in phase4b_env["events"])
    assert any(event == "provider_promotion" for event, _ in phase4b_env["events"])


@pytest.mark.asyncio
async def test_budget_hard_stop_blocks_before_send_and_uses_policy_path(monkeypatch: pytest.MonkeyPatch, phase4b_env):
    deps._settings["budgets"] = {
        "codex": {
            "max_cost_usd_per_session": 0.00001,
            "warning_threshold_pct": 80,
            "hard_stop_threshold_pct": 100,
        }
    }
    calls = {"policy": [], "send": 0}

    async def _fake_eval(action: str, tier: str, context, *, snapshot=None):
        calls["policy"].append((action, tier, context.agent_name))
        return {"decision": "escalate", "reason": "budget_exceeded"}

    class _NeverSend(_DummyTransport):
        async def send(self, request: ProviderRequest) -> ProviderResponse:
            calls["send"] += 1
            return await super().send(request)

    monkeypatch.setattr(deps.policy_engine, "evaluate", _fake_eval)
    monkeypatch.setattr(deps.provider_registry, "iter_providers_for_capability", lambda *args, **kwargs: ["openai"])
    monkeypatch.setattr(deps.provider_registry, "default_model_for", lambda *args, **kwargs: "gpt-5.4")
    monkeypatch.setattr(deps.provider_registry, "build_transport", lambda *args, **kwargs: _NeverSend("openai", []))

    with pytest.raises(BudgetExceededError):
        await deps.transport_manager.execute(
            "chat",
            ProviderRequest(capability="chat", agent_id="codex", session_id="s1", task_id="t1", input_tokens=5000),
        )

    assert calls["policy"] == [("budget_exceeded", "deployment", "codex")]
    assert calls["send"] == 0


@pytest.mark.asyncio
async def test_cost_record_created_for_real_usage(monkeypatch: pytest.MonkeyPatch, phase4b_env):
    response = ProviderResponse(
        "openai",
        "gpt-5.4",
        "api",
        200,
        {},
        b'{"usage":{"prompt_tokens":123,"completion_tokens":45}}',
        {"usage": {"prompt_tokens": 123, "completion_tokens": 45}},
        44,
    )
    monkeypatch.setattr(deps.provider_registry, "iter_providers_for_capability", lambda *args, **kwargs: ["openai"])
    monkeypatch.setattr(deps.provider_registry, "default_model_for", lambda *args, **kwargs: "gpt-5.4")
    monkeypatch.setattr(deps.provider_registry, "build_transport", lambda *args, **kwargs: _DummyTransport("openai", [response]))

    await deps.transport_manager.execute(
        "chat",
        ProviderRequest(capability="chat", agent_id="codex", session_id="session-1", task_id="task-1", input_tokens=100),
    )
    usage = await deps.cost_tracker.usage_snapshot()

    assert usage["entry_count"] == 1
    entry = usage["entries"][0]
    assert entry["agent"] == "codex"
    assert entry["session_id"] == "session-1"
    assert entry["task_id"] == "task-1"
    assert entry["provider"] == "openai"
    assert entry["model"] == "gpt-5.4"
    assert entry["transport"] == "api"
    assert entry["input_tokens"] == 123
    assert entry["output_tokens"] == 45
    assert entry["cost"] > 0


@pytest.mark.asyncio
async def test_cli_transport_cost_record_is_marked_derived(phase4b_env):
    await deps.cost_tracker.record_derived_cli_usage(
        agent_id="claude",
        session_id="session-2",
        task_id="task-2",
        provider="anthropic",
        model="claude-sonnet-4-6",
        input_tokens=400,
        output_tokens=100,
    )
    usage = await deps.cost_tracker.usage_snapshot()
    assert usage["entries"][0]["transport"] == "cli"
    assert usage["entries"][0]["metadata"]["accounting_mode"] == "derived"


@pytest.mark.asyncio
async def test_cache_diagnostics_report_hits_and_misses(monkeypatch: pytest.MonkeyPatch, phase4b_env):
    response = ProviderResponse("openai", "gpt-5.4-mini", "api", 200, {}, b"{}", {}, 8)
    monkeypatch.setattr(deps.provider_registry, "iter_providers_for_capability", lambda *args, **kwargs: ["openai"])
    monkeypatch.setattr(deps.provider_registry, "default_model_for", lambda *args, **kwargs: "gpt-5.4-mini")
    monkeypatch.setattr(
        deps.provider_registry,
        "build_transport",
        lambda *args, **kwargs: _DummyTransport("openai", [response, ProviderResponse("openai", "gpt-5.4-mini", "api", 200, {}, b"{}", {}, 8)]),
    )
    req = ProviderRequest(capability="chat", agent_id="codex", session_id="cache", cache_key="same-key")
    await deps.transport_manager.execute("chat", req)
    await deps.transport_manager.execute("chat", req)
    metrics = deps.transport_manager.cache_metrics()
    assert metrics["providers"]["openai"]["misses"] == 1
    assert metrics["providers"]["openai"]["hits"] == 1
    assert metrics["providers"]["openai"]["cache_hit_rate"] == 0.5


@pytest.mark.asyncio
async def test_cache_alert_fires_after_sustained_low_hit_rate(monkeypatch: pytest.MonkeyPatch, phase4b_env):
    deps._settings["cacheAlertThreshold"] = 0.5
    deps._settings["cacheAlertMissStreak"] = 5
    responses = [ProviderResponse("openai", "gpt-5.4-mini", "api", 200, {}, b"{}", {}, 8) for _ in range(5)]
    monkeypatch.setattr(deps.provider_registry, "iter_providers_for_capability", lambda *args, **kwargs: ["openai"])
    monkeypatch.setattr(deps.provider_registry, "default_model_for", lambda *args, **kwargs: "gpt-5.4-mini")
    monkeypatch.setattr(deps.provider_registry, "build_transport", lambda *args, **kwargs: _DummyTransport("openai", responses))
    monkeypatch.setattr(deps.provider_registry, "extract_usage", lambda *args, **kwargs: {"input_tokens": 10, "output_tokens": 1, "accounting_mode": "direct"})

    for idx in range(5):
        req = ProviderRequest(capability="chat", agent_id="codex", session_id="cache-alert", task_id=f"t{idx}", cache_key=f"unique-{idx}")
        await deps.transport_manager.execute("chat", req)

    alerts = [payload for event, payload in phase4b_env["events"] if event == "cache_alert"]
    assert len(alerts) == 1
    assert alerts[0]["provider"] == "openai"
    assert alerts[0]["consecutive_misses"] == 5
    assert alerts[0]["cache_hit_rate"] == 0.0


@pytest.mark.asyncio
async def test_new_provider_metadata_includes_transport_and_auth(phase4b_env):
    status = deps.provider_registry.get_provider_status()
    by_id = {provider["id"]: provider for provider in status["providers"]}
    assert by_id["bedrock"]["transport_mode"] == "api"
    assert by_id["bedrock"]["auth_method"] == "aws_sigv4"
    assert by_id["moonshot"]["transport_mode"] == "api"
    assert by_id["moonshot"]["auth_method"] == "api_key"
