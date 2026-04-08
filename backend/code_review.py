from __future__ import annotations

import hashlib
import json
import re
import time
import uuid
from dataclasses import dataclass
from typing import Any

import aiosqlite

from migrations import apply_migrations

REVIEW_SQL = """
CREATE TABLE IF NOT EXISTS review_rules (
    rule_id            TEXT PRIMARY KEY NOT NULL,
    rule_text          TEXT NOT NULL DEFAULT '',
    category           TEXT NOT NULL DEFAULT 'custom',
    match_text         TEXT NOT NULL DEFAULT '',
    suggestion         TEXT NOT NULL DEFAULT '',
    severity           TEXT NOT NULL DEFAULT 'medium',
    origin             TEXT NOT NULL DEFAULT 'manual',
    created_from       TEXT NOT NULL DEFAULT '',
    active             INTEGER NOT NULL DEFAULT 1,
    created_at         REAL NOT NULL,
    updated_at         REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_rules_active ON review_rules(active, category);

CREATE TABLE IF NOT EXISTS review_findings (
    finding_id         TEXT PRIMARY KEY NOT NULL,
    review_id          TEXT NOT NULL,
    fingerprint        TEXT NOT NULL,
    category           TEXT NOT NULL,
    severity           TEXT NOT NULL,
    title              TEXT NOT NULL,
    suggestion         TEXT NOT NULL DEFAULT '',
    path               TEXT NOT NULL DEFAULT '',
    line               INTEGER DEFAULT NULL,
    rule_id            TEXT DEFAULT NULL,
    rule_text          TEXT NOT NULL DEFAULT '',
    diff_line          TEXT NOT NULL DEFAULT '',
    raw_finding        TEXT NOT NULL DEFAULT '{}',
    created_at         REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_findings_review ON review_findings(review_id);
CREATE INDEX IF NOT EXISTS idx_review_findings_fingerprint ON review_findings(fingerprint);
"""


async def _migration_create_review_tables(db: aiosqlite.Connection) -> None:
    await db.executescript(REVIEW_SQL)


REVIEW_MIGRATIONS = [("20260408_create_review_tables", _migration_create_review_tables)]


async def init_review_db(db: aiosqlite.Connection) -> None:
    await apply_migrations(db, REVIEW_MIGRATIONS)


