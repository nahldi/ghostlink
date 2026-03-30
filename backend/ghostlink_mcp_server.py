#!/usr/bin/env python3
"""GhostLink MCP Server — standalone headless entry point.

Boots the core GhostLink backend (SQLite, message store, registry, MCP tools)
and exposes it as an MCP server. Any MCP client (Claude Code, Codex, Gemini CLI,
Cursor, etc.) can connect and use GhostLink's 37+ tools.

Usage:
    # stdio mode (for MCP client config):
    python ghostlink_mcp_server.py

    # HTTP mode (for browser/remote clients):
    python ghostlink_mcp_server.py --http --port 8200

    # SSE mode (for Gemini CLI):
    python ghostlink_mcp_server.py --sse --port 8201

Add to Claude Code's MCP config:
    {
        "mcpServers": {
            "ghostlink": {
                "command": "python",
                "args": ["/path/to/ghostlink/backend/ghostlink_mcp_server.py"]
            }
        }
    }
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path

# Ensure backend modules are importable
sys.path.insert(0, str(Path(__file__).parent))

log = logging.getLogger("ghostlink-mcp")


async def init_core_services(data_dir: Path, port: int = 8300):
    """Boot the minimal set of core services needed for MCP tools."""
    import aiosqlite
    import deps
    from store import MessageStore
    from jobs import JobStore
    from rules import RuleStore
    from schedules import ScheduleStore
    from registry import AgentRegistry
    from router import MessageRouter

    # Create data directory
    data_dir.mkdir(parents=True, exist_ok=True)

    # Initialize SQLite stores
    db_path = data_dir / "ghostlink_v2.db"
    store = MessageStore(db_path)
    await store.init()

    db = await aiosqlite.connect(str(db_path))
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA busy_timeout=5000")
    job_store = JobStore(db)
    await job_store.init()
    rule_store = RuleStore(db)
    await rule_store.init()
    schedule_store = ScheduleStore(db)
    await schedule_store.init()

    # Core registries
    registry = AgentRegistry()
    router = MessageRouter()

    # Load settings
    settings_path = data_dir / "settings.json"
    settings: dict = {}
    if settings_path.exists():
        try:
            settings = json.loads(settings_path.read_text("utf-8"))
        except Exception:
            pass

    # Publish to deps
    deps.DATA_DIR = data_dir
    deps.BASE_DIR = data_dir.parent
    deps.store = store
    deps.job_store = job_store
    deps.rule_store = rule_store
    deps.schedule_store = schedule_store
    deps.registry = registry
    deps.router_inst = router
    deps._settings = settings

    # Optional services — load if available, skip gracefully if not
    for attr, mod_name, cls_name, args in [
        ("skills_registry", "skills", "SkillsRegistry", (data_dir,)),
        ("session_manager", "sessions", "SessionManager", (data_dir,)),
        ("branch_manager", "branches", "BranchManager", (data_dir,)),
        ("secrets_manager", "secrets", "SecretsManager", (data_dir,)),
        ("provider_registry", "providers", "ProviderRegistry", (data_dir,)),
        ("hook_manager", "hooks", "HookManager", (data_dir,)),
        ("exec_policy", "exec_policy", "ExecPolicy", (data_dir,)),
        ("audit_log", "audit", "AuditLog", (data_dir,)),
        ("data_manager", "data_manager", "DataManager", (data_dir,)),
    ]:
        try:
            mod = __import__(mod_name)
            cls = getattr(mod, cls_name)
            if cls_name == "HookManager":
                inst = cls(data_dir, server_port=port)
                inst.register_all()
            elif cls_name == "DataManager":
                inst = cls(data_dir, store=store)
            else:
                inst = cls(*args)
            setattr(deps, attr, inst)
        except Exception as e:
            log.debug("Optional service %s not available: %s", attr, e)

    return store, registry, settings, rule_store, job_store, router


def run_stdio(data_dir: Path, port: int):
    """Run GhostLink MCP server in stdio mode (stdin/stdout JSON-RPC)."""
    import mcp_bridge

    async def _main():
        store, registry, settings, rule_store, job_store, router = await init_core_services(data_dir, port)

        # Configure MCP bridge with core services
        mcp_bridge.configure(
            store=store,
            registry=registry,
            settings=settings,
            data_dir=data_dir,
            server_port=port,
            rule_store=rule_store,
            job_store=job_store,
            router=router,
        )

        # Create the MCP server
        mcp_bridge._init_servers()
        server = mcp_bridge._mcp_http

        if server is None:
            log.error("Failed to create MCP server")
            sys.exit(1)

        log.info("GhostLink MCP server starting (stdio mode)")
        log.info("  Data: %s", data_dir)
        log.info("  Tools: %d", len(mcp_bridge._ALL_TOOLS))

        # Run in stdio transport — use async version to avoid nested event loop
        await server.run_stdio_async()

    asyncio.run(_main())


def run_http(data_dir: Path, port: int, host: str):
    """Run GhostLink MCP server in HTTP mode."""
    import mcp_bridge

    async def _main():
        store, registry, settings, rule_store, job_store, router = await init_core_services(data_dir, port)

        mcp_bridge.configure(
            store=store,
            registry=registry,
            settings=settings,
            data_dir=data_dir,
            server_port=port,
            rule_store=rule_store,
            job_store=job_store,
            router=router,
            mcp_http_port=port,
        )

        mcp_bridge._init_servers()
        print(f"GhostLink MCP server running on http://{host}:{port}")
        print(f"  Tools: {len(mcp_bridge._ALL_TOOLS)}")
        print(f"  Data: {data_dir}")
        print(f"  Transport: streamable-http")
        await mcp_bridge._mcp_http.run_streamable_http_async()

    asyncio.run(_main())


def run_sse(data_dir: Path, port: int, host: str):
    """Run GhostLink MCP server in SSE mode."""
    import mcp_bridge

    async def _main():
        store, registry, settings, rule_store, job_store, router = await init_core_services(data_dir, port)

        mcp_bridge.configure(
            store=store,
            registry=registry,
            settings=settings,
            data_dir=data_dir,
            server_port=port,
            rule_store=rule_store,
            job_store=job_store,
            router=router,
            mcp_sse_port=port,
        )

        mcp_bridge._init_servers()
        print(f"GhostLink MCP server running on http://{host}:{port}")
        print(f"  Tools: {len(mcp_bridge._ALL_TOOLS)}")
        print(f"  Data: {data_dir}")
        print(f"  Transport: SSE")
        await mcp_bridge._mcp_sse.run_sse_async()

    asyncio.run(_main())


def main():
    parser = argparse.ArgumentParser(
        description="GhostLink MCP Server — expose GhostLink tools to any MCP client",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # stdio mode (for Claude Code, Codex, etc.):
  python ghostlink_mcp_server.py

  # HTTP mode:
  python ghostlink_mcp_server.py --http --port 8200

  # SSE mode (for Gemini CLI):
  python ghostlink_mcp_server.py --sse --port 8201

  # Custom data directory:
  python ghostlink_mcp_server.py --data-dir ~/.ghostlink/data
""",
    )
    parser.add_argument("--http", action="store_true", help="Run in HTTP transport mode")
    parser.add_argument("--sse", action="store_true", help="Run in SSE transport mode")
    parser.add_argument("--port", type=int, default=8200, help="Port for HTTP/SSE mode (default: 8200)")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind (default: 127.0.0.1)")
    parser.add_argument("--data-dir", type=str, default=None, help="Data directory (default: ./data)")
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging")

    args = parser.parse_args()

    level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        stream=sys.stderr,  # Log to stderr so stdout is clean for stdio transport
    )

    # Determine data directory
    if args.data_dir:
        data_dir = Path(args.data_dir).resolve()
    else:
        # Default: look for existing GhostLink data, or use ./data
        home_ghostlink = Path.home() / ".ghostlink" / "data"
        local_data = Path(__file__).parent / "data"
        if home_ghostlink.exists():
            data_dir = home_ghostlink
        elif local_data.exists():
            data_dir = local_data
        else:
            data_dir = local_data

    if args.http:
        run_http(data_dir, args.port, args.host)
    elif args.sse:
        run_sse(data_dir, args.port, args.host)
    else:
        run_stdio(data_dir, args.port)


if __name__ == "__main__":
    main()
