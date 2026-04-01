"""Authentication & Authorization — multi-user support with roles.

Roles:
  - admin: Full access (manage users, agents, settings)
  - member: Chat + spawn agents
  - viewer: Read-only (view messages and agents)

Uses PBKDF2-SHA256 for password hashing and opaque random session tokens.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
import secrets
import time
from pathlib import Path

log = logging.getLogger(__name__)

# Token expiry: 7 days
TOKEN_EXPIRY = 7 * 24 * 3600
ROLES = ("admin", "member", "viewer")
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{2,64}$")


def _hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    """Hash a password with PBKDF2-SHA256. Returns (hash, salt)."""
    if salt is None:
        salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000)
    return h.hex(), salt


def _verify_password(password: str, stored_hash: str, salt: str) -> bool:
    """Verify a password against a stored hash."""
    h, _ = _hash_password(password, salt)
    return hmac.compare_digest(h, stored_hash)


class UserManager:
    """Manages user accounts, sessions, and authorization."""

    def __init__(self, data_dir: str | Path):
        self.data_dir = Path(data_dir)
        self.users_file = self.data_dir / "users.json"
        self._users: dict[str, dict] = {}
        self._sessions: dict[str, dict] = {}  # token → {username, role, expires}
        self._load()

    def _load(self):
        """Load users from disk."""
        if self.users_file.exists():
            try:
                self._users = json.loads(self.users_file.read_text())
            except Exception as e:
                log.warning("Failed to load users: %s", e)
                self._users = {}

    def _save(self):
        """Persist users to disk."""
        self.data_dir.mkdir(parents=True, exist_ok=True)
        tmp = self.users_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._users, indent=2))
        tmp.replace(self.users_file)

    def is_enabled(self) -> bool:
        """Check if multi-user mode is enabled (at least one user exists)."""
        return len(self._users) > 0

    def create_user(self, username: str, password: str, role: str = "member") -> dict:
        """Create a new user account."""
        if not USERNAME_RE.fullmatch(username):
            raise ValueError("Username must be 2-64 chars using letters, numbers, ., _, or -")
        if username in self._users:
            raise ValueError(f"User '{username}' already exists")
        if role not in ROLES:
            raise ValueError(f"Invalid role: {role}. Must be one of {ROLES}")
        if len(password) < 6:
            raise ValueError("Password must be at least 6 characters")

        pw_hash, salt = _hash_password(password)
        self._users[username] = {
            "username": username,
            "role": role,
            "password_hash": pw_hash,
            "salt": salt,
            "created_at": time.time(),
        }
        self._save()
        log.info("User created: %s (role: %s)", username, role)
        return {"username": username, "role": role}

    def authenticate(self, username: str, password: str) -> str | None:
        """Authenticate a user. Returns session token or None."""
        user = self._users.get(username)
        if not user:
            return None
        if not _verify_password(password, user["password_hash"], user["salt"]):
            return None

        now = time.time()
        token = secrets.token_urlsafe(32)
        self._sessions[token] = {
            "username": username,
            "role": user["role"],
            "expires": now + TOKEN_EXPIRY,
            "created_at": now,
            "last_seen": now,
        }
        log.info("User authenticated: %s", username)
        return token

    def validate_token(self, token: str) -> dict | None:
        """Validate a session token. Returns user info or None."""
        session = self._sessions.get(token)
        if not session:
            return None
        if time.time() > session["expires"]:
            del self._sessions[token]
            return None
        session["last_seen"] = time.time()
        return {"username": session["username"], "role": session["role"]}

    def logout(self, token: str):
        """Invalidate a session token."""
        self._sessions.pop(token, None)

    def list_users(self) -> list[dict]:
        """List all users (without password hashes)."""
        return [
            {"username": u["username"], "role": u["role"], "created_at": u.get("created_at", 0)}
            for u in self._users.values()
        ]

    def has_admin(self) -> bool:
        """Return True when at least one admin user exists."""
        return any(user.get("role") == "admin" for user in self._users.values())

    def update_role(self, username: str, new_role: str) -> bool:
        """Update a user's role."""
        if username not in self._users:
            return False
        if new_role not in ROLES:
            return False
        self._users[username]["role"] = new_role
        self._save()
        # Update active sessions
        for session in self._sessions.values():
            if session["username"] == username:
                session["role"] = new_role
        return True

    def delete_user(self, username: str) -> bool:
        """Delete a user account."""
        if username not in self._users:
            return False
        del self._users[username]
        self._save()
        # Invalidate sessions
        to_remove = [t for t, s in self._sessions.items() if s["username"] == username]
        for t in to_remove:
            del self._sessions[t]
        log.info("User deleted: %s", username)
        return True

    def change_password(self, username: str, old_password: str, new_password: str) -> bool:
        """Change a user's password."""
        user = self._users.get(username)
        if not user:
            return False
        if not _verify_password(old_password, user["password_hash"], user["salt"]):
            return False
        if len(new_password) < 6:
            return False
        pw_hash, salt = _hash_password(new_password)
        user["password_hash"] = pw_hash
        user["salt"] = salt
        self._save()
        return True

    def check_permission(self, token: str, required_role: str) -> bool:
        """Check if a token has the required role or higher."""
        user = self.validate_token(token)
        if not user:
            return False
        role_hierarchy = {"admin": 3, "member": 2, "viewer": 1}
        return role_hierarchy.get(user["role"], 0) >= role_hierarchy.get(required_role, 0)

    def list_active_sessions(self) -> list[dict]:
        """Return non-expired active sessions without exposing raw tokens."""
        now = time.time()
        expired = [token for token, session in self._sessions.items() if now > session["expires"]]
        for token in expired:
            del self._sessions[token]
        return [
            {
                "username": session["username"],
                "role": session["role"],
                "created_at": session.get("created_at", now),
                "last_seen": session.get("last_seen", session.get("created_at", now)),
            }
            for session in self._sessions.values()
        ]
