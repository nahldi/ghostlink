#!/usr/bin/env python3
"""GhostLink CLI — headless mode for CI/CD and scripting.

Usage:
    ghostlink run -p "review this PR" --agent claude --output json
    ghostlink run -p "fix the bug in auth.py" --channel backend
    ghostlink status
    ghostlink send "hello" --channel general

Output modes:
    --output json    Newline-delimited JSON events to stdout
    --output text    Human-readable text (default)
    --output quiet   Only final result, no intermediate events
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
import os

# Ensure backend modules are importable
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def _create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ghostlink",
        description="GhostLink — Multi-Agent AI Chat Platform (CLI)",
    )
    sub = parser.add_subparsers(dest="command", help="Available commands")

    # ghostlink run
    run_p = sub.add_parser("run", help="Send a prompt to an agent and stream the response")
    run_p.add_argument("-p", "--prompt", required=True, help="The prompt/task to send")
    run_p.add_argument("--agent", default="", help="Target agent (e.g., claude, codex). If omitted, broadcasts to all.")
    run_p.add_argument("--channel", default="general", help="Channel to post in (default: general)")
    run_p.add_argument("--output", choices=["json", "text", "quiet"], default="text", help="Output format")
    run_p.add_argument("--timeout", type=int, default=120, help="Max seconds to wait for response (default: 120)")
    run_p.add_argument("--port", type=int, default=8300, help="Server port (default: 8300)")
    run_p.add_argument("--full-auto", action="store_true", help="Auto-approve all agent permission requests")
    run_p.add_argument("--no-stream", action="store_true", help="Wait for final response only, don't stream intermediate events")

    # ghostlink status
    status_p = sub.add_parser("status", help="Check server and agent status")
    status_p.add_argument("--port", type=int, default=8300, help="Server port")
    status_p.add_argument("--output", choices=["json", "text"], default="text", help="Output format")

    # ghostlink send
    send_p = sub.add_parser("send", help="Send a message (fire and forget)")
    send_p.add_argument("text", help="Message text")
    send_p.add_argument("--channel", default="general", help="Channel")
    send_p.add_argument("--sender", default="CLI", help="Sender name")
    send_p.add_argument("--port", type=int, default=8300, help="Server port")

    # ghostlink agents
    agents_p = sub.add_parser("agents", help="List connected agents")
    agents_p.add_argument("--port", type=int, default=8300, help="Server port")
    agents_p.add_argument("--output", choices=["json", "text"], default="text", help="Output format")

    return parser


async def _http_get(port: int, path: str) -> dict:
    """Make an async HTTP GET request to the local server."""
    import aiohttp
    async with aiohttp.ClientSession() as session:
        async with session.get(f"http://127.0.0.1:{port}{path}", timeout=aiohttp.ClientTimeout(total=10)) as resp:
            return await resp.json()


async def _http_post(port: int, path: str, data: dict) -> dict:
    """Make an async HTTP POST request to the local server."""
    import aiohttp
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"http://127.0.0.1:{port}{path}",
            json=data,
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            return await resp.json()


def _emit(output_mode: str, event_type: str, data: dict):
    """Emit an event to stdout based on output mode."""
    if output_mode == "json":
        print(json.dumps({"type": event_type, "timestamp": time.time(), **data}), flush=True)
    elif output_mode == "text":
        if event_type == "message":
            sender = data.get("sender", "?")
            text = data.get("text", "")
            print(f"[{sender}] {text}", flush=True)
        elif event_type == "status":
            print(f"  {data.get('info', '')}", flush=True)
        elif event_type == "error":
            print(f"ERROR: {data.get('error', '')}", file=sys.stderr, flush=True)


async def cmd_run(args):
    """Send a prompt and stream agent responses."""
    port = args.port
    output = args.output

    # Check server is running
    try:
        status = await _http_get(port, "/api/status")
    except Exception:
        _emit(output, "error", {"error": f"Server not running on port {port}. Start it first."})
        return 1

    _emit(output, "status", {"info": f"Connected to GhostLink on port {port}"})

    # In full-auto mode, auto-approve all pending approval requests
    if args.full_auto:
        _emit(output, "status", {"info": "Full-auto mode: will auto-approve all permission requests"})

    # Build the message text with @mention if agent specified
    text = args.prompt
    if args.agent:
        text = f"@{args.agent} {text}"

    # Get current message count to know where to start polling
    try:
        msgs = await _http_get(port, f"/api/messages?channel={args.channel}&limit=1")
        last_id = msgs["messages"][-1]["id"] if msgs.get("messages") else 0
    except Exception:
        last_id = 0

    # Send the message
    try:
        msg = await _http_post(port, "/api/send", {
            "sender": "CLI",
            "text": text,
            "channel": args.channel,
        })
        _emit(output, "message", {"sender": "CLI", "text": text, "id": msg.get("id")})
    except Exception as e:
        _emit(output, "error", {"error": f"Failed to send: {e}"})
        return 1

    # Poll for responses
    _emit(output, "status", {"info": "Waiting for agent response..."})
    start = time.time()
    seen_ids = {msg.get("id", 0)}
    got_response = False

    while time.time() - start < args.timeout:
        await asyncio.sleep(1)
        try:
            new_msgs = await _http_get(port, f"/api/messages?channel={args.channel}&since_id={last_id}")
            for m in new_msgs.get("messages", []):
                if m["id"] not in seen_ids and m["sender"] != "CLI":
                    seen_ids.add(m["id"])
                    last_id = max(last_id, m["id"])
                    _emit(output, "message", {
                        "sender": m["sender"],
                        "text": m["text"],
                        "id": m["id"],
                        "type": m.get("type", "chat"),
                    })
                    if m.get("type") == "chat" and m["sender"] != "system":
                        got_response = True
        except Exception:
            pass

        # In full-auto mode, auto-approve any pending approval requests
        if args.full_auto:
            try:
                new_msgs_check = await _http_get(port, f"/api/messages?channel={args.channel}&since_id={max(0, last_id - 5)}")
                for m in new_msgs_check.get("messages", []):
                    if m.get("type") == "approval_request" and m["id"] not in seen_ids:
                        await _http_post(port, f"/api/messages/{m['id']}/approve", {"response": "allow"})
                        _emit(output, "status", {"info": f"Auto-approved: {m.get('text', '')[:80]}"})
            except Exception:
                pass

        # If we got a response and no new messages for 5s, assume done
        if got_response and time.time() - start > 10:
            # Check if any agent is still thinking
            try:
                status = await _http_get(port, "/api/status")
                agents = status.get("agents", [])
                thinking = any(a.get("state") == "thinking" for a in agents)
                if not thinking:
                    break
            except Exception:
                break

    if not got_response:
        _emit(output, "status", {"info": "No agent response received (timeout or no agents connected)"})

    return 0


async def cmd_status(args):
    """Show server status."""
    try:
        status = await _http_get(args.port, "/api/status")
        config = await _http_get(args.port, "/api/server-config")
        dashboard = await _http_get(args.port, "/api/dashboard")
    except Exception:
        if args.output == "json":
            print(json.dumps({"running": False, "error": "Server not reachable"}))
        else:
            print(f"Server not running on port {args.port}")
        return 1

    if args.output == "json":
        print(json.dumps({
            "running": True,
            "agents": status.get("agents", []),
            "config": config,
            "dashboard": dashboard,
        }, indent=2))
    else:
        agents = status.get("agents", [])
        print(f"GhostLink v{config.get('server', {}).get('version', '?')} — port {args.port}")
        print(f"Agents online: {len(agents)}")
        for a in agents:
            print(f"  {a['name']} ({a.get('state', '?')})")
        print(f"Messages: {dashboard.get('total_messages', 0)}")
        print(f"Channels: {', '.join(dashboard.get('messages_by_channel', {}).keys()) or 'general'}")
    return 0


async def cmd_send(args):
    """Send a message."""
    try:
        msg = await _http_post(args.port, "/api/send", {
            "sender": args.sender,
            "text": args.text,
            "channel": args.channel,
        })
        print(json.dumps(msg, indent=2) if "--json" in sys.argv else f"Sent: {args.text}")
        return 0
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


async def cmd_agents(args):
    """List agents."""
    try:
        status = await _http_get(args.port, "/api/status")
        agents = status.get("agents", [])
    except Exception:
        print(f"Server not running on port {args.port}", file=sys.stderr)
        return 1

    if args.output == "json":
        print(json.dumps(agents, indent=2))
    else:
        if not agents:
            print("No agents connected")
        else:
            for a in agents:
                state = a.get("state", "unknown")
                print(f"  {a['name']:20s} {state:10s} {a.get('label', '')}")
    return 0


def main():
    parser = _create_parser()
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    cmd_map = {
        "run": cmd_run,
        "status": cmd_status,
        "send": cmd_send,
        "agents": cmd_agents,
    }

    handler = cmd_map.get(args.command)
    if handler:
        exit_code = asyncio.run(handler(args))
        sys.exit(exit_code or 0)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
