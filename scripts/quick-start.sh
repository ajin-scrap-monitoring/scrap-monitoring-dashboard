#!/usr/bin/env bash

set -euo pipefail

image_name=scrap-monitoring-dashboard:demo
container_name=scrap-monitoring-dashboard-demo
host_address=127.0.0.1
host_port=8080

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

repository_root=$(cd -- "$(dirname -- "$0")/.." && pwd)

wait_for_dashboard() {
  local attempt

  for attempt in {1..30}; do
    if (exec 3<>"/dev/tcp/$host_address/$host_port") 2>/dev/null; then
      return
    fi

    if [[ $(docker container inspect --format '{{.State.Running}}' "$container_name") != true ]]; then
      docker logs "$container_name" >&2
      fail "Container $container_name stopped before the dashboard became available."
    fi

    sleep 1
  done

  fail "Dashboard did not become available at http://$host_address:$host_port"
}

start() {
  docker version --format '{{.Server.Version}}' >/dev/null || fail 'Docker Engine is unavailable. Run newgrp docker after installation.'
  docker container inspect "$container_name" >/dev/null 2>&1 && fail "Container $container_name already exists. Run $0 stop first."

  docker build \
    --build-arg VITE_ENABLE_MOCK_DATA=true \
    --tag "$image_name" \
    "$repository_root"
  docker run --detach --rm \
    --name "$container_name" \
    --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=16m \
    --publish "$host_address:$host_port:8080" \
    "$image_name"

  wait_for_dashboard
  printf 'Dashboard is available at http://%s:%s\n' "$host_address" "$host_port"
}

stop() {
  if docker container inspect "$container_name" >/dev/null 2>&1; then
    docker rm --force "$container_name"
  else
    printf 'Container %s does not exist.\n' "$container_name"
  fi
}

case ${1:-start} in
  start) start ;;
  stop) stop ;;
  *) fail "Usage: $0 [start|stop]" ;;
esac
