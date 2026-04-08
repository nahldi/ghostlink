"""Provider transport abstraction, failover, and prompt-cache diagnostics."""

from __future__ import annotations

import asyncio
import hashlib
import json
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field, replace
from enum import Enum
from typing import Any


class TransportMode(str, Enum):
    API = "api"
    CLI = "cli"
    MCP = "mcp"
    LOCAL = "local"


class CapabilityFlag(str, Enum):
    STREAMING = "streaming"
    FUNCTION_CALLING = "function_calling"
    VISION = "vision"
    CACHING = "caching"
    TOOL_USE = "tool_use"
    CODE_EXEC = "code_exec"
    EMBEDDING = "embedding"
    IMAGE_GEN = "image_gen"
    VIDEO_GEN = "video_gen"
    TTS = "tts"
    STT = "stt"
    SEARCH = "search"
    REASONING = "reasoning"


@dataclass
class TransportConfig:
    mode: TransportMode
    base_url: str = ""
    headers: dict[str, str] = field(default_factory=dict)
    proxy: str = ""
    tls_cert_path: str = ""
    timeout: int = 120
    max_retries: int = 2
    capabilities: set[CapabilityFlag] = field(default_factory=set)


@dataclass
class ProviderRequest:
    capability: str
    provider: str = ""
    model: str = ""
    method: str = "POST"
    url: str = ""
    path: str = ""
    headers: dict[str, str] = field(default_factory=dict)
    json_body: dict[str, Any] | None = None
    data: bytes | None = None
    timeout: int | None = None
    cache_key: str = ""
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    expected_output_tokens: int = 0
    agent_id: str = ""
    session_id: str = ""
    task_id: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ProviderResponse:
    provider: str
    model: str
    transport: str
    status: int
    headers: dict[str, str]
    body: bytes
    json_body: dict[str, Any] | list[Any] | None
    latency_ms: int
    cache_hit: bool = False
    cache_key: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


class TransportError(RuntimeError):
    pass


class BudgetExceededError(TransportError):
    pass


