from __future__ import annotations

import json
from pathlib import Path

import pytest
import aiosqlite

import deps


@pytest.fixture(autouse=True)
def _reset_phase6_deps():
    old_registry = deps.registry
    old_memory_graph = deps.memory_graph
    old_rag_pipeline = deps.rag_pipeline
    old_data_dir = deps.DATA_DIR
    deps.registry = None
    deps.memory_graph = None
    deps.rag_pipeline = None
    yield
    deps.registry = old_registry
    deps.memory_graph = old_memory_graph
    deps.rag_pipeline = old_rag_pipeline
    deps.DATA_DIR = old_data_dir


def test_phase6_memory_entries_gain_layered_metadata(tmp_path: Path):
    from agent_memory import AgentMemory

    mem = AgentMemory(tmp_path, "codex")
    saved = mem.save("project", "GhostLink backend architecture", tags=["arch"])
    loaded = mem.load("project")

    assert saved["layer"] == "workspace"
    assert loaded is not None
    assert loaded["layer"] == "workspace"
    assert loaded["tags"] == ["arch"]
    assert loaded["importance"] == 0.5
    assert loaded["access_count"] >= 2
    assert loaded["size_tokens"] > 0
    assert (tmp_path / "agents" / "codex" / "memory" / "workspace").is_dir()


def test_phase6_flat_memory_migrates_into_workspace_layer(tmp_path: Path):
    from agent_memory import AgentMemory

    legacy_dir = tmp_path / "agents" / "codex" / "memory"
    legacy_dir.mkdir(parents=True)
    (legacy_dir / "legacy.json").write_text(json.dumps({"key": "legacy", "content": "old memory"}), encoding="utf-8")

    mem = AgentMemory(tmp_path, "codex")
    loaded = mem.load("legacy")

    assert loaded is not None
    assert loaded["layer"] == "workspace"
    assert (tmp_path / "agents" / "codex" / "memory" / "workspace" / "legacy.json").exists()
    assert not (legacy_dir / "legacy.json").exists()


def test_phase6_set_soul_mirrors_identity_memory(tmp_path: Path):
    from agent_memory import get_agent_memory, get_soul, set_soul

    set_soul(tmp_path, "codex", "You are Tyson.")
    identity = get_agent_memory(tmp_path, "codex").load("core_identity")

    assert identity is not None
    assert identity["layer"] == "identity"
    assert identity["importance"] == 1.0
    assert get_soul(tmp_path, "codex") == "You are Tyson."


def test_phase6_layered_cross_agent_search_reads_workspace_subdirs(tmp_path: Path):
    from agent_memory import AgentMemory, search_all_memories

    AgentMemory(tmp_path, "claude").save("design", "React dashboard plan")
    AgentMemory(tmp_path, "codex").save("notes", "Python backend plan")

    results = search_all_memories(tmp_path, "plan")

    assert len(results) == 2
    assert {item["layer"] for item in results} == {"workspace"}


def test_phase6_memory_graph_is_updated_from_memory_saves(tmp_path: Path):
    from agent_memory import AgentMemory
    from memory_graph import MemoryGraph

    deps.memory_graph = MemoryGraph(tmp_path / "graph")
    try:
        mem = AgentMemory(tmp_path, "codex")
        mem.save("routing", "Model routing uses weighted recall", tags=["routing"])
        results = deps.memory_graph.search("weighted recall", agent="codex")
        assert results
        assert results[0]["key"] == "routing"
        assert "workspace" in results[0]["tags"]
    finally:
        deps.memory_graph = None


def test_phase6_search_reconciles_rag_pipeline(tmp_path: Path):
    from agent_memory import AgentMemory
    from rag import RAGPipeline

    deps.rag_pipeline = RAGPipeline(tmp_path)
    try:
        deps.rag_pipeline.upload("memory-notes.md", "Weighted recall uses retrieval context.", channel="general")
        mem = AgentMemory(tmp_path, "codex")
        mem.save("routing", "Memory search should include local entries", tags=["memory"])
        results = mem.search("retrieval context")
        assert any(item.get("source") == "rag" for item in results)

        from agent_memory import search_all_memories

        all_results = search_all_memories(tmp_path, "retrieval context")
        assert any(item.get("source") == "rag" for item in all_results)
    finally:
        deps.rag_pipeline = None


