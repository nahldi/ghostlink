"""Message router with @mention parsing and loop guard."""

from __future__ import annotations

import re


def parse_mentions(text: str) -> list[str]:
    return re.findall(r"@(\w[\w-]*)", text)


class MessageRouter:
    def __init__(self, max_hops: int = 4, default_routing: str = "none"):
        self.max_hops = max_hops
        self.default_routing = default_routing
        self._hop_counts: dict[str, int] = {}  # channel -> hop count

    def get_targets(
        self, sender: str, text: str, channel: str, agent_names: list[str]
    ) -> list[str]:
        mentions = parse_mentions(text)

        if "all" in mentions:
            targets = [n for n in agent_names if n != sender]
        elif mentions:
            targets = [m for m in mentions if m in agent_names and m != sender]
        elif self.default_routing == "all":
            targets = [n for n in agent_names if n != sender]
        else:
            targets = []

        # Loop guard: track agent-to-agent hops per channel
        if sender in agent_names and targets:
            count = self._hop_counts.get(channel, 0) + 1
            if count > self.max_hops:
                return []
            self._hop_counts[channel] = count
        else:
            # Human message resets the hop counter
            self._hop_counts[channel] = 0

        return targets

    def reset_channel(self, channel: str):
        self._hop_counts.pop(channel, None)
