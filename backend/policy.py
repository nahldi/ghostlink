"""SQLite-backed policy engine for tool, shell, egress, and sandbox decisions."""

from __future__ import annotations

import fnmatch
import hashlib
import ipaddress
import json
import re
import socket
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import aiosqlite

POLICY_SCHEMA = """
CREATE TABLE IF NOT EXISTS policy_rules (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    scope_type      TEXT NOT NULL,
    scope_id        TEXT NOT NULL,
    action          TEXT NOT NULL,
    tier            TEXT NOT NULL,
    behavior        TEXT NOT NULL,
    priority        INTEGER NOT NULL DEFAULT 0,
    conditions      TEXT NOT NULL DEFAULT '{}',
    created_by      TEXT NOT NULL DEFAULT 'system',
    created_at      REAL NOT NULL,
    updated_at      REAL NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_policy_scope ON policy_rules(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_policy_action ON policy_rules(action);
CREATE INDEX IF NOT EXISTS idx_policy_enabled ON policy_rules(enabled);

CREATE TABLE IF NOT EXISTS egress_rules (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    scope_type      TEXT NOT NULL,
    scope_id        TEXT NOT NULL,
    rule_type       TEXT NOT NULL,
    domain          TEXT NOT NULL,
    protocol        TEXT NOT NULL DEFAULT '*',
    port            INTEGER NOT NULL DEFAULT 0,
    priority        INTEGER NOT NULL DEFAULT 0,
    enabled         INTEGER NOT NULL DEFAULT 1,
    created_at      REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_egress_scope ON egress_rules(scope_type, scope_id);

CREATE TABLE IF NOT EXISTS secret_scopes (
    secret_key      TEXT NOT NULL,
    scope_type      TEXT NOT NULL,
    scope_id        TEXT NOT NULL,
    PRIMARY KEY (secret_key, scope_type, scope_id)
);

CREATE TABLE IF NOT EXISTS circuit_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_name      TEXT NOT NULL,
    task_id         TEXT DEFAULT NULL,
    event_type      TEXT NOT NULL,
    event_key       TEXT NOT NULL DEFAULT '',
    count           INTEGER NOT NULL DEFAULT 1,
    metadata        TEXT NOT NULL DEFAULT '{}',
    created_at      REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_circuit_agent ON circuit_events(agent_name, created_at);

CREATE TABLE IF NOT EXISTS trusted_hook_signatures (
    hook_name       TEXT NOT NULL,
    signature       TEXT NOT NULL,
    trusted         INTEGER NOT NULL DEFAULT 1,
    created_at      REAL NOT NULL,
    PRIMARY KEY (hook_name, signature)
);
"""

SCOPE_SPECIFICITY = {
    "tool": 7,
    "task": 6,
    "agent": 5,
    "provider": 4,
    "profile": 3,
    "workspace": 2,
    "environment": 1,
}

DEFAULT_TIER_BEHAVIOR = {
    "read_only": "allow",
    "low_risk_write": "allow",
    "high_risk_write": "ask",
    "shell_exec": "ask",
    "network_egress": "ask",
    "secrets_access": "allow",
    "git_mutation": "escalate",
    "external_messaging": "ask",
    "deployment": "escalate",
}

TOOL_TIERS = {
    "chat_read": "read_only",
    "chat_who": "read_only",
    "chat_channels": "read_only",
    "chat_rules": "read_only",
    "chat_claim": "read_only",
    "chat_send": "low_risk_write",
    "chat_join": "low_risk_write",
    "chat_progress": "low_risk_write",
    "chat_react": "low_risk_write",
    "chat_propose_job": "high_risk_write",
    "delegate": "high_risk_write",
    "memory_save": "low_risk_write",
    "memory_search": "read_only",
    "memory_search_all": "read_only",
    "memory_get": "read_only",
    "memory_list": "read_only",
    "web_fetch": "network_egress",
    "web_search": "network_egress",
    "browser_snapshot": "network_egress",
    "image_generate": "network_egress",
    "gemini_image": "network_egress",
    "gemini_video": "network_egress",
    "text_to_speech": "network_egress",
    "speech_to_text": "network_egress",
    "code_execute": "shell_exec",
    "set_thinking": "read_only",
    "sessions_list": "read_only",
    "sessions_send": "external_messaging",
}

