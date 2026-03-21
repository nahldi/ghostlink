#!/bin/bash
# Start GhostLink server + Codex agent wrapper
set -e
cd "$(dirname "$0")/backend"
source ../.venv/bin/activate

# Start server in background
python app.py &
SERVER_PID=$!
sleep 2

# Start Codex wrapper (blocks on tmux attach)
python wrapper.py codex "$@"

# Cleanup
kill $SERVER_PID 2>/dev/null
