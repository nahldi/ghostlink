"""SQLite-backed provider cost tracking and budget enforcement."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any

import aiosqlite


COST_SCHEMA = """
CREATE TABLE IF NOT EXISTS cost_records (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id            TEXT NOT NULL,
    session_id          TEXT NOT NULL,
    task_id             TEXT NOT NULL DEFAULT '',
    provider            TEXT NOT NULL,
    model               TEXT NOT NULL,
    transport           TEXT NOT NULL DEFAULT 'api',
    input_tokens        INTEGER NOT NULL DEFAULT 0,
    output_tokens       INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens  INTEGER NOT NULL DEFAULT 0,
    cost_usd            REAL NOT NULL DEFAULT 0.0,
    latency_ms          INTEGER NOT NULL DEFAULT 0,
    timestamp           REAL NOT NULL,
    metadata            TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_cost_agent ON cost_records(agent_id);
CREATE INDEX IF NOT EXISTS idx_cost_session ON cost_records(session_id);
CREATE INDEX IF NOT EXISTS idx_cost_provider ON cost_records(provider);
CREATE INDEX IF NOT EXISTS idx_cost_timestamp ON cost_records(timestamp);
"""


PRICING = {
    "anthropic": {
        "claude-opus-4-6": {"input_per_1m": 15.0, "output_per_1m": 75.0},
        "claude-sonnet-4-6": {"input_per_1m": 3.0, "output_per_1m": 15.0},
        "claude-haiku-4-5": {"input_per_1m": 0.8, "output_per_1m": 4.0},
    },
    "openai": {
        "gpt-5.4": {"input_per_1m": 2.5, "output_per_1m": 10.0},
        "gpt-5.4-mini": {"input_per_1m": 0.4, "output_per_1m": 1.6},
        "o3": {"input_per_1m": 2.0, "output_per_1m": 8.0},
        "o4-mini": {"input_per_1m": 0.6, "output_per_1m": 2.4},
        "dall-e-3": {"input_per_1m": 0.0, "output_per_1m": 0.04},
    },
    "google": {
        "gemini-3.1-pro-preview": {"input_per_1m": 2.0, "output_per_1m": 8.0},
        "gemini-2.5-pro": {"input_per_1m": 1.25, "output_per_1m": 5.0},
        "gemini-2.5-flash": {"input_per_1m": 0.3, "output_per_1m": 1.2},
        "imagen-4.0-generate-001": {"input_per_1m": 0.0, "output_per_1m": 0.04},
    },
    "groq": {
        "llama-3.3-70b-versatile": {"input_per_1m": 0.05, "output_per_1m": 0.10},
        "llama-3.1-8b-instant": {"input_per_1m": 0.03, "output_per_1m": 0.06},
    },
    "together": {
        "meta-llama/Llama-3.3-70B-Instruct-Turbo": {"input_per_1m": 0.2, "output_per_1m": 0.2},
        "black-forest-labs/FLUX.1-schnell-Free": {"input_per_1m": 0.0, "output_per_1m": 0.0},
    },
    "mistral": {
        "mistral-large-latest": {"input_per_1m": 2.0, "output_per_1m": 6.0},
        "codestral-latest": {"input_per_1m": 1.0, "output_per_1m": 3.0},
    },
    "deepseek": {
        "deepseek-chat": {"input_per_1m": 0.14, "output_per_1m": 0.28},
        "deepseek-reasoner": {"input_per_1m": 0.55, "output_per_1m": 2.19},
    },
    "cohere": {
        "command-r-plus": {"input_per_1m": 3.0, "output_per_1m": 15.0},
        "command-r": {"input_per_1m": 0.5, "output_per_1m": 1.5},
    },
}


@dataclass
class BudgetDecision:
    allowed: bool
    decision: str = "allow"
    reason: str = ""
    warning_emitted: bool = False
    remaining_cost_usd: float | None = None
    remaining_tokens: int | None = None


class CostTracker:
    def __init__(self, db: aiosqlite.Connection):
        self._db = db

    async def init(self) -> None:
        await self._db.executescript(COST_SCHEMA)
        await self._db.commit()

    def _price_entry(self, provider: str, model: str) -> dict[str, float] | None:
        provider_prices = PRICING.get(provider, {})
        if model in provider_prices:
            return provider_prices[model]
        if provider_prices:
            first_key = next(iter(provider_prices))
            return provider_prices[first_key]
        return None

    def estimate_cost(
        self,
        provider: str,
        model: str,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cache_read_tokens: int = 0,
        cache_write_tokens: int = 0,
    ) -> tuple[float, str]:
        price = self._price_entry(provider, model)
        if not price:
            return 0.0, "unpriced"
        cache_read_rate = price["input_per_1m"] * 0.2
        cache_write_rate = price["input_per_1m"] * 0.5
        total = (
            (input_tokens * price["input_per_1m"])
            + (output_tokens * price["output_per_1m"])
            + (cache_read_tokens * cache_read_rate)
            + (cache_write_tokens * cache_write_rate)
        ) / 1_000_000
        return round(total, 6), "direct"

    async def record(
        self,
        *,
        agent_id: str,
        session_id: str,
        task_id: str = "",
        provider: str,
        model: str,
        transport: str = "api",
        input_tokens: int = 0,
        output_tokens: int = 0,
        cache_read_tokens: int = 0,
        cache_write_tokens: int = 0,
        latency_ms: int = 0,
        metadata: dict[str, Any] | None = None,
        cost_usd: float | None = None,
    ) -> dict[str, Any]:
        import deps

        meta = dict(metadata or {})
        if cost_usd is None:
            cost_usd, mode = self.estimate_cost(
                provider,
                model,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cache_read_tokens=cache_read_tokens,
                cache_write_tokens=cache_write_tokens,
            )
            meta.setdefault("accounting_mode", mode)
        else:
            meta.setdefault("accounting_mode", "direct")
        timestamp = time.time()
        await self._db.execute(
            """
            INSERT INTO cost_records(
                agent_id, session_id, task_id, provider, model, transport,
                input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
                cost_usd, latency_ms, timestamp, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                agent_id or "system",
                session_id or "default",
                task_id or "",
                provider,
                model,
                transport,
                int(input_tokens or 0),
                int(output_tokens or 0),
                int(cache_read_tokens or 0),
                int(cache_write_tokens or 0),
                float(cost_usd or 0.0),
                int(latency_ms or 0),
                timestamp,
                json.dumps(meta),
            ),
        )
        await self._db.commit()
        usage_entry = {
            "ts": timestamp,
            "agent": agent_id or "system",
            "provider": provider,
            "model": model,
            "transport": transport,
            "input_tokens": int(input_tokens or 0),
            "output_tokens": int(output_tokens or 0),
            "cache_read_tokens": int(cache_read_tokens or 0),
            "cache_write_tokens": int(cache_write_tokens or 0),
            "cost": float(cost_usd or 0.0),
            "metadata": meta,
        }
        deps._usage_log.append(usage_entry)
        max_entries = getattr(deps, "_USAGE_LOG_MAX", 10000)
        if len(deps._usage_log) > max_entries:
            del deps._usage_log[: len(deps._usage_log) - max_entries]
        return usage_entry

    async def record_derived_cli_usage(
        self,
        *,
        agent_id: str,
        session_id: str,
        task_id: str = "",
        provider: str,
        model: str,
        input_tokens: int = 0,
        output_tokens: int = 0,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        meta = dict(metadata or {})
        meta["accounting_mode"] = "derived"
        meta["derived_reason"] = meta.get("derived_reason", "cli_usage_partial")
        cost_usd, _ = self.estimate_cost(provider, model, input_tokens=input_tokens, output_tokens=output_tokens)
        return await self.record(
            agent_id=agent_id,
            session_id=session_id,
            task_id=task_id,
            provider=provider,
            model=model,
            transport="cli",
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            metadata=meta,
            cost_usd=cost_usd,
        )

    def _budget_config(self, agent_id: str) -> dict[str, Any]:
        import deps

        budgets = dict(getattr(deps, "_settings", {}).get("budgets", {}) or {})
        return dict(budgets.get(agent_id) or budgets.get("*") or {})

    async def _cost_totals(self, agent_id: str, session_id: str) -> dict[str, float]:
        now = time.time()
        day_start = now - 86400
        cursor = await self._db.execute(
            """
            SELECT
                COALESCE(SUM(CASE WHEN session_id = ? THEN cost_usd END), 0.0) AS session_cost,
                COALESCE(SUM(CASE WHEN session_id = ? THEN input_tokens + output_tokens + cache_read_tokens + cache_write_tokens END), 0) AS session_tokens,
                COALESCE(SUM(CASE WHEN timestamp >= ? THEN cost_usd END), 0.0) AS day_cost
            FROM cost_records
            WHERE agent_id = ?
            """,
            (session_id or "default", session_id or "default", day_start, agent_id or "system"),
        )
        try:
            row = await cursor.fetchone()
        finally:
            await cursor.close()
        return {
            "session_cost": float((row["session_cost"] if row else 0.0) or 0.0),
            "session_tokens": float((row["session_tokens"] if row else 0.0) or 0.0),
            "day_cost": float((row["day_cost"] if row else 0.0) or 0.0),
        }

    async def check_budget(
        self,
        *,
        agent_id: str,
        session_id: str,
        task_id: str = "",
        provider: str,
        model: str,
        estimated_input_tokens: int = 0,
        estimated_output_tokens: int = 0,
    ) -> BudgetDecision:
        import deps
        from policy import PolicyContext

        config = self._budget_config(agent_id or "system")
        if not config:
            return BudgetDecision(allowed=True, remaining_cost_usd=None, remaining_tokens=None)
        if config.get("bypass_enabled"):
            return BudgetDecision(allowed=True, reason="budget_bypass_enabled")

        estimated_cost, _ = self.estimate_cost(
            provider,
            model,
            input_tokens=estimated_input_tokens,
            output_tokens=estimated_output_tokens,
        )
        totals = await self._cost_totals(agent_id or "system", session_id or "default")

        max_cost_session = float(config.get("max_cost_usd_per_session") or 0.0)
        max_cost_day = float(config.get("max_cost_usd_per_day") or 0.0)
        max_tokens_session = int(config.get("max_tokens_per_session") or 0)
        warning_pct = float(config.get("warning_threshold_pct") or 80.0)
        hard_stop_pct = float(config.get("hard_stop_threshold_pct") or 100.0)

        projected_session_cost = totals["session_cost"] + estimated_cost
        projected_day_cost = totals["day_cost"] + estimated_cost
        projected_session_tokens = totals["session_tokens"] + estimated_input_tokens + estimated_output_tokens

        warning_emitted = False
        if max_cost_session > 0:
            current_pct = (projected_session_cost / max_cost_session) * 100.0
            if current_pct >= warning_pct:
                warning_emitted = True
                remaining = max(max_cost_session - totals["session_cost"], 0.0)
                if deps.audit_log:
                    deps.audit_log.log(
                        "budget_warning",
                        {"agent_id": agent_id, "session_id": session_id, "remaining_cost_usd": round(remaining, 6)},
                        actor=agent_id or "system",
                    )
                if deps.broadcast:
                    await deps.broadcast("budget_warning", {"agent_id": agent_id, "session_id": session_id, "remaining_cost_usd": round(remaining, 6)})

        over_session_cost = max_cost_session > 0 and projected_session_cost > max_cost_session * (hard_stop_pct / 100.0)
        over_day_cost = max_cost_day > 0 and projected_day_cost > max_cost_day * (hard_stop_pct / 100.0)
        over_session_tokens = max_tokens_session > 0 and projected_session_tokens > max_tokens_session * (hard_stop_pct / 100.0)
        if not (over_session_cost or over_day_cost or over_session_tokens):
            remaining_cost = None if max_cost_session <= 0 else max(max_cost_session - totals["session_cost"], 0.0)
            remaining_tokens = None if max_tokens_session <= 0 else max(max_tokens_session - int(totals["session_tokens"]), 0)
            return BudgetDecision(
                allowed=True,
                warning_emitted=warning_emitted,
                remaining_cost_usd=remaining_cost,
                remaining_tokens=remaining_tokens,
            )

        reason_bits = []
        if over_session_cost:
            reason_bits.append("session_cost")
        if over_day_cost:
            reason_bits.append("day_cost")
        if over_session_tokens:
            reason_bits.append("session_tokens")
        reason = ",".join(reason_bits) or "budget_exceeded"
        context = PolicyContext(
            agent_name=agent_id or "system",
            task_id=task_id,
            provider=provider,
            metadata={"budget_reason": reason, "session_id": session_id, "model": model},
        )
        decision = {"decision": "escalate", "reason": reason}
        if deps.policy_engine:
            decision = await deps.policy_engine.evaluate("budget_exceeded", "deployment", context)
            await deps.policy_engine.record_circuit_event(context, "deployment", event_key="budget_exceeded", metadata={"reason": reason})
        if deps.audit_log:
            deps.audit_log.log(
                "budget_exceeded",
                {"agent_id": agent_id, "session_id": session_id, "provider": provider, "model": model, "reason": reason},
                actor=agent_id or "system",
            )
        if deps.broadcast:
            await deps.broadcast(
                "budget_exceeded",
                {"agent_id": agent_id, "session_id": session_id, "provider": provider, "model": model, "reason": reason},
            )
        return BudgetDecision(
            allowed=False,
            decision=str(decision.get("decision", "escalate")),
            reason=str(decision.get("reason", reason)),
            warning_emitted=warning_emitted,
            remaining_cost_usd=0.0,
            remaining_tokens=0,
        )

    async def usage_snapshot(self, limit: int = 1000) -> dict[str, Any]:
        cursor = await self._db.execute(
            """
            SELECT agent_id, session_id, task_id, provider, model, transport,
                   input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
                   cost_usd, latency_ms, timestamp, metadata
            FROM cost_records
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        )
        try:
            rows = await cursor.fetchall()
        finally:
            await cursor.close()
        entries = []
        total_cost = 0.0
        total_input = 0
        total_output = 0
        for row in reversed(rows):
            meta = json.loads(row["metadata"] or "{}")
            entries.append(
                {
                    "ts": row["timestamp"],
                    "agent": row["agent_id"],
                    "session_id": row["session_id"],
                    "task_id": row["task_id"],
                    "provider": row["provider"],
                    "model": row["model"],
                    "transport": row["transport"],
                    "input_tokens": row["input_tokens"],
                    "output_tokens": row["output_tokens"],
                    "cache_read_tokens": row["cache_read_tokens"],
                    "cache_write_tokens": row["cache_write_tokens"],
                    "cost": row["cost_usd"],
                    "latency_ms": row["latency_ms"],
                    "metadata": meta,
                }
            )
            total_cost += float(row["cost_usd"] or 0.0)
            total_input += int(row["input_tokens"] or 0)
            total_output += int(row["output_tokens"] or 0)
        return {
            "entries": entries,
            "total_cost": round(total_cost, 4),
            "total_input_tokens": total_input,
            "total_output_tokens": total_output,
            "entry_count": len(entries),
        }
