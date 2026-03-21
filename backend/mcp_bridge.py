"""MCP server for agent chat tools — runs alongside the web server.

Serves two transports for compatibility:
  - streamable-http on port 8200 (Claude Code, Codex)
  - SSE on port 8201 (Gemini)
"""

import json
import os
import time
import logging
import threading
import asyncio
from pathlib import Path

from mcp.server.fastmcp import Context, FastMCP

log = logging.getLogger(__name__)

# ── Shared state — set by app.py before starting ────────────────────

_store = None          # MessageStore (async)
_registry = None       # AgentRegistry
_rule_store = None     # RuleStore (async)
_job_store = None      # JobStore (async)
_router = None         # MessageRouter
_settings = None       # dict with channels etc.
_data_dir: Path | None = None
_server_port: int = 8300

# Presence tracking
_presence: dict[str, float] = {}
_activity: dict[str, bool] = {}
_activity_ts: dict[str, float] = {}
ACTIVITY_TIMEOUT = 8
_presence_lock = threading.Lock()
PRESENCE_TIMEOUT = 15

# Per-agent read cursors: agent_name → {channel → last_msg_id}
_cursors: dict[str, dict[str, int]] = {}
_cursors_lock = threading.Lock()

# Empty-read escalation
_empty_read_count: dict[str, int] = {}


def configure(
    store,
    registry,
    settings: dict,
    data_dir: Path,
    server_port: int = 8300,
    rule_store=None,
    job_store=None,
    router=None,
):
    """Called before server start to inject dependencies."""
    global _store, _registry, _settings, _data_dir, _server_port
    global _rule_store, _job_store, _router
    _store = store
    _registry = registry
    _settings = settings
    _data_dir = data_dir
    _server_port = server_port
    _rule_store = rule_store
    _job_store = job_store
    _router = router


# ── Async event loop for sync→async bridge ──────────────────────────

_loop: asyncio.AbstractEventLoop | None = None
_loop_thread: threading.Thread | None = None


def _ensure_loop():
    global _loop, _loop_thread
    if _loop is not None:
        return
    _loop = asyncio.new_event_loop()
    _loop_thread = threading.Thread(target=_loop.run_forever, daemon=True)
    _loop_thread.start()


def _run_async(coro):
    """Run an async coroutine from sync context using our dedicated loop."""
    _ensure_loop()
    future = asyncio.run_coroutine_threadsafe(coro, _loop)
    return future.result(timeout=10)


# ── Helpers ─────────────────────────────────────────────────────────

def _touch_presence(name: str):
    with _presence_lock:
        _presence[name] = time.time()


def _get_online() -> list[str]:
    now = time.time()
    with _presence_lock:
        return [n for n, ts in _presence.items() if now - ts < PRESENCE_TIMEOUT]


def is_online(name: str) -> bool:
    now = time.time()
    with _presence_lock:
        return name in _presence and now - _presence.get(name, 0) < PRESENCE_TIMEOUT


def set_active(name: str, active: bool):
    with _presence_lock:
        _activity[name] = active
        if active:
            _activity_ts[name] = time.time()


def is_active(name: str) -> bool:
    with _presence_lock:
        if not _activity.get(name, False):
            return False
        ts = _activity_ts.get(name, 0)
        if time.time() - ts > ACTIVITY_TIMEOUT:
            _activity[name] = False
            return False
        return True


def _extract_agent_token(ctx: Context | None) -> str:
    if ctx is None:
        return ""
    try:
        request = ctx.request_context.request
        headers = getattr(request, "headers", None)
        if not headers:
            return ""
        auth = headers.get("authorization", "")
        if auth and auth.lower().startswith("bearer "):
            return auth[7:].strip()
        return headers.get("x-agent-token", "").strip()
    except Exception:
        return ""


def _resolve_identity(
    raw_name: str,
    ctx: Context | None,
    *,
    field_name: str = "sender",
    required: bool = False,
) -> tuple[str, str | None]:
    """Resolve sender identity from token or raw name.
    Returns (resolved_name, error_or_none).
    """
    provided = raw_name.strip() if raw_name else ""
    token = _extract_agent_token(ctx)

    # Token-based auth (from proxy or direct bearer)
    if token and _registry:
        inst = _registry.resolve_token(token)
        if inst:
            _touch_presence(inst.name)
            return inst.name, None
        return "", "Error: stale or unknown token. Re-register and retry."

    # Fallback to raw name
    if not provided:
        if required:
            return "", f"Error: {field_name} is required."
        return "", None

    _touch_presence(provided)
    return provided, None


