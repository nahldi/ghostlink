"""Background task executor for async agent work."""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import time
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any


class TaskState(str, Enum):
    CREATED = "created"
    QUEUED = "queued"
    STARTING = "starting"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    RESUMING = "resuming"


@dataclass
class BackgroundTask:
    task_id: str
    agent_id: str
    agent_name: str
    command: list[str]
    cwd: str = ""
    env: dict[str, str] = field(default_factory=dict)
    worktree_path: Path | None = None
    process: subprocess.Popen | None = None
    state: TaskState = TaskState.CREATED
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    completed_at: float | None = None
    checkpoint_id: str | None = None
    cancel_requested: bool = False
    output_log: Path | None = None
    return_code: int | None = None
    error: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)
    monitor: asyncio.Task | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "agent_id": self.agent_id,
            "agent_name": self.agent_name,
            "command": list(self.command),
            "cwd": self.cwd,
            "env": dict(self.env),
            "worktree_path": str(self.worktree_path) if self.worktree_path else "",
            "pid": self.process.pid if self.process else None,
            "state": self.state.value,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "checkpoint_id": self.checkpoint_id,
            "cancel_requested": self.cancel_requested,
            "output_log": str(self.output_log) if self.output_log else "",
            "return_code": self.return_code,
            "error": self.error,
            "metadata": dict(self.metadata),
        }


