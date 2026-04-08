from __future__ import annotations

import time
import uuid as _uuid
from dataclasses import asdict, dataclass, field

import deps
from autonomous import AutonomousPlan


@dataclass
class SupervisorSession:
    session_id: str
    supervisor_id: str
    worker_ids: list[str]
    plan: AutonomousPlan
    authority_level: int = 0
    artifact_lineage_root: str = ""
    created_at: float = field(default_factory=time.time)
    status: str = "active"

    def to_dict(self) -> dict:
        data = asdict(self)
        data["plan"] = {
            "plan_id": self.plan.plan_id,
            "goal": self.plan.goal,
            "agent": self.plan.agent,
            "status": self.plan.status,
            "subtasks": [
                {
                    "id": item.id,
                    "label": item.label,
                    "description": item.description,
                    "status": item.status,
                    "assignee": item.assignee,
                }
                for item in self.plan.subtasks
            ],
        }
        return data


@dataclass
class PoolMessage:
    message_id: str
    publisher_agent_id: str
    message_type: str
    namespace: str
    payload: dict
    published_at: float = field(default_factory=time.time)
    subscribers_acked: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


class CollaborationManager:
    def __init__(self):
        self._sessions: dict[str, SupervisorSession] = {}
        self._message_pool: dict[str, list[PoolMessage]] = {}

    async def create_supervisor_session(
        self,
        *,
        supervisor_id: str,
        worker_ids: list[str],
        plan: AutonomousPlan,
        authority_level: int = 0,
        artifact_lineage_root: str = "",
    ) -> SupervisorSession:
        session = SupervisorSession(
            session_id=_uuid.uuid4().hex,
            supervisor_id=supervisor_id,
            worker_ids=list(worker_ids),
            plan=plan,
            authority_level=int(authority_level),
            artifact_lineage_root=artifact_lineage_root,
        )
        self._sessions[session.session_id] = session
        await self._record_audit(
            "collaboration",
            "supervisor_session_create",
            detail={
                "session_id": session.session_id,
                "supervisor_id": supervisor_id,
                "worker_ids": worker_ids,
                "plan_id": plan.plan_id,
            },
            trace_id=plan.plan_id,
        )
        return session

    def get_supervisor_session(self, session_id: str) -> dict | None:
        session = self._sessions.get(session_id)
        return session.to_dict() if session else None

    def list_supervisor_sessions(self, supervisor_id: str | None = None) -> list[dict]:
        sessions = list(self._sessions.values())
        if supervisor_id:
            sessions = [item for item in sessions if item.supervisor_id == supervisor_id]
        sessions.sort(key=lambda item: item.created_at, reverse=True)
        return [item.to_dict() for item in sessions]

    async def publish_message(
        self,
        *,
        publisher_agent_id: str,
        message_type: str,
        namespace: str,
        payload: dict,
    ) -> dict:
        message = PoolMessage(
            message_id=_uuid.uuid4().hex,
            publisher_agent_id=publisher_agent_id,
            message_type=message_type,
            namespace=namespace,
            payload=dict(payload),
        )
        self._message_pool.setdefault(namespace, []).append(message)
        await self._record_audit(
            "collaboration",
            "message_publish",
            detail={
                "message_id": message.message_id,
                "publisher_agent_id": publisher_agent_id,
                "message_type": message_type,
                "namespace": namespace,
            },
            trace_id=namespace,
        )
        return message.to_dict()

    def list_messages(self, namespace: str, *, message_type: str | None = None) -> list[dict]:
        messages = list(self._message_pool.get(namespace, []))
        if message_type:
            messages = [item for item in messages if item.message_type == message_type]
        return [item.to_dict() for item in messages]

    async def ack_message(self, namespace: str, message_id: str, agent_id: str) -> dict | None:
        messages = self._message_pool.get(namespace, [])
        target = next((item for item in messages if item.message_id == message_id), None)
        if target is None:
            return None
        if agent_id not in target.subscribers_acked:
            target.subscribers_acked.append(agent_id)
        await self._record_audit(
            "collaboration",
            "message_ack",
            detail={"message_id": message_id, "namespace": namespace, "agent_id": agent_id},
            trace_id=namespace,
        )
        return target.to_dict()

    async def _record_audit(self, event_type: str, action: str, *, detail: dict, trace_id: str | None = None) -> None:
        if deps.audit_store is None:
            return
        await deps.audit_store.record(
            event_type,
            "system",
            action,
            trace_id=trace_id,
            detail=detail,
        )