def _update_cursor(sender: str, msgs: list[dict], channel: str | None):
    if sender and msgs:
        ch_key = channel or "__all__"
        with _cursors_lock:
            agent_cursors = _cursors.setdefault(sender, {})
            agent_cursors[ch_key] = msgs[-1]["id"]


def _serialize_messages(msgs: list[dict]) -> str:
    """Serialize store messages into MCP chat_read output shape."""
    out = []
    for m in msgs:
        entry = {
            "id": m["id"],
            "sender": m["sender"],
            "text": m["text"],
            "type": m["type"],
            "time": m["time"],
            "channel": m.get("channel", "general"),
        }
        if m.get("attachments"):
            try:
                atts = m["attachments"]
                if isinstance(atts, str):
                    atts = json.loads(atts)
                if atts:
                    entry["attachments"] = atts
            except Exception:
                pass
        if m.get("reply_to") is not None:
            entry["reply_to"] = m["reply_to"]
        out.append(entry)
    return json.dumps(out, ensure_ascii=False) if out else ""


def _trigger_mentions(sender: str, text: str, channel: str):
    """Parse @mentions and write to agent queue files to trigger them."""
    import re
    mentions = re.findall(r"@(\w[\w-]*)", text)
    if not mentions or not _data_dir:
        return

    agent_names = []
    if _registry:
        agent_names = [inst.name for inst in _registry.get_all()]

    if _router:
        targets = _router.get_targets(sender, text, channel, agent_names)
    else:
        if "all" in mentions:
            targets = [n for n in agent_names if n != sender]
        else:
            targets = [m for m in mentions if m in agent_names and m != sender]

    for target in targets:
        queue_file = _data_dir / f"{target}_queue.jsonl"
        try:
            with open(queue_file, "a", encoding="utf-8") as f:
                f.write(json.dumps({"channel": channel}) + "\n")
        except Exception as e:
            log.warning(f"Failed to write queue for {target}: {e}")


# ── MCP Instructions ───────────────────────────────────────────────

_INSTRUCTIONS = (
    "AI Chattr — a shared chat channel for coordinating development between AI agents and humans. "
    "Use chat_send to post messages. Use chat_read to check recent messages. "
    "Use chat_join when you start a session to announce your presence. "
    "Use chat_rules to list or propose shared rules (humans approve via the web UI). "
    "Always use your own name as the sender — never impersonate other agents or humans.\n\n"
    "CRITICAL — Sender Identity Rules:\n"
    "Your BASE agent identity (used for chat_read) is:\n"
    "  - Anthropic products (Claude Code, etc.) → base: \"claude\"\n"
    "  - OpenAI products (Codex CLI, etc.) → base: \"codex\"\n"
    "  - Google products (Gemini CLI, etc.) → base: \"gemini\"\n"
    "  - Humans use their own name (e.g. \"user\")\n"
    "Do NOT use your CLI tool name — use the base name above.\n"
    "If chat_send rejects your sender, call chat_claim(sender='your_base_name') and use the confirmed_name "
    "as your sender for ALL subsequent tool calls.\n\n"
    "CRITICAL — Always Respond In Chat:\n"
    "When addressed in a chat message (@yourname or @all agents), you MUST respond using chat_send "
    "in the same channel. NEVER respond only in your terminal/console output. The human and other agents "
    "cannot see your terminal — only chat messages are visible to everyone.\n\n"
    "CRITICAL — Token-Aware Reading:\n"
    "Each chat_read call costs tokens. Default: one read per relevant channel per turn. "
    "After an empty read ('No new messages'), do NOT read the same channel again — "
    "stop and wait for your next prompt. Never use chat_read as a sleep/wait loop.\n\n"
    "Rules are shared working style for agents. At session start, call chat_rules(action='list') to read active rules. "
    "When you notice a repeated correction or convention, propose it as a rule via chat_rules(action='propose').\n\n"
    "Messages belong to channels (default: 'general'). Use the 'channel' parameter in chat_send and "
    "chat_read to target a specific channel.\n\n"
    "If you are addressed in chat, respond in chat — use chat_send to reply in the same channel. "
    "Do not take the answer back to your terminal session.\n\n"
    "Jobs are bounded work conversations — like threads with status tracking. "
    "When triggered with job_id=N, use chat_read(job_id=N) to read the job conversation. "
    "Then use chat_send(job_id=N, message='...') to reply within it.\n\n"
    "CRITICAL — Proposing Jobs:\n"
    "Only propose jobs using chat_propose_job when explicitly asked by the user, OR when the request is a clearly scoped task "
    "with concrete outcome, specific boundary, clear done criteria, and appropriate size."
)


