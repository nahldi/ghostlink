"""Agent registry — tracks connected agent instances."""

from __future__ import annotations

import time
import secrets
from dataclasses import dataclass, field, asdict


TOKEN_TTL = 3600  # 1 hour default


@dataclass
class AgentInstance:
    name: str
    base: str
    label: str
    color: str
    slot: int = 1
    state: str = "pending"
    token: str = field(default_factory=lambda: secrets.token_hex(16))
    registered_at: float = field(default_factory=time.time)
    token_issued_at: float = field(default_factory=time.time)
    token_ttl: float = field(default_factory=lambda: TOKEN_TTL)
    role: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    def public_dict(self) -> dict:
        d = self.to_dict()
        d.pop("token", None)
        d.pop("token_issued_at", None)
        d.pop("token_ttl", None)
        return d

    def is_token_expired(self) -> bool:
        return time.time() - self.token_issued_at > self.token_ttl

    def rotate_token(self) -> str:
        self.token = secrets.token_hex(16)
        self.token_issued_at = time.time()
        return self.token


# Default color palette per agent base name
_COLORS = {
    "claude": "#e8734a",
    "codex": "#10a37f",
    "gemini": "#4285f4",
    "qwen": "#ffb784",
    "grok": "#ff84a2",
    "copilot": "#84ffa2",
}


class AgentRegistry:
    def __init__(self):
        self._instances: dict[str, AgentInstance] = {}
        self._slot_counters: dict[str, int] = {}

    def register(self, base: str, label: str = "", color: str = "") -> AgentInstance:
        if not label:
            label = base.capitalize()
        if not color:
            color = _COLORS.get(base, "#d2bbff")

        # Reuse the base name if no agent with that name is currently registered
        if base not in self._instances:
            name = base
            slot = 1
        else:
            # Multiple instances — find next available slot
            slot = self._slot_counters.get(base, 1) + 1
            name = f"{base}-{slot}"
            # If this is the second instance, rename the first to base-1
            if slot == 2 and base in self._instances:
                old = self._instances.pop(base)
                old.name = f"{base}-1"
                old.slot = 1
                self._instances[old.name] = old

        self._slot_counters[base] = slot

        inst = AgentInstance(
            name=name, base=base, label=label, color=color, slot=slot, state="active"
        )
        self._instances[name] = inst
        return inst

    def deregister(self, name: str) -> bool:
        inst = self._instances.pop(name, None)
        if inst:
            # If no more instances of this base, reset the counter
            remaining = [i for i in self._instances.values() if i.base == inst.base]
            if not remaining:
                self._slot_counters.pop(inst.base, None)
            return True
        return False

    def get(self, name: str) -> AgentInstance | None:
        return self._instances.get(name)

    def get_all(self) -> list[AgentInstance]:
        return list(self._instances.values())

    def get_public_list(self) -> list[dict]:
        return [inst.public_dict() for inst in self._instances.values()]

    def set_state(self, name: str, state: str):
        inst = self._instances.get(name)
        if inst:
            inst.state = state

    def resolve_token(self, token: str) -> AgentInstance | None:
        for inst in self._instances.values():
            if inst.token == token:
                return inst
        return None
