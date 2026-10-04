#!/bin/bash
# career-ops bridge watchdog: restart bridge if down, gate on health
BRIDGE_URL="http://127.0.0.1:8787"
DIR="/root/career-ops"
LOCK="/tmp/career-ops-watchdog.lock"
exec 9>"$LOCK"
flock -n 9 || exit 0
if curl -s -m 5 "$BRIDGE_URL/health" >/dev/null 2>&1; then
  exit 0
fi
cd "$DIR" && setsid node bridge-server.mjs >> /tmp/bridge.log 2>&1 < /dev/null &
exit 0
