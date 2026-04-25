#!/usr/bin/env bash
# Free ports used by dev scripts so reruns are idempotent.
# Usage: free-dev-ports.sh [PORT ...]
# With no args, frees the full dev set: 19432 (MCP), 3001 (backend), 5173 (Vite).
set -u
ports=("$@")
if [ ${#ports[@]} -eq 0 ]; then
  ports=(19432 3001 5173)
fi
for port in "${ports[@]}"; do
  pids=$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "${pids}" ]; then
    echo "[free-dev-ports] killing pid(s) on :${port}: ${pids}"
    kill -9 ${pids} 2>/dev/null || true
  fi
done
exit 0
