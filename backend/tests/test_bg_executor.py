from __future__ import annotations

import asyncio
from pathlib import Path

import aiosqlite
import pytest
import pytest_asyncio

from bg_executor import BackgroundExecutor, TaskState, default_python_command
from task_store import TaskStore


@pytest_asyncio.fixture
async def executor_env(tmp_path: Path):
    db_path = tmp_path / "ghostlink_v2.db"
    db = await aiosqlite.connect(str(db_path))
    db.row_factory = aiosqlite.Row
    task_store = TaskStore(db)
    await task_store.init()
    executor = BackgroundExecutor(output_root=tmp_path, task_store=task_store, max_concurrent=1)
    try:
        yield {"executor": executor, "task_store": task_store}
    finally:
        await executor.shutdown(force=True)
        await db.close()


async def _wait_for_task_state(
    executor: BackgroundExecutor,
    task_id: str,
    expected_state: TaskState,
    *,
    timeout: float = 2.0,
) -> dict:
    deadline = asyncio.get_running_loop().time() + timeout
    last = None
    while asyncio.get_running_loop().time() < deadline:
        last = await executor.get_task(task_id)
        if last is not None and last["state"] == expected_state.value:
            return last
        await asyncio.sleep(0.05)
    raise AssertionError(f"task {task_id} did not reach {expected_state.value}; last={last}")


@pytest.mark.asyncio
async def test_background_executor_respects_concurrency_limit(executor_env):
    executor = executor_env["executor"]
    task_store = executor_env["task_store"]

    first = await task_store.create(title="first", agent_id="agent-1", agent_name="tyson", created_by="test")
    second = await task_store.create(title="second", agent_id="agent-1", agent_name="tyson", created_by="test")

    await executor.enqueue(
        task_id=first["task_id"],
        agent_id="agent-1",
        agent_name="tyson",
        command=default_python_command("import time; time.sleep(0.4)"),
    )
    await executor.enqueue(
        task_id=second["task_id"],
        agent_id="agent-1",
        agent_name="tyson",
        command=default_python_command("print('done')"),
    )

    await asyncio.sleep(0.1)
    first_live = await executor.get_task(first["task_id"])
    second_live = await executor.get_task(second["task_id"])
    assert first_live is not None and first_live["state"] in {TaskState.STARTING.value, TaskState.RUNNING.value}
    assert second_live is not None and second_live["state"] == TaskState.QUEUED.value

    first_done = await _wait_for_task_state(executor, first["task_id"], TaskState.COMPLETED)
    second_done = await _wait_for_task_state(executor, second["task_id"], TaskState.COMPLETED)
    assert first_done["state"] == TaskState.COMPLETED.value
    assert second_done["state"] == TaskState.COMPLETED.value

    second_row = await task_store.get(second["task_id"])
    assert second_row is not None
    assert second_row["status"] == "completed"
    assert second_row["metadata"]["background_state"] == "completed"


@pytest.mark.asyncio
async def test_background_executor_cancels_queued_task(executor_env):
    executor = executor_env["executor"]
    task_store = executor_env["task_store"]

    first = await task_store.create(title="first", agent_id="agent-1", agent_name="tyson", created_by="test")
    second = await task_store.create(title="second", agent_id="agent-1", agent_name="tyson", created_by="test")

    await executor.enqueue(
        task_id=first["task_id"],
        agent_id="agent-1",
        agent_name="tyson",
        command=default_python_command("import time; time.sleep(0.4)"),
    )
    await executor.enqueue(
        task_id=second["task_id"],
        agent_id="agent-1",
        agent_name="tyson",
        command=default_python_command("print('never runs')"),
    )

    cancelled = await executor.cancel(second["task_id"])
    assert cancelled is not None
    assert cancelled["state"] == TaskState.CANCELLED.value

    row = await task_store.get(second["task_id"])
    assert row is not None
    assert row["status"] == "cancelled"
    assert row["metadata"]["cancel_requested"] is True


@pytest.mark.asyncio
async def test_background_executor_captures_output_log(executor_env):
    executor = executor_env["executor"]
    task_store = executor_env["task_store"]
    task = await task_store.create(title="log", agent_id="agent-1", agent_name="tyson", created_by="test")

    await executor.enqueue(
        task_id=task["task_id"],
        agent_id="agent-1",
        agent_name="tyson",
        command=default_python_command("print('hello from background executor')"),
    )

    live = await _wait_for_task_state(executor, task["task_id"], TaskState.COMPLETED)
    stored = await task_store.get(task["task_id"])
    assert stored is not None
    assert live["state"] == TaskState.COMPLETED.value
    output_log = Path(stored["metadata"]["output_log"])
    assert output_log.exists()
    assert "hello from background executor" in output_log.read_text(encoding="utf-8")
