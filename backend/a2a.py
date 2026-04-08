from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import deps
from policy import PolicyContext

log = logging.getLogger(__name__)


class A2AManager:
    def __init__(self, data_dir: Path, *, server_name: str = "GhostLink", server_version: str = "5.7.2"):
        self._data_dir = Path(data_dir)
        self.server_name = server_name
        self.server_version = server_version
        self._discovered_file = self._data_dir / "a2a_discovered.json"
        self._card_overrides_file = self._data_dir / "a2a_card_overrides.json"

    def _load_discovered(self) -> list[dict[str, Any]]:
        if not self._discovered_file.exists():
            return []
        try:
            return list(json.loads(self._discovered_file.read_text(encoding="utf-8")))
        except Exception:
            return []

    def _save_discovered(self, entries: list[dict[str, Any]]) -> None:
        self._discovered_file.parent.mkdir(parents=True, exist_ok=True)
        self._discovered_file.write_text(json.dumps(entries, indent=2), encoding="utf-8")

    def _load_card_overrides(self) -> dict[str, Any]:
        if not self._card_overrides_file.exists():
            return {}
        try:
            return dict(json.loads(self._card_overrides_file.read_text(encoding="utf-8")))
        except Exception:
            return {}

    def _save_card_overrides(self, overrides: dict[str, Any]) -> None:
        self._card_overrides_file.parent.mkdir(parents=True, exist_ok=True)
        self._card_overrides_file.write_text(json.dumps(overrides, indent=2), encoding="utf-8")

    def list_discovered(self) -> list[dict[str, Any]]:
        return self._load_discovered()

    def _shared_key(self) -> str:
        settings = getattr(deps, "_settings", {}) or {}
        return str(settings.get("a2a_shared_key") or os.getenv("GHOSTLINK_A2A_API_KEY") or "").strip()

    def auth_mode(self) -> str:
        if self._shared_key():
            return "api_key"
        if deps.user_manager is not None:
            return "bearer"
        return "none"

    def verify_request_headers(self, headers: dict[str, str] | None) -> bool:
        expected = self._shared_key()
        if not expected:
            return True
        normalized = {str(key).lower(): str(value) for key, value in (headers or {}).items()}
        if normalized.get("x-a2a-key", "").strip() == expected:
            return True
        auth = normalized.get("authorization", "").strip()
        if auth.lower().startswith("bearer ") and auth.split(" ", 1)[1].strip() == expected:
            return True
        return False

    def _server_base_url(self) -> str:
        host = getattr(deps, "HOST", "127.0.0.1") or "127.0.0.1"
        port = int(getattr(deps, "PORT", 8300) or 8300)
        return f"http://{host}:{port}"

    def _public_agents(self) -> list[dict[str, Any]]:
        registry = deps.registry
        if registry is None:
            return []
        return registry.get_public_list() or registry.get_persisted_public_list()

    def _agent_skills(self, inst: Any) -> list[dict[str, str]]:
        items: list[dict[str, str]] = []
        base = str(getattr(inst, "base", "") or "")
        if base:
            items.append(
                {
                    "id": f"{base}-execution",
                    "name": f"{base} execution",
                    "description": f"GhostLink-managed {base} agent runtime",
                }
            )
        model = str(getattr(inst, "model", "") or "")
        if model:
            items.append({"id": "model", "name": model, "description": "Configured model"})
        return items

    def _frontend_card_from_spec(self, card: dict[str, Any]) -> dict[str, Any]:
        capabilities = card.get("capabilities")
        if isinstance(capabilities, dict):
            capability_values = [name for name, enabled in capabilities.items() if enabled]
        elif isinstance(capabilities, list):
            capability_values = [str(item) for item in capabilities if isinstance(item, str)]
        else:
            capability_values = []
        skills = []
        for item in card.get("skills", []) if isinstance(card.get("skills"), list) else []:
            if isinstance(item, dict):
                name = str(item.get("name") or item.get("id") or "").strip()
                if name:
                    skills.append(name)
            elif isinstance(item, str):
                skills.append(item)
        return {
            "agent_id": card.get("id", ""),
            "name": card.get("name", ""),
            "description": card.get("description", ""),
            "url": card.get("url", ""),
            "version": card.get("version", ""),
            "provider": card.get("provider", ""),
            "default_input_modes": card.get("defaultInputModes", []),
            "default_output_modes": card.get("defaultOutputModes", []),
            "capabilities": capability_values,
            "skills": skills,
            "metadata": {
                "auth": card.get("auth", {}),
                "preferred_transport": card.get("preferredTransport", ""),
                "model": card.get("model", ""),
                "published_card_url": f"{self._server_base_url()}/.well-known/agent-card.json",
            },
        }

    def generate_agent_card(self, agent_identifier: str | None = None) -> dict[str, Any]:
        registry = deps.registry
        inst = registry.resolve(agent_identifier) if agent_identifier and registry is not None else None
        if inst is None:
            agents = self._public_agents()
            if agents:
                first = agents[0]
                if registry is not None:
                    inst = registry.resolve(str(first.get("agent_id") or first.get("name") or ""))
        capabilities = {
            "streaming": False,
            "pushNotifications": False,
            "stateTransitionHistory": True,
        }
        auth_type = self.auth_mode()
        card_id = "ghostlink"
        card_name = self.server_name
        description = "GhostLink A2A endpoint"
        skills: list[dict[str, str]] = [
            {"id": "delegate", "name": "Task delegation", "description": "Delegates tasks over A2A"},
        ]
        provider = ""
        model = ""
        if inst is not None:
            card_id = str(getattr(inst, "agent_id", "") or card_id)
            card_name = str(getattr(inst, "name", "") or card_name)
            description = str(getattr(inst, "role", "") or f"{getattr(inst, 'base', 'agent')} agent exposed over A2A")
            provider = str(getattr(inst, "base", "") or "")
            model = str(getattr(inst, "model", "") or "")
            skills.extend(self._agent_skills(inst))
        overrides = self._load_card_overrides()
        base_url = str(overrides.get("url") or self._server_base_url())
        return {
            "protocolVersion": "0.2",
            "id": card_id,
            "name": str(overrides.get("name") or card_name),
            "version": str(overrides.get("version") or self.server_version),
            "description": str(overrides.get("description") or description),
            "url": f"{base_url.rstrip('/')}/a2a",
            "preferredTransport": "JSON-RPC",
            "capabilities": capabilities,
            "defaultInputModes": list(overrides.get("default_input_modes") or ["text"]),
            "defaultOutputModes": list(overrides.get("default_output_modes") or ["text", "artifact"]),
            "skills": skills,
            "auth": {"type": auth_type},
            "provider": provider,
            "model": model,
        }

    def get_api_card(self, agent_identifier: str | None = None) -> dict[str, Any]:
        card = self.generate_agent_card(agent_identifier)
        frontend = self._frontend_card_from_spec(card)
        overrides = self._load_card_overrides()
        if isinstance(overrides.get("skills"), list):
            frontend["skills"] = [str(item) for item in overrides["skills"] if str(item).strip()]
        if isinstance(overrides.get("capabilities"), list):
            frontend["capabilities"] = [str(item) for item in overrides["capabilities"] if str(item).strip()]
        return frontend

    def update_api_card(self, body: dict[str, Any]) -> dict[str, Any]:
        allowed = {
            "name",
            "description",
            "url",
            "version",
            "skills",
            "capabilities",
            "default_input_modes",
            "default_output_modes",
        }
        current = self._load_card_overrides()
        for key, value in body.items():
            if key not in allowed:
                continue
            if isinstance(value, str):
                current[key] = value.strip()
            elif isinstance(value, list):
                current[key] = [str(item).strip() for item in value if str(item).strip()]
        self._save_card_overrides(current)
        return self.get_api_card()

    async def _fetch_json(self, url: str) -> dict[str, Any]:
        def _fetch() -> dict[str, Any]:
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=10) as response:
                return json.loads(response.read().decode("utf-8"))

        return await asyncio.to_thread(_fetch)

    async def _post_json(self, url: str, payload: dict[str, Any]) -> dict[str, Any]:
        def _post() -> dict[str, Any]:
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=data,
                headers={"Content-Type": "application/json", "Accept": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=20) as response:
                return json.loads(response.read().decode("utf-8"))

        return await asyncio.to_thread(_post)

    async def discover(self, endpoint: str) -> dict[str, Any]:
        base = endpoint.rstrip("/")
        if base.endswith("/.well-known/agent-card.json"):
            card_url = base
            base = base[: -len("/.well-known/agent-card.json")]
        else:
            card_url = f"{base}/.well-known/agent-card.json"
        card = await self._fetch_json(card_url)
        if not isinstance(card, dict) or not card.get("name") or not card.get("url"):
            raise ValueError("Malformed remote agent card")
        frontend_card = self._frontend_card_from_spec(card)
        entry = {
            "endpoint": base,
            "card_url": card_url,
            "discovered_at": time.time(),
            "card": card,
            "frontend_card": frontend_card,
        }
        entries = [item for item in self._load_discovered() if item.get("endpoint") != base]
        entries.append(entry)
        self._save_discovered(entries)
        return entry

    async def invoke_remote(
        self,
        *,
        endpoint: str,
        target_agent: str,
        prompt: str,
        local_agent_id: str = "",
        local_agent_name: str = "",
        channel: str = "general",
    ) -> dict[str, Any]:
        if deps.task_store is None:
            raise RuntimeError("Task store not initialized")
        steps = [
            {"label": "routing", "status": "active"},
            {"label": "delegating", "status": "pending"},
            {"label": "awaiting_remote", "status": "pending"},
        ]
        local_task = await deps.task_store.create(
            title=f"A2A delegate: {target_agent}",
            description=prompt,
            channel=channel,
            agent_id=local_agent_id or None,
            agent_name=local_agent_name or None,
            source_type="a2a",
            source_ref="pending",
            trace_id=f"a2a-{int(time.time() * 1000)}",
            status="running",
            metadata={"endpoint": endpoint, "target_agent": target_agent},
        )
        await deps.task_store.update_progress(local_task["task_id"], 10, "routing", len(steps), {"steps": steps})
        payload = {
            "jsonrpc": "2.0",
            "id": local_task["task_id"],
            "method": "tasks/send",
            "params": {
                "agent_id": target_agent,
                "message": {"role": "user", "parts": [{"type": "text", "text": prompt}]},
                "metadata": {
                    "channel": channel,
                    "source_agent_id": local_agent_id,
                    "source_agent_name": local_agent_name,
                    "local_task_id": local_task["task_id"],
                    "trace_id": local_task["trace_id"],
                },
            },
        }
        steps[0]["status"] = "completed"
        steps[1]["status"] = "active"
        await deps.task_store.update_progress(local_task["task_id"], 45, "delegating", len(steps), {"steps": steps})
        response = await self._post_json(f"{endpoint.rstrip('/')}/a2a", payload)
        if response.get("error"):
            await deps.task_store.update(local_task["task_id"], status="failed", error=str(response["error"].get("message", "A2A invocation failed")))
            return {"ok": False, "task_id": local_task["task_id"], "error": response["error"]}
        result = dict(response.get("result") or {})
        remote_task_id = str(result.get("id", "") or "")
        steps[1]["status"] = "completed"
        steps[2]["status"] = "active"
        await deps.task_store.update_progress(local_task["task_id"], 75, "awaiting_remote", len(steps), {"steps": steps})
        await deps.task_store.update(
            local_task["task_id"],
            source_ref=remote_task_id or "pending",
            status="awaiting_external",
            metadata={
                **dict(local_task.get("metadata") or {}),
                "endpoint": endpoint,
                "target_agent": target_agent,
                "remote_task_id": remote_task_id,
                "remote_status": result.get("status", {}),
            },
        )
        return {"ok": True, "task_id": local_task["task_id"], "remote_task_id": remote_task_id, "result": result}

    def _status_steps(self, active_step: str, *, terminal: bool = False, failed: bool = False) -> list[dict[str, str]]:
        labels = ["routing", "delegating", "awaiting_remote", "syncing", "completed"]
        steps: list[dict[str, str]] = []
        for label in labels:
            if terminal and label == "completed":
                status = "completed" if not failed else "failed"
            elif label == active_step:
                status = "active" if not terminal else ("failed" if failed else "completed")
            elif labels.index(label) < labels.index(active_step):
                status = "completed"
            else:
                status = "pending"
            steps.append({"label": label, "status": status})
        return steps

    async def refresh_remote_task(self, local_task_id: str) -> dict[str, Any]:
        if deps.task_store is None:
            raise RuntimeError("Task store not initialized")
        local_task = await deps.task_store.get(local_task_id)
        if not local_task or local_task.get("source_type") != "a2a":
            raise ValueError("A2A task not found")
        metadata = dict(local_task.get("metadata") or {})
        endpoint = str(metadata.get("endpoint") or "").strip()
        remote_task_id = str(local_task.get("source_ref") or metadata.get("remote_task_id") or "").strip()
        if not endpoint or not remote_task_id:
            raise ValueError("A2A task missing remote mapping")

        steps = self._status_steps("syncing")
        await deps.task_store.update_progress(local_task_id, 85, "syncing", len(steps), {"steps": steps})
        response = await self._post_json(
            f"{endpoint.rstrip('/')}/a2a",
            {
                "jsonrpc": "2.0",
                "id": local_task_id,
                "method": "tasks/get",
                "params": {"id": remote_task_id},
            },
        )
        if response.get("error"):
            task = await deps.task_store.update(local_task_id, error=str(response["error"].get("message", "A2A refresh failed")))
            return {"ok": False, "task": task, "error": response["error"]}

        result = dict(response.get("result") or {})
        remote_status = result.get("status") if isinstance(result.get("status"), dict) else {}
        remote_state = str(remote_status.get("state") or "unknown").strip().lower()
        artifact = result.get("artifact") if isinstance(result.get("artifact"), dict) else {}
        remote_error = str(result.get("error") or remote_status.get("message") or "").strip()

        status_map = {
            "queued": ("queued", 80, "awaiting_remote"),
            "working": ("running", 90, "syncing"),
            "running": ("running", 90, "syncing"),
            "input-needed": ("awaiting_input", 90, "syncing"),
            "input_needed": ("awaiting_input", 90, "syncing"),
            "completed": ("completed", 100, "completed"),
            "failed": ("failed", 100, "completed"),
            "canceled": ("cancelled", 100, "completed"),
            "cancelled": ("cancelled", 100, "completed"),
        }
        local_status, progress_pct, progress_step = status_map.get(remote_state, ("awaiting_external", 90, "syncing"))
        terminal = local_status in {"completed", "failed", "cancelled"}
        updated_metadata = {
            **metadata,
            "remote_task_id": remote_task_id,
            "remote_status": remote_status,
        }
        if artifact:
            updated_metadata["remote_artifact"] = artifact
        if remote_error:
            updated_metadata["remote_error"] = remote_error
        steps = self._status_steps(progress_step, terminal=terminal, failed=local_status == "failed")
        task = await deps.task_store.update(
            local_task_id,
            status=local_status,
            progress_pct=progress_pct,
            progress_step=progress_step,
            progress_total=len(steps),
            progress_data={"steps": steps},
            error=remote_error or None,
            metadata=updated_metadata,
        )
        return {"ok": True, "task": task, "remote_status": remote_status}

    async def _check_inbound_policy(self, request: dict[str, Any]) -> dict[str, Any]:
        engine = deps.policy_engine
        if engine is None:
            return {"decision": "allow", "reason": "policy_engine_unavailable"}
        params = request.get("params") if isinstance(request.get("params"), dict) else {}
        metadata = params.get("metadata") if isinstance(params.get("metadata"), dict) else {}
        context = PolicyContext(
            agent_name=str(metadata.get("source_agent_name") or metadata.get("source_agent_id") or "external-agent"),
            agent_id=str(metadata.get("source_agent_id") or ""),
            task_id=str(metadata.get("local_task_id") or ""),
            metadata={"a2a_method": request.get("method", ""), "endpoint": metadata.get("endpoint", "")},
        )
        return await engine.evaluate("a2a_inbound", "external_messaging", context)

    async def handle_rpc(self, request: dict[str, Any]) -> dict[str, Any]:
        rpc_id = request.get("id")
        if request.get("jsonrpc") != "2.0":
            return {"jsonrpc": "2.0", "id": rpc_id, "error": {"code": -32600, "message": "Invalid Request"}}
        method = str(request.get("method") or "")
        params = request.get("params") if isinstance(request.get("params"), dict) else {}

        if method in {"tasks/send", "tasks/cancel"}:
            decision = await self._check_inbound_policy(request)
            if decision.get("decision") != "allow":
                return {
                    "jsonrpc": "2.0",
                    "id": rpc_id,
                    "error": {"code": -32001, "message": f"Inbound A2A blocked: {decision.get('reason', 'policy')}"},
                }

        try:
            if method == "tasks/send":
                result = await self._handle_send(params)
            elif method == "tasks/get":
                result = await self._handle_get(params)
            elif method == "tasks/cancel":
                result = await self._handle_cancel(params)
            else:
                return {"jsonrpc": "2.0", "id": rpc_id, "error": {"code": -32601, "message": f"Method not found: {method}"}}
        except Exception as exc:
            log.warning("A2A RPC error for %s: %s", method, exc)
            return {"jsonrpc": "2.0", "id": rpc_id, "error": {"code": -32000, "message": str(exc)}}

        return {"jsonrpc": "2.0", "id": rpc_id, "result": result}

    async def _handle_send(self, params: dict[str, Any]) -> dict[str, Any]:
        if deps.task_store is None:
            raise RuntimeError("Task store not initialized")
        message = params.get("message") if isinstance(params.get("message"), dict) else {}
        parts = message.get("parts") if isinstance(message.get("parts"), list) else []
        text_parts = [str(part.get("text", "")).strip() for part in parts if isinstance(part, dict) and part.get("type") == "text"]
        text = "\n".join(part for part in text_parts if part)
        if not text:
            raise ValueError("No text content in message")
        metadata = params.get("metadata") if isinstance(params.get("metadata"), dict) else {}
        channel = str(metadata.get("channel") or "general")
        remote_task_id = str(params.get("id") or f"remote-{int(time.time() * 1000)}")
        task = await deps.task_store.create(
            title=f"A2A inbound: {str(params.get('agent_id') or 'remote-agent')}",
            description=text,
            channel=channel,
            source_type="a2a",
            source_ref=remote_task_id,
            trace_id=str(metadata.get("trace_id") or remote_task_id),
            status="completed",
            metadata={"message": text, "direction": "inbound", "remote_metadata": metadata},
        )
        if deps.audit_store is not None:
            await deps.audit_store.record(
                "a2a.inbound",
                actor=str(metadata.get("source_agent_name") or metadata.get("source_agent_id") or "external-agent"),
                actor_type="agent",
                action="inbound a2a task received",
                task_id=task["task_id"],
                trace_id=task["trace_id"],
                channel=channel,
                detail={"source_ref": remote_task_id},
            )
        return {
            "id": remote_task_id,
            "status": {"state": "completed"},
            "metadata": {"local_task_id": task["task_id"], "trace_id": task["trace_id"]},
            "artifacts": [{"parts": [{"type": "text", "text": "Task accepted by GhostLink"}]}],
        }

    async def _handle_get(self, params: dict[str, Any]) -> dict[str, Any]:
        remote_task_id = str(params.get("id") or "")
        task = await deps.task_store.get_by_source_ref("a2a", remote_task_id) if deps.task_store is not None and remote_task_id else None
        state = "unknown"
        metadata: dict[str, Any] = {}
        if task is not None:
            state = str(task.get("status") or "unknown")
            metadata = dict(task.get("metadata") or {})
        return {
            "id": remote_task_id,
            "status": {"state": state},
            "metadata": {"task_id": (task or {}).get("task_id", ""), **metadata},
            "error": (task or {}).get("error"),
        }

    async def _handle_cancel(self, params: dict[str, Any]) -> dict[str, Any]:
        remote_task_id = str(params.get("id") or "")
        task = await deps.task_store.get_by_source_ref("a2a", remote_task_id) if deps.task_store is not None and remote_task_id else None
        if task is not None and deps.task_store is not None:
            await deps.task_store.cancel(task["task_id"], error="Cancelled by remote A2A peer")
        return {"id": remote_task_id, "status": {"state": "canceled"}}
