"""GhostLink Security Module — secrets management, exec hardening, GDPR, audit trail.

Provides:
- Encrypted secrets storage (API keys, tokens)
- Command allowlist/blocklist per agent
- Data export/deletion (GDPR compliance)
- Security audit log
- Data retention policies
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import time
import zipfile
from io import BytesIO
from pathlib import Path

log = logging.getLogger(__name__)


# ── Secrets Manager ─────────────────────────────────────────────────

class SecretsManager:
    """Encrypted storage for API keys and sensitive tokens.

    Uses XOR encryption with a machine-derived key.
    Secrets are never logged, never exposed in API responses,
    and never included in exports.
    """

    def __init__(self, data_dir: Path):
        self._data_dir = data_dir
        self._secrets_file = data_dir / "secrets.enc"
        self._secrets: dict[str, str] = {}
        self._key = self._derive_key()
        self._load()

    def _derive_key(self) -> bytes:
        """Derive an encryption key from machine-specific data."""
        material = f"{self._data_dir}:{os.getenv('USER', os.getenv('USERNAME', 'ghostlink'))}"
        return hashlib.sha256(material.encode()).digest()

    def _encrypt(self, plaintext: str) -> str:
        key = self._key
        encrypted = bytes(b ^ key[i % len(key)] for i, b in enumerate(plaintext.encode()))
        return base64.b64encode(encrypted).decode()

    def _decrypt(self, ciphertext: str) -> str:
        key = self._key
        encrypted = base64.b64decode(ciphertext)
        decrypted = bytes(b ^ key[i % len(key)] for i, b in enumerate(encrypted))
        return decrypted.decode()

    def _load(self):
        if self._secrets_file.exists():
            try:
                raw = json.loads(self._secrets_file.read_text())
                self._secrets = {k: self._decrypt(v) for k, v in raw.items()}
            except Exception as e:
                log.warning("Failed to load secrets: %s", e)
                self._secrets = {}

    def _save(self):
        self._secrets_file.parent.mkdir(parents=True, exist_ok=True)
        encrypted = {k: self._encrypt(v) for k, v in self._secrets.items()}
        self._secrets_file.write_text(json.dumps(encrypted, indent=2))

    def set(self, key: str, value: str):
        self._secrets[key] = value
        self._save()

    def get(self, key: str) -> str | None:
        return self._secrets.get(key)

    def delete(self, key: str) -> bool:
        if key in self._secrets:
            del self._secrets[key]
            self._save()
            return True
        return False

    def list_keys(self) -> list[dict]:
        """List all secret keys (values redacted)."""
        return [
            {"key": k, "preview": v[:4] + "..." if len(v) > 4 else "***", "length": len(v)}
            for k, v in self._secrets.items()
        ]

    def has(self, key: str) -> bool:
        return key in self._secrets

    def clear_all(self):
        self._secrets = {}
        self._save()


# ── Exec Approval Hardening ─────────────────────────────────────────

BLOCKED_COMMANDS = {
    "rm -rf /", "rm -rf /*", "mkfs", "dd if=/dev/zero",
    ":(){ :|:& };:", "chmod -R 777 /",
    "> /dev/sda", "shutdown", "reboot", "halt", "poweroff",
    "init 0", "init 6", "kill -9 1", "killall",
}

APPROVAL_REQUIRED = {
    "rm", "sudo", "apt", "yum", "pip install", "npm install -g",
    "git push", "git reset", "docker", "kubectl",
    "chmod", "chown", "mount", "umount",
}

SAFE_COMMANDS = {
    "ls", "cat", "head", "tail", "grep", "find", "pwd", "echo",
    "date", "whoami", "uname", "env", "printenv", "which",
    "wc", "sort", "uniq", "diff", "git status", "git log",
    "git diff", "git branch", "git show", "python --version",
    "node --version", "npm --version", "pip --version",
}


class ExecPolicy:
    """Per-agent command execution policy."""

    def __init__(self, data_dir: Path):
        self._data_dir = data_dir
        self._policies_file = data_dir / "exec_policies.json"
        self._policies: dict[str, dict] = {}
        self._load()

    def _load(self):
        if self._policies_file.exists():
            try:
                self._policies = json.loads(self._policies_file.read_text())
            except (json.JSONDecodeError, OSError):
                self._policies = {}

    def _save(self):
        self._policies_file.parent.mkdir(parents=True, exist_ok=True)
        self._policies_file.write_text(json.dumps(self._policies, indent=2))

    def get_policy(self, agent_name: str) -> dict:
        return self._policies.get(agent_name, {
            "allowlist": [],
            "blocklist": [],
            "require_approval": True,
            "max_commands_per_minute": 30,
        })

    def set_policy(self, agent_name: str, policy: dict) -> dict:
        existing = self.get_policy(agent_name)
        for k in ("allowlist", "blocklist", "require_approval", "max_commands_per_minute"):
            if k in policy:
                existing[k] = policy[k]
        self._policies[agent_name] = existing
        self._save()
        return existing

    def check_command(self, agent_name: str, command: str) -> dict:
        """Check if a command is allowed for an agent."""
        # Normalize shell escaping to prevent bypass via backslash-space, quotes, etc.
        cmd_lower = command.replace("\\ ", " ").replace("\\t", "\t").strip().lower()
        # Also strip surrounding quotes
        if (cmd_lower.startswith('"') and cmd_lower.endswith('"')) or (cmd_lower.startswith("'") and cmd_lower.endswith("'")):
            cmd_lower = cmd_lower[1:-1]

        for blocked in BLOCKED_COMMANDS:
            if blocked in cmd_lower:
                return {"allowed": False, "reason": f"Blocked: dangerous command", "requires_approval": False}

        policy = self.get_policy(agent_name)

        for pattern in policy.get("blocklist", []):
            if pattern.lower() in cmd_lower:
                return {"allowed": False, "reason": f"Blocked by agent policy", "requires_approval": False}

        for pattern in policy.get("allowlist", []):
            if pattern.lower() in cmd_lower:
                return {"allowed": True, "reason": "Allowed by agent policy", "requires_approval": False}

        cmd_base = cmd_lower.split()[0] if cmd_lower.split() else ""
        if cmd_base in SAFE_COMMANDS or cmd_lower in SAFE_COMMANDS:
            return {"allowed": True, "reason": "Safe command", "requires_approval": False}

        for pattern in APPROVAL_REQUIRED:
            if cmd_lower.startswith(pattern):
                if policy.get("require_approval", True):
                    return {"allowed": True, "reason": "Requires approval", "requires_approval": True}
                return {"allowed": True, "reason": "Auto-approved by policy", "requires_approval": False}

        if policy.get("require_approval", True):
            return {"allowed": True, "reason": "Unknown command — requires approval", "requires_approval": True}
        return {"allowed": True, "reason": "Allowed by default", "requires_approval": False}

    def list_policies(self) -> dict:
        return dict(self._policies)


# ── Security Audit Log ──────────────────────────────────────────────

class AuditLog:
    """Tracks security-relevant events."""

    def __init__(self, data_dir: Path):
        self._log_file = data_dir / "audit_log.jsonl"
        self._write_lock = __import__('threading').Lock()

    _MAX_LOG_SIZE = 50_000_000  # 50MB rotation threshold

    def log(self, event_type: str, details: dict, actor: str = "system"):
        entry = {
            "timestamp": time.time(),
            "type": event_type,
            "actor": actor,
            "details": details,
        }
        with self._write_lock:
            try:
                self._log_file.parent.mkdir(parents=True, exist_ok=True)
                # Rotate if file exceeds size limit
                if self._log_file.exists() and self._log_file.stat().st_size > self._MAX_LOG_SIZE:
                    backup = self._log_file.with_suffix(".jsonl.old")
                    if backup.exists():
                        backup.unlink()
                    self._log_file.rename(backup)
                with open(self._log_file, "a", encoding="utf-8") as f:
                    f.write(json.dumps(entry) + "\n")
            except Exception as e:
                log.debug("Audit log write failed: %s", e)

    def get_recent(self, limit: int = 100, event_type: str = "") -> list[dict]:
        if not self._log_file.exists():
            return []
        entries = []
        try:
            with open(self._log_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                        if event_type and entry.get("type") != event_type:
                            continue
                        entries.append(entry)
                    except json.JSONDecodeError:
                        continue
        except Exception:
            pass
        return entries[-limit:]

    def clear(self):
        if self._log_file.exists():
            self._log_file.unlink()


# ── GDPR Data Management ───────────────────────────────────────────

class DataManager:
    """Handles data export, deletion, and retention for GDPR compliance."""

    def __init__(self, data_dir: Path, store=None):
        self._data_dir = data_dir
        self._store = store
        self._retention_file = data_dir / "retention_policy.json"
        self._retention: dict = self._load_retention()

    def _load_retention(self) -> dict:
        if self._retention_file.exists():
            try:
                return json.loads(self._retention_file.read_text())
            except (json.JSONDecodeError, OSError):
                pass
        return {"enabled": False, "max_age_days": 90, "delete_attachments": True, "delete_memories": False}

    def save_retention(self, policy: dict):
        for k in ("enabled", "max_age_days", "delete_attachments", "delete_memories"):
            if k in policy:
                self._retention[k] = policy[k]
        self._retention_file.parent.mkdir(parents=True, exist_ok=True)
        self._retention_file.write_text(json.dumps(self._retention, indent=2))

    def get_retention(self) -> dict:
        return dict(self._retention)

    async def export_all_data(self) -> bytes:
        """Export all user data as a ZIP file (GDPR data portability)."""
        buf = BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            if self._store and self._store._db:
                cursor = await self._store._db.execute("SELECT * FROM messages ORDER BY id")
                rows = await cursor.fetchall()
                messages = [self._store._row_to_dict(r) for r in rows]
                zf.writestr("messages.json", json.dumps(messages, indent=2, default=str))

            settings_path = self._data_dir / "settings.json"
            if settings_path.exists():
                zf.writestr("settings.json", settings_path.read_text())

            for agent_dir in sorted(self._data_dir.iterdir()):
                if agent_dir.is_dir() and (agent_dir / "memory").is_dir():
                    for mem_file in sorted((agent_dir / "memory").glob("*.json")):
                        zf.writestr(f"agents/{agent_dir.name}/memory/{mem_file.name}", mem_file.read_text())
                    for txt in ("soul.txt", "notes.txt"):
                        p = agent_dir / txt
                        if p.exists():
                            zf.writestr(f"agents/{agent_dir.name}/{txt}", p.read_text())

            for f in ("sessions.json", "hooks.json"):
                p = self._data_dir / f
                if p.exists():
                    zf.writestr(f, p.read_text())

            # Redact API keys from provider config
            prov_path = self._data_dir / "providers.json"
            if prov_path.exists():
                try:
                    prov_data = json.loads(prov_path.read_text())
                    for k in list(prov_data.keys()):
                        if k.endswith("_api_key"):
                            prov_data[k] = "***REDACTED***"
                    zf.writestr("providers.json", json.dumps(prov_data, indent=2))
                except Exception:
                    pass

            # Redact tokens from bridge configs
            bridges_path = self._data_dir / "bridges.json"
            if bridges_path.exists():
                try:
                    bridges_data = json.loads(bridges_path.read_text())
                    for cfg in bridges_data.values():
                        if isinstance(cfg, dict) and "token" in cfg:
                            cfg["token"] = "***REDACTED***"
                    zf.writestr("bridges.json", json.dumps(bridges_data, indent=2))
                except Exception:
                    pass

            zf.writestr("manifest.json", json.dumps({
                "exported_at": time.time(), "version": "2.1.0", "format": "ghostlink-export-v1",
            }, indent=2))

        return buf.getvalue()

    async def delete_all_data(self) -> dict:
        """Delete all user data (GDPR right to erasure)."""
        deleted = []

        if self._store and self._store._db:
            await self._store._db.execute("DELETE FROM messages")
            await self._store._db.commit()
            deleted.append("messages")

        for f in ("settings.json", "providers.json", "sessions.json", "hooks.json",
                   "bridges.json", "marketplace.json", "secrets.enc", "audit_log.jsonl",
                   "exec_policies.json", "retention_policy.json"):
            p = self._data_dir / f
            if p.exists():
                p.unlink()
                deleted.append(f)

        for agent_dir in list(self._data_dir.iterdir()):
            if agent_dir.is_dir() and agent_dir.name not in ("skills",):
                import shutil
                shutil.rmtree(agent_dir, ignore_errors=True)
                deleted.append(f"agent:{agent_dir.name}")

        uploads_dir = self._data_dir.parent / "uploads"
        if uploads_dir.exists():
            for f in uploads_dir.iterdir():
                if f.is_file():
                    f.unlink()
                    deleted.append(f"upload:{f.name}")

        return {"ok": True, "deleted": deleted, "count": len(deleted)}

    async def apply_retention(self) -> dict:
        """Delete messages older than max_age_days."""
        if not self._retention.get("enabled"):
            return {"ok": False, "reason": "retention policy disabled"}
        max_age = self._retention.get("max_age_days", 90)
        cutoff = time.time() - (max_age * 86400)
        deleted_count = 0
        if self._store and self._store._db:
            # Preserve system messages (join, session, scheduled)
            cursor = await self._store._db.execute(
                "DELETE FROM messages WHERE timestamp < ? AND type NOT IN ('system', 'join')", (cutoff,)
            )
            await self._store._db.commit()
            deleted_count = cursor.rowcount
        return {"ok": True, "deleted_messages": deleted_count, "cutoff_days": max_age}
