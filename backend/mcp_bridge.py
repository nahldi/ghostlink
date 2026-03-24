"""MCP server for agent chat tools — runs alongside the web server.

Serves two transports for compatibility:
  - streamable-http on port 8200 (Claude Code, Codex)
  - SSE on port 8201 (Gemini)
"""

try:
    import fcntl
except ImportError:
    fcntl = None  # type: ignore  # Windows: no file locking
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

def cleanup_agent(name: str):
    """Remove all tracked state for a deregistered agent."""
    with _presence_lock:
        _presence.pop(name, None)
        _activity.pop(name, None)
        _activity_ts.pop(name, None)
    with _cursors_lock:
        _cursors.pop(name, None)


def configure(
    store,
    registry,
    settings: dict,
    data_dir: Path,
    server_port: int = 8300,
    rule_store=None,
    job_store=None,
    router=None,
    mcp_http_port: int = 0,
    mcp_sse_port: int = 0,
):
    """Called before server start to inject dependencies."""
    global _store, _registry, _settings, _data_dir, _server_port
    global _rule_store, _job_store, _router
    global MCP_HTTP_PORT, MCP_SSE_PORT, MCP_PORT
    _store = store
    _registry = registry
    _settings = settings
    _data_dir = data_dir
    _server_port = server_port
    _rule_store = rule_store
    _job_store = job_store
    _router = router
    if mcp_http_port:
        MCP_HTTP_PORT = mcp_http_port
        MCP_PORT = mcp_http_port
    if mcp_sse_port:
        MCP_SSE_PORT = mcp_sse_port


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
    """Run an async coroutine from sync context using our dedicated loop.

    Times out after 5 seconds to prevent MCP tool handlers from blocking indefinitely
    if the main event loop is slow or a broadcast callback hangs (backpressure guard).
    """
    import concurrent.futures
    _ensure_loop()
    future = asyncio.run_coroutine_threadsafe(coro, _loop)
    try:
        return future.result(timeout=5)
    except concurrent.futures.TimeoutError:
        future.cancel()
        log.warning("_run_async: coroutine timed out after 5s (backpressure)")
        raise TimeoutError("MCP bridge async operation timed out")


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
    except Exception as e:
        log.debug("Failed to extract agent token: %s", e)
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
            if inst.is_token_expired():
                return "", "Error: token expired. Send a heartbeat to rotate."
            _touch_presence(inst.name)
            return inst.name, None
        return "", "Error: stale or unknown token. Re-register and retry."

    # Fallback to raw name — only allowed for human names
    if not provided:
        if required:
            return "", f"Error: {field_name} is required."
        return "", None

    _HUMAN_NAMES = {"you", "user", "human", "admin"}
    if provided.lower() in _HUMAN_NAMES:
        _touch_presence(provided)
        return provided, None

    # Non-human names (agents) MUST authenticate with a bearer token
    if _registry and _registry.get(provided):
        return "", f"Error: '{provided}' is a registered agent — use bearer token authentication."

    return "", f"Error: '{provided}' is not a registered agent. Register first."


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
            except Exception as e:
                log.debug("Failed to parse attachments for msg %s: %s", m.get("id"), e)
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
                if fcntl:
                    fcntl.flock(f.fileno(), fcntl.LOCK_EX)
                    try:
                        f.write(json.dumps({"channel": channel}) + "\n")
                    finally:
                        fcntl.flock(f.fileno(), fcntl.LOCK_UN)
                else:
                    f.write(json.dumps({"channel": channel}) + "\n")
        except Exception as e:
            log.warning(f"Failed to write queue for {target}: {e}")


# ── MCP Instructions ───────────────────────────────────────────────

