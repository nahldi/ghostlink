from __future__ import annotations

import time
import uuid as _uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Literal

import deps


ArenaState = Literal["running", "comparing", "resolved", "cancelled"]
ContestantState = Literal["queued", "running", "completed", "failed", "timeout", "budget_exceeded", "discarded", "winner"]


@dataclass
class ArenaContestant:
    agent_id: str
    agent_name: str
    task_id: str = ""
    worktree_path: str = ""
    state: ContestantState = "queued"
    cost: dict = field(default_factory=lambda: {"input_tokens": 0, "output_tokens": 0, "estimated_cost_usd": 0.0})
    time_elapsed_seconds: float = 0.0
    eval_scores: dict | None = None
    diff_stat: dict | None = None
    result_summary: str = ""
    error: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ArenaRun:
    arena_id: str
    task_description: str
    spec_id: str | None
    contestants: list[ArenaContestant]
    state: ArenaState = "running"
    created_at: float = field(default_factory=time.time)
    timeout_seconds: int = 1800
    resolved_at: float | None = None
    winner_agent_id: str | None = None

    def to_dict(self) -> dict:
        data = asdict(self)
        data["contestants"] = [contestant.to_dict() for contestant in self.contestants]
        return data


class ArenaDispatcher:
    def __init__(self):
        self._runs: dict[str, ArenaRun] = {}

    async def create_run(
        self,
        *,
        task_description: str,
        contestants: list[dict],
        channel: str = "general",
        spec_id: str | None = None,
        timeout_seconds: int = 1800,
    ) -> ArenaRun:
        arena_id = _uuid.uuid4().hex
        arena_contestants = [
            ArenaContestant(
                agent_id=str(item.get("agent_id") or ""),
                agent_name=str(item.get("agent_name") or item.get("agent_id") or ""),
                worktree_path=str(item.get("worktree_path") or ""),
                state=str(item.get("state") or "queued"),
            )
            for item in contestants
        ]
        run = ArenaRun(
            arena_id=arena_id,
            task_description=task_description,
            spec_id=spec_id,
            contestants=arena_contestants,
            timeout_seconds=max(60, int(timeout_seconds)),
        )
        self._runs[arena_id] = run

        if deps.task_store is not None:
            for contestant in run.contestants:
                task = await deps.task_store.create(
                    title=f"Arena: {contestant.agent_name}",
                    description=task_description,
                    channel=channel,
                    agent_id=contestant.agent_id or None,
                    agent_name=contestant.agent_name or None,
                    source_type="arena",
                    source_ref=arena_id,
                    trace_id=arena_id,
                    created_by="operator",
                    status="queued",
                    metadata={
                        "arena_id": arena_id,
                        "contestant_agent_id": contestant.agent_id,
                        "contestant_agent_name": contestant.agent_name,
                        "worktree_path": contestant.worktree_path,
                    },
                )
                contestant.task_id = task["task_id"]

        await self._record_audit(
            "arena_run",
            "create",
            detail={
                "arena_id": arena_id,
                "contestants": [contestant.to_dict() for contestant in run.contestants],
                "spec_id": spec_id,
            },
            trace_id=arena_id,
            channel=channel,
        )
        return run

    def get_run(self, arena_id: str) -> ArenaRun | None:
        return self._runs.get(arena_id)

    def list_runs(self, *, state: ArenaState | None = None) -> list[dict]:
        runs = list(self._runs.values())
        if state is not None:
            runs = [run for run in runs if run.state == state]
        runs.sort(key=lambda run: run.created_at, reverse=True)
        return [run.to_dict() for run in runs]

    async def update_contestant(
        self,
        arena_id: str,
        agent_id: str,
        *,
        state: ContestantState | None = None,
        cost: dict | None = None,
        eval_scores: dict | None = None,
        diff_stat: dict | None = None,
        time_elapsed_seconds: float | None = None,
        result_summary: str | None = None,
        error: str | None = None,
    ) -> dict | None:
        run = self._runs.get(arena_id)
        if run is None:
            return None
        contestant = next((item for item in run.contestants if item.agent_id == agent_id), None)
        if contestant is None:
            return None

        if state is not None:
            contestant.state = state
        if cost is not None:
            contestant.cost = dict(cost)
        if eval_scores is not None:
            contestant.eval_scores = dict(eval_scores)
        if diff_stat is not None:
            contestant.diff_stat = dict(diff_stat)
        if time_elapsed_seconds is not None:
            contestant.time_elapsed_seconds = float(time_elapsed_seconds)
        if result_summary is not None:
            contestant.result_summary = result_summary
        if error is not None:
            contestant.error = error

        if contestant.task_id and deps.task_store is not None:
            mapped_status = {
                "queued": "queued",
                "running": "running",
                "completed": "completed",
                "failed": "failed",
                "timeout": "failed",
                "budget_exceeded": "failed",
                "discarded": "cancelled",
                "winner": "completed",
            }[contestant.state]
            await deps.task_store.update(
                contestant.task_id,
                status=mapped_status,
                error=contestant.error or None,
                metadata={
                    "arena_id": arena_id,
                    "contestant_agent_id": contestant.agent_id,
                    "contestant_agent_name": contestant.agent_name,
                    "worktree_path": contestant.worktree_path,
                    "arena_state": contestant.state,
                    "cost": contestant.cost,
                    "eval_scores": contestant.eval_scores,
                    "diff_stat": contestant.diff_stat,
                    "time_elapsed_seconds": contestant.time_elapsed_seconds,
                    "result_summary": contestant.result_summary,
                },
            )

        terminal = {"completed", "failed", "timeout", "budget_exceeded", "discarded", "winner"}
        if run.state == "running" and all(item.state in terminal for item in run.contestants):
            run.state = "comparing"
        return contestant.to_dict()

    def comparison_view(self, arena_id: str) -> dict | None:
        run = self._runs.get(arena_id)
        if run is None:
            return None
        return {
            "arena_id": run.arena_id,
            "task_description": run.task_description,
            "state": run.state,
            "timeout_seconds": run.timeout_seconds,
            "created_at": run.created_at,
            "resolved_at": run.resolved_at,
            "winner_agent_id": run.winner_agent_id,
            "contestants": [
                {
                    "agent_id": contestant.agent_id,
                    "agent_name": contestant.agent_name,
                    "task_id": contestant.task_id,
                    "worktree_path": contestant.worktree_path,
                    "state": contestant.state,
                    "cost": contestant.cost,
                    "time_elapsed_seconds": contestant.time_elapsed_seconds,
                    "eval_scores": contestant.eval_scores or {},
                    "diff_stat": contestant.diff_stat or {},
                    "result_summary": contestant.result_summary,
                    "error": contestant.error,
                }
                for contestant in run.contestants
            ],
        }

    async def resolve_winner(self, arena_id: str, winner_agent_id: str) -> dict | None:
        run = self._runs.get(arena_id)
        if run is None:
            return None
        winner = next((item for item in run.contestants if item.agent_id == winner_agent_id), None)
        if winner is None:
            return None

        for contestant in run.contestants:
            contestant.state = "winner" if contestant.agent_id == winner_agent_id else "discarded"
        run.state = "resolved"
        run.resolved_at = time.time()
        run.winner_agent_id = winner_agent_id

        for contestant in run.contestants:
            await self.update_contestant(
                arena_id,
                contestant.agent_id,
                state=contestant.state,
                result_summary=contestant.result_summary,
                error=contestant.error,
            )

        await self._record_audit(
            "arena_run",
            "resolve",
            detail={"arena_id": arena_id, "winner_agent_id": winner_agent_id},
            trace_id=arena_id,
        )
        return run.to_dict()

    async def cancel_run(self, arena_id: str, reason: str = "") -> dict | None:
        run = self._runs.get(arena_id)
        if run is None:
            return None
        run.state = "cancelled"
        run.resolved_at = time.time()
        for contestant in run.contestants:
            if contestant.state not in {"completed", "winner", "discarded"}:
                contestant.state = "discarded"
                contestant.error = reason
                if contestant.task_id and deps.task_store is not None:
                    await deps.task_store.update(contestant.task_id, status="cancelled", error=reason or None)
        await self._record_audit(
            "arena_run",
            "cancel",
            detail={"arena_id": arena_id, "reason": reason},
            trace_id=arena_id,
        )
        return run.to_dict()

    async def _record_audit(
        self,
        event_type: str,
        action: str,
        *,
        detail: dict,
        trace_id: str | None = None,
        channel: str | None = None,
    ) -> None:
        if deps.audit_store is None:
            return
        await deps.audit_store.record(
            event_type,
            "system",
            action,
            trace_id=trace_id,
            channel=channel,
            detail=detail,
        )
