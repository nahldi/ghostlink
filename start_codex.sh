#!/bin/bash
# Start GhostLink server + Codex agent wrapper
set -e
cd "$(dirname "$0")/backend"
if [ ! -f "../.venv/bin/activate" ]; then
    echo "Error: Virtual environment not found."
    echo "Create one with: cd $(dirname "$0") && python3 -m venv .venv && source .venv/bin/activate && pip install -r backend/requirements.txt"
    exit 1
fi
source ../.venv/bin/activate

# Cleanup server on exit (Ctrl+C, normal exit, etc.)
cleanup() { kill $SERVER_PID 2>/dev/null; }
trap cleanup EXIT

# Start server in background
python app.py &
SERVER_PID=$!
sleep 2

# Start Codex wrapper (blocks on tmux attach)
python wrapper.py codex "$@"
