"""GhostLink Python SDK — programmatic access to the GhostLink REST API.

Usage:
    from ghostlink_sdk import GhostLinkClient

    client = GhostLinkClient()  # defaults to localhost:8300
    print(client.channels())
    client.send("Hello from Python!", channel="general")
    msgs = client.messages("general", limit=10)
    agents = client.agents()
"""

from __future__ import annotations

import json
import time
from typing import Any
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

__version__ = "5.7.1"


class GhostLinkError(Exception):
    """Raised when a GhostLink API call fails."""

    def __init__(self, message: str, status_code: int = 0):
        super().__init__(message)
        self.status_code = status_code


class GhostLinkClient:
    """Client for the GhostLink REST API.

    Args:
        host: Server host (default: 127.0.0.1)
        port: Server port (default: 8300)
        sender: Default sender name for messages (default: SDK)
    """

    def __init__(self, host: str = "127.0.0.1", port: int = 8300, sender: str = "SDK"):
        self.base_url = f"http://{host}:{port}"
        self.sender = sender

    def _request(self, method: str, path: str, data: dict | None = None) -> Any:
        """Make an HTTP request to the GhostLink API."""
        url = f"{self.base_url}{path}"
        body = json.dumps(data).encode("utf-8") if data else None
        req = Request(url, data=body, method=method)
        req.add_header("Content-Type", "application/json")
        try:
            with urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except HTTPError as e:
            raise GhostLinkError(f"HTTP {e.code}: {e.reason}", e.code) from e
        except URLError as e:
            raise GhostLinkError(f"Connection failed: {e.reason}") from e

    def _get(self, path: str) -> Any:
        return self._request("GET", path)

    def _post(self, path: str, data: dict) -> Any:
        return self._request("POST", path, data)

    # ── Core ──────────────────────────────────────────────────────

    def status(self) -> dict:
        """Get server and agent status."""
        return self._get("/api/status")

    def health(self) -> bool:
        """Check if server is running."""
        try:
            self._get("/api/channels")
            return True
        except GhostLinkError:
            return False

    # ── Channels ──────────────────────────────────────────────────

    def channels(self) -> list[str]:
        """List all channels."""
        return self._get("/api/channels")["channels"]

    def create_channel(self, name: str) -> dict:
        """Create a new channel."""
        return self._post("/api/channels", {"name": name})

    # ── Messages ──────────────────────────────────────────────────

    def messages(self, channel: str = "general", limit: int = 50, since_id: int = 0) -> list[dict]:
        """Get messages from a channel."""
        path = f"/api/messages?channel={channel}&limit={limit}"
        if since_id:
            path += f"&since_id={since_id}"
        return self._get(path)["messages"]

    def send(self, text: str, channel: str = "general", sender: str | None = None) -> dict:
        """Send a message to a channel."""
        return self._post("/api/send", {
            "sender": sender or self.sender,
            "text": text,
            "channel": channel,
        })

    def search(self, query: str) -> list[dict]:
        """Search messages by keyword."""
        from urllib.parse import quote_plus
        return self._get(f"/api/search?q={quote_plus(query)}")["results"]

    # ── Agents ────────────────────────────────────────────────────

    def agents(self) -> list[dict]:
        """List all registered agents."""
        return self._get("/api/status")["agents"]

    def spawn(self, base: str, label: str = "", cwd: str = ".", args: list[str] | None = None) -> dict:
        """Spawn a new agent."""
        return self._post("/api/spawn-agent", {
            "base": base,
            "label": label or base.capitalize(),
            "cwd": cwd,
            "args": args or [],
        })

    def kill(self, name: str) -> dict:
        """Kill an agent."""
        return self._post(f"/api/agents/{name}/kill", {})

    # ── Jobs ──────────────────────────────────────────────────────

    def jobs(self) -> list[dict]:
        """List all jobs."""
        return self._get("/api/jobs")["jobs"]

    def create_job(self, title: str, channel: str = "general") -> dict:
        """Create a new job."""
        return self._post("/api/jobs", {"title": title, "channel": channel})

    # ── Settings ──────────────────────────────────────────────────

    def settings(self) -> dict:
        """Get current settings."""
        return self._get("/api/settings")

    def save_settings(self, updates: dict) -> dict:
        """Save settings."""
        return self._post("/api/settings", updates)

    # ── Providers ─────────────────────────────────────────────────

    def providers(self) -> dict:
        """List AI providers and their capabilities."""
        return self._get("/api/providers")

    # ── Sessions ──────────────────────────────────────────────────

    def start_session(self, channel: str, template: str, topic: str = "", cast: dict | None = None) -> dict:
        """Start a structured session."""
        return self._post(f"/api/sessions/{channel}/start", {
            "template_id": template,
            "topic": topic,
            "cast": cast or {},
        })

    def end_session(self, channel: str) -> dict:
        """End the active session on a channel."""
        return self._post(f"/api/sessions/{channel}/end", {})

    # ── Convenience ───────────────────────────────────────────────

    def wait_for_response(self, channel: str = "general", timeout: int = 60, after_id: int = 0) -> dict | None:
        """Wait for the next agent message in a channel.

        Args:
            channel: Channel to watch
            timeout: Max seconds to wait
            after_id: Only return messages with ID > this value

        Returns:
            The first agent message received, or None if timeout
        """
        start = time.time()
        while time.time() - start < timeout:
            try:
                msgs = self.messages(channel, limit=5, since_id=after_id)
                for m in msgs:
                    if m.get("type") == "chat" and m.get("sender") not in ("You", "CLI", "SDK", "system"):
                        return m
            except GhostLinkError:
                pass
            time.sleep(1)
        return None

    def prompt(self, text: str, agent: str = "", channel: str = "general", timeout: int = 60) -> str | None:
        """Send a prompt and wait for the agent's response.

        Args:
            text: The prompt text
            agent: Target agent (prepends @mention). Empty = broadcast.
            channel: Channel to use
            timeout: Max seconds to wait for response

        Returns:
            The agent's response text, or None if timeout
        """
        msg_text = f"@{agent} {text}" if agent else text
        sent = self.send(msg_text, channel=channel)
        sent_id = sent.get("id", 0)
        response = self.wait_for_response(channel, timeout=timeout, after_id=sent_id)
        return response["text"] if response else None
