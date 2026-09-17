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

run_docker() {
  if [[ $(id --user) -eq 0 ]]; then
    docker "$@"
  else
    sudo docker "$@"
  fi
}

repository_root=$(cd -- "$(dirname -- "$0")/.." && pwd)
environment_file=$repository_root/.env

read_environment_value() {
  local key=$1

  awk -F= -v key="$key" '
    $0 ~ "^" key "=" {
      value = substr($0, length(key) + 2)
      found = 1
    }
    END {
      if (!found) {
        exit 1
      }
      print value
    }
  ' "$environment_file"
}

wait_for_dashboard() {
  local attempt health_status

  for attempt in {1..30}; do
    health_status=$(run_docker container inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container_name")
    if [[ $health_status == healthy ]]; then
      return
    fi

    if [[ $(run_docker container inspect --format '{{.State.Running}}' "$container_name") != true ]]; then
      run_docker logs "$container_name" >&2
      fail "Container $container_name stopped before the dashboard became available."
    fi

    if [[ $health_status == unhealthy ]]; then
      run_docker logs "$container_name" >&2
      fail "Container $container_name is unhealthy."
    fi

    sleep 1
  done

  fail "Dashboard did not become available at http://$host_address:$host_port"
}

start() {
  [[ -r $environment_file ]] || fail 'Create .env with cp .env.example .env before running the quick start.'

  local app_version mock_data_enabled
  app_version=$(read_environment_value VITE_APP_VERSION) || fail 'Set VITE_APP_VERSION in .env.'
  mock_data_enabled=$(read_environment_value VITE_ENABLE_MOCK_DATA) || fail 'Set VITE_ENABLE_MOCK_DATA in .env.'
  [[ -n $app_version ]] || fail 'Set VITE_APP_VERSION in .env.'
  [[ $mock_data_enabled == true || $mock_data_enabled == false ]] || fail 'Set VITE_ENABLE_MOCK_DATA to true or false in .env.'

  run_docker version --format '{{.Server.Version}}' >/dev/null || fail 'Docker Engine is unavailable or sudo access is missing.'
  run_docker container inspect "$container_name" >/dev/null 2>&1 && fail "Container $container_name already exists. Run $0 stop first."

  run_docker build \
    --build-arg APP_VERSION="$app_version" \
    --build-arg VITE_ENABLE_MOCK_DATA="$mock_data_enabled" \
    --tag "$image_name" \
    "$repository_root"
  run_docker run --detach --rm \
    --name "$container_name" \
    --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=16m \
    --publish "$host_address:$host_port:8080" \
    "$image_name"

  wait_for_dashboard
  printf 'Dashboard is available at http://%s:%s\n' "$host_address" "$host_port"
}

stop() {
  if run_docker container inspect "$container_name" >/dev/null 2>&1; then
    run_docker rm --force "$container_name"
  else
    printf 'Container %s does not exist.\n' "$container_name"
  fi
}

clean() {
  stop

  if run_docker image inspect "$image_name" >/dev/null 2>&1; then
    run_docker image rm "$image_name"
  else
    printf 'Image %s does not exist.\n' "$image_name"
  fi
}

case ${1:-} in
  start) start ;;
  stop) stop ;;
  clean) clean ;;
  *) fail "Usage: $0 {start|stop|clean}" ;;
esac
