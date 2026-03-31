"""Per-instance MCP identity proxy.

Sits between an agent CLI and the MCP bridge server.
Stamps sender identity and bearer token on all tool calls
so agents don't need to know their own name or auth.

Adapted from reference-agentchattr/mcp_proxy.py.
"""

import json
import logging
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

log = logging.getLogger(__name__)

# MCP tools and which parameter carries the agent identity
_SENDER_PARAMS = {
    "chat_send": "sender",
    "chat_read": "sender",
    "chat_join": "name",
    "chat_who": None,
    "chat_channels": None,
    "chat_rules": "sender",
    "chat_propose_job": "sender",
    "chat_claim": "sender",
}


class _ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)):
            return
        super().handle_error(request, client_address)


class McpIdentityProxy:
    """Local HTTP proxy that stamps agent identity on MCP tool calls."""

    def __init__(self, upstream_base: str, upstream_path: str,
                 agent_name: str, instance_token: str, port: int = 0):
        self._upstream_base = upstream_base.rstrip("/")
        self._upstream_path = upstream_path
        self._agent_name = agent_name
        self._token = instance_token
        self._port = port
        self._lock = threading.Lock()
        self._server: _ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    @property
    def port(self) -> int:
        if self._server:
            return self._server.server_address[1]
        return 0

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    @property
    def agent_name(self) -> str:
        with self._lock:
            return self._agent_name

    @agent_name.setter
    def agent_name(self, name: str):
        with self._lock:
            self._agent_name = name

    @property
    def token(self) -> str:
        with self._lock:
            return self._token

    @token.setter
    def token(self, value: str):
        with self._lock:
            self._token = value

    def start(self):
        proxy = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format, *args):
                pass

            def _upstream_url(self, path=None):
                p = path if path else self.path
                return f"{proxy._upstream_base}{p}"

            def _send_response_headers(self, headers):
                for key in ("Content-Type", "Mcp-Session-Id", "Cache-Control"):
                    val = headers.get(key)
                    if val:
                        self.send_header(key, val)

            def do_POST(self):
                length = int(self.headers.get("Content-Length", 0))
                raw = self.rfile.read(length) if length else b""
                body = self._maybe_inject_sender(raw)

                try:
                    req = Request(self._upstream_url(), data=body, method="POST")
                    for hdr, val in self.headers.items():
                        if hdr.lower() not in ("content-length", "host"):
                            req.add_header(hdr, val)
                    req.add_header("Authorization", f"Bearer {proxy.token}")
                    req.add_header("X-Agent-Token", proxy.token)
                    resp = urlopen(req, timeout=30)
                    status = resp.status
                    resp_body = resp.read()
                    resp_headers = resp.headers
                except HTTPError as e:
                    status = e.code
                    resp_body = e.read()
                    resp_headers = e.headers
                except (URLError, OSError) as e:
                    self.send_error(502, f"Upstream error: {e}")
                    return

                self.send_response(status)
                self._send_response_headers(resp_headers)
                self.send_header("Content-Length", str(len(resp_body)))
                self.end_headers()
                self.wfile.write(resp_body)

            def do_GET(self):
                try:
                    req = Request(self._upstream_url(), method="GET")
                    for hdr, val in self.headers.items():
                        if hdr.lower() not in ("host",):
                            req.add_header(hdr, val)
                    req.add_header("Authorization", f"Bearer {proxy.token}")
                    req.add_header("X-Agent-Token", proxy.token)
                    resp = urlopen(req, timeout=300)
                except HTTPError as e:
                    self.send_response(e.code)
                    self._send_response_headers(e.headers)
                    body = e.read()
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                except (URLError, OSError) as e:
                    self.send_error(502, f"Upstream error: {e}")
                    return

                self.send_response(resp.status)
                self._send_response_headers(resp.headers)
                self.end_headers()
                try:
                    for line in resp:
                        if line.startswith(b"data:"):
                            line = self._rewrite_sse_endpoint(line)
                        self.wfile.write(line)
                        self.wfile.flush()
                except BrokenPipeError:
                    pass

            def do_DELETE(self):
                try:
                    req = Request(self._upstream_url(), method="DELETE")
                    for hdr in ("Mcp-Session-Id",):
                        val = self.headers.get(hdr)
                        if val:
                            req.add_header(hdr, val)
                    req.add_header("Authorization", f"Bearer {proxy.token}")
                    req.add_header("X-Agent-Token", proxy.token)
                    resp = urlopen(req, timeout=10)
                    self.send_response(resp.status)
                    self.end_headers()
                except Exception:
                    self.send_error(502)

            def _rewrite_sse_endpoint(self, line: bytes) -> bytes:
                try:
                    text = line.decode("utf-8")
                    rewritten = re.sub(
                        r'data:\s*http://127\.0\.0\.1:\d+/',
                        f'data: {proxy.url}/',
                        text,
                    )
                    return rewritten.encode("utf-8")
                except Exception:
                    return line

            def _maybe_inject_sender(self, raw: bytes) -> bytes:
                if not raw:
                    return raw
                try:
                    data = json.loads(raw)
                except (json.JSONDecodeError, UnicodeDecodeError):
                    return raw

                messages = data if isinstance(data, list) else [data]
                modified = False

                for msg in messages:
                    if not isinstance(msg, dict):
                        continue
                    if msg.get("method") != "tools/call":
                        continue
                    params = msg.get("params", {})
                    tool_name = params.get("name", "")
                    args = params.get("arguments", {})
                    sender_key = _SENDER_PARAMS.get(tool_name)
                    if sender_key is None:
                        continue
                    # Always inject — never trust agent-provided sender
                    args[sender_key] = proxy.agent_name
                    params["arguments"] = args
                    modified = True

                if modified:
                    return json.dumps(data).encode("utf-8")
                return raw

        try:
            self._server = _ThreadingHTTPServer(("127.0.0.1", self._port), Handler)
        except OSError:
            self._server = None
            return False

        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        log.info(f"MCP proxy for {self._agent_name} on port {self.port}")
        print(f"  MCP proxy: port {self.port}")
        return True

    def stop(self):
        if self._server:
            self._server.shutdown()
            self._server.server_close()
            self._server = None