def test_phase6_memory_write_emits_event(tmp_path: Path):
    from agent_memory import AgentMemory
    from plugin_sdk import event_bus

    seen: list[dict] = []

    def _handler(payload: dict):
        seen.append(payload)

    event_bus.on("memory_written", _handler)
    try:
        mem = AgentMemory(tmp_path, "codex")
        mem.save("routing", "Weighted recall memory", layer="workspace", tags=["routing", "memory"])
    finally:
        event_bus.off("memory_written", _handler)

    assert seen
    assert seen[0]["agent_id"] == "codex"
    assert seen[0]["key"] == "routing"
    assert seen[0]["layer"] == "workspace"
    assert seen[0]["tags"] == ["routing", "memory"]


def test_phase6_memory_promotion_moves_entry_and_emits_event(tmp_path: Path):
    from agent_memory import AgentMemory
    from plugin_sdk import event_bus

    seen: list[dict] = []

    def _handler(payload: dict):
        seen.append(payload)

    event_bus.on("memory_promoted", _handler)
    try:
        mem = AgentMemory(tmp_path, "codex")
        mem.save("session_summary", "Finished auth debugging", layer="session", tags=["summary"])
        promoted = mem.promote("session_summary", target_layer="workspace")
    finally:
        event_bus.off("memory_promoted", _handler)

    assert promoted is not None
    assert promoted["layer"] == "workspace"
    assert promoted["promoted"] is True
    assert "promoted" in promoted["tags"]
    assert (tmp_path / "agents" / "codex" / "memory" / "workspace" / "session_summary.json").exists()
    assert not (tmp_path / "agents" / "codex" / "memory" / "session" / "session_summary.json").exists()
    assert seen
    assert seen[0]["key"] == "session_summary"
    assert seen[0]["from_layer"] == "session"
    assert seen[0]["to_layer"] == "workspace"


def test_phase6_conflicting_memories_emit_conflict_event(tmp_path: Path):
    from agent_memory import AgentMemory
    from plugin_sdk import event_bus

    seen: list[dict] = []

    def _handler(payload: dict):
        seen.append(payload)

    event_bus.on("memory_conflict", _handler)
    try:
        AgentMemory(tmp_path, "claude").save(
            "style_rule",
            "You should always run pytest before merge.",
            layer="workspace",
            tags=["pattern", "decision"],
        )
        AgentMemory(tmp_path, "codex").save(
            "style_rule_alt",
            "You should never run pytest before merge.",
            layer="workspace",
            tags=["pattern"],
        )
    finally:
        event_bus.off("memory_conflict", _handler)

    assert seen
    assert seen[0]["agent_id"] == "codex"
    assert seen[0]["key"] == "style_rule_alt"
    assert seen[0]["conflicts"][0]["agent_id"] == "claude"


def test_phase6_observer_persists_tool_preference_memory(tmp_path: Path):
    from observer import ObservationEngine
    from plugin_sdk import event_bus

    engine = ObservationEngine(tmp_path, threshold=3)
    engine.start()
    try:
        for _ in range(3):
            event_bus.emit("post_tool_use", {"agent": "codex", "tool": "git_diff", "args": {}, "result": "ok"})
    finally:
        engine.stop()

    from agent_memory import AgentMemory

    observed = AgentMemory(tmp_path, "codex").load("obs_tool_preference_git_diff")
    assert observed is not None
    assert observed["layer"] == "workspace"
    assert "observational" in observed["tags"]
    assert "tool_preference" in observed["tags"]
    assert observed["importance"] == 0.3


