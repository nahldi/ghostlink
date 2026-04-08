from __future__ import annotations

from pathlib import Path

import aiosqlite
import pytest
import pytest_asyncio

import deps
from audit_store import AuditStore
from checkpoints import CheckpointStore
from evals import EvalEngine, evaluate_regression_gates
from task_store import TaskStore


REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest_asyncio.fixture
async def phase45_env(tmp_path: Path):
    db = await aiosqlite.connect(str(tmp_path / "ghostlink_v2.db"))
    db.row_factory = aiosqlite.Row
    deps.runtime_db = db
    deps.DATA_DIR = tmp_path
    deps.BASE_DIR = REPO_ROOT / "backend"
    deps._settings = {"channels": ["general"]}
    deps.audit_store = AuditStore(db)
    await deps.audit_store.init()
    deps.task_store = TaskStore(db)
    await deps.task_store.init()
    deps.checkpoint_store = CheckpointStore(db)
    await deps.checkpoint_store.init()
    deps.cost_tracker = None
    deps.eval_engine = EvalEngine(db, root=REPO_ROOT)
    await deps.eval_engine.init()
    try:
        yield
    finally:
        await db.close()
        deps.runtime_db = None
        deps.audit_store = None
        deps.task_store = None
        deps.checkpoint_store = None
        deps.eval_engine = None


def _good_trace() -> dict:
    return {
        "task_id": "task-good",
        "trace_id": "trace-good",
        "events": [
            {"event_type": "tool.chat_join", "outcome": "ok", "detail": {"tool": "chat_join", "args": {"sender": "claude"}}},
            {"event_type": "tool.chat_send", "outcome": "ok", "detail": {"tool": "chat_send", "args": {"sender": "claude"}}},
            {"event_type": "policy.approval", "outcome": "ok", "detail": {"approval_required": False}},
        ],
        "usage": [{"cost": 0.0001}],
        "artifact_refs": ["artifact-1"],
        "outputs": [{"message": "hello"}],
        "messages": [{"sender": "claude", "content": "hello"}],
        "duration_ms": 2000,
        "interrupt_events": [],
        "interrupt_handled": True,
        "interrupt_needs_review": False,
        "needs_review": False,
    }


def _bad_trace() -> dict:
    return {
        "task_id": "task-bad",
        "trace_id": "trace-bad",
        "events": [
            {"event_type": "tool.chat_send", "outcome": "ok", "detail": {"tool": "chat_send", "args": {"sender": "Claude Code"}}},
            {"event_type": "policy.violation", "outcome": "violation", "detail": {"approval_required": True, "approval_requested": False}},
        ],
        "usage": [{"cost": 0.01}],
        "artifact_refs": [],
        "outputs": [{"message": "wrong"}],
        "messages": [{"sender": "Claude Code", "content": "wrong"}],
        "duration_ms": 60000,
        "interrupt_events": [{"event_type": "task.interrupted"}],
        "interrupt_handled": False,
        "interrupt_needs_review": True,
        "needs_review": True,
    }


@pytest.mark.asyncio
async def test_minimum_golden_task_count_and_manifest_generation(phase45_env):
    corpus = deps.eval_engine.corpus
    tasks = corpus.list_tasks()
    manifest = corpus.generate_manifest(write=False)
    counts = corpus.category_counts()
    assert len(tasks) >= 22
    assert manifest["task_count"] == len(tasks)
    assert len(corpus.mandatory_subset()) == 44
    for category in ("identity", "routing", "hooks", "approvals", "replay", "delegation", "worktrees", "failover", "memory", "policy"):
        assert counts.get(category, 0) >= 2


@pytest.mark.asyncio
async def test_trace_grader_scores_known_good_trace(phase45_env):
    task = deps.eval_engine.corpus.get_task("golden-identity-001")
    report = deps.eval_engine.grader.grade(_good_trace(), task)
    assert report.passed is True
    assert report.composite >= 0.80
    assert "correctness" in report.scores
    assert "policy_compliance" in report.scores


@pytest.mark.asyncio
async def test_trace_grader_hard_floors_block_known_bad_trace(phase45_env):
    task = deps.eval_engine.corpus.get_task("golden-identity-001")
    report = deps.eval_engine.grader.grade(_bad_trace(), task)
    assert report.passed is False
    assert "correctness" in report.hard_fails
    assert "policy_compliance" in report.hard_fails


@pytest.mark.asyncio
async def test_eval_store_persists_results_and_human_override(phase45_env):
    task = deps.eval_engine.corpus.get_task("golden-identity-001")
    run = await deps.eval_engine.store.create_run(subset="mandatory", commit_hash="abc123", version="5.7.2")
    report = deps.eval_engine.grader.grade(_good_trace(), task)
    row = await deps.eval_engine.store.record_result(
        run_id=run["run_id"],
        task=task,
        provider="anthropic",
        model="claude-sonnet-4-6",
        profile="default",
        sandbox_tier="none",
        agent_role="single_agent",
        trace_id="trace-good",
        task_ref="task-good",
        report=report,
        cost_usd=0.0001,
        duration_ms=2000,
        commit_hash="abc123",
        version="5.7.2",
        human_override={"interrupt_handling": 1.0, "reviewer": "kurt"},
    )
    summary = await deps.eval_engine.store.summarize_run(run["run_id"])
    assert row["authoritative_source"] == "human_override"
    assert row["human_override"]["reviewer"] == "kurt"
    assert summary["pass_count"] == 1


@pytest.mark.asyncio
async def test_regression_gate_blocks_new_failure_even_if_average_passes(phase45_env):
    baseline = [
        {"task_id": "golden-identity-001", "passed": True, "composite": 0.92, "scores": {"safety": 1.0, "policy_compliance": 1.0, "correctness": 1.0}},
        {"task_id": "golden-routing-001", "passed": True, "composite": 0.88, "scores": {"safety": 1.0, "policy_compliance": 1.0, "correctness": 1.0}},
    ]
    current = [
        {"task_id": "golden-identity-001", "passed": False, "composite": 0.78, "scores": {"safety": 1.0, "policy_compliance": 1.0, "correctness": 0.49}},
        {"task_id": "golden-routing-001", "passed": True, "composite": 0.99, "scores": {"safety": 1.0, "policy_compliance": 1.0, "correctness": 1.0}},
    ]
    gate = evaluate_regression_gates(current, thresholds=deps.eval_engine.corpus.thresholds(), baseline_results=baseline)
    reasons = {item["reason"] for item in gate["blocking"]}
    assert gate["ok"] is False
    assert "no_new_failures" in reasons
    assert "correctness_floor" in reasons


@pytest.mark.asyncio
async def test_eval_engine_builds_trace_from_stored_backend_records(phase45_env):
    task = await deps.task_store.create(title="Identity task", status="completed", trace_id="trace-built", agent_name="claude", metadata={"artifact_refs": ["artifact-1"]})
    await deps.task_store.update(task["task_id"], started_at=100.0, completed_at=101.5)
    await deps.audit_store.record("tool.chat_send", actor="claude", action="send message", agent_name="claude", task_id=task["task_id"], trace_id="trace-built", detail={"tool": "chat_send", "args": {"sender": "claude"}})
    await deps.checkpoint_store.create(task["task_id"], "claude", "completion", {"task": {"progress_step": "done"}})
    trace = await deps.eval_engine.build_trace(task_id=task["task_id"])
    assert trace["trace_id"] == "trace-built"
    assert len(trace["events"]) == 1
    assert len(trace["checkpoints"]) == 1
    assert trace["artifact_refs"] == ["artifact-1"]
