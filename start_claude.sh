#!/bin/bash
# Start GhostLink server + Claude agent wrapper
set -e
cd "$(dirname "$0")/backend"
source ../.venv/bin/activate

# Start server in background
python app.py &
SERVER_PID=$!
sleep 2

# Start Claude wrapper (blocks on tmux attach)
python wrapper.py claude "$@"

# Cleanup
kill $SERVER_PID 2>/dev/null
