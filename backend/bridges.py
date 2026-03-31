"""Channel bridge system — connects GhostLink to external chat platforms.

Each bridge handles bidirectional message sync between GhostLink channels
and an external platform (Discord, Telegram, Slack, WhatsApp, or webhooks).

Bridges are configured in Settings > Integrations and stored in data/bridges.json.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)
_APPROVAL_CMD_RE = re.compile(r"^/(approve-session|approve|deny)\s+(\d+)\s*$", re.IGNORECASE)


# ── Bridge configuration persistence ────────────────────────────────

class BridgeManager:
    """Manages all channel bridge configurations and instances."""

    def __init__(self, data_dir: Path, store=None, registry=None, server_port: int = 8300):
        self._data_dir = data_dir
        self._config_path = data_dir / "bridges.json"
        self._store = store
        self._registry = registry
        self._server_port = server_port
        self._configs: dict[str, dict] = {}
        self._bridges: dict[str, BaseBridge] = {}
        self._load()

    def _load(self):
        if self._config_path.exists():
            try:
                self._configs = json.loads(self._config_path.read_text())
            except (json.JSONDecodeError, OSError):
                self._configs = {}

    def _save(self):
        self._config_path.parent.mkdir(parents=True, exist_ok=True)
        self._config_path.write_text(json.dumps(self._configs, indent=2))

    def get_all(self) -> list[dict]:
        """Get all bridge configurations with status."""
        result = []
        for platform in ("discord", "telegram", "slack", "whatsapp", "webhook"):
            cfg = self._configs.get(platform, {})
            bridge = self._bridges.get(platform)
            result.append({
                "platform": platform,
                "enabled": cfg.get("enabled", False),
                "configured": bool(cfg.get("token") or cfg.get("url") or platform == "webhook"),
                "connected": bridge is not None and bridge.is_connected(),
                "config": {k: v for k, v in cfg.items() if k != "token"},  # Don't expose token
                "has_token": bool(cfg.get("token")),
                "channel_map": cfg.get("channel_map", {}),
            })
        return result

    def configure(self, platform: str, config: dict) -> dict:
        """Update configuration for a platform bridge."""
        existing = self._configs.get(platform, {})
        # Only update provided keys
        for key in ("token", "enabled", "channel_map", "url", "secret", "options"):
            if key in config:
                existing[key] = config[key]
        existing["platform"] = platform
        existing["updated_at"] = time.time()
        self._configs[platform] = existing
        self._save()
        return {"ok": True, "platform": platform}

    def get_config(self, platform: str) -> dict:
        return self._configs.get(platform, {})

    def start_bridge(self, platform: str) -> dict:
        """Start a configured bridge."""
        cfg = self._configs.get(platform)
        if not cfg:
            return {"ok": False, "error": "not configured"}
        if not cfg.get("enabled"):
            return {"ok": False, "error": "not enabled"}

        # Stop existing bridge if running
        if platform in self._bridges:
            self._bridges[platform].stop()

        cfg.setdefault("server_port", self._server_port)
        bridge = _create_bridge(platform, cfg, self._store, self._registry, self._data_dir)
        if not bridge:
            return {"ok": False, "error": f"unknown platform: {platform}"}

        try:
            bridge.start()
            self._bridges[platform] = bridge
            log.info("Bridge started: %s", platform)
            return {"ok": True, "platform": platform}
        except Exception as e:
            log.error("Bridge start failed for %s: %s", platform, e)
            return {"ok": False, "error": str(e)}

    def stop_bridge(self, platform: str) -> dict:
        bridge = self._bridges.pop(platform, None)
        if bridge:
            bridge.stop()
            log.info("Bridge stopped: %s", platform)
            return {"ok": True}
        return {"ok": False, "error": "not running"}

    def start_all_enabled(self):
        """Start all enabled bridges on server startup."""
        for platform, cfg in self._configs.items():
            if cfg.get("enabled") and (cfg.get("token") or cfg.get("url")):
                try:
                    self.start_bridge(platform)
                except Exception as e:
                    log.error("Failed to auto-start bridge %s: %s", platform, e)

    def stop_all(self):
        for platform in list(self._bridges):
            self.stop_bridge(platform)

    def handle_ghostlink_message(
        self,
        sender: str,
        text: str,
        channel: str,
        *,
        msg_type: str = "chat",
        message_id: int | None = None,
        metadata: dict[str, Any] | None = None,
    ):
        """Forward a GhostLink message to all active bridges."""
        for platform, bridge in self._bridges.items():
            if bridge.is_connected():
                try:
                    bridge.send_outbound(
                        sender,
                        text,
                        channel,
                        msg_type=msg_type,
                        message_id=message_id,
                        metadata=metadata or {},
                    )
                except Exception as e:
                    log.debug("Bridge outbound failed for %s: %s", platform, e)


# ── Base bridge class ────────────────────────────────────────────────

class BaseBridge:
    """Base class for channel bridges."""

    def __init__(self, config: dict, store, registry, data_dir: Path):
        self._config = config
        self._store = store
        self._registry = registry
        self._data_dir = data_dir
        self._connected = False
        self._thread: threading.Thread | None = None
        self._outbound_rate_lock = threading.Lock()
        self._last_outbound_at: dict[str, float] = {}

    def is_connected(self) -> bool:
        return self._connected

    def start(self):
        raise NotImplementedError

    def stop(self):
        self._connected = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5)

    def send_outbound(
        self,
        sender: str,
        text: str,
        channel: str,
        *,
        msg_type: str = "chat",
        message_id: int | None = None,
        metadata: dict[str, Any] | None = None,
    ):
        """Send a GhostLink message to the external platform."""
        raise NotImplementedError

    def _transient_attempts(self) -> int:
        options = self._config.get("options", {})
        raw = options.get("retry_attempts", 3)
        try:
            attempts = int(raw)
        except (TypeError, ValueError):
            attempts = 3
        return max(1, min(attempts, 5))

    def _minimum_outbound_interval(self) -> float:
        options = self._config.get("options", {})
        raw = options.get("min_send_interval_s", 0.35)
        try:
            interval = float(raw)
        except (TypeError, ValueError):
            interval = 0.35
        return max(0.0, min(interval, 5.0))

    @staticmethod
    def _is_retryable_error(exc: Exception) -> bool:
        if isinstance(exc, urllib.error.HTTPError):
            return exc.code == 429 or 500 <= exc.code <= 599
        return isinstance(exc, (urllib.error.URLError, TimeoutError, OSError))

    def _request_with_retry(
        self,
        req: urllib.request.Request,
        *,
        timeout: int,
        operation: str,
        retry_transient: bool = False,
    ) -> bytes:
        attempts = self._transient_attempts() if retry_transient else 1
        last_exc: Exception | None = None
        for attempt in range(1, attempts + 1):
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    return resp.read()
            except Exception as exc:
                last_exc = exc
                if not retry_transient or attempt >= attempts or not self._is_retryable_error(exc):
                    raise
                delay = min(0.5 * (2 ** (attempt - 1)), 2.0)
                log.debug(
                    "%s transient failure (%s/%s): %s; retrying in %.2fs",
                    operation,
                    attempt,
                    attempts,
                    exc,
                    delay,
                )
                time.sleep(delay)
        if last_exc is not None:
            raise last_exc
        raise RuntimeError(f"{operation} failed without exception")

    def _respect_outbound_rate_limit(self, destination: str | None):
        if not destination:
            return
        interval = self._minimum_outbound_interval()
        if interval <= 0:
            return
        with self._outbound_rate_lock:
            now = time.monotonic()
            last = self._last_outbound_at.get(destination)
            if last is not None:
                remaining = interval - (now - last)
                if remaining > 0:
                    time.sleep(remaining)
                    now = time.monotonic()
            self._last_outbound_at[destination] = now

    def _parse_approval_command(self, text: str) -> tuple[int, str] | None:
        match = _APPROVAL_CMD_RE.match((text or "").strip())
        if not match:
            return None
        command, raw_id = match.groups()
        response = {
            "approve": "allow_once",
            "approve-session": "allow_session",
            "deny": "deny",
        }[command.lower()]
        return int(raw_id), response

    def _submit_approval_response(self, message_id: int, response: str) -> bool:
        try:
            body = json.dumps({
                "message_id": message_id,
                "response": response,
            }).encode()
            req = urllib.request.Request(
                f"http://127.0.0.1:{self._config.get('server_port', 8300)}/api/approval/respond",
                data=body,
                method="POST",
                headers={"Content-Type": "application/json"},
            )
            self._request_with_retry(req, timeout=5, operation="Approval response")
            return True
        except Exception as e:
            log.debug("Failed to submit approval response: %s", e)
            return False

    def _format_outbound(
        self,
        sender: str,
        text: str,
        *,
        msg_type: str = "chat",
        message_id: int | None = None,
        metadata: dict[str, Any] | None = None,
        markdown: bool = False,
    ) -> str:
        metadata = metadata or {}
        if msg_type != "approval_request":
            sender_fmt = f"*{sender}*" if markdown else f"**{sender}**"
            return f"{sender_fmt}: {text}"

        agent = str(metadata.get("agent") or sender)
        prompt = str(metadata.get("prompt") or text).strip()
        prompt = prompt[:600] + ("..." if len(prompt) > 600 else "")
        intro = f"Approval needed for {agent}"
        commands = (
            f"/approve {message_id} | /approve-session {message_id} | /deny {message_id}"
            if message_id
            else "/approve <id> | /approve-session <id> | /deny <id>"
        )
        if markdown:
            return f"*{intro}*\n```{prompt}```\nReply: `{commands}`"
        return f"{intro}\n{prompt}\nReply: {commands}"

    def _get_mapped_channel(self, external_channel: str) -> str:
        """Map external channel ID to GhostLink channel name."""
        channel_map = self._config.get("channel_map", {})
        # Reverse lookup: external_id → ghostlink_channel
        for gl_channel, ext_id in channel_map.items():
            if str(ext_id) == str(external_channel):
                return gl_channel
        return "general"  # Default

    def _get_external_channel(self, gl_channel: str) -> str | None:
        """Map GhostLink channel to external channel ID."""
        channel_map = self._config.get("channel_map", {})
        ext_id = channel_map.get(gl_channel)
        if ext_id is not None and str(ext_id).isdigit():
            return str(ext_id)
        return None

    def _post_to_ghostlink(self, sender: str, text: str, channel: str = "general"):
        """Post an inbound message from external platform to GhostLink."""
        try:
            body = json.dumps({
                "sender": sender,
                "text": text,
                "channel": channel,
                "type": "chat",
            }).encode()
            req = urllib.request.Request(
                f"http://127.0.0.1:{self._config.get('server_port', 8300)}/api/send",
                data=body, method="POST",
                headers={"Content-Type": "application/json"},
            )
            self._request_with_retry(req, timeout=5, operation="Inbound bridge post")
        except Exception as e:
            log.debug("Failed to post inbound message: %s", e)


# ── Discord Bridge ──────────────────────────────────────────────────

class DiscordBridge(BaseBridge):
    """Discord bot bridge using HTTP API (no gateway dependency)."""

    DISCORD_API = "https://discord.com/api/v10"

    def __init__(self, config, store, registry, data_dir):
        super().__init__(config, store, registry, data_dir)
        self._token = config.get("token", "")
        self._stop_event = threading.Event()
        self._message_cache: list[str] = []  # Dedup sent messages (ordered)
        self._last_message_ids: dict[str, str] = {}  # channel_id → last seen message id

    def start(self):
        if not self._token:
            raise ValueError("Discord bot token required")
        self._stop_event.clear()
        self._connected = False  # Verified after first successful API call
        self._thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._thread.start()
        log.info("Discord bridge starting (polling mode)")

    def stop(self):
        self._stop_event.set()
        self._connected = False

    def _discord_request(self, method: str, path: str, body: dict | None = None) -> dict | list | None:
        """Make an authenticated request to Discord API."""
        url = f"{self.DISCORD_API}{path}"
        data = json.dumps(body).encode() if body else None
        req = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": f"Bot {self._token}",
            "Content-Type": "application/json",
            "User-Agent": "GhostLink/1.8 (Bot)",
        })
        try:
            raw = self._request_with_retry(
                req,
                timeout=10,
                operation=f"Discord API {method} {path}",
                retry_transient=method != "GET",
            )
            return json.loads(raw)
        except urllib.error.HTTPError as e:
            log.debug("Discord API %s %s: %s", method, path, e.code)
            return None
        except Exception as e:
            log.debug("Discord API error: %s", e)
            return None

    def _poll_loop(self):
        """Poll Discord channels for new messages."""
        # Verify token on first iteration
        if not self._connected:
            me = self._discord_request("GET", "/users/@me")
            if me and isinstance(me, dict) and me.get("id"):
                self._connected = True
                log.info("Discord bridge connected (bot: %s)", me.get("username", "?"))
            else:
                log.error("Discord token verification failed — bridge not connected")
                return  # Don't poll with bad token
        while not self._stop_event.is_set():
            try:
                channel_map = self._config.get("channel_map", {})
                for gl_channel, discord_channel_id in channel_map.items():
                    if self._stop_event.is_set():
                        break
                    self._check_channel(str(discord_channel_id), gl_channel)
            except Exception as e:
                log.debug("Discord poll error: %s", e)
            self._stop_event.wait(3)  # Poll every 3 seconds

    def _check_channel(self, channel_id: str, gl_channel: str):
        """Check a Discord channel for new messages."""
        params = "?limit=10"
        last_id = self._last_message_ids.get(channel_id)
        if last_id:
            params += f"&after={last_id}"

        messages = self._discord_request("GET", f"/channels/{channel_id}/messages{params}")
        if not messages or not isinstance(messages, list):
            return

        # Discord returns newest first — reverse to process in order
        messages.reverse()

        for msg in messages:
            msg_id = msg.get("id", "")
            # Skip bot's own messages and already-seen messages
            if msg.get("author", {}).get("bot"):
                self._last_message_ids[channel_id] = msg_id
                continue
            if msg_id in self._message_cache:
                continue

            self._message_cache.append(msg_id)
            if len(self._message_cache) > 1000:
                self._message_cache = self._message_cache[-500:]

            author = msg.get("author", {}).get("username", "discord-user")
            content = msg.get("content", "")
            if content:
                approval = self._parse_approval_command(content)
                if approval:
                    approval_message_id, response = approval
                    if self._submit_approval_response(approval_message_id, response):
                        self._discord_request("POST", f"/channels/{channel_id}/messages", {
                            "content": f"Approval recorded: {response} for #{approval_message_id}",
                        })
                        self._last_message_ids[channel_id] = msg_id
                        continue
                self._post_to_ghostlink(f"discord:{author}", content, gl_channel)

            self._last_message_ids[channel_id] = msg_id

    def send_outbound(self, sender: str, text: str, channel: str, *, msg_type: str = "chat", message_id: int | None = None, metadata: dict[str, Any] | None = None):
        """Send a GhostLink message to Discord."""
        ext_channel = self._get_external_channel(channel)
        if not ext_channel:
            return

        # Don't echo back messages from Discord
        if sender.startswith("discord:"):
            return

        content = self._format_outbound(sender, text, msg_type=msg_type, message_id=message_id, metadata=metadata)
        # Discord max message length is 2000
        if len(content) > 2000:
            content = content[:1997] + "..."
        self._respect_outbound_rate_limit(f"discord:{ext_channel}")

        payload: dict[str, Any] = {"content": content}

        # Native Discord buttons for approval requests
        if msg_type == "approval_request" and message_id:
            payload["components"] = [{
                "type": 1,  # ACTION_ROW
                "components": [
                    {
                        "type": 2,  # BUTTON
                        "style": 3,  # SUCCESS (green)
                        "label": "Allow Once",
                        "custom_id": f"approve_{message_id}",
                    },
                    {
                        "type": 2,
                        "style": 1,  # PRIMARY (blue)
                        "label": "Allow Session",
                        "custom_id": f"approve-session_{message_id}",
                    },
                    {
                        "type": 2,
                        "style": 4,  # DANGER (red)
                        "label": "Deny",
                        "custom_id": f"deny_{message_id}",
                    },
                ],
            }]

        self._discord_request("POST", f"/channels/{ext_channel}/messages", payload)


# ── Telegram Bridge ─────────────────────────────────────────────────

class TelegramBridge(BaseBridge):
    """Telegram bot bridge using Bot API polling."""

    TELEGRAM_API = "https://api.telegram.org"

    def __init__(self, config, store, registry, data_dir):
        super().__init__(config, store, registry, data_dir)
        self._token = config.get("token", "")
        self._stop_event = threading.Event()
        self._offset = 0
        self._thinking_messages: dict[str, int] = {}  # agent → message_id for edit

    def start(self):
        if not self._token:
            raise ValueError("Telegram bot token required")
        self._stop_event.clear()
        self._connected = True
        self._thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._thread.start()
        log.info("Telegram bridge started (long-polling)")

    def stop(self):
        self._stop_event.set()
        self._connected = False

    def _tg_request(self, method: str, params: dict | None = None) -> dict | None:
        """Call Telegram Bot API."""
        url = f"{self.TELEGRAM_API}/bot{self._token}/{method}"
        data = json.dumps(params or {}).encode()
        req = urllib.request.Request(url, data=data, method="POST", headers={
            "Content-Type": "application/json",
        })
        try:
            raw = self._request_with_retry(
                req,
                timeout=35,
                operation=f"Telegram API {method}",
                retry_transient=method != "getUpdates",
            )
            result = json.loads(raw)
            return result if result.get("ok") else None
        except Exception as e:
            # Sanitize error to avoid leaking bot token from URL in stack traces
            err_msg = str(e).replace(self._token, "***") if self._token else str(e)
            log.debug("Telegram API %s error: %s", method, err_msg)
            return None

    def _poll_loop(self):
        """Long-poll Telegram for updates."""
        while not self._stop_event.is_set():
            try:
                result = self._tg_request("getUpdates", {
                    "offset": self._offset,
                    "timeout": 30,
                    "allowed_updates": ["message", "callback_query"],
                })
                if result and result.get("result"):
                    for update in result["result"]:
                        self._offset = update["update_id"] + 1
                        self._handle_update(update)
            except Exception as e:
                log.debug("Telegram poll error: %s", e)
                self._stop_event.wait(5)

    def _handle_update(self, update: dict):
        """Process a Telegram update (message or callback_query)."""
        # Handle inline keyboard button clicks
        callback = update.get("callback_query")
        if callback:
            data = callback.get("data", "")
            callback_id = callback.get("id", "")
            # Parse: approve_123, approve-session_123, deny_123
            parts = data.rsplit("_", 1)
            if len(parts) == 2:
                cmd, raw_id = parts
                response_map = {"approve": "allow_once", "approve-session": "allow_session", "deny": "deny"}
                response = response_map.get(cmd)
                if response:
                    try:
                        mid = int(raw_id)
                        success = self._submit_approval_response(mid, response)
                        answer = f"{'Done' if success else 'Failed'}: {cmd} #{mid}"
                    except ValueError:
                        answer = "Invalid approval ID"
                else:
                    answer = "Unknown action"
            else:
                answer = "Unknown callback"
            # Answer the callback to dismiss the loading state
            self._tg_request("answerCallbackQuery", {"callback_query_id": callback_id, "text": answer})
            return

        msg = update.get("message")
        if not msg:
            return
        text = msg.get("text", "")
        if not text:
            return

        chat_id = str(msg["chat"]["id"])
        username = msg.get("from", {}).get("username") or msg.get("from", {}).get("first_name", "user")
        gl_channel = self._get_mapped_channel(chat_id)
        approval = self._parse_approval_command(text)
        if approval:
            approval_message_id, response = approval
            if self._submit_approval_response(approval_message_id, response):
                self._tg_request("sendMessage", {
                    "chat_id": chat_id,
                    "text": f"Approval recorded: {response} for #{approval_message_id}",
                })
                return
        self._post_to_ghostlink(f"telegram:{username}", text, gl_channel)

    def send_outbound(self, sender: str, text: str, channel: str, *, msg_type: str = "chat", message_id: int | None = None, metadata: dict[str, Any] | None = None):
        """Send a GhostLink message to Telegram."""
        ext_channel = self._get_external_channel(channel)
        if not ext_channel:
            return
        if sender.startswith("telegram:"):
            return

        content = self._format_outbound(sender, text, msg_type=msg_type, message_id=message_id, metadata=metadata, markdown=True)
        if len(content) > 4096:
            content = content[:4093] + "..."
        self._respect_outbound_rate_limit(f"telegram:{ext_channel}")

        payload: dict[str, Any] = {
            "chat_id": ext_channel,
            "text": content,
            "parse_mode": "Markdown",
        }

        # Native Telegram inline keyboard for approval requests
        if msg_type == "approval_request" and message_id:
            payload["reply_markup"] = json.dumps({
                "inline_keyboard": [[
                    {"text": "Allow Once", "callback_data": f"approve_{message_id}"},
                    {"text": "Allow Session", "callback_data": f"approve-session_{message_id}"},
                    {"text": "Deny", "callback_data": f"deny_{message_id}"},
                ]],
            })

        self._tg_request("sendMessage", payload)


# ── Slack Bridge ────────────────────────────────────────────────────

class SlackBridge(BaseBridge):
    """Slack bridge using incoming/outgoing webhooks."""

    def __init__(self, config, store, registry, data_dir):
        super().__init__(config, store, registry, data_dir)
        self._webhook_url = config.get("url", "")  # Slack incoming webhook URL
        self._stop_event = threading.Event()

    def start(self):
        if not self._webhook_url:
            raise ValueError("Slack webhook URL required")
        self._connected = True
        log.info("Slack bridge started (webhook mode)")

    def stop(self):
        self._connected = False

    def send_outbound(self, sender: str, text: str, channel: str, *, msg_type: str = "chat", message_id: int | None = None, metadata: dict[str, Any] | None = None):
        """Send to Slack via incoming webhook."""
        if sender.startswith("slack:"):
            return
        try:
            self._respect_outbound_rate_limit(f"slack:{self._webhook_url}")
            body = json.dumps({
                "text": self._format_outbound(sender, text, msg_type=msg_type, message_id=message_id, metadata=metadata, markdown=True),
                "username": f"GhostLink ({sender})",
                "icon_emoji": ":robot_face:",
            }).encode()
            req = urllib.request.Request(
                self._webhook_url, data=body, method="POST",
                headers={"Content-Type": "application/json"},
            )
            self._request_with_retry(req, timeout=10, operation="Slack webhook", retry_transient=True)
        except Exception as e:
            log.debug("Slack webhook error: %s", e)


# ── WhatsApp Bridge ─────────────────────────────────────────────────

class WhatsAppBridge(BaseBridge):
    """WhatsApp bridge using Cloud API (Meta Business)."""

    def __init__(self, config, store, registry, data_dir):
        super().__init__(config, store, registry, data_dir)
        self._token = config.get("token", "")  # WhatsApp Cloud API token
        self._phone_id = config.get("options", {}).get("phone_number_id", "")

    def start(self):
        if not self._token or not self._phone_id:
            raise ValueError("WhatsApp Cloud API token and phone number ID required")
        self._connected = True
        log.info("WhatsApp bridge started (Cloud API)")

    def stop(self):
        self._connected = False

    def send_outbound(self, sender: str, text: str, channel: str, *, msg_type: str = "chat", message_id: int | None = None, metadata: dict[str, Any] | None = None):
        """Send to WhatsApp via Cloud API."""
        if sender.startswith("whatsapp:"):
            return
        ext_channel = self._get_external_channel(channel)
        if not ext_channel:
            return
        try:
            self._respect_outbound_rate_limit(f"whatsapp:{ext_channel}")
            body = json.dumps({
                "messaging_product": "whatsapp",
                "to": ext_channel,
                "type": "text",
                "text": {"body": self._format_outbound(sender, text, msg_type=msg_type, message_id=message_id, metadata=metadata)},
            }).encode()
            req = urllib.request.Request(
                f"https://graph.facebook.com/v21.0/{self._phone_id}/messages",
                data=body, method="POST",
                headers={
                    "Authorization": f"Bearer {self._token}",
                    "Content-Type": "application/json",
                },
            )
            self._request_with_retry(req, timeout=10, operation="WhatsApp send", retry_transient=True)
        except Exception as e:
            log.debug("WhatsApp send error: %s", e)


# ── Generic Webhook Bridge ──────────────────────────────────────────

class WebhookBridge(BaseBridge):
    """Generic webhook bridge — works with any platform that supports webhooks."""

    def __init__(self, config, store, registry, data_dir):
        super().__init__(config, store, registry, data_dir)
        self._outbound_url = config.get("url", "")
        self._secret = config.get("secret", "")

    def start(self):
        self._connected = True
        log.info("Webhook bridge started")

    def stop(self):
        self._connected = False

    def send_outbound(self, sender: str, text: str, channel: str, *, msg_type: str = "chat", message_id: int | None = None, metadata: dict[str, Any] | None = None):
        """POST to configured webhook URL."""
        if not self._outbound_url or sender.startswith("webhook:"):
            return
        try:
            self._respect_outbound_rate_limit(f"webhook:{self._outbound_url}")
            body = json.dumps({
                "event": "approval_request" if msg_type == "approval_request" else "message",
                "sender": sender,
                "text": text,
                "channel": channel,
                "message_id": message_id,
                "metadata": metadata or {},
                "timestamp": time.time(),
                "source": "ghostlink",
            }).encode()
            headers = {"Content-Type": "application/json", "User-Agent": "GhostLink/1.8"}
            if self._secret:
                import hashlib, hmac
                sig = hmac.new(self._secret.encode(), body, hashlib.sha256).hexdigest()
                headers["X-GhostLink-Signature"] = sig
            req = urllib.request.Request(
                self._outbound_url, data=body, method="POST", headers=headers,
            )
            self._request_with_retry(req, timeout=10, operation="Webhook outbound", retry_transient=True)
        except Exception as e:
            log.debug("Webhook outbound error: %s", e)


# ── Bridge factory ──────────────────────────────────────────────────

def _create_bridge(platform: str, config: dict, store, registry, data_dir: Path) -> BaseBridge | None:
    """Create a bridge instance for the given platform."""
    # Inject server port for inbound posting (passed from BridgeManager)
    # config["server_port"] should already be set by the caller
    bridges = {
        "discord": DiscordBridge,
        "telegram": TelegramBridge,
        "slack": SlackBridge,
        "whatsapp": WhatsAppBridge,
        "webhook": WebhookBridge,
    }
    cls = bridges.get(platform)
    if cls:
        return cls(config, store, registry, data_dir)
    return None
