"""Agent-to-Agent (A2A) Protocol Bridge.

Implements Google's A2A protocol for agent interoperability.
External A2A-compatible agents can register and participate in GhostLink channels.

Protocol: JSON-RPC 2.0 over HTTP
Endpoints:
  POST /a2a — JSON-RPC handler for A2A messages
  GET  /a2a/.well-known/agent.json — Agent Card (discovery)
"""

from __future__ import annotations

import logging
import secrets
import time
from dataclasses import dataclass, field

log = logging.getLogger(__name__)


@dataclass
class A2AAgent:
    """Represents a connected A2A remote agent."""
    agent_id: str
    name: str
    url: str  # callback URL for sending messages to this agent
    capabilities: list[str] = field(default_factory=list)
    connected_at: float = field(default_factory=time.time)
    token: str = field(default_factory=lambda: secrets.token_urlsafe(16))
    channel: str = "general"


class A2ABridge:
    """Manages A2A protocol connections and message routing."""

    def __init__(self, server_name: str = "GhostLink", server_version: str = "4.4.0"):
        self._agents: dict[str, A2AAgent] = {}
        self.server_name = server_name
        self.server_version = server_version

    def get_agent_card(self) -> dict:
        """Return the A2A Agent Card for discovery."""
        return {
            "name": self.server_name,
            "version": self.server_version,
            "description": "GhostLink — Multi-Agent AI Chat Platform with MCP bridge",
            "url": "/a2a",
            "capabilities": {
                "streaming": False,
                "pushNotifications": False,
                "stateTransitionHistory": True,
            },
            "skills": [
                {
                    "id": "chat",
                    "name": "Multi-Agent Chat",
                    "description": "Participate in multi-agent chat channels",
                },
                {
                    "id": "delegate",
                    "name": "Task Delegation",
                    "description": "Delegate tasks to other agents in the network",
                },
            ],
            "defaultInputModes": ["text"],
            "defaultOutputModes": ["text"],
        }

    def handle_rpc(self, request: dict) -> dict:
        """Handle an A2A JSON-RPC 2.0 request."""
        method = request.get("method", "")
        params = request.get("params", {})
        rpc_id = request.get("id")

        handlers = {
            "tasks/send": self._handle_send,
            "tasks/get": self._handle_get,
            "tasks/cancel": self._handle_cancel,
            "agent/register": self._handle_register,
            "agent/deregister": self._handle_deregister,
        }

        handler = handlers.get(method)
        if not handler:
            return {
                "jsonrpc": "2.0",
                "id": rpc_id,
                "error": {"code": -32601, "message": f"Method not found: {method}"},
            }

        try:
            result = handler(params)
            return {"jsonrpc": "2.0", "id": rpc_id, "result": result}
        except Exception as e:
            log.warning("A2A RPC error for %s: %s", method, e)
            return {
                "jsonrpc": "2.0",
                "id": rpc_id,
                "error": {"code": -32000, "message": str(e)},
            }

    def _handle_register(self, params: dict) -> dict:
        """Register an external A2A agent."""
        name = params.get("name", "")
        url = params.get("url", "")
        if not name or not url:
            raise ValueError("name and url required")

        agent_id = f"a2a-{secrets.token_hex(4)}"
        agent = A2AAgent(
            agent_id=agent_id,
            name=name,
            url=url,
            capabilities=params.get("capabilities", []),
            channel=params.get("channel", "general"),
        )
        self._agents[agent_id] = agent
        log.info("A2A agent registered: %s (%s) from %s", name, agent_id, url)

        # Register with GhostLink's agent registry
        try:
            import deps
            if deps.registry:
                inst = deps.registry.register(f"a2a-{name}", name, "#4ade80")
                inst.role = "A2A Remote Agent"
        except Exception as e:
            log.debug("Failed to register A2A agent in GhostLink registry: %s", e)

        return {"agent_id": agent_id, "token": agent.token, "status": "registered"}

    def _handle_deregister(self, params: dict) -> dict:
        """Deregister an A2A agent."""
        agent_id = params.get("agent_id", "")
        agent = self._agents.pop(agent_id, None)
        if not agent:
            raise ValueError(f"Agent {agent_id} not found")

        # Deregister from GhostLink
        try:
            import deps
            if deps.registry:
                deps.registry.deregister(f"a2a-{agent.name}")
        except Exception:
            pass

        log.info("A2A agent deregistered: %s", agent.name)
        return {"status": "deregistered"}

    def _handle_send(self, params: dict) -> dict:
        """Handle a tasks/send request — route message to GhostLink."""
        task_id = params.get("id", secrets.token_hex(8))
        message = params.get("message", {})
        text = ""
        for part in message.get("parts", []):
            if part.get("type") == "text":
                text += part.get("text", "")

        if not text:
            raise ValueError("No text content in message")

        agent_id = params.get("agent_id", "")
        agent = self._agents.get(agent_id)
        sender = agent.name if agent else "a2a-unknown"
        channel = agent.channel if agent else "general"

        # Route to GhostLink store
        try:
            import deps
            from mcp_bridge import _run_async
            if deps.store:
                _run_async(deps.store.add(sender, text, "chat", channel))
                _run_async(deps.broadcast("message", {
                    "sender": sender, "text": text, "type": "chat", "channel": channel,
                }))
        except Exception as e:
            log.warning("A2A message routing failed: %s", e)

        return {
            "id": task_id,
            "status": {"state": "completed"},
            "artifacts": [{"parts": [{"type": "text", "text": f"Message delivered to #{channel}"}]}],
        }

    def _handle_get(self, params: dict) -> dict:
        """Handle tasks/get — return task status."""
        return {"id": params.get("id", ""), "status": {"state": "completed"}}

    def _handle_cancel(self, params: dict) -> dict:
        """Handle tasks/cancel."""
        return {"id": params.get("id", ""), "status": {"state": "canceled"}}

    def list_agents(self) -> list[dict]:
        """List connected A2A agents."""
        return [
            {
                "agent_id": a.agent_id,
                "name": a.name,
                "url": a.url,
                "channel": a.channel,
                "uptime": int(time.time() - a.connected_at),
            }
            for a in self._agents.values()
        ]


def setup_routes(app, bridge: A2ABridge):
    """Register A2A protocol routes on the FastAPI app."""
    from fastapi import Request
    from fastapi.responses import JSONResponse

    @app.get("/a2a/.well-known/agent.json")
    async def agent_card():
        return bridge.get_agent_card()

    @app.post("/a2a")
    async def a2a_rpc(request: Request):
        body = await request.json()
        # Validate JSON-RPC 2.0
        if body.get("jsonrpc") != "2.0":
            return JSONResponse(
                {"jsonrpc": "2.0", "error": {"code": -32600, "message": "Invalid Request"}},
                400,
            )
        result = bridge.handle_rpc(body)
        return result

    @app.get("/api/a2a/agents")
    async def list_a2a_agents():
        return {"agents": bridge.list_agents()}

    log.info("A2A protocol bridge loaded (endpoint: /a2a)")