def test_phase6_weighted_recall_prefers_recent_frequent_important_entries(tmp_path: Path):
    from agent_memory import AgentMemory

    mem = AgentMemory(tmp_path, "codex")
    mem.save("routing_low", "Weighted recall for provider routing", tags=["routing"], importance=0.2)
    mem.save("routing_high", "Weighted recall for provider routing", tags=["routing"], importance=0.9)

    low = mem.load("routing_low")
    assert low is not None
    low["last_accessed"] = 1.0
    low["access_count"] = 1
    (tmp_path / "agents" / "codex" / "memory" / "workspace" / "routing_low.json").write_text(
        json.dumps(low), encoding="utf-8"
    )

    high = mem.load("routing_high")
    assert high is not None
    for _ in range(3):
        high = mem.load("routing_high")
        assert high is not None

    results = mem.search("weighted recall", tags=["routing"])

    assert results
    assert results[0]["key"] == "routing_high"
    assert results[0]["score"] > results[1]["score"]


def test_phase6_tag_filter_matches_any_requested_tag(tmp_path: Path):
    from agent_memory import AgentMemory

    mem = AgentMemory(tmp_path, "codex")
    mem.save("arch_note", "Layered architecture decision", tags=["architecture"])
    mem.save("bug_note", "Known routing bug workaround", tags=["bug"])
    mem.save("mixed_note", "Architecture bug note", tags=["architecture", "bug"])

    results = mem.search("note", tags=["architecture", "bug"])
    keys = {item["key"] for item in results}

    assert keys == {"arch_note", "bug_note", "mixed_note"}


class _DummyRequest:
    def __init__(self, body: dict | None = None):
        self._body = body or {}
        self.headers: dict[str, str] = {}

    async def json(self) -> dict:
        return self._body


@pytest.mark.asyncio
async def test_phase6_agent_memory_search_route_supports_layer_filter(tmp_path: Path):
    from registry import AgentRegistry, init_registry_db
    from routes import agents

    db = await aiosqlite.connect(str(tmp_path / "ghostlink_v2.db"))
    db.row_factory = aiosqlite.Row
    await init_registry_db(db)
    deps.DATA_DIR = tmp_path
    deps.runtime_db = db
    deps.registry = AgentRegistry()
    deps.worktree_manager = None
    deps.automation_manager = None

    async def _broadcast(*_args, **_kwargs):
        return None

    deps.broadcast = _broadcast
    try:
        registered = await agents.register_agent(_DummyRequest({"base": "codex"}))
        mem = agents.get_agent_memory(deps.DATA_DIR, registered["agent_id"])
        mem.save("core_identity", "You are Tyson.", layer="identity", tags=["identity"])
        mem.save("workspace_note", "GhostLink roadmap context", layer="workspace", tags=["roadmap"])

        identity_results = await agents.search_agent_memories(registered["name"], q="Tyson", layer="identity")
        workspace_results = await agents.search_agent_memories(registered["name"], q="roadmap", layer="workspace")

        assert len(identity_results["results"]) == 1
        assert identity_results["results"][0]["layer"] == "identity"
        assert len(workspace_results["results"]) == 1
        assert workspace_results["results"][0]["layer"] == "workspace"
    finally:
        await db.close()
        deps.runtime_db = None
        deps.registry = None


@pytest.mark.asyncio
async def test_phase6_agent_memory_promote_route_promotes_entry(tmp_path: Path):
    from registry import AgentRegistry, init_registry_db
    from routes import agents

    db = await aiosqlite.connect(str(tmp_path / "ghostlink_v2.db"))
    db.row_factory = aiosqlite.Row
    await init_registry_db(db)
    deps.DATA_DIR = tmp_path
    deps.runtime_db = db
    deps.registry = AgentRegistry()
    deps.worktree_manager = None
    deps.automation_manager = None

    async def _broadcast(*_args, **_kwargs):
        return None

    deps.broadcast = _broadcast
    try:
        registered = await agents.register_agent(_DummyRequest({"base": "codex"}))
        mem = agents.get_agent_memory(deps.DATA_DIR, registered["agent_id"])
        mem.save("session_summary", "Finished auth debugging", layer="session", tags=["summary"])

        result = await agents.api_promote_agent_memory(
            registered["name"],
            "session_summary",
            _DummyRequest({"layer": "workspace"}),
        )

        assert result["ok"] is True
        assert result["memory"]["layer"] == "workspace"
        assert result["memory"]["promoted"] is True
        assert "promoted" in result["memory"]["tags"]
    finally:
        await db.close()
        deps.runtime_db = None
        deps.registry = None
