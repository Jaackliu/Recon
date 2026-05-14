#!/bin/bash
export PYTHONDONTWRITEBYTECODE=1
PYTHON="${CONDA_PREFIX}/bin/python"

# Start the unified server (serves both static files and API)
$PYTHON src/backend/api_server.py &
SERVER_PID=$!

echo "Server running on http://0.0.0.0:8000 (PID: $SERVER_PID)"
echo "Open: http://localhost:8000/"

trap "kill $SERVER_PID 2>/dev/null" EXIT
wait
