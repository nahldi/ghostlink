#!/usr/bin/env python3
"""GhostLink MCP Server — standalone entry point.

Run GhostLink as an MCP server that any AI agent can connect to.
No Electron app needed — just the backend + MCP bridge.

Usage:
    python ghostlink_mcp.py                      # Start with defaults
    python ghostlink_mcp.py --port 8300          # Custom web port
    python ghostlink_mcp.py --mcp-port 8200      # Custom MCP port
    ghostlink-mcp                                 # If installed via npm/pip

This starts:
    1. The FastAPI backend (message store, registry, routing)
    2. The MCP bridge server (37 tools for chat, memory, web, etc.)
    3. WebSocket hub for real-time communication

AI agents connect by adding to their MCP config:
    {
        "mcpServers": {
            "ghostlink": {
                "type": "http",
                "url": "http://127.0.0.1:8200/mcp"
            }
        }
    }
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# Ensure backend is importable
BACKEND_DIR = Path(__file__).parent.resolve()
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def main():
    parser = argparse.ArgumentParser(
        description="GhostLink MCP Server — multi-agent AI chat hub",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s                          Start with default ports (8300/8200/8201)
  %(prog)s --port 9000              Custom API port
  %(prog)s --mcp-port 9200          Custom MCP port
  %(prog)s --data-dir ~/.ghostlink  Custom data directory

Connect from Claude Code:
  Add to ~/.claude/.mcp.json:
  {"mcpServers": {"ghostlink": {"type": "http", "url": "http://127.0.0.1:8200/mcp"}}}
""",
    )
    parser.add_argument("--port", type=int, default=8300, help="API/WebSocket port (default: 8300)")
    parser.add_argument("--mcp-port", type=int, default=8200, help="MCP HTTP port (default: 8200)")
    parser.add_argument("--sse-port", type=int, default=8201, help="MCP SSE port (default: 8201)")
    parser.add_argument("--data-dir", type=str, default=None, help="Data directory (default: backend/data)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--quiet", action="store_true", help="Suppress startup banner")
    args = parser.parse_args()

    # Set port env vars before importing app
    os.environ["PORT"] = str(args.port)
    os.environ["PYTHONUNBUFFERED"] = "1"

    if not args.quiet:
        print(f"""
╔══════════════════════════════════════════╗
║         GhostLink MCP Server             ║
║   Multi-Agent AI Chat Hub                ║
╠══════════════════════════════════════════╣
║  API:     http://{args.host}:{args.port}         ║
║  MCP:     http://{args.host}:{args.mcp_port}/mcp      ║
║  SSE:     http://{args.host}:{args.sse_port}/sse      ║
╠══════════════════════════════════════════╣
║  Connect from Claude Code:               ║
║    Add to ~/.claude/.mcp.json:           ║
║    {{"mcpServers": {{"ghostlink":          ║
║      {{"type": "http",                    ║
║       "url": "http://{args.host}:{args.mcp_port}/mcp"}}}}}}  ║
╚══════════════════════════════════════════╝
""")

    # Start the server via uvicorn (same as app.py __main__)
    try:
        import uvicorn
        uvicorn.run(
            "app:app",
            host=args.host,
            port=args.port,
            reload=False,
            log_level="info",
        )
    except KeyboardInterrupt:
        print("\nGhostLink MCP Server stopped.")
    except Exception as e:
        print(f"Failed to start: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
