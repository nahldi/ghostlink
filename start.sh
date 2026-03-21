#!/bin/bash
# Start the AI Chattr server (backend only)
set -e
cd "$(dirname "$0")/backend"
source ../.venv/bin/activate
exec python app.py