SHELL_RISK_PATTERNS = {
    "git_mutation": (
        r"\bgit\s+push\b",
        r"\bgit\s+reset\b",
        r"\bgit\s+rebase\b",
        r"\bgit\s+branch\s+-D\b",
    ),
    "deployment": (
        r"\bdocker\b",
        r"\bkubectl\b",
        r"\bhelm\b",
        r"\brailway\b",
        r"\bvercel\b",
    ),
}

CIRCUIT_BREAKERS = {
    "deployment": {"event_type": "deployment", "threshold": 1, "window_seconds": 3600, "cooldown_seconds": 300},
    "rapid_commands": {"event_type": "shell_exec", "threshold": 60, "window_seconds": 60, "cooldown_seconds": 300},
    "repeated_failures": {"event_type": "tool_failure", "threshold": 5, "window_seconds": 600, "cooldown_seconds": 300},
}


@dataclass
class PolicyContext:
    agent_name: str = ""
    agent_id: str = ""
    profile_id: str = ""
    task_id: str = ""
    tool_name: str = ""
    command: str = ""
    provider: str = ""
    workspace_id: str = "*"
    session_mode: str = ""
    sandbox_tier: str = "none"
    sandbox_root: str = ""
    requested_paths: list[str] = field(default_factory=list)
    domain: str = ""
    protocol: str = "*"
    port: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)