# ── MCP Tool implementations ───────────────────────────────────────

def chat_send(
    sender: str,
    message: str,
    channel: str = "general",
    choices: list[str] = [],
    reply_to: int = -1,
    job_id: int = 0,
    ctx: Context | None = None,
) -> str:
    """Send a message to the AI Chattr chat room.

    Args:
        sender: Your agent name (claude/codex/gemini)
        message: The message text
        channel: Channel to post in (default: general)
        choices: For yes/no or multiple-choice questions, provide options.
                 For normal messages, pass choices=[].
        reply_to: Message ID to reply to (-1 for no reply)
        job_id: Post into a job conversation instead of main timeline (0 = main)
    """
    sender, err = _resolve_identity(sender, ctx, field_name="sender", required=True)
    if err:
        return err
    if not message.strip():
        return "Empty message, not sent."

    # Job-scoped send
    if job_id and _job_store:
        job = _run_async(_job_store._get_by_id(job_id))
        if not job:
            return f"Error: job #{job_id} not found."
        # For now, post as a regular message in the job's channel with job context
        msg = _run_async(_store.add(
            sender=sender,
            text=message.strip(),
            channel=job.get("channel", channel),
            metadata=json.dumps({"job_id": job_id}),
        ))
        with _presence_lock:
            _presence[sender] = time.time()
        _trigger_mentions(sender, message, job.get("channel", channel))
        return f"Sent to job #{job_id} (id={msg['id']})"

    reply_id = reply_to if reply_to >= 0 else None

    # Determine message type based on choices
    msg_type = "chat"
    metadata = "{}"
    clean_choices = [c for c in (choices if choices else []) if isinstance(c, str) and c.strip()]
    if clean_choices:
        msg_type = "decision"
        metadata = json.dumps({"choices": clean_choices, "resolved": False})

    msg = _run_async(_store.add(
        sender=sender,
        text=message.strip(),
        channel=channel,
        reply_to=reply_id,
        msg_type=msg_type,
        metadata=metadata,
    ))
    _update_cursor(sender, [msg], channel)

    with _presence_lock:
        _presence[sender] = time.time()

    # Trigger routing for @mentions
    _trigger_mentions(sender, message, channel)

    # Clear thinking state when agent sends a message
    if _registry:
        inst = _registry.get(sender)
        if inst and inst.state == "thinking":
            inst.state = "active"
            try:
                inst._think_ts = 0  # type: ignore[attr-defined]
            except Exception:
                pass

    return f"Sent (id={msg['id']})"


