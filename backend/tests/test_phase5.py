from __future__ import annotations

import subprocess
from pathlib import Path
import shutil

import aiosqlite
import pytest
import pytest_asyncio

import deps
import mcp_bridge
from registry import AgentRegistry
from checkpoints import CheckpointStore
from repo_map import scan_repo
from task_store import TaskStore
from worktree import WorktreeManager


def _git(cwd: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, timeout=20, check=False)


def _init_git_repo(root: Path) -> None:
    (root / ".gitignore").write_text(".ghostlink/\n", encoding="utf-8")
    _git(root, "init")
    _git(root, "config", "user.email", "ghostlink@example.com")
    _git(root, "config", "user.name", "GhostLink Tests")
    (root / "shared.txt").write_text("base\n", encoding="utf-8")
    _git(root, "add", ".")
    _git(root, "commit", "-m", "init")


@pytest.fixture
def git_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _init_git_repo(repo)
    return repo


@pytest.mark.skipif(not shutil.which("git"), reason="git required")
def test_worktree_keyed_by_agent_id_and_repo_map_excludes_runtime_root(git_repo: Path):
    manager = WorktreeManager(str(git_repo))
    worktree = manager.create_worktree("agent123", agent_name="codex")
    assert worktree is not None
    assert worktree == git_repo / ".ghostlink" / "worktrees" / "agent123"
    assert Path(manager.list_worktrees()["agent123"]).name == "agent123"

    mapped = scan_repo(git_repo, max_files=200)
    assert all(".ghostlink/" not in symbol.file for symbol in mapped.symbols)


@pytest.mark.skipif(not shutil.which("git"), reason="git required")
def test_can_merge_reports_conflicts_and_leaves_main_tree_clean(git_repo: Path):
    manager = WorktreeManager(str(git_repo))
    worktree = manager.create_worktree("agent123", agent_name="codex")
    assert worktree is not None

    (git_repo / "shared.txt").write_text("main branch change\n", encoding="utf-8")
    _git(git_repo, "add", "shared.txt")
    _git(git_repo, "commit", "-m", "main change")

    (worktree / "shared.txt").write_text("worktree change\n", encoding="utf-8")
    _git(worktree, "add", "shared.txt")
    _git(worktree, "commit", "-m", "worktree change")

    probe = manager.can_merge("agent123")
    assert probe["clean"] is False
    assert any("shared.txt" in item for item in probe["conflicting_files"] or [probe["reason"]])
    status = _git(git_repo, "status", "--porcelain")
    assert status.stdout.strip() == ""


@pytest.mark.skipif(not shutil.which("git"), reason="git required")
def test_disconnect_preserves_dirty_worktree(git_repo: Path):
    manager = WorktreeManager(str(git_repo))
    worktree = manager.create_worktree("agent123", agent_name="codex")
    assert worktree is not None

    (worktree / "notes.txt").write_text("dirty\n", encoding="utf-8")
    result = manager.on_agent_disconnect("agent123")
    assert result["action"] == "preserve"
    assert result["dirty"] is True
    assert worktree.exists()


@pytest_asyncio.fixture
async def phase5_db(tmp_path: Path):
    db_path = tmp_path / "ghostlink_v2.db"
    db = await aiosqlite.connect(str(db_path))
    db.row_factory = aiosqlite.Row
    task_store = TaskStore(db)
    checkpoint_store = CheckpointStore(db)
    deps.registry = AgentRegistry()
    deps.task_store = task_store
    await task_store.init()
    await checkpoint_store.init()
    mcp_bridge.configure(
        store=None,
        registry=deps.registry,
        settings={"channels": ["general"]},
        data_dir=tmp_path,
        task_store=task_store,
    )
    try:
        yield {"db": db, "task_store": task_store, "checkpoint_store": checkpoint_store}
    finally:
        await db.close()
        deps.registry = None
        deps.task_store = None


@pytest.mark.asyncio
async def test_task_and_checkpoint_lookups_can_use_agent_id(phase5_db):
    task = await phase5_db["task_store"].create(
        title="Phase 5 task",
        agent_id="agent123",
        agent_name="codex",
        created_by="tyson",
    )
    await phase5_db["checkpoint_store"].create(
        task["task_id"],
        "codex",
        "task_start",
        {"task": {"title": "Phase 5 task"}},
        agent_id="agent123",
    )
    listed = await phase5_db["task_store"].list_tasks(agent_id="agent123")
    cancellation = await phase5_db["task_store"].update(task["task_id"], status="cancelled")
    pending = await phase5_db["task_store"].get_pending_cancellation(agent_id="agent123")
    checkpoints = await phase5_db["checkpoint_store"].list_for_agent(agent_id="agent123")

    assert listed and listed[0]["task_id"] == task["task_id"]
    assert cancellation is not None
    assert pending is not None and pending["task_id"] == task["task_id"]
    assert checkpoints and checkpoints[0]["agent_id"] == "agent123"


@pytest.mark.asyncio
async def test_mcp_bridge_pending_signal_prefers_agent_id_over_stale_name(phase5_db):
    registered = deps.registry.register("codex")
    task = await phase5_db["task_store"].create(
        title="Signal task",
        agent_id=registered.agent_id,
        agent_name="stale-name",
        created_by="tyson",
    )
    await phase5_db["task_store"].update(task["task_id"], status="cancelled")

    message = mcp_bridge._pending_cancellation_message(registered.name)
    delivered = await phase5_db["task_store"].get(task["task_id"])

    assert message is not None
    assert task["task_id"] in message
    assert delivered["metadata"]["cancel_signal_delivered"] is True