class PolicyEngine:
    def __init__(self, db: aiosqlite.Connection, data_dir: Path):
        self._db = db
        self._data_dir = data_dir
        self._legacy_file = data_dir / "exec_policies.json"

    async def init(self) -> None:
        await self._db.executescript(POLICY_SCHEMA)
        await self._db.commit()
        await self._seed_environment_defaults()
        await self._migrate_legacy_exec_policies()

    async def snapshot_for_task(self, context: PolicyContext) -> dict:
        rules = await self._collect_rules(context, include_tool=False)
        egress_rules = await self._collect_egress_rules(context)
        return {
            "captured_at": time.time(),
            "context": asdict(context),
            "rules": rules,
            "egress_rules": egress_rules,
        }

    async def evaluate(self, action: str, tier: str, context: PolicyContext, *, snapshot: dict | None = None) -> dict:
        rules = snapshot.get("rules", []) if snapshot else await self._collect_rules(context)
        matches = [rule for rule in rules if self._matches_rule(rule, action, context)]
        locked = [rule for rule in matches if rule.get("conditions", {}).get("override_locked")]
        pool = locked or matches
        if pool:
            pool.sort(key=self._rule_sort_key, reverse=True)
            chosen = pool[0]
            return {
                "decision": chosen["behavior"],
                "rule_id": chosen["id"],
                "reason": f"Matched {chosen['scope_type']}:{chosen['scope_id']}",
                "tier": chosen["tier"],
            }
        return {
            "decision": DEFAULT_TIER_BEHAVIOR.get(tier, "ask"),
            "rule_id": None,
            "reason": f"default:{tier}",
            "tier": tier,
        }

    async def evaluate_tool_call(self, tool_name: str, context: PolicyContext, *, snapshot: dict | None = None) -> dict:
        tier = TOOL_TIERS.get(tool_name, "high_risk_write")
        return await self.evaluate("tool_call", tier, context, snapshot=snapshot)

    async def evaluate_command(self, command: str, context: PolicyContext, *, snapshot: dict | None = None) -> dict:
        tier = self.classify_command_tier(command)
        context.command = command
        if context.sandbox_tier == "worktree_only" and context.sandbox_root:
            paths = self.extract_candidate_paths(command)
            if paths and not all(self.validate_path_in_sandbox(path, Path(context.sandbox_root)) for path in paths):
                return {"decision": "deny", "rule_id": None, "reason": "sandbox path escape blocked", "tier": tier}
        return await self.evaluate("shell_exec", tier, context, snapshot=snapshot)

    async def check_egress(self, url: str, context: PolicyContext, *, snapshot: dict | None = None) -> dict:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        protocol = parsed.scheme or "*"
        port = int(parsed.port or (443 if protocol == "https" else 80 if protocol == "http" else 0))
        context.domain = host
        context.protocol = protocol
        context.port = port
        if self.is_private_url(url):
            return {"allowed": False, "reason": "ssrf_blocked"}
        rules = snapshot.get("egress_rules", []) if snapshot else await self._collect_egress_rules(context)
        deny_matches = [rule for rule in rules if rule["rule_type"] == "deny" and self._matches_egress(rule, host, protocol, port)]
        if deny_matches:
            deny_matches.sort(key=lambda rule: rule.get("priority", 0), reverse=True)
            return {"allowed": False, "reason": f"deny:{deny_matches[0]['domain']}"}
        allow_rules = [rule for rule in rules if rule["rule_type"] == "allow"]
        scoped_allow_exists = bool(allow_rules)
        if scoped_allow_exists:
            allow_matches = [rule for rule in allow_rules if self._matches_egress(rule, host, protocol, port)]
            if not allow_matches:
                return {"allowed": False, "reason": "not_in_allowlist"}
        return {"allowed": True, "reason": "allowed"}

    async def bind_secret_scope(self, secret_key: str, scope_type: str, scope_id: str) -> None:
        await self._db.execute(
            "INSERT OR REPLACE INTO secret_scopes(secret_key, scope_type, scope_id) VALUES (?, ?, ?)",
            (secret_key, scope_type, scope_id),
        )
        await self._db.commit()

    async def is_secret_allowed(self, secret_key: str, context: PolicyContext) -> bool:
        cursor = await self._db.execute("SELECT scope_type, scope_id FROM secret_scopes WHERE secret_key = ?", (secret_key,))
        try:
            rows = await cursor.fetchall()
        finally:
            await cursor.close()
        if not rows:
            return True
        for row in rows:
            if self._scope_matches(row["scope_type"], row["scope_id"], context):
                return True
        return False

    async def record_circuit_event(self, context: PolicyContext, event_type: str, *, event_key: str = "", metadata: dict | None = None) -> None:
        await self._db.execute(
            "INSERT INTO circuit_events(agent_name, task_id, event_type, event_key, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (context.agent_name, context.task_id or None, event_type, event_key, json.dumps(metadata or {}), time.time()),
        )
        await self._db.commit()

    async def active_circuit_breaker(self, context: PolicyContext) -> dict | None:
        now = time.time()
        for name, config in CIRCUIT_BREAKERS.items():
            cursor = await self._db.execute(
                """
                SELECT COUNT(*) AS count
                FROM circuit_events
                WHERE agent_name = ? AND event_type = ? AND created_at >= ?
                """,
                (context.agent_name, config["event_type"], now - config["window_seconds"]),
            )
            try:
                row = await cursor.fetchone()
            finally:
                await cursor.close()
            count = int((row["count"] if row else 0) or 0)
            if count >= config["threshold"]:
                return {
                    "breaker": name,
                    "count": count,
                    "cooldown_seconds": config["cooldown_seconds"],
                    "reason": f"{name} threshold exceeded",
                }
        return None

    async def upsert_rule(
        self,
        *,
        scope_type: str,
        scope_id: str,
        action: str,
        tier: str,
        behavior: str,
        priority: int = 0,
        conditions: dict | None = None,
        created_by: str = "system",
        enabled: bool = True,
    ) -> None:
        now = time.time()
        await self._db.execute(
            """
            INSERT INTO policy_rules(scope_type, scope_id, action, tier, behavior, priority, conditions, created_by, created_at, updated_at, enabled)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (scope_type, scope_id, action, tier, behavior, priority, json.dumps(conditions or {}), created_by, now, now, 1 if enabled else 0),
        )
        await self._db.commit()

    async def add_egress_rule(
        self,
        *,
        scope_type: str,
        scope_id: str,
        rule_type: str,
        domain: str,
        protocol: str = "*",
        port: int = 0,
        priority: int = 0,
    ) -> None:
        await self._db.execute(
            """
            INSERT INTO egress_rules(scope_type, scope_id, rule_type, domain, protocol, port, priority, enabled, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
            """,
            (scope_type, scope_id, rule_type, domain.lower(), protocol, port, priority, time.time()),
        )
        await self._db.commit()

    async def list_rules(self) -> list[dict]:
        cursor = await self._db.execute("SELECT * FROM policy_rules ORDER BY scope_type, scope_id, priority DESC, id DESC")
        try:
            rows = await cursor.fetchall()
        finally:
            await cursor.close()
        return [self._rule_row_to_dict(row) for row in rows]

    async def list_egress_rules(self) -> list[dict]:
        cursor = await self._db.execute("SELECT * FROM egress_rules ORDER BY scope_type, scope_id, priority DESC, id DESC")
        try:
            rows = await cursor.fetchall()
        finally:
            await cursor.close()
        return [dict(row) for row in rows]

    async def list_secret_scopes(self) -> list[dict]:
        cursor = await self._db.execute("SELECT secret_key, scope_type, scope_id FROM secret_scopes ORDER BY secret_key, scope_type, scope_id")
        try:
            rows = await cursor.fetchall()
        finally:
            await cursor.close()
        return [dict(row) for row in rows]

    async def list_circuit_events(self, limit: int = 100) -> list[dict]:
        cursor = await self._db.execute(
            "SELECT * FROM circuit_events ORDER BY created_at DESC LIMIT ?",
            (max(1, min(int(limit), 1000)),),
        )
        try:
            rows = await cursor.fetchall()
        finally:
            await cursor.close()
        return [dict(row) for row in rows]

    async def trust_hook_signature(self, hook_name: str, signature: str) -> None:
        await self._db.execute(
            "INSERT OR REPLACE INTO trusted_hook_signatures(hook_name, signature, trusted, created_at) VALUES (?, ?, 1, ?)",
            (hook_name, signature, time.time()),
        )
        await self._db.commit()

    async def is_hook_trusted(self, hook: dict) -> bool:
        if hook.get("action") != "block":
            return True
        signature = str(hook.get("signature", "") or hook.get("config", {}).get("signature", "") or "").strip()
        if not signature:
            return False
        cursor = await self._db.execute(
            "SELECT trusted FROM trusted_hook_signatures WHERE hook_name = ? AND signature = ?",
            (str(hook.get("name", "")), signature),
        )
        try:
            row = await cursor.fetchone()
        finally:
            await cursor.close()
        return bool(row and int(row["trusted"]) == 1)

    @staticmethod
    def classify_command_tier(command: str) -> str:
        normalized = " ".join((command or "").strip().lower().split())
        for tier, patterns in SHELL_RISK_PATTERNS.items():
            if any(re.search(pattern, normalized) for pattern in patterns):
                return tier
        return "shell_exec"

    @staticmethod
    def extract_candidate_paths(command: str) -> list[str]:
        tokens = re.findall(r'(?:"[^"]+"|\'[^\']+\'|\S+)', command or "")
        paths: list[str] = []
        for token in tokens[1:]:
            cleaned = token.strip("\"'")
            if not cleaned or cleaned.startswith("-"):
                continue
            if "/" in cleaned or "\\" in cleaned or cleaned.startswith("."):
                paths.append(cleaned)
        return paths

    @staticmethod
    def validate_path_in_sandbox(path_value: str, sandbox_root: Path) -> bool:
        try:
            root = sandbox_root.resolve()
            candidate = Path(path_value)
            resolved = (candidate if candidate.is_absolute() else (root / candidate)).resolve()
            return str(resolved).startswith(str(root))
        except Exception:
            return False

    @staticmethod
    def is_private_url(url: str) -> bool:
        try:
            parsed = urlparse(url)
            if parsed.scheme not in ("http", "https"):
                return True
            host = (parsed.hostname or "").strip().rstrip(".").lower()
            if not host or host == "localhost" or host.endswith(".local") or host.endswith(".internal"):
                return True
            try:
                addr = ipaddress.ip_address(host)
                return addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved or addr.is_multicast or addr.is_unspecified
            except ValueError:
                infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
                for info in infos:
                    resolved_ip = info[4][0]
                    addr = ipaddress.ip_address(resolved_ip)
                    if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved or addr.is_multicast or addr.is_unspecified:
                        return True
                return False
        except Exception:
            return True

    async def _seed_environment_defaults(self) -> None:
        cursor = await self._db.execute("SELECT COUNT(*) AS count FROM policy_rules")
        try:
            row = await cursor.fetchone()
        finally:
            await cursor.close()
        if int((row["count"] if row else 0) or 0):
            return
        defaults = [
            ("environment", "*", "tool_call", "shell_exec", "ask", 0, {"tool_name": "code_execute"}),
            ("environment", "*", "tool_call", "read_only", "allow", 0, {"tool_name": "chat_read"}),
            ("environment", "*", "tool_call", "read_only", "allow", 0, {"tool_name": "chat_who"}),
            ("environment", "*", "tool_call", "read_only", "allow", 0, {"tool_name": "chat_channels"}),
            ("environment", "*", "tool_call", "read_only", "allow", 0, {"tool_name": "chat_rules"}),
            ("environment", "*", "tool_call", "low_risk_write", "allow", 0, {"tool_name": "chat_send"}),
            ("environment", "*", "shell_exec", "git_mutation", "escalate", 100, {"command_pattern": r"\bgit\s+(push|reset|rebase)\b", "override_locked": True}),
            ("environment", "*", "shell_exec", "deployment", "escalate", 100, {"command_pattern": r"\b(docker|kubectl|helm|railway|vercel)\b", "override_locked": True}),
        ]
        for scope_type, scope_id, action, tier, behavior, priority, conditions in defaults:
            await self.upsert_rule(
                scope_type=scope_type,
                scope_id=scope_id,
                action=action,
                tier=tier,
                behavior=behavior,
                priority=priority,
                conditions=conditions,
            )

    async def _migrate_legacy_exec_policies(self) -> None:
        if not self._legacy_file.exists():
            return
        backup = self._legacy_file.with_suffix(".json.migrated")
        if backup.exists():
            return
        try:
            raw = json.loads(self._legacy_file.read_text(encoding="utf-8"))
        except Exception:
            return
        for agent_name, policy in raw.items():
            for pattern in policy.get("allowlist", []):
                await self.upsert_rule(
                    scope_type="agent",
                    scope_id=str(agent_name),
                    action="shell_exec",
                    tier="shell_exec",
                    behavior="allow",
                    priority=50,
                    conditions={"command_pattern": re.escape(str(pattern))},
                )
            for pattern in policy.get("blocklist", []):
                await self.upsert_rule(
                    scope_type="agent",
                    scope_id=str(agent_name),
                    action="shell_exec",
                    tier="shell_exec",
                    behavior="deny",
                    priority=60,
                    conditions={"command_pattern": re.escape(str(pattern))},
                )
            if policy.get("require_approval", True):
                await self.upsert_rule(
                    scope_type="agent",
                    scope_id=str(agent_name),
                    action="shell_exec",
                    tier="shell_exec",
                    behavior="ask",
                    priority=10,
                    conditions={},
                )
        self._legacy_file.rename(backup)

    async def _collect_rules(self, context: PolicyContext, *, include_tool: bool = True) -> list[dict]:
        cursor = await self._db.execute("SELECT * FROM policy_rules WHERE enabled = 1")
        try:
            rows = await cursor.fetchall()
        finally:
            await cursor.close()
        rules = [self._rule_row_to_dict(row) for row in rows]
        return [rule for rule in rules if self._scope_matches(rule["scope_type"], rule["scope_id"], context, include_tool=include_tool)]

    async def _collect_egress_rules(self, context: PolicyContext) -> list[dict]:
        cursor = await self._db.execute("SELECT * FROM egress_rules WHERE enabled = 1")
        try:
            rows = await cursor.fetchall()
        finally:
            await cursor.close()
        rules = []
        for row in rows:
            rule = dict(row)
            if self._scope_matches(rule["scope_type"], rule["scope_id"], context):
                rules.append(rule)
        return rules

    def _scope_matches(self, scope_type: str, scope_id: str, context: PolicyContext, *, include_tool: bool = True) -> bool:
        value = "*"
        if scope_type == "workspace":
            value = context.workspace_id or "*"
        elif scope_type == "profile":
            value = context.profile_id
        elif scope_type == "provider":
            value = context.provider
        elif scope_type == "agent":
            value = context.agent_name
        elif scope_type == "task":
            value = context.task_id
        elif scope_type == "tool" and include_tool:
            value = context.tool_name
        elif scope_type == "environment":
            value = "*"
        else:
            return False
        return scope_id == "*" or scope_id == value

    def _matches_rule(self, rule: dict, action: str, context: PolicyContext) -> bool:
        if rule["action"] not in ("*", action):
            return False
        conditions = rule.get("conditions", {})
        tool_name = conditions.get("tool_name")
        if tool_name and tool_name != context.tool_name:
            return False
        session_mode = conditions.get("session_mode")
        if session_mode and session_mode != context.session_mode:
            return False
        domain = conditions.get("domain")
        if domain and domain != context.domain:
            return False
        command_pattern = conditions.get("command_pattern")
        if command_pattern and not re.search(command_pattern, context.command or "", re.IGNORECASE):
            return False
        path_glob = conditions.get("path_glob")
        if path_glob and not any(fnmatch.fnmatch(path, path_glob) for path in context.requested_paths):
            return False
        return True

    def _rule_sort_key(self, rule: dict) -> tuple[int, int]:
        return (SCOPE_SPECIFICITY.get(rule["scope_type"], 0), int(rule.get("priority", 0) or 0))

    @staticmethod
    def _matches_egress(rule: dict, host: str, protocol: str, port: int) -> bool:
        domain = str(rule.get("domain", "") or "").lower()
        if domain.startswith("*."):
            if not host.endswith(domain[1:]):
                return False
        elif domain != host:
            return False
        rule_protocol = str(rule.get("protocol", "*") or "*").lower()
        if rule_protocol not in ("*", protocol):
            return False
        rule_port = int(rule.get("port", 0) or 0)
        if rule_port and rule_port != port:
            return False
        return True

    @staticmethod
    def _rule_row_to_dict(row) -> dict:
        conditions = row["conditions"] or "{}"
        try:
            parsed = json.loads(conditions)
        except Exception:
            parsed = {}
        return {
            "id": row["id"],
            "scope_type": row["scope_type"],
            "scope_id": row["scope_id"],
            "action": row["action"],
            "tier": row["tier"],
            "behavior": row["behavior"],
            "priority": row["priority"],
            "conditions": parsed,
            "created_by": row["created_by"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "enabled": bool(row["enabled"]),
        }
