#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <image> <container-name> <expected-version>" >&2
  exit 2
fi

image=$1
container_name=$2
expected_version=$3

fail() {
  echo "$1" >&2
  exit 1
}

run_docker() {
  if [[ $(id --user) -eq 0 ]]; then
    docker "$@"
  else
    sudo docker "$@"
  fi
}

image_platform=$(run_docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")
[[ "$image_platform" == "linux/amd64" ]] || fail "Runtime image platform is $image_platform, expected linux/amd64."

cleanup() {
  run_docker rm --force "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

run_docker run --rm "$image" nginx -t >/dev/null

run_docker run \
  --detach \
  --read-only \
  --tmpfs /tmp \
  --name "$container_name" \
  --publish 127.0.0.1:18080:8080 \
  "$image" >/dev/null

for attempt in {1..10}; do
  if curl --fail --silent http://127.0.0.1:18080/healthz | grep --fixed-strings --line-regexp --quiet ok; then
    break
  fi
  if [[ "$attempt" == 10 ]]; then
    run_docker logs "$container_name"
    exit 1
  fi
  sleep 1
done

for route in / /history /recordings /admin /login; do
  curl --fail --silent --show-error "http://127.0.0.1:18080$route" | grep --fixed-strings --quiet '<div id="root"></div>' || fail "SPA fallback failed for $route."
done

curl --fail --silent --show-error --head http://127.0.0.1:18080/index.html | grep --ignore-case --quiet 'cache-control: no-store' || fail "HTML cache policy is missing."
curl --fail --silent --show-error --head http://127.0.0.1:18080/index.html | grep --ignore-case --quiet 'x-content-type-options: nosniff' || fail "Content type protection header is missing."
curl --fail --silent --show-error --head http://127.0.0.1:18080/index.html | grep --ignore-case --quiet 'referrer-policy: no-referrer' || fail "Referrer policy header is missing."
curl --fail --silent --show-error --head http://127.0.0.1:18080/index.html | grep --ignore-case --quiet 'x-frame-options: deny' || fail "Frame protection header is missing."
curl --fail --silent --show-error --head http://127.0.0.1:18080/index.html | grep --ignore-case --quiet "content-security-policy: .*frame-ancestors 'none'" || fail "Content Security Policy is missing frame-ancestors."
curl --fail --silent --show-error --head http://127.0.0.1:18080/index.html | grep --ignore-case --quiet 'permissions-policy: camera=(), microphone=()' || fail "Permissions Policy header is missing."
curl --fail --silent --show-error --head http://127.0.0.1:18080/index.html | grep --ignore-case --quiet 'x-request-id:' || fail "Request ID response header is missing."
curl --fail --silent --show-error --head http://127.0.0.1:18080/history | grep --ignore-case --quiet 'cache-control: no-store' || fail "SPA fallback cache policy is missing."
curl --fail --silent --show-error --compressed --dump-header - http://127.0.0.1:18080/index.html --output /dev/null | grep --ignore-case --quiet 'content-encoding: gzip' || fail "Gzip compression is missing."

asset_path=$(run_docker exec "$container_name" sh -c "find /usr/share/nginx/html/assets -type f -name '*.js' | head -n 1")
if [[ -z "$asset_path" ]]; then
  echo "Runtime image does not contain a JavaScript asset." >&2
  exit 1
fi
asset_name=${asset_path##*/}
curl --fail --silent --show-error --head "http://127.0.0.1:18080/assets/$asset_name" | grep --ignore-case --quiet 'cache-control: public, max-age=31536000, immutable' || fail "Static asset cache policy is missing."

[[ $(run_docker exec "$container_name" id -u) == 101 ]] || fail "Runtime process does not use UID 101."
run_docker exec "$container_name" test -f /usr/share/licenses/scrap-monitoring-dashboard/NotoSansKR-OFL.txt || fail "Noto Sans KR license is missing."
run_docker exec "$container_name" test -f /usr/share/licenses/scrap-monitoring-dashboard/React-MIT.txt || fail "React license is missing."
run_docker exec "$container_name" test -f /usr/share/licenses/scrap-monitoring-dashboard/Vite-MIT.txt || fail "Vite license is missing."
run_docker exec "$container_name" grep -rFq "$expected_version" /usr/share/nginx/html/assets || fail "Application version does not match $expected_version."
run_docker exec "$container_name" test ! -e /app/src || fail "Runtime image contains application source files."
source_map=$(run_docker exec "$container_name" sh -c "find /usr/share/nginx/html -type f -name '*.map' -print -quit")
[[ -z "$source_map" ]] || fail "Runtime image contains a source map."

if run_docker exec "$container_name" sh -c 'command -v node || command -v npm || command -v pnpm'; then
  echo "Runtime image contains a build tool." >&2
  exit 1
fi

echo "Verified $image for linux/amd64."
