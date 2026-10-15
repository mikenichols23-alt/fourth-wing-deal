#!/bin/bash
# Keeps the localhost.run tunnel alive for the Fourth Wing Deal game server.
# NOTE (2026-10-15): the egress proxy rate-limits rapid reconnects with
# HTTP 403, so this loop backs off instead of hammering every 5s.
fails=0
while true; do
  ssh -T -o StrictHostKeyChecking=no -o ConnectTimeout=15 \
      -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
      -o ProxyCommand="nc -X connect -x hatch-egress-proxy:3128 %h %p" \
      -R 80:localhost:3000 nokey@localhost.run > /tmp/tunnel-raw.log 2>&1 &
  SSH_PID=$!
  # Wait for URL to appear (up to 60s)
  for i in $(seq 1 60); do
    URL=$(grep -o "https://[a-z0-9]*\.lhr\.life" /tmp/tunnel-raw.log 2>/dev/null | head -1)
    if [ -n "$URL" ]; then echo "$URL" > /tmp/tunnel-url.txt; break; fi
    sleep 1
  done
  wait $SSH_PID
  if [ -n "$URL" ]; then
    fails=0
    echo "Tunnel died, reconnecting in 15s..."
    sleep 15
  else
    fails=$((fails + 1))
    # Exponential backoff: 30s, 60s, 120s, ... capped at 10 min.
    # A fresh 403 from the proxy means we're rate-limited; hammering makes it worse.
    backoff=$((30 * (2 ** (fails - 1))))
    [ "$backoff" -gt 600 ] && backoff=600
    echo "Tunnel failed to connect (attempt $fails), retrying in ${backoff}s..."
    sleep "$backoff"
  fi
  URL=""
done
