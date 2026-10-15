#!/usr/bin/env bash
set -euo pipefail

repository_root=$(cd -- "$(dirname -- "$0")/.." && pwd)
if [[ $(id -u) -ne 0 ]]; then exec sudo "$repository_root/scripts/verify-container-integration.sh" "$@"; fi
source "$repository_root/scripts/verification-common.sh"
check_docker
recovery=false
if [[ ${1:-} == --cleanup && $# -eq 2 ]]; then
  [[ -d $2 && ! -L $2 ]] || verification_fail 'Invalid container verification directory.'
  work_directory=$(cd -- "$2" && pwd)
  [[ $work_directory =~ ^/tmp/dashboard-container-integration\.[A-Za-z0-9]{8}$ ]] || verification_fail 'Invalid container verification directory.'
  recovery=true
else
  [[ $# -eq 0 ]] || verification_fail "Usage: $0 [--cleanup <container-verification-directory>]"
  work_directory=$(mktemp -d /tmp/dashboard-container-integration.XXXXXXXX)
fi
run_id=${work_directory##*.}
run_id=${run_id,,}
tool_image=dashboard-container-$run_id-tools:local
dashboard_image=dashboard-container-$run_id-app:local
tool_container=dashboard-container-$run_id-tools
dashboard_container=dashboard-container-$run_id-runtime
step_log=$work_directory/steps.log

cleanup_resources() {
  local result=0 target found tls_directory
  timeout --signal=TERM --kill-after=5s 10s docker info >/dev/null 2>>"$step_log" || return 1
  for target in "$tool_container" "$dashboard_container" "proxy-integration-frontend-$run_id" "proxy-integration-upstream-$run_id"; do
    found=$(timeout 10s docker container ls --all --filter "name=^/$target$" --format '{{.ID}}' 2>>"$step_log") || { result=1; continue; }
    if [[ -n $found ]]; then
      timeout --signal=TERM --kill-after=5s 15s docker container rm --force "$target" >>"$step_log" 2>&1 || result=1
    fi
  done
  timeout --signal=TERM --kill-after=5s 20s env TLS_TEST_IMAGE="$dashboard_image" TLS_TEST_CERTIFICATE_FILE="$work_directory/removed.crt" \
    TLS_TEST_PRIVATE_KEY_FILE="$work_directory/removed.key" TLS_TEST_NGINX_CONFIG="$repository_root/test/tls/nginx.conf" TLS_TEST_RUNTIME_CONFIG_FILE="$work_directory/removed.json" \
    docker compose --project-name "scrap-tls-test-$run_id" --file "$repository_root/test/tls/compose.yaml" down --volumes --remove-orphans >>"$step_log" 2>&1 || result=1
  found=$(timeout 10s docker network ls --filter "name=^proxy-integration-$run_id$" --format '{{.ID}}' 2>>"$step_log") || result=1
  if [[ -n $found ]]; then timeout 10s docker network rm "proxy-integration-$run_id" >>"$step_log" 2>&1 || result=1; fi
  for target in "$dashboard_image" "$tool_image" "scrap-monitoring-dashboard-proxy-upstream:$run_id"; do
    found=$(timeout 10s docker image ls --filter "reference=$target" --format '{{.ID}}' 2>>"$step_log") || { result=1; continue; }
    if [[ -n $found ]]; then timeout 15s docker image rm "$target" >>"$step_log" 2>&1 || result=1; fi
  done
  if [[ $result -eq 0 ]]; then
    for tls_directory in "$work_directory"/tls.*; do
      if [[ -d $tls_directory && ! -L $tls_directory && ${tls_directory##*/} =~ ^tls\.[A-Za-z0-9]{8}$ ]]; then
        rm -r -- "$tls_directory" || result=1
      fi
    done
  fi
  return "$result"
}

if [[ $recovery == true ]]; then
  cleanup_resources || verification_fail "Container verification cleanup failed. Private diagnostics: $step_log"
  printf 'Container verification resources cleaned for %s.\n' "$run_id"
  exit 0
fi

cleanup() {
  local result=$?
  trap - EXIT INT TERM
  set +e
  stop_active_step
  if cleanup_resources; then
    printf 'Container verification resources cleaned for %s.\n' "$run_id"
  else
    printf 'Container verification cleanup failed.\n' >&2
    [[ $result -ne 0 ]] || result=1
  fi
  if [[ $result -ne 0 ]]; then printf 'Container verification failed (exit %s). Private diagnostics: %s\n' "$result" "$step_log" >&2; fi
  printf 'Recovery command: sudo %s --cleanup %s\n' "$repository_root/scripts/verify-container-integration.sh" "$work_directory"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf 'Container verification directory: %s\n' "$work_directory"
printf 'Recovery command: sudo %s --cleanup %s\n' "$repository_root/scripts/verify-container-integration.sh" "$work_directory"
run_step verification-tools-build 600s docker build --platform linux/amd64 --tag "$tool_image" "$repository_root/test/container"
run_step production-image-build 600s docker build --platform linux/amd64 --tag "$dashboard_image" "$repository_root"
tool=(docker run --rm --name "$tool_container" --network host \
  --mount "type=bind,source=$verification_socket,target=/var/run/docker.sock" \
  --mount "type=bind,source=$repository_root,target=$repository_root,readonly" \
  --mount "type=bind,source=$work_directory,target=$work_directory" \
  --workdir "$repository_root" --env "VERIFY_RUN_DIRECTORY=$work_directory" --env "VERIFY_RUN_ID=$run_id" "$tool_image")
run_step container-runtime 120s "${tool[@]}" bash scripts/verify-container-image.sh "$dashboard_image" "$dashboard_container" 0.4.0
run_step tls-integration 120s "${tool[@]}" bash test/tls/integration.sh "$dashboard_image"
run_step reverse-proxy 120s "${tool[@]}" node test/proxy/integration.mjs "$dashboard_image"
printf 'Production runtime, TLS and reverse proxy verification passed.\n'
