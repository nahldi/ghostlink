#!/bin/bash
# Start an agent wrapper for AI Chattr
# Usage: ./start_agent.sh claude [--headless]
#        ./start_agent.sh codex [--headless]

set -e
cd "$(dirname "$0")/backend"
source ../.venv/bin/activate
exec python wrapper.py "$@"
