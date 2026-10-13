#!/usr/bin/env bash

minimum_docker_version=29.8.0
minimum_compose_version=5.5.1
minimum_buildx_version=0.37.1

verification_fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

version_at_least() {
  [[ $(printf '%s\n%s\n' "$2" "$1" | sort --version-sort | head --lines 1) == "$2" ]]
}

check_docker() {
  local engine_version compose_version buildx_version endpoint
  engine_version=$(docker version --format '{{.Server.Version}}') || verification_fail 'Docker Engine is unavailable.'
  compose_version=$(docker compose version --short) || verification_fail 'Docker Compose is unavailable.'
  buildx_version=$(docker buildx version | awk '{print $2}') || verification_fail 'Docker Buildx is unavailable.'
  engine_version=${engine_version#v}
  compose_version=${compose_version#v}
  buildx_version=${buildx_version#v}
  version_at_least "${engine_version%%+*}" "$minimum_docker_version" || verification_fail "Docker Engine must be $minimum_docker_version or later."
  version_at_least "${compose_version%%+*}" "$minimum_compose_version" || verification_fail "Docker Compose must be $minimum_compose_version or later."
  version_at_least "${buildx_version%%+*}" "$minimum_buildx_version" || verification_fail "Docker Buildx must be $minimum_buildx_version or later."
  endpoint=${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}')}
  [[ $endpoint == unix:///* ]] || verification_fail 'Verification requires a local Docker daemon.'
  verification_socket=${endpoint#unix://}
  [[ -S $verification_socket ]] || verification_fail 'The local Docker socket is unavailable.'
}

active_step_pid=
run_step() {
  local label=$1 duration=$2 result
  shift 2
  printf 'Running %s\n' "$label"
  timeout --signal=TERM --kill-after=15s "$duration" "$@" >>"$step_log" 2>&1 &
  active_step_pid=$!
  if wait "$active_step_pid"; then result=0; else result=$?; fi
  active_step_pid=
  if [[ $result -ne 0 ]]; then printf 'Failed %s (exit %s)\n' "$label" "$result" >&2; fi
  return "$result"
}

stop_active_step() {
  if [[ -n $active_step_pid ]]; then
    kill -TERM "$active_step_pid" 2>/dev/null || true
    wait "$active_step_pid" 2>/dev/null || true
    active_step_pid=
  fi
}