@dataclass
class ReviewRule:
    rule_id: str
    rule_text: str
    category: str
    match_text: str
    suggestion: str
    severity: str
    origin: str
    created_from: str
    active: bool
    created_at: float
    updated_at: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "rule_id": self.rule_id,
            "rule_text": self.rule_text,
            "category": self.category,
            "match_text": self.match_text,
            "suggestion": self.suggestion,
            "severity": self.severity,
            "origin": self.origin,
            "created_from": self.created_from,
            "active": self.active,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class ReviewEngine:
    def __init__(self, db: aiosqlite.Connection):
        self._db = db

    async def list_rules(self, *, active_only: bool = False) -> list[dict[str, Any]]:
        await init_review_db(self._db)
        query = "SELECT * FROM review_rules"
        params: list[Any] = []
        if active_only:
            query += " WHERE active = 1"
        query += " ORDER BY updated_at DESC, created_at DESC"
        cursor = await self._db.execute(query, params)
        try:
            rows = await cursor.fetchall()
        finally:
            await cursor.close()
        return [self._rule_from_row(row).to_dict() for row in rows]

    async def create_rule(
        self,
        *,
        rule_text: str,
        category: str = "custom",
        match_text: str = "",
        suggestion: str = "",
        severity: str = "medium",
        origin: str = "manual",
        created_from: str = "",
        active: bool = True,
    ) -> dict[str, Any]:
        await init_review_db(self._db)
        now = time.time()
        rule_id = uuid.uuid4().hex
        await self._db.execute(
            """
            INSERT INTO review_rules (
                rule_id, rule_text, category, match_text, suggestion, severity,
                origin, created_from, active, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rule_id,
                str(rule_text or "").strip(),
                str(category or "custom").strip() or "custom",
                str(match_text or "").strip(),
                str(suggestion or "").strip(),
                str(severity or "medium").strip() or "medium",
                str(origin or "manual").strip() or "manual",
                str(created_from or "").strip(),
                1 if active else 0,
                now,
                now,
            ),
        )
        await self._db.commit()
        return await self.get_rule(rule_id)

    async def get_rule(self, rule_id: str) -> dict[str, Any]:
        await init_review_db(self._db)
        cursor = await self._db.execute("SELECT * FROM review_rules WHERE rule_id = ?", (rule_id,))
        try:
            row = await cursor.fetchone()
        finally:
            await cursor.close()
        if row is None:
            raise KeyError(rule_id)
        return self._rule_from_row(row).to_dict()

    async def delete_rule(self, rule_id: str) -> bool:
        await init_review_db(self._db)
        cursor = await self._db.execute("DELETE FROM review_rules WHERE rule_id = ?", (rule_id,))
        await self._db.commit()
        try:
            return cursor.rowcount > 0
        finally:
            await cursor.close()

    async def review_diff(self, diff_text: str, rules: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        active_rules = rules if rules is not None else await self.list_rules(active_only=True)
        review_id = uuid.uuid4().hex
        findings = self._generate_findings(diff_text, active_rules)
        await self._store_findings(review_id, findings)
        return {"review_id": review_id, "findings": findings}

    async def learn_from_correction(self, finding_id: str, correction_type: str, correction_text: str = "") -> dict[str, Any]:
        await init_review_db(self._db)
        cursor = await self._db.execute("SELECT * FROM review_findings WHERE finding_id = ?", (finding_id,))
        try:
            row = await cursor.fetchone()
        finally:
            await cursor.close()
        if row is None:
            raise KeyError(finding_id)
        finding = self._finding_from_row(row)
        correction_type = str(correction_type or "").strip().lower()
        if correction_type == "accept":
            return {"finding_id": finding_id, "correction_type": correction_type, "rule": None}
        if correction_type not in {"dismiss", "modify"}:
            raise ValueError("correction_type must be accept, dismiss, or modify")

        if correction_type == "dismiss":
            rule = await self.create_rule(
                rule_text=f"Suppress repeated review finding: {finding['title']}",
                category=finding["category"],
                match_text=finding["fingerprint"],
                suggestion="",
                severity=finding["severity"],
                origin="learned",
                created_from=finding_id,
            )
        else:
            rule = await self.create_rule(
                rule_text=f"Preferred review wording for {finding['title']}",
                category=finding["category"],
                match_text=finding["fingerprint"],
                suggestion=str(correction_text or "").strip(),
                severity=finding["severity"],
                origin="learned",
                created_from=finding_id,
            )
        return {"finding_id": finding_id, "correction_type": correction_type, "rule": rule}

    async def _store_findings(self, review_id: str, findings: list[dict[str, Any]]) -> None:
        await init_review_db(self._db)
        now = time.time()
        for finding in findings:
            await self._db.execute(
                """
                INSERT OR REPLACE INTO review_findings (
                    finding_id, review_id, fingerprint, category, severity, title,
                    suggestion, path, line, rule_id, rule_text, diff_line, raw_finding, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    finding["finding_id"],
                    review_id,
                    finding["fingerprint"],
                    finding["category"],
                    finding["severity"],
                    finding["title"],
                    finding.get("suggestion", ""),
                    finding.get("path", ""),
                    finding.get("line"),
                    finding.get("rule_id"),
                    finding.get("rule_text", ""),
                    finding.get("diff_line", ""),
                    json.dumps(finding),
                    now,
                ),
            )
        await self._db.commit()

    def _generate_findings(self, diff_text: str, rules: list[dict[str, Any]]) -> list[dict[str, Any]]:
        suppressions = {rule["match_text"] for rule in rules if rule.get("origin") == "learned" and not rule.get("suggestion")}
        replacements = {
            rule["match_text"]: rule for rule in rules if rule.get("suggestion")
        }
        findings: list[dict[str, Any]] = []
        current_path = ""
        new_line = 0
        for raw_line in diff_text.splitlines():
            line = raw_line.rstrip("\n")
            if line.startswith("+++ b/"):
                current_path = line[6:]
                continue
            if line.startswith("@@"):
                match = re.search(r"\+(\d+)", line)
                new_line = int(match.group(1)) if match else 0
                continue
            if not line.startswith("+") or line.startswith("+++"):
                if not line.startswith("-"):
                    new_line += 1
                continue
            added = line[1:]
            match = self._match_builtin_rule(added)
            if match is None:
                new_line += 1
                continue
            fingerprint = self._fingerprint(match["category"], current_path, added)
            if fingerprint in suppressions:
                new_line += 1
                continue
            replacement = replacements.get(fingerprint)
            finding = {
                "finding_id": uuid.uuid4().hex,
                "fingerprint": fingerprint,
                "category": match["category"],
                "severity": match["severity"],
                "title": match["title"],
                "suggestion": replacement["suggestion"] if replacement else match["suggestion"],
                "path": current_path,
                "line": new_line,
                "rule_id": replacement["rule_id"] if replacement else None,
                "rule_text": replacement["rule_text"] if replacement else match["title"],
                "diff_line": added,
            }
            findings.append(finding)
            new_line += 1

        for rule in rules:
            if not rule.get("origin") == "manual":
                continue
            needle = str(rule.get("match_text") or "").strip()
            if not needle or needle not in diff_text:
                continue
            fingerprint = self._fingerprint(str(rule.get("category") or "custom"), current_path, needle)
            findings.append(
                {
                    "finding_id": uuid.uuid4().hex,
                    "fingerprint": fingerprint,
                    "category": str(rule.get("category") or "custom"),
                    "severity": str(rule.get("severity") or "medium"),
                    "title": str(rule.get("rule_text") or "Manual review rule"),
                    "suggestion": str(rule.get("suggestion") or ""),
                    "path": current_path,
                    "line": None,
                    "rule_id": rule.get("rule_id"),
                    "rule_text": str(rule.get("rule_text") or ""),
                    "diff_line": needle,
                }
            )
        return findings

    @staticmethod
    def _match_builtin_rule(line: str) -> dict[str, str] | None:
        stripped = line.strip()
        if "TODO" in stripped or "FIXME" in stripped:
            return {"category": "todo", "severity": "low", "title": "TODO left in diff", "suggestion": "Resolve or remove TODO/FIXME before merge"}
        if re.search(r"\bprint\s*\(", stripped):
            return {"category": "debug", "severity": "medium", "title": "Debug print in diff", "suggestion": "Remove debug print or replace it with structured logging"}
        if re.search(r"except\s*:\s*$", stripped):
            return {"category": "error_handling", "severity": "high", "title": "Bare except added", "suggestion": "Catch a specific exception instead of using bare except"}
        if re.search(r"console\.log\s*\(", stripped):
            return {"category": "debug", "severity": "low", "title": "console.log in diff", "suggestion": "Remove console.log before merge"}
        return None

    @staticmethod
    def _fingerprint(category: str, path: str, line: str) -> str:
        payload = f"{category}|{path}|{line.strip()}".encode("utf-8")
        return hashlib.sha256(payload).hexdigest()[:16]

    @staticmethod
    def _rule_from_row(row: aiosqlite.Row) -> ReviewRule:
        return ReviewRule(
            rule_id=row["rule_id"],
            rule_text=row["rule_text"],
            category=row["category"],
            match_text=row["match_text"],
            suggestion=row["suggestion"],
            severity=row["severity"],
            origin=row["origin"],
            created_from=row["created_from"],
            active=bool(row["active"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _finding_from_row(row: aiosqlite.Row) -> dict[str, Any]:
        payload = json.loads(row["raw_finding"] or "{}")
        payload["finding_id"] = row["finding_id"]
        payload["fingerprint"] = row["fingerprint"]
        return payload