def chat_read(
    sender: str = "",
    since_id: int = 0,
    limit: int = 20,
    channel: str = "",
    job_id: int = 0,
    ctx: Context | None = None,
) -> str:
    """Read chat messages. Returns JSON array with: id, sender, text, type, time, channel.

    Smart defaults:
    - First call with sender: returns last `limit` messages (full context).
    - Subsequent calls with same sender: returns only NEW messages since last read.
    - Pass since_id to override and read from a specific point.
    - Omit sender to always get the last `limit` messages (no cursor).
    - Pass channel to filter by channel name (default: all channels).
    - Pass job_id to read a specific job conversation."""
    sender, err = _resolve_identity(sender, ctx, field_name="sender", required=False)
    if err and sender == "":
        pass  # Allow anonymous reads

    # Job-scoped read
    if job_id and _job_store:
        job = _run_async(_job_store._get_by_id(job_id))
        if not job:
            return f"Error: job #{job_id} not found."
        title = (job.get("title") or "").strip()
        body = (job.get("body") or "").strip()
        header_text = f"Job: {title}" if title else f"Job #{job_id}"
        if body:
            header_text += f"\nDescription: {body}"
        out = [{
            "id": -1,
            "sender": "system",
            "text": header_text,
            "type": "job_header",
            "time": "",
            "job_id": job_id,
            "title": title,
            "body": body,
            "status": job.get("status", ""),
            "channel": job.get("channel", ""),
        }]
        return json.dumps(out, ensure_ascii=False)

    ch = channel if channel else "general"

    if since_id:
        msgs = _run_async(_store.get_since(since_id, ch))
    elif sender:
        ch_key = ch
        with _cursors_lock:
            agent_cursors = _cursors.get(sender, {})
            cursor = agent_cursors.get(ch_key, 0)
        if cursor:
            msgs = _run_async(_store.get_since(cursor, ch))
        else:
            msgs = _run_async(_store.get_recent(limit, ch))
    else:
        msgs = _run_async(_store.get_recent(limit, ch))

    msgs = msgs[-limit:]
    _update_cursor(sender, msgs, ch)
    serialized = _serialize_messages(msgs)

    # Escalating empty-read hints to discourage polling loops
    if not serialized and sender:
        _empty_read_count[sender] = _empty_read_count.get(sender, 0) + 1
        n = _empty_read_count[sender]
        if n == 1:
            serialized = "No new messages. Do not poll — wait for your next prompt."
        elif n == 2:
            serialized = ("No new messages. You have read with no results twice — "
                          "stop polling and wait for a trigger.")
        else:
            serialized = ("No new messages. STOP. Repeated empty reads waste tokens. "
                          "Wait for your next prompt.")
    elif sender:
        _empty_read_count[sender] = 0

    return serialized


def chat_join(name: str, channel: str = "general", ctx: Context | None = None) -> str:
    """Announce that you've connected to AI Chattr."""
    name, err = _resolve_identity(name, ctx, field_name="name", required=True)
    if err:
        return err

    _run_async(_store.add(sender=name, text=f"{name} is online", msg_type="join", channel="general"))
    online = _get_online()
    return f"Joined. Online: {', '.join(online)}"


def chat_who(ctx: Context | None = None) -> str:
    """Check who's currently online in AI Chattr."""
    online = _get_online()
    return f"Online: {', '.join(online)}" if online else "Nobody online."


def chat_channels(ctx: Context | None = None) -> str:
    """List all available channels. Returns a JSON array of channel names."""
    channels = _settings.get("channels", ["general"]) if _settings else ["general"]
    return json.dumps(channels)


def chat_rules(
    action: str,
    sender: str = "",
    rule: str = "",
    reason: str = "",
    channel: str = "general",
    ctx: Context | None = None,
) -> str:
    """Manage shared rules — the working style for your agents.

    Actions:
      - list: Returns active rules (the current working style).
      - propose: Propose a new rule for human approval. Requires rule text + sender.

    Agents cannot activate, edit, or delete rules — only humans can do that from the web UI."""
    sender, _ = _resolve_identity(sender, ctx, field_name="sender", required=False)
    action = action.strip().lower()

    if action == "list":
        if not _rule_store:
            return "Rules not configured."
        active = _run_async(_rule_store.active_list())
        if not active["rules"]:
            return "No active rules."
        lines = [f"Active rules (epoch {active['epoch']}):"]
        for i, r in enumerate(active["rules"], 1):
            lines.append(f"  {i}. {r}")
        return "\n".join(lines)

    if action == "propose":
        if not rule.strip():
            return "Error: rule text is required."
        if not sender.strip():
            return "Error: sender is required."
        if not _rule_store:
            return "Rules not configured."
        result = _run_async(_rule_store.propose(rule, sender, reason))
        if result is None:
            return "Error: too many rules."
        # Add proposal card to chat timeline
        if _store:
            _run_async(_store.add(
                sender=sender,
                text=f"Rule proposal: {result['text']}",
                msg_type="rule_proposal",
                channel=channel or "general",
                metadata=json.dumps({"rule_id": result["id"], "text": result["text"], "status": "pending"}),
            ))
        return f"Proposed rule #{result['id']}: '{result['text']}'. Human will review in the Rules panel."

    if action in ("activate", "edit", "delete"):
        return f"Error: '{action}' is only available to humans via the web UI."

    return f"Unknown action: {action}. Valid actions: list, propose."