_INSTRUCTIONS = (
    "GhostLink — a shared chat channel for coordinating development between AI agents and humans. "
    "Use chat_send to post messages. Use chat_read to check recent messages. "
    "Use chat_join when you start a session to announce your presence. "
    "Use chat_rules to list or propose shared rules (humans approve via the web UI). "
    "Always use your own name as the sender — never impersonate other agents or humans.\n\n"
    "CRITICAL — Agent Identity & Isolation:\n"
    "You have a unique agent name assigned by GhostLink (e.g., 'claude', 'claude-2', 'codex'). "
    "This is YOUR identity — always use it as your sender name. Never claim to be a different agent.\n"
    "Your memory, notes, and soul are scoped to YOUR agent directory. You cannot access other agents' data. "
    "When you call memory_save/load, the system automatically scopes to YOUR storage. "
    "Do NOT attempt to read or modify another agent's files, memories, notes, or soul.\n"
    "If multiple instances of the same model are running (e.g., claude and claude-2), each has a SEPARATE identity. "
    "Do not confuse yourself with other instances.\n\n"
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
    "CRITICAL — Token Efficiency:\n"
    "Each chat_read call costs tokens. Be efficient:\n"
    "  - ONE read per channel per turn. Never loop or poll.\n"
    "  - After an empty read ('No new messages'), STOP. Wait for your next prompt.\n"
    "  - Keep your responses concise and focused. Don't repeat the question back.\n"
    "  - Use chat_read with the channel parameter to only read relevant channels.\n"
    "  - The system compresses old messages automatically — you don't need full history.\n\n"
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
    """Send a message to the GhostLink chat room.

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

    # Don't force-clear thinking — heartbeat activity monitor is the source of truth.
    # If agent is still working after sending, glow stays. If idle, heartbeat clears it.

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

    # Smart context compression: if this is a first read (no cursor) with many messages,
    # compress older messages into a summary to save tokens
    COMPRESS_THRESHOLD = 30  # Only compress if more than this many messages
    KEEP_RECENT = 15  # Always keep the most recent N messages in full
    if len(msgs) > COMPRESS_THRESHOLD and not since_id:
        old_msgs = msgs[:-KEEP_RECENT]
        recent_msgs = msgs[-KEEP_RECENT:]
        # Build a compressed summary of old messages
        senders = {}
        topics = []
        for m in old_msgs:
            s = m.get("sender", "unknown")
            senders[s] = senders.get(s, 0) + 1
            # Extract key info from longer messages
            text = m.get("text", "")
            if len(text) > 50:
                topics.append(f"[{s}] {text[:80]}...")
        summary_lines = [f"--- Context summary ({len(old_msgs)} earlier messages) ---"]
        summary_lines.append(f"Participants: {', '.join(f'{k} ({v} msgs)' for k, v in senders.items())}")
        if topics:
            summary_lines.append("Key messages:")
            for t in topics[:8]:  # Max 8 topic previews
                summary_lines.append(f"  {t}")
        summary_lines.append("--- End summary (recent messages follow) ---")
        summary_msg = {
            "id": 0, "sender": "system", "text": "\n".join(summary_lines),
            "type": "system", "time": "", "channel": ch,
        }
        msgs = [summary_msg] + recent_msgs

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
    """Announce that you've connected to GhostLink."""
    name, err = _resolve_identity(name, ctx, field_name="name", required=True)
    if err:
        return err

    _run_async(_store.add(sender=name, text=f"{name} is online", msg_type="join", channel="general"))
    online = _get_online()
    return f"Joined. Online: {', '.join(online)}"


def chat_who(ctx: Context | None = None) -> str:
    """Check who's currently online in GhostLink."""
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


def chat_progress(
    sender: str,
    channel: str = "general",
    title: str = "",
    steps: list[str] = [],
    current: int = 0,
    total: int = 0,
    message_id: int = 0,
    ctx: Context | None = None,
) -> str:
    """Report progress on a multi-step task. Shows a live-updating progress card in the chat.

    Args:
        sender: Your agent name
        channel: Channel to post in
        title: Short title for the progress (e.g. "Building auth module")
        steps: List of step labels (e.g. ["Planning", "Coding", "Testing", "Deploying"])
        current: Current step number (1-indexed)
        total: Total number of steps
        message_id: If updating an existing progress card, pass its message ID. 0 = create new.
    """
    sender, err = _resolve_identity(sender, ctx, field_name="sender", required=True)
    if err:
        return err

    step_data = []
    for i, label in enumerate(steps):
        if i + 1 < current:
            step_data.append({"label": label, "status": "done"})
        elif i + 1 == current:
            step_data.append({"label": label, "status": "active"})
        else:
            step_data.append({"label": label, "status": "pending"})

    metadata = json.dumps({
        "progress": {
            "steps": step_data,
            "current": current,
            "total": total or len(steps),
            "title": title,
        }
    })

    if message_id:
        # Update existing progress message
        _run_async(_store._db.execute(
            "UPDATE messages SET metadata = ? WHERE id = ?",
            (metadata, message_id),
        ))
        _run_async(_store._db.commit())
        # Broadcast the metadata update to all WebSocket clients
        try:
            import urllib.request
            body = json.dumps({"metadata": metadata}).encode()
            req = urllib.request.Request(
                f"http://127.0.0.1:{_server_port}/api/messages/{message_id}/progress-update",
                data=body, method="POST",
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=3)
        except Exception as e:
            log.debug("Progress broadcast failed: %s", e)
        return f"Updated progress (id={message_id}): step {current}/{total or len(steps)}"

    msg = _run_async(_store.add(
        sender=sender,
        text=title or "Progress",
        channel=channel,
        msg_type="progress",
        metadata=metadata,
    ))
    return f"Progress card created (id={msg['id']}): step {current}/{total or len(steps)}"


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
    except Exception as e:
        log.debug("Reaction broadcast best-effort failed: %s", e)
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


# ── Memory tools ─────────────────────────────────────────────────────

def memory_save(sender: str, key: str, content: str) -> str:
    """Save a memory entry. Use this to remember important information across sessions.

    Args:
        sender: Your agent name (used to scope the memory to your identity)
        key: Short descriptive key (e.g. 'project_goals', 'user_preferences')
        content: The content to remember (text, notes, data)

    Returns:
        Confirmation of saved memory
    """
    identity, err = _resolve_identity(sender, None, field_name="sender", required=True)
    if err:
        return err
    from agent_memory import get_agent_memory
    mem = get_agent_memory(_data_dir, identity)
    result = mem.save(key, content)
    return f"Saved memory '{key}' ({len(content)} chars)"


def memory_search(sender: str, query: str) -> str:
    """Search your memory entries by keyword. Returns matching entries.

    Args:
        sender: Your agent name
        query: Search term to find in memory keys and content

    Returns:
        JSON array of matching memory entries with key, content preview, and timestamps
    """
    identity, err = _resolve_identity(sender, None, field_name="sender", required=True)
    if err:
        return err
    from agent_memory import get_agent_memory
    mem = get_agent_memory(_data_dir, identity)
    results = mem.search(query)
    if not results:
        return "No memories match that query."
    entries = []
    for r in results[:10]:
        entries.append({
            "key": r["key"],
            "preview": r["content"][:200] + ("..." if len(r["content"]) > 200 else ""),
            "updated_at": r.get("updated_at"),
        })
    return json.dumps(entries, indent=2)


def memory_get(sender: str, key: str) -> str:
    """Retrieve a specific memory entry by its key.

    Args:
        sender: Your agent name
        key: The exact key of the memory to retrieve

    Returns:
        The full content of the memory entry, or error if not found
    """
    identity, err = _resolve_identity(sender, None, field_name="sender", required=True)
    if err:
        return err
    from agent_memory import get_agent_memory
    mem = get_agent_memory(_data_dir, identity)
    entry = mem.load(key)
    if not entry:
        return f"Memory '{key}' not found."
    return entry["content"]


def memory_list(sender: str) -> str:
    """List all your memory entries (keys and sizes, not full content).

    Args:
        sender: Your agent name

    Returns:
        JSON array of memory keys with sizes
    """
    identity, err = _resolve_identity(sender, None, field_name="sender", required=True)
    if err:
        return err
    from agent_memory import get_agent_memory
    mem = get_agent_memory(_data_dir, identity)
    entries = mem.list_all()
    if not entries:
        return "No memories stored yet."
    items = [{"key": e["key"], "size": e.get("size", 0)} for e in entries]
    return json.dumps(items, indent=2)


# ── Web & Browser tools ──────────────────────────────────────────────

def web_fetch(url: str, extract: str = "text") -> str:
    """Fetch a URL and return its content. Use for reading web pages, APIs, docs.

    Args:
        url: The URL to fetch (must start with http:// or https://)
        extract: What to extract — "text" (readable text), "html" (raw HTML), "json" (parse as JSON)

    Returns:
        The fetched content (truncated to 50KB for safety)
    """
    import urllib.request
    import urllib.error
    from html.parser import HTMLParser

    if not url.startswith(("http://", "https://")):
        return "Error: URL must start with http:// or https://"

    # Block private/internal IPs (handles hex, octal, integer notations via DNS resolution)
    from urllib.parse import urlparse
    import ipaddress, socket
    try:
        parsed_url = urlparse(url)
        hostname = parsed_url.hostname or ""
        if hostname in ("localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"):
            return "Error: Cannot fetch private/local URLs"
        if hostname.endswith(".local") or hostname.endswith(".internal"):
            return "Error: Cannot fetch private/local URLs"
        try:
            ip = socket.gethostbyname(hostname)
            addr = ipaddress.ip_address(ip)
            if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
                return "Error: Cannot fetch private/local URLs"
        except (socket.gaierror, ValueError):
            pass
    except Exception:
        return "Error: Invalid URL"

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "GhostLink/1.3 (Bot)"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read(51200).decode("utf-8", errors="replace")

        if extract == "json":
            return json.dumps(json.loads(raw), indent=2)[:50000]
        elif extract == "html":
            return raw[:50000]
        else:
            # Strip HTML tags for readable text
            class TextExtractor(HTMLParser):
                def __init__(self):
                    super().__init__()
                    self.parts: list[str] = []
                    self._skip = False
                def handle_starttag(self, tag, attrs):
                    if tag in ('script', 'style', 'noscript'):
                        self._skip = True
                def handle_endtag(self, tag):
                    if tag in ('script', 'style', 'noscript'):
                        self._skip = False
                def handle_data(self, data):
                    if not self._skip:
                        t = data.strip()
                        if t:
                            self.parts.append(t)
            parser = TextExtractor()
            parser.feed(raw)
            return "\n".join(parser.parts)[:50000]
    except urllib.error.HTTPError as e:
        return f"HTTP Error {e.code}: {e.reason}"
    except Exception as e:
        return f"Fetch failed: {str(e)[:200]}"


def web_search(query: str, num_results: int = 5) -> str:
    """Search the web using DuckDuckGo. Returns titles, URLs, and snippets.

    Args:
        query: Search query
        num_results: Number of results to return (max 10)

    Returns:
        JSON array of search results with title, url, and snippet
    """
    import urllib.request
    import urllib.parse

    num_results = min(max(num_results, 1), 10)
    encoded = urllib.parse.quote_plus(query)
    url = f"https://html.duckduckgo.com/html/?q={encoded}"

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "GhostLink/1.3 (Bot)"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read(102400).decode("utf-8", errors="replace")

        # Parse DuckDuckGo HTML results
        import re
        results = []
        # Find result blocks
        blocks = re.findall(r'<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)</a>', html, re.DOTALL)
        snippets = re.findall(r'<a[^>]*class="result__snippet"[^>]*>(.*?)</a>', html, re.DOTALL)

        for i, (href, title) in enumerate(blocks[:num_results]):
            # Clean HTML tags from title and snippet
            clean_title = re.sub(r'<[^>]+>', '', title).strip()
            clean_snippet = re.sub(r'<[^>]+>', '', snippets[i]).strip() if i < len(snippets) else ""
            # Decode DuckDuckGo redirect URL
            if "uddg=" in href:
                match = re.search(r'uddg=([^&]+)', href)
                if match:
                    href = urllib.parse.unquote(match.group(1))
            results.append({"title": clean_title, "url": href, "snippet": clean_snippet})

        if not results:
            return f"No results found for: {query}"
        return json.dumps(results, indent=2)
    except Exception as e:
        return f"Search failed: {str(e)[:200]}"


def browser_snapshot(url: str) -> str:
    """Take a screenshot of a web page and return the file path. Requires Playwright.

    Args:
        url: The URL to screenshot

    Returns:
        Path to the saved screenshot image, or error message
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return "Error: Playwright not installed. Run: pip install playwright && playwright install chromium"

    if not url.startswith(("http://", "https://")):
        return "Error: URL must start with http:// or https://"

    screenshot_dir = _data_dir / "screenshots" if _data_dir else Path("./data/screenshots")
    screenshot_dir.mkdir(parents=True, exist_ok=True)
    filename = f"snap-{int(time.time())}.png"
    filepath = screenshot_dir / filename

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1280, "height": 720})
            page.goto(url, timeout=15000, wait_until="domcontentloaded")
            page.screenshot(path=str(filepath), full_page=False)
            browser.close()
        return f"Screenshot saved: {filepath} (1280x720)"
    except Exception as e:
        return f"Screenshot failed: {str(e)[:200]}"


def image_generate(prompt: str, style: str = "natural", provider: str = "auto") -> str:
    """Generate an image from a text description. Auto-detects best available provider.

    Args:
        prompt: Description of the image to generate
        style: Image style — "natural", "artistic", "diagram", "icon"
        provider: Provider to use — "auto" (best available), "google", "openai", "together", "huggingface"

    Returns:
        Path to saved image or URL, or error with setup instructions
    """
    import urllib.request
    import base64

    save_dir = _data_dir / "generated" if _data_dir else Path("./data/generated")
    save_dir.mkdir(parents=True, exist_ok=True)

    # Try providers in priority order
    providers_to_try = []
    if provider != "auto":
        providers_to_try = [provider]
    else:
        # Priority: Gemini Imagen > OpenAI DALL-E > Together FLUX > HuggingFace
        if os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"):
            providers_to_try.append("google")
        if os.environ.get("OPENAI_API_KEY"):
            providers_to_try.append("openai")
        if os.environ.get("TOGETHER_API_KEY"):
            providers_to_try.append("together")
        if os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_API_KEY"):
            providers_to_try.append("huggingface")

    for prov in providers_to_try:
        try:
            if prov == "google":
                key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
                body = json.dumps({
                    "instances": [{"prompt": prompt}],
                    "parameters": {"sampleCount": 1, "aspectRatio": "1:1", "personGeneration": "allow_adult"},
                }).encode()
                req = urllib.request.Request(
                    f"https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key={key}",
                    data=body, headers={"Content-Type": "application/json"},
                )
                with urllib.request.urlopen(req, timeout=60) as resp:
                    result = json.loads(resp.read())
                predictions = result.get("predictions", [])
                if predictions:
                    img_data = base64.b64decode(predictions[0].get("bytesBase64Encoded", ""))
                    filepath = save_dir / f"img-{int(time.time())}.png"
                    filepath.write_bytes(img_data)
                    return f"Image generated (Imagen 4): {filepath}\nPrompt: {prompt}"

            elif prov == "openai":
                key = os.environ.get("OPENAI_API_KEY")
                body = json.dumps({"model": "dall-e-3", "prompt": prompt, "n": 1, "size": "1024x1024",
                                   "style": "vivid" if style == "artistic" else "natural"}).encode()
                req = urllib.request.Request(
                    "https://api.openai.com/v1/images/generations", data=body,
                    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                )
                with urllib.request.urlopen(req, timeout=60) as resp:
                    result = json.loads(resp.read())
                return f"Image generated (DALL-E 3): {result['data'][0]['url']}\nPrompt: {prompt}"

            elif prov == "together":
                key = os.environ.get("TOGETHER_API_KEY")
                body = json.dumps({"model": "black-forest-labs/FLUX.1-schnell-Free", "prompt": prompt,
                                   "width": 1024, "height": 1024, "steps": 4, "n": 1}).encode()
                req = urllib.request.Request(
                    "https://api.together.xyz/v1/images/generations", data=body,
                    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                )
                with urllib.request.urlopen(req, timeout=60) as resp:
                    result = json.loads(resp.read())
                img_b64 = result.get("data", [{}])[0].get("b64_json", "")
                if img_b64:
                    filepath = save_dir / f"img-{int(time.time())}.png"
                    filepath.write_bytes(base64.b64decode(img_b64))
                    return f"Image generated (FLUX.1 Free): {filepath}\nPrompt: {prompt}"

            elif prov == "huggingface":
                key = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_API_KEY")
                req = urllib.request.Request(
                    "https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-dev",
                    data=json.dumps({"inputs": prompt}).encode(),
                    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                )
                with urllib.request.urlopen(req, timeout=120) as resp:
                    img_data = resp.read()
                filepath = save_dir / f"img-{int(time.time())}.png"
                filepath.write_bytes(img_data)
                return f"Image generated (FLUX.1 Dev): {filepath}\nPrompt: {prompt}"

        except Exception as e:
            log.debug("Image gen failed with %s: %s", prov, e)
            continue

    return ("No image generation provider configured. Options:\n"
            "- Set GEMINI_API_KEY for Imagen 4 (Google AI)\n"
            "- Set OPENAI_API_KEY for DALL-E 3\n"
            "- Set TOGETHER_API_KEY for FLUX.1 (free tier available)\n"
            "- Set HF_TOKEN for Hugging Face (free tier available)")


# ── Agent control tools ──────────────────────────────────────────────

def set_thinking(sender: str, level: str = "medium") -> str:
    """Set your thinking/reasoning level. Higher levels = deeper analysis but slower.

    Args:
        sender: Your agent name
        level: Thinking level — "off", "minimal", "low", "medium", "high"

    Returns:
        Confirmation of the new thinking level
    """
    identity, err = _resolve_identity(sender, None, field_name="sender", required=True)
    if err:
        return err
    valid = ("off", "minimal", "low", "medium", "high")
    if level not in valid:
        return f"Invalid level. Choose from: {', '.join(valid)}"
    inst = _registry.get(identity) if _registry else None
    if inst:
        inst.thinkingLevel = level
    return f"Thinking level set to: {level}"


def sessions_list(sender: str) -> str:
    """List all active agent sessions (other agents currently running).

    Args:
        sender: Your agent name

    Returns:
        JSON array of active agents with name, base, state, and role
    """
    identity, err = _resolve_identity(sender, None, field_name="sender", required=True)
    if err:
        return err
    agents = _registry.get_all() if _registry else []
    items = []
    for a in agents:
        items.append({
            "name": a.name,
            "base": a.base,
            "state": a.state,
            "role": getattr(a, "role", ""),
            "responseMode": getattr(a, "responseMode", "mentioned"),
        })
    return json.dumps(items, indent=2) if items else "No agents online."


def sessions_send(sender: str, target: str, message: str, channel: str = "general") -> str:
    """Send a message to another agent's session directly. Use for agent-to-agent coordination.

    Args:
        sender: Your agent name
        target: Target agent name to message
        message: The message text (will be sent as @target in the channel)
        channel: Channel to send in (default "general")

    Returns:
        Confirmation that the message was routed
    """
    identity, err = _resolve_identity(sender, None, field_name="sender", required=True)
    if err:
        return err
    if not _registry or not _registry.get(target):
        return f"Error: Agent '{target}' not found or offline."
    # Send as @mention so routing picks it up
    full_text = f"@{target} {message}"
    result = _run_async(_store.add(sender=identity, text=full_text, msg_type="chat", channel=channel))
    if isinstance(result, dict) and result.get("id"):
        return f"Message sent to @{target} in #{channel}"
    return "Failed to send message."


# ── Gemini AI tools (image gen, video gen, TTS, STT, code exec) ──────

_GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"

def _gemini_api_key() -> str | None:
    return os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")


def _gemini_request(endpoint: str, body: dict, timeout: int = 60) -> dict:
    """Make authenticated request to Gemini API."""
    import urllib.request
    key = _gemini_api_key()
    if not key:
        raise RuntimeError("No GEMINI_API_KEY or GOOGLE_API_KEY set")
    url = f"{_GEMINI_API_BASE}/{endpoint}?key={key}"
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def gemini_image(prompt: str, aspect_ratio: str = "1:1", model: str = "imagen-4.0-generate-001") -> str:
    """Generate an image using Google Imagen 4. Requires GEMINI_API_KEY.

    Args:
        prompt: Description of the image to generate
        aspect_ratio: Image ratio — "1:1", "16:9", "9:16", "3:4", "4:3"
        model: Imagen model — "imagen-4.0-generate-001", "imagen-4.0-ultra-generate-001", "imagen-4.0-fast-generate-001"

    Returns:
        Path to saved image file, or error message
    """
    if not _gemini_api_key():
        return "Error: Set GEMINI_API_KEY or GOOGLE_API_KEY environment variable"

    valid_ratios = ("1:1", "16:9", "9:16", "3:4", "4:3")
    if aspect_ratio not in valid_ratios:
        aspect_ratio = "1:1"

    try:
        result = _gemini_request(f"models/{model}:predict", {
            "instances": [{"prompt": prompt}],
            "parameters": {
                "sampleCount": 1,
                "aspectRatio": aspect_ratio,
                "personGeneration": "allow_adult",
            },
        }, timeout=60)

        predictions = result.get("predictions", [])
        if not predictions:
            return "No image generated. Try a different prompt."

        import base64
        img_data = base64.b64decode(predictions[0].get("bytesBase64Encoded", ""))
        save_dir = _data_dir / "generated" if _data_dir else Path("./data/generated")
        save_dir.mkdir(parents=True, exist_ok=True)
        filepath = save_dir / f"img-{int(time.time())}.png"
        filepath.write_bytes(img_data)
        return f"Image generated: {filepath} ({aspect_ratio})\nPrompt: {prompt}"
    except Exception as e:
        return f"Image generation failed: {str(e)[:300]}"


def gemini_video(prompt: str, duration: str = "8", aspect_ratio: str = "16:9") -> str:
    """Generate a video using Google Veo 3.1. Long-running operation — may take 1-6 minutes.

    Args:
        prompt: Description of the video to generate (include audio/dialogue cues in quotes)
        duration: Video length in seconds — "4", "6", or "8"
        aspect_ratio: Video ratio — "16:9" (landscape) or "9:16" (portrait)

    Returns:
        Path to saved video file, or status message
    """
    if duration not in ("4", "6", "8"):
        return "Error: duration must be '4', '6', or '8' seconds"
    if aspect_ratio not in ("16:9", "9:16"):
        return "Error: aspect_ratio must be '16:9' or '9:16'"
    if not _gemini_api_key():
        return "Error: Set GEMINI_API_KEY or GOOGLE_API_KEY environment variable"

    import urllib.request
    key = _gemini_api_key()

    try:
        # Start generation (long-running operation)
        body = json.dumps({
            "instances": [{"prompt": prompt}],
            "parameters": {
                "aspectRatio": aspect_ratio,
                "resolution": "720p",
                "durationSeconds": duration,
                "personGeneration": "allow_all",
            },
        }).encode()
        url = f"{_GEMINI_API_BASE}/models/veo-3.1-generate-preview:predictLongRunning?key={key}"
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            op = json.loads(resp.read())

        op_name = op.get("name", "")
        if not op_name:
            return "Failed to start video generation."

        # Poll for completion (up to 6 minutes)
        import urllib.request as _ur
        for _ in range(72):  # 72 * 5s = 360s = 6 min
            time.sleep(5)
            poll_url = f"{_GEMINI_API_BASE}/{op_name}?key={key}"
            poll_req = _ur.Request(poll_url)
            with _ur.urlopen(poll_req, timeout=10) as poll_resp:
                status = json.loads(poll_resp.read())
            if status.get("done"):
                response = status.get("response", {})
                videos = response.get("generatedVideos", response.get("predictions", []))
                if videos:
                    import base64
                    raw_b64 = videos[0].get("bytesBase64Encoded") or videos[0].get("video") or ""
                    if not raw_b64:
                        return "Video generation completed but no video data in response."
                    vid_data = base64.b64decode(raw_b64)
                    save_dir = _data_dir / "generated" if _data_dir else Path("./data/generated")
                    save_dir.mkdir(parents=True, exist_ok=True)
                    filepath = save_dir / f"vid-{int(time.time())}.mp4"
                    filepath.write_bytes(vid_data)
                    return f"Video generated: {filepath} ({duration}s, {aspect_ratio})\nPrompt: {prompt}"
                return "Video generation completed but no video data returned."
            if status.get("error"):
                return f"Video generation error: {status['error'].get('message', 'Unknown')}"

        return f"Video generation timed out after 6 minutes. Operation: {op_name}"
    except Exception as e:
        return f"Video generation failed: {str(e)[:300]}"


def text_to_speech(text: str, voice: str = "Kore", model: str = "gemini-2.5-flash-preview-tts") -> str:
    """Convert text to speech using Gemini TTS. Returns path to audio file.

    Args:
        text: Text to speak (max ~5000 chars)
        voice: Voice name — Kore, Puck, Zephyr, Enceladus, Breeze, etc.
        model: TTS model — "gemini-2.5-flash-preview-tts" or "gemini-2.5-pro-preview-tts"

    Returns:
        Path to saved WAV audio file, or error message
    """
    if not _gemini_api_key():
        return "Error: Set GEMINI_API_KEY or GOOGLE_API_KEY environment variable"

    try:
        result = _gemini_request(f"models/{model}:generateContent", {
            "contents": [{"role": "user", "parts": [{"text": text[:5000]}]}],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {
                    "voiceConfig": {
                        "prebuiltVoiceConfig": {"voiceName": voice}
                    }
                },
            },
        }, timeout=30)

        candidates = result.get("candidates", [])
        if not candidates:
            return "No audio generated."

        parts = candidates[0].get("content", {}).get("parts", [])
        for part in parts:
            inline = part.get("inlineData", {})
            if inline.get("data"):
                import base64
                audio_data = base64.b64decode(inline["data"])
                save_dir = _data_dir / "generated" if _data_dir else Path("./data/generated")
                save_dir.mkdir(parents=True, exist_ok=True)
                filepath = save_dir / f"tts-{int(time.time())}.wav"
                filepath.write_bytes(audio_data)
                return f"Audio generated: {filepath} (voice: {voice})"

        return "TTS completed but no audio data returned."
    except Exception as e:
        return f"TTS failed: {str(e)[:300]}"


def speech_to_text(audio_path: str, task: str = "transcribe") -> str:
    """Transcribe or analyze audio using Gemini. Supports WAV, MP3, FLAC, OGG.

    Args:
        audio_path: Path to audio file
        task: What to do — "transcribe", "translate", "summarize", "analyze"

    Returns:
        Transcription or analysis text
    """
    if not _gemini_api_key():
        return "Error: Set GEMINI_API_KEY or GOOGLE_API_KEY environment variable"

    audio_file = Path(audio_path)
    if not audio_file.exists():
        return f"Error: File not found: {audio_path}"

    mime_types = {".wav": "audio/wav", ".mp3": "audio/mp3", ".flac": "audio/flac", ".ogg": "audio/ogg", ".aac": "audio/aac"}
    mime = mime_types.get(audio_file.suffix.lower(), "audio/wav")

    import base64
    audio_data = base64.b64encode(audio_file.read_bytes()).decode()

    prompts = {
        "transcribe": "Transcribe this audio accurately. Include speaker labels if multiple speakers.",
        "translate": "Transcribe and translate this audio to English.",
        "summarize": "Summarize the key points from this audio.",
        "analyze": "Analyze this audio: describe the content, speakers, emotions, and any notable elements.",
    }

    try:
        result = _gemini_request("models/gemini-2.5-flash:generateContent", {
            "contents": [{
                "role": "user",
                "parts": [
                    {"text": prompts.get(task, prompts["transcribe"])},
                    {"inlineData": {"mimeType": mime, "data": audio_data}},
                ],
            }],
        }, timeout=60)

        candidates = result.get("candidates", [])
        if candidates:
            parts = candidates[0].get("content", {}).get("parts", [])
            text_parts = [p["text"] for p in parts if "text" in p]
            return "\n".join(text_parts) if text_parts else "No transcription returned."
        return "No results from audio analysis."
    except Exception as e:
        return f"Speech-to-text failed: {str(e)[:300]}"


def code_execute(code: str, language: str = "python") -> str:
    """Execute code using Gemini's sandboxed code execution. Python only.

    Args:
        code: The code to execute (Python)
        language: Programming language (only "python" supported)

    Returns:
        Code output and any errors
    """
    if not _gemini_api_key():
        return "Error: Set GEMINI_API_KEY or GOOGLE_API_KEY environment variable"

    if language != "python":
        return "Error: Only Python code execution is supported."

    try:
        result = _gemini_request("models/gemini-2.5-flash:generateContent", {
            "contents": [{
                "role": "user",
                "parts": [{"text": f"Execute this Python code and return the output:\n```python\n{code}\n```"}],
            }],
            "tools": [{"codeExecution": {}}],
        }, timeout=45)

        candidates = result.get("candidates", [])
        if not candidates:
            return "No execution result."

        parts = candidates[0].get("content", {}).get("parts", [])
        output_parts = []
        for part in parts:
            if "text" in part:
                output_parts.append(part["text"])
            if "executableCode" in part:
                output_parts.append(f"```python\n{part['executableCode'].get('code', '')}\n```")
            if "codeExecutionResult" in part:
                outcome = part["codeExecutionResult"].get("outcome", "")
                output = part["codeExecutionResult"].get("output", "")
                if outcome == "OUTCOME_OK":
                    output_parts.append(f"Output:\n{output}")
                else:
                    output_parts.append(f"Error ({outcome}):\n{output}")

        return "\n\n".join(output_parts) if output_parts else "Execution completed with no output."
    except Exception as e:
        return f"Code execution failed: {str(e)[:300]}"


# ── Server setup ────────────────────────────────────────────────────

_ALL_TOOLS = [
    # Chat
    chat_send, chat_read, chat_join, chat_who, chat_channels,
    chat_rules, chat_progress, chat_propose_job, chat_react, chat_claim,
    # Memory
    memory_save, memory_search, memory_get, memory_list,
    # Web & Browser
    web_fetch, web_search, browser_snapshot, image_generate,
    # Gemini AI
    gemini_image, gemini_video, text_to_speech, speech_to_text, code_execute,
    # Agent control
    set_thinking, sessions_list, sessions_send,
]

MCP_HTTP_PORT = 8200
MCP_SSE_PORT = 8201

# Lazy-initialized servers — created after configure() sets ports
_mcp_http: FastMCP | None = None
_mcp_sse: FastMCP | None = None


def _create_server(port: int) -> FastMCP:
    server = FastMCP(
        "ghostlink",
        host="127.0.0.1",
        port=port,
        log_level="ERROR",
        instructions=_INSTRUCTIONS,
    )
    for func in _ALL_TOOLS:
        server.tool()(func)
    return server


def _init_servers():
    """Create MCP servers after configure() has set ports."""
    global _mcp_http, _mcp_sse
    if _mcp_http is None:
        _mcp_http = _create_server(MCP_HTTP_PORT)
    if _mcp_sse is None:
        _mcp_sse = _create_server(MCP_SSE_PORT)


def _kill_port(port: int):
    """Try to kill whatever is holding a port."""
    import subprocess
    for cmd in [f"kill $(lsof -ti:{port})", f"fuser -k {port}/tcp"]:
        try:
            subprocess.run(["bash", "-c", cmd], capture_output=True, timeout=3)
        except Exception:
            pass
    import time
    time.sleep(0.5)


def run_http_server():
    """Block — run streamable-http MCP in a background thread."""
    global _mcp_http
    _ensure_loop()
    _init_servers()
    log.info(f"MCP HTTP bridge starting on port {MCP_HTTP_PORT}")
    try:
        _mcp_http.run(transport="streamable-http")
    except OSError as e:
        if "address already in use" in str(e).lower():
            log.warning("Port %d in use — killing stale process and retrying", MCP_HTTP_PORT)
            _kill_port(MCP_HTTP_PORT)
            try:
                _mcp_http = _create_server(MCP_HTTP_PORT)
                _mcp_http.run(transport="streamable-http")
            except Exception as e2:
                log.error("MCP HTTP bridge failed after retry: %s", e2)
        else:
            log.error("MCP HTTP bridge failed: %s", e)


def run_sse_server():
    """Block — run SSE MCP in a background thread."""
    global _mcp_sse
    _ensure_loop()
    _init_servers()
    log.info(f"MCP SSE bridge starting on port {MCP_SSE_PORT}")
    try:
        _mcp_sse.run(transport="sse")
    except OSError as e:
        if "address already in use" in str(e).lower():
            log.warning("Port %d in use — killing stale process and retrying", MCP_SSE_PORT)
            _kill_port(MCP_SSE_PORT)
            try:
                _mcp_sse = _create_server(MCP_SSE_PORT)
                _mcp_sse.run(transport="sse")
            except Exception as e2:
                log.error("MCP SSE bridge failed after retry: %s", e2)
        else:
            log.error("MCP SSE bridge failed: %s", e)


# Backward compat — single server entry point
MCP_PORT = MCP_HTTP_PORT


def run_server():
    """Block — run the MCP streamable-HTTP server (backward compat)."""
    run_http_server()
