#!/usr/bin/env bash
# Boot a Toolbox image and probe /api/health, /api/auth/status, and the SPA index.
# Usage: smoke-image.sh IMAGE
# The container binds a random 127.0.0.1 port, so this is safe next to a dev
# server on :3100. CI (PR image) and docker-publish (each pushed arch) share it.
set -euo pipefail

image="${1:?usage: smoke-image.sh IMAGE}"
name="toolbox-smoke-$$"

fail() {
  echo "::error::$*"
  docker logs "$name" || true
  exit 1
}
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$name" -p 127.0.0.1::3100 -e AUTH_REQUIRED=true "$image" >/dev/null
hostport=$(docker port "$name" 3100/tcp) || fail "No published port for $image"
base="http://$hostport"

ready=0
for _ in $(seq 1 30); do
  if health=$(curl -fsS "$base/api/health" 2>/dev/null) &&
     jq -e '.status == "ok"' >/dev/null <<<"$health"; then
    ready=1
    break
  fi
  sleep 1
done
[[ "$ready" -eq 1 ]] || fail "Timed out waiting for /api/health"

if ! auth=$(curl -fsS "$base/api/auth/status") ||
   ! jq -e '.authRequired == true and .authenticated == false' >/dev/null <<<"$auth"; then
  fail "Unexpected /api/auth/status response: ${auth:-<empty>}"
fi

if ! html=$(curl -fsS "$base/") || ! grep -q '<div id="root"></div>' <<<"$html"; then
  fail "Unexpected SPA index response from /"
fi

echo "Smoke test passed for $image"