def chat_propose_job(
    sender: str,
    title: str,
    body: str = "",
    channel: str = "general",
    ctx: Context | None = None,
) -> str:
    """Propose a job for human approval. Posts a proposal card in the timeline.
    The human can Accept (creates the job) or Dismiss.

    Args:
        sender: Your agent name
        title: Short job title (max 80 chars)
        body: Detailed description of the work (max 1000 chars)
        channel: Channel to post the proposal in
    """
    sender, err = _resolve_identity(sender, ctx, field_name="sender", required=True)
    if err:
        return err
    if not title.strip():
        return "Error: title is required."
    title = title.strip()[:80]
    body = (body or "").strip()[:1000]

    msg = _run_async(_store.add(
        sender=sender,
        text=f"Job proposal: {title}",
        msg_type="job_proposal",
        channel=channel,
        metadata=json.dumps({"title": title, "body": body, "status": "pending"}),
    ))
    _update_cursor(sender, [msg], channel)
    with _presence_lock:
        _presence[sender] = time.time()
    return f"Proposed job (msg_id={msg['id']}): {title}"


def chat_react(
    message_id: int,
    emoji: str,
    sender: str = "",
    ctx: Context | None = None,
) -> str:
    """React to a chat message with an emoji. Toggles the reaction (add/remove).

    Args:
        message_id: The message ID to react to
        emoji: The emoji to react with (e.g. "👍", "❤️", "🎉", "👀", "🔥", "✅")
        sender: Your agent name (claude/codex/gemini)
    """
    sender, err = _resolve_identity(sender, ctx, field_name="sender", required=True)
    if err:
        return err
    if not emoji.strip():
        return "Error: emoji is required."
    reactions = _run_async(_store.react(message_id, emoji.strip(), sender))
    if reactions is None:
        return f"Error: message #{message_id} not found."
    # Broadcast via HTTP to the main server
    import urllib.request
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{_server_port}/api/messages/{message_id}/react",
            data=json.dumps({"emoji": emoji.strip(), "sender": sender}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass  # Direct DB update already done; broadcast is best-effort
    return f"Reacted {emoji} to message #{message_id}"


def chat_claim(sender: str, name: str = "", ctx: Context | None = None) -> str:
    """Claim your identity in a multi-instance setup.

    - Without name: accept the auto-assigned identity and unlock chat_send.
    - With name: reclaim a previous identity (e.g. after /resume).

    Your sender must be your current registered name."""
    sender, err = _resolve_identity(sender, ctx, field_name="sender", required=True)
    if err:
        return err
    if not _registry:
        return "Error: registry not available."

    # Simple claim: confirm the current identity
    inst = _registry.get(sender)
    if inst:
        _touch_presence(sender)
        return json.dumps({"confirmed_name": inst.name, "label": inst.label, "base": inst.base})

    return f"Error: '{sender}' is not registered."


# ── Server setup ────────────────────────────────────────────────────

_ALL_TOOLS = [
    chat_send, chat_read, chat_join, chat_who, chat_channels,
    chat_rules, chat_propose_job, chat_react, chat_claim,
]

MCP_HTTP_PORT = 8200
MCP_SSE_PORT = 8201


def _create_server(port: int) -> FastMCP:
    server = FastMCP(
        "aichttr",
        host="127.0.0.1",
        port=port,
        log_level="ERROR",
        instructions=_INSTRUCTIONS,
    )
    for func in _ALL_TOOLS:
        server.tool()(func)
    return server


mcp_http = _create_server(MCP_HTTP_PORT)
mcp_sse = _create_server(MCP_SSE_PORT)


def run_http_server():
    """Block — run streamable-http MCP in a background thread."""
    _ensure_loop()
    log.info(f"MCP HTTP bridge starting on port {MCP_HTTP_PORT}")
    mcp_http.run(transport="streamable-http")


def run_sse_server():
    """Block — run SSE MCP in a background thread."""
    _ensure_loop()
    log.info(f"MCP SSE bridge starting on port {MCP_SSE_PORT}")
    mcp_sse.run(transport="sse")


# Backward compat — single server entry point
MCP_PORT = MCP_HTTP_PORT


def run_server():
    """Block — run the MCP streamable-HTTP server (backward compat)."""
    run_http_server()
