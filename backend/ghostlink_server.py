#!/usr/bin/env python3
"""GhostLink server — standalone headless backend entry point.

Run the full GhostLink backend without Electron.
This starts the API, WebSocket hub, and embedded MCP bridge.

Usage:
    python ghostlink_server.py                   # Start in foreground
    python ghostlink_server.py --daemon          # Start as background service
    python ghostlink_server.py --port 8300       # Custom web port
    python ghostlink_server.py --stop            # Stop a running daemon
    ghostlink-server                             # If installed via pip

This starts:
    1. The FastAPI backend (message store, registry, routing)
    2. The MCP bridge server (29 tools for chat, memory, web, etc.)
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
import signal
import sys
from pathlib import Path

# Ensure backend is importable
BACKEND_DIR = Path(__file__).parent.resolve()
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

DEFAULT_PID_FILE = Path.home() / ".ghostlink" / "ghostlink-server.pid"


def _write_pid(pid_file: Path):
    pid_file.parent.mkdir(parents=True, exist_ok=True)
    pid_file.write_text(str(os.getpid()))


def _read_pid(pid_file: Path) -> int | None:
    try:
        return int(pid_file.read_text().strip())
    except (FileNotFoundError, ValueError):
        return None


def _is_pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _stop_daemon(pid_file: Path) -> bool:
    pid = _read_pid(pid_file)
    if pid is None:
        print("No daemon PID file found.")
        return False
    if not _is_pid_alive(pid):
        print(f"Daemon (pid {pid}) is not running. Cleaning up PID file.")
        pid_file.unlink(missing_ok=True)
        return False
    print(f"Stopping GhostLink daemon (pid {pid})...")
    try:
        os.kill(pid, signal.SIGTERM)
        # Wait briefly for graceful shutdown
        import time
        for _ in range(10):
            time.sleep(0.5)
            if not _is_pid_alive(pid):
                break
        if _is_pid_alive(pid):
            os.kill(pid, signal.SIGKILL)
    except OSError as e:
        print(f"Failed to stop daemon: {e}")
        return False
    pid_file.unlink(missing_ok=True)
    print("Daemon stopped.")
    return True


def _daemonize():
    """Fork into a background daemon process (Unix only)."""
    if sys.platform == "win32":
        print("Daemon mode is not supported on Windows. Use a service manager instead.", file=sys.stderr)
        sys.exit(1)

    # First fork
    pid = os.fork()
    if pid > 0:
        # Parent exits
        print(f"GhostLink daemon started (pid {pid})")
        sys.exit(0)

    # Create new session
    os.setsid()

    # Second fork (prevent terminal reattachment)
    pid = os.fork()
    if pid > 0:
        sys.exit(0)

    # Redirect stdio to /dev/null
    sys.stdin = open(os.devnull, "r")
    sys.stdout = open(os.devnull, "w")
    sys.stderr = open(os.devnull, "w")


def main():
    parser = argparse.ArgumentParser(
        description="GhostLink server — full backend + MCP bridge",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s                          Start in foreground
  %(prog)s --daemon                 Start as background service
  %(prog)s --stop                   Stop a running daemon
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
    parser.add_argument("--daemon", action="store_true", help="Run as a background daemon")
    parser.add_argument("--stop", action="store_true", help="Stop a running daemon")
    parser.add_argument("--pid-file", type=str, default=None, help="PID file path (default: ~/.ghostlink/ghostlink-server.pid)")
    parser.add_argument("--quiet", action="store_true", help="Suppress startup banner")
    args = parser.parse_args()

    pid_file = Path(args.pid_file) if args.pid_file else DEFAULT_PID_FILE

    # Handle --stop
    if args.stop:
        success = _stop_daemon(pid_file)
        sys.exit(0 if success else 1)

    # Check if already running
    existing_pid = _read_pid(pid_file)
    if existing_pid and _is_pid_alive(existing_pid):
        print(f"GhostLink daemon is already running (pid {existing_pid}).")
        print(f"Use --stop to shut it down first.")
        sys.exit(1)

    # Set port env vars before importing app
    os.environ["PORT"] = str(args.port)
    os.environ["PYTHONUNBUFFERED"] = "1"

    # Handle --daemon
    if args.daemon:
        if not args.quiet:
            print(f"Starting GhostLink daemon on port {args.port}...")
        _daemonize()
        args.quiet = True  # No banner in daemon mode

    # Write PID file
    _write_pid(pid_file)

    # Cleanup PID file on exit
    def _cleanup(*_):
        pid_file.unlink(missing_ok=True)
        sys.exit(0)
    signal.signal(signal.SIGTERM, _cleanup)

    if not args.quiet:
        print(f"""
╔══════════════════════════════════════════╗
║         GhostLink Server                 ║
║   Full Backend + MCP Bridge              ║
╠══════════════════════════════════════════╣
║  API:     http://{args.host}:{args.port:<5}              ║
║  MCP:     http://{args.host}:{args.mcp_port:<5}/mcp         ║
║  SSE:     http://{args.host}:{args.sse_port:<5}/sse         ║
╠══════════════════════════════════════════╣
║  PID:     {os.getpid():<32}║
║  Stop:    ghostlink-server --stop        ║
╚══════════════════════════════════════════╝
""")

    # Start the server via uvicorn
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
        pass
    except Exception as e:
        print(f"Failed to start: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        pid_file.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