class BackgroundExecutor:
    def __init__(
        self,
        *,
        output_root: str | Path,
        task_store=None,
        checkpoint_store=None,
        worktree_manager=None,
        max_concurrent: int = 3,
    ):
        self.output_root = Path(output_root)
        self.task_store = task_store
        self.checkpoint_store = checkpoint_store
        self.worktree_manager = worktree_manager
        self.max_concurrent = max(1, int(max_concurrent or 1))
        self._tasks: dict[str, BackgroundTask] = {}
        self._queue: deque[str] = deque()
        self._running: set[str] = set()
        self._lock = asyncio.Lock()
        self._closed = False

    async def enqueue(
        self,
        *,
        task_id: str,
        agent_id: str,
        agent_name: str,
        command: list[str],
        cwd: str = "",
        env: dict[str, str] | None = None,
        checkpoint_id: str | None = None,
        worktree_path: str | Path | None = None,
        metadata: dict[str, Any] | None = None,
        resume: bool = False,
    ) -> dict[str, Any]:
        task = BackgroundTask(
            task_id=task_id,
            agent_id=str(agent_id or ""),
            agent_name=str(agent_name or ""),
            command=[str(part) for part in command],
            cwd=str(cwd or ""),
            env={str(k): str(v) for k, v in (env or {}).items()},
            checkpoint_id=checkpoint_id,
            worktree_path=Path(worktree_path) if worktree_path else None,
            state=TaskState.RESUMING if resume else TaskState.QUEUED,
            metadata=dict(metadata or {}),
        )
        task.output_log = self.output_root / "background" / f"{task.task_id}.log"
        task.output_log.parent.mkdir(parents=True, exist_ok=True)
        async with self._lock:
            if self._closed:
                raise RuntimeError("background executor is closed")
            self._tasks[task.task_id] = task
            self._queue.append(task.task_id)
            await self._sync_task_store(task)
            await self._schedule_locked()
            return task.to_dict()

    async def get_task(self, task_id: str) -> dict[str, Any] | None:
        async with self._lock:
            task = self._tasks.get(task_id)
            return task.to_dict() if task else None

    async def list_tasks(self) -> list[dict[str, Any]]:
        async with self._lock:
            return [task.to_dict() for task in self._tasks.values()]

    async def cancel(self, task_id: str, *, force: bool = False) -> dict[str, Any] | None:
        async with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return None
            task.cancel_requested = True
            if task_id in self._queue:
                self._queue.remove(task_id)
                task.state = TaskState.CANCELLED
                task.completed_at = time.time()
                task.error = "cancelled before start"
                await self._sync_task_store(task, status="cancelled", error=task.error)
                return task.to_dict()
            proc = task.process
        if proc is not None and proc.poll() is None:
            try:
                proc.kill() if force else proc.terminate()
            except Exception as exc:
                async with self._lock:
                    task = self._tasks.get(task_id)
                    if task is not None:
                        task.error = f"cancel failed: {exc}"
        return await self.get_task(task_id)

    async def shutdown(self, *, force: bool = False) -> None:
        async with self._lock:
            self._closed = True
            queued = list(self._queue)
            running = list(self._running)
        for task_id in queued:
            await self.cancel(task_id, force=force)
        for task_id in running:
            await self.cancel(task_id, force=force)
        monitors: list[asyncio.Task] = []
        async with self._lock:
            for task in self._tasks.values():
                if task.monitor is not None:
                    monitors.append(task.monitor)
        if monitors:
            await asyncio.gather(*monitors, return_exceptions=True)

    async def _schedule_locked(self) -> None:
        while self._queue and len(self._running) < self.max_concurrent:
            task_id = self._queue.popleft()
            task = self._tasks.get(task_id)
            if task is None or task.state == TaskState.CANCELLED:
                continue
            self._running.add(task_id)
            task.monitor = asyncio.create_task(self._run_task(task_id))

    async def _run_task(self, task_id: str) -> None:
        async with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return
            task.state = TaskState.STARTING
            task.started_at = time.time()
            await self._sync_task_store(task, status="running")
        try:
            task = self._tasks[task_id]
            if task.worktree_path is None and self.worktree_manager and task.agent_id:
                created = await asyncio.to_thread(
                    self.worktree_manager.create_worktree,
                    task.agent_id,
                    task.task_id,
                    agent_name=task.agent_name or task.agent_id,
                )
                task.worktree_path = Path(created) if created else None
            log_path = task.output_log or (self.output_root / "background" / f"{task.task_id}.log")
            log_path.parent.mkdir(parents=True, exist_ok=True)
            with log_path.open("a", encoding="utf-8") as log_handle:
                merged_env = os.environ.copy()
                merged_env.update(task.env)
                proc = subprocess.Popen(
                    task.command,
                    cwd=task.cwd or None,
                    env=merged_env,
                    stdout=log_handle,
                    stderr=subprocess.STDOUT,
                    text=True,
                )
                async with self._lock:
                    live_task = self._tasks.get(task_id)
                    if live_task is None:
                        return
                    live_task.process = proc
                    live_task.state = TaskState.RUNNING
                    await self._sync_task_store(live_task, status="running")
                return_code = await asyncio.to_thread(proc.wait)
            async with self._lock:
                live_task = self._tasks.get(task_id)
                if live_task is None:
                    return
                live_task.return_code = return_code
                live_task.completed_at = time.time()
                if live_task.cancel_requested:
                    live_task.state = TaskState.CANCELLED
                    live_task.error = "cancelled"
                    await self._sync_task_store(live_task, status="cancelled", error=live_task.error)
                elif return_code == 0:
                    live_task.state = TaskState.COMPLETED
                    await self._sync_task_store(live_task, status="completed")
                else:
                    live_task.state = TaskState.FAILED
                    live_task.error = f"process exited with code {return_code}"
                    await self._sync_task_store(live_task, status="failed", error=live_task.error)
        except Exception as exc:
            async with self._lock:
                live_task = self._tasks.get(task_id)
                if live_task is not None:
                    live_task.completed_at = time.time()
                    live_task.state = TaskState.FAILED
                    live_task.error = str(exc)
                    await self._sync_task_store(live_task, status="failed", error=live_task.error)
        finally:
            async with self._lock:
                self._running.discard(task_id)
                live_task = self._tasks.get(task_id)
                if live_task is not None:
                    live_task.process = None
                    live_task.monitor = None
                await self._schedule_locked()

    async def _sync_task_store(self, task: BackgroundTask, *, status: str | None = None, error: str | None = None) -> None:
        if self.task_store is None:
            return
        mapped_status = status or self._map_status(task.state)
        await self.task_store.update(
            task.task_id,
            status=mapped_status,
            started_at=task.started_at,
            completed_at=task.completed_at,
            error=error if error is not None else (task.error or None),
            metadata={
                **dict(task.metadata),
                "background": True,
                "background_state": task.state.value,
                "pid": task.process.pid if task.process else None,
                "command": list(task.command),
                "output_log": str(task.output_log) if task.output_log else "",
                "checkpoint_id": task.checkpoint_id,
                "cancel_requested": task.cancel_requested,
                "return_code": task.return_code,
                "worktree_path": str(task.worktree_path) if task.worktree_path else "",
            },
        )

    @staticmethod
    def _map_status(state: TaskState) -> str:
        return {
            TaskState.CREATED: "queued",
            TaskState.QUEUED: "queued",
            TaskState.STARTING: "running",
            TaskState.RUNNING: "running",
            TaskState.COMPLETED: "completed",
            TaskState.FAILED: "failed",
            TaskState.CANCELLED: "cancelled",
            TaskState.RESUMING: "running",
        }[state]


def default_python_command(code: str) -> list[str]:
    return [sys.executable, "-c", code]
