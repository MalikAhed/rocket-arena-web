#!/usr/bin/env bash
# Fail on actual startup errors, but don't confuse docker run with HTTP readiness.
set -euo pipefail
mkdir -p evidence
cleanup() {
  local result=$?
  trap - EXIT
  for name in online-server-check online-frontend-check; do
    docker logs "$name" > "evidence/${name}.log" 2>&1 || true
    docker inspect --format '{{json .State}}' "$name" > "evidence/${name}-state.json" 2>&1 || true
    if (( result != 0 )); then cat "evidence/${name}.log" >&2; fi
    docker rm -f "$name" >/dev/null 2>&1 || true
  done
  exit "$result"
}
trap cleanup EXIT

docker compose config --quiet
docker build --target server -t rocket-online-server . > evidence/docker-server.log 2>&1
docker build --target frontend -t rocket-online-frontend . > evidence/docker-frontend.log 2>&1
docker run -d --name online-server-check -p 18080:8080 -e NODE_ENV=development rocket-online-server
docker run -d --name online-frontend-check -p 18081:4173 rocket-online-frontend

wait_http() {
  local name=$1 url=$2 destination=$3
  local deadline=$((SECONDS + 40))
  while (( SECONDS < deadline )); do
    if [[ $(docker inspect --format '{{.State.Running}}' "$name") != true ]]; then
      printf '%s exited before becoming ready\n' "$name" >&2
      return 1
    fi
    if curl --fail --silent --show-error --connect-timeout 1 --max-time 2 "$url" > "$destination" 2>>evidence/container-readiness.log; then
      printf '%s HTTP ready\n' "$name"
      return 0
    fi
    sleep 1
  done
  printf '%s failed HTTP readiness within the deadline\n' "$name" >&2
  return 1
}
wait_http online-server-check http://127.0.0.1:18080/readyz evidence/docker-ready.json
wait_http online-frontend-check http://127.0.0.1:18081/ evidence/docker-index.html
curl --fail --silent --show-error --max-time 5 http://127.0.0.1:18081/assets/online/config.json > evidence/docker-frontend-config.json
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const health = JSON.parse(readFileSync('evidence/docker-ready.json', 'utf8'));
const config = JSON.parse(readFileSync('evidence/docker-frontend-config.json', 'utf8'));
assert.equal(health.ready, true);
assert.equal(health.ranked, false, 'This smoke container has no account/database credentials');
assert.equal(config.serverUrl, 'http://127.0.0.1:8080');
assert.equal(config.publishableKey, '');
assert.match(readFileSync('evidence/docker-index.html', 'utf8'), /\/app\/game\.js/);
const response = await fetch('http://127.0.0.1:18081/app/game.js', { method: 'HEAD', signal: AbortSignal.timeout(5000) });
assert.equal(response.status, 200);
assert.match(response.headers.get('Content-Type'), /javascript/);
assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
console.log('Both container images start, serve expected content, and preserve isolation headers.');
JS