def normalized_cache_key(parts: list[Any]) -> str:
    payload = json.dumps(parts, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(payload.encode()).hexdigest()


class Transport:
    def __init__(self, config: TransportConfig):
        self.config = config
        self._healthy = True
        self._last_error = ""
        self._last_error_at = 0.0

    def supports(self, capability: CapabilityFlag) -> bool:
        return capability in self.config.capabilities

    def mark_unhealthy(self, error: str) -> None:
        self._healthy = False
        self._last_error = error
        self._last_error_at = time.time()

    def mark_healthy(self) -> None:
        self._healthy = True
        self._last_error = ""
        self._last_error_at = 0.0

    @property
    def is_healthy(self) -> bool:
        return self._healthy

    @property
    def last_error(self) -> str:
        return self._last_error

    @property
    def last_error_at(self) -> float:
        return self._last_error_at

    async def send(self, request: ProviderRequest) -> ProviderResponse:
        raise NotImplementedError


class ApiTransport(Transport):
    async def send(self, request: ProviderRequest) -> ProviderResponse:
        return await asyncio.to_thread(self._send_sync, request)

    def _send_sync(self, request: ProviderRequest) -> ProviderResponse:
        url = request.url
        if not url:
            if not self.config.base_url or not request.path:
                raise TransportError("transport missing url")
            url = urllib.parse.urljoin(f"{self.config.base_url.rstrip('/')}/", request.path.lstrip("/"))
        headers = dict(self.config.headers)
        headers.update(request.headers)
        data = request.data
        if request.json_body is not None:
            data = json.dumps(request.json_body).encode()
            headers.setdefault("Content-Type", "application/json")
        req = urllib.request.Request(url, data=data, headers=headers, method=request.method.upper())
        context = None
        if self.config.tls_cert_path:
            context = ssl.create_default_context(cafile=self.config.tls_cert_path)
        opener = None
        if self.config.proxy:
            opener = urllib.request.build_opener(
                urllib.request.ProxyHandler({"http": self.config.proxy, "https": self.config.proxy})
            )
            if context is not None:
                opener.add_handler(urllib.request.HTTPSHandler(context=context))
        started = time.time()
        try:
            if opener:
                resp = opener.open(req, timeout=request.timeout or self.config.timeout)
            else:
                resp = urllib.request.urlopen(req, timeout=request.timeout or self.config.timeout, context=context)
            with resp:
                body = resp.read()
                status = getattr(resp, "status", 200)
                response_headers = dict(resp.headers.items())
        except urllib.error.HTTPError as exc:
            self.mark_unhealthy(f"http:{exc.code}")
            raise TransportError(f"http:{exc.code}") from exc
        except Exception as exc:
            self.mark_unhealthy(str(exc))
            raise TransportError(str(exc)) from exc
        self.mark_healthy()
        latency_ms = int((time.time() - started) * 1000)
        json_body = None
        if body:
            try:
                json_body = json.loads(body.decode())
            except Exception:
                json_body = None
        return ProviderResponse(
            provider=request.provider,
            model=request.model,
            transport=self.config.mode.value,
            status=status,
            headers=response_headers,
            body=body,
            json_body=json_body,
            latency_ms=latency_ms,
            cache_key=request.cache_key,
        )


class ProviderTransportManager:
    def __init__(self, provider_registry, *, cost_tracker=None):
        self._provider_registry = provider_registry
        self._cost_tracker = cost_tracker
        self._active_provider_by_capability: dict[str, str] = {}
        self._health: dict[str, dict[str, Any]] = {}
        self._cache_metrics: dict[str, dict[str, int]] = {}
        self._seen_cache_keys: dict[tuple[str, str], set[str]] = {}

    def _record_cache(self, provider: str, capability: str, cache_key: str) -> bool:
        if not cache_key:
            return False
        provider_stats = self._cache_metrics.setdefault(provider, {"hits": 0, "misses": 0})
        seen = self._seen_cache_keys.setdefault((provider, capability), set())
        if cache_key in seen:
            provider_stats["hits"] += 1
            return True
        seen.add(cache_key)
        provider_stats["misses"] += 1
        return False

    async def _emit_event(self, event_type: str, payload: dict[str, Any]) -> None:
        import deps

        if deps.audit_log:
            deps.audit_log.log(event_type, payload, actor=payload.get("agent_id", "system"))
        if deps.broadcast:
            await deps.broadcast(event_type, payload)

    async def execute(
        self,
        capability: str,
        request: ProviderRequest,
        *,
        preferred_provider: str = "",
        exclude: list[str] | None = None,
    ) -> ProviderResponse:
        providers = self._provider_registry.iter_providers_for_capability(capability, preferred_provider=preferred_provider, exclude=exclude or [])
        last_error: Exception | None = None
        previous_active = self._active_provider_by_capability.get(capability, "")
        for index, provider_id in enumerate(providers):
            transport = self._provider_registry.build_transport(provider_id, capability=capability)
            model = request.model or self._provider_registry.default_model_for(provider_id, capability)
            provider_request = replace(request, provider=provider_id, model=model)
            if not provider_request.cache_key:
                provider_request.cache_key = normalized_cache_key(
                    [provider_id, capability, model, provider_request.path or provider_request.url, provider_request.json_body or provider_request.data or "", provider_request.metadata]
                )
            if self._cost_tracker:
                budget = await self._cost_tracker.check_budget(
                    agent_id=provider_request.agent_id or "system",
                    session_id=provider_request.session_id or "default",
                    task_id=provider_request.task_id,
                    provider=provider_id,
                    model=model,
                    estimated_input_tokens=provider_request.input_tokens,
                    estimated_output_tokens=provider_request.expected_output_tokens or provider_request.output_tokens,
                )
                if not budget.allowed:
                    raise BudgetExceededError(budget.reason or "budget exceeded")
            try:
                response = await transport.send(provider_request)
            except BudgetExceededError:
                raise
            except Exception as exc:
                self._health[provider_id] = {
                    "healthy": False,
                    "last_error": str(exc),
                    "last_error_at": time.time(),
                    "active": False,
                }
                last_error = exc
                if index + 1 < len(providers):
                    await self._emit_event(
                        "provider_failover",
                        {
                            "capability": capability,
                            "from_provider": provider_id,
                            "to_provider": providers[index + 1],
                            "reason": str(exc),
                            "agent_id": provider_request.agent_id or "system",
                            "task_id": provider_request.task_id,
                        },
                    )
                continue
            cache_hit = self._record_cache(provider_id, capability, provider_request.cache_key)
            response.cache_hit = cache_hit
            response.metadata["cache_hit"] = cache_hit
            if self._cost_tracker:
                usage = self._provider_registry.extract_usage(provider_id, model, response)
                await self._cost_tracker.record(
                    agent_id=provider_request.agent_id or "system",
                    session_id=provider_request.session_id or "default",
                    task_id=provider_request.task_id,
                    provider=provider_id,
                    model=model,
                    transport=response.transport,
                    input_tokens=usage.get("input_tokens", provider_request.input_tokens),
                    output_tokens=usage.get("output_tokens", provider_request.output_tokens),
                    cache_read_tokens=usage.get("cache_read_tokens", provider_request.cache_read_tokens),
                    cache_write_tokens=usage.get("cache_write_tokens", provider_request.cache_write_tokens),
                    latency_ms=response.latency_ms,
                    metadata={"accounting_mode": usage.get("accounting_mode", "direct"), **response.metadata},
                )
            self._health[provider_id] = {
                "healthy": True,
                "last_error": "",
                "last_error_at": 0.0,
                "active": True,
            }
            self._active_provider_by_capability[capability] = provider_id
            if previous_active and previous_active != provider_id and provider_id == providers[0]:
                await self._emit_event(
                    "provider_promotion",
                    {
                        "capability": capability,
                        "provider": provider_id,
                        "previous_provider": previous_active,
                        "agent_id": provider_request.agent_id or "system",
                        "task_id": provider_request.task_id,
                    },
                )
            return response
        if last_error:
            raise TransportError(str(last_error))
        raise TransportError(f"no provider available for {capability}")

    def get_provider_health(self) -> dict[str, dict[str, Any]]:
        out = {}
        for provider_id, status in self._health.items():
            current = dict(status)
            current.setdefault("active", False)
            out[provider_id] = current
        return out

    def cache_metrics(self) -> dict[str, Any]:
        total_hits = sum(v.get("hits", 0) for v in self._cache_metrics.values())
        total_misses = sum(v.get("misses", 0) for v in self._cache_metrics.values())
        return {
            "providers": {k: dict(v) for k, v in self._cache_metrics.items()},
            "total_hits": total_hits,
            "total_misses": total_misses,
        }
