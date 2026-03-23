#!/bin/bash
# Start the GhostLink server (backend only)
set -e
cd "$(dirname "$0")/backend"
if [ ! -f "../.venv/bin/activate" ]; then
    echo "Error: Virtual environment not found."
    echo "Create one with: cd $(dirname "$0") && python3 -m venv .venv && source .venv/bin/activate && pip install -r backend/requirements.txt"
    exit 1
fi
source ../.venv/bin/activate
exec python app.py
