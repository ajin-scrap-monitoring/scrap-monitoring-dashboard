#!/usr/bin/env bash
set -euo pipefail

repository_root=$(cd -- "$(dirname -- "$0")/.." && pwd)
if [[ $(id -u) -ne 0 ]]; then
  exec sudo --preserve-env=SYNC_SOURCE_ROOT "$repository_root/scripts/verify-service-integration.sh" "$@"
fi
source "$repository_root/scripts/verification-common.sh"
check_docker
node_image=$(awk '/^FROM node:/{print $2; exit}' "$repository_root/Dockerfile")

run_node() {
  timeout --signal=TERM --kill-after=5s 30s docker run --rm --network none \
    --mount "type=bind,source=$repository_root,target=/app,readonly" \
    --mount "type=bind,source=$run_directory,target=$container_run_directory" \
    --workdir /app "$node_image" node scripts/integration-artifacts.ts "$@"
}

if [[ ${1:-} == --cleanup && $# -eq 2 ]]; then
  run_directory=$(cd -- "$2" && pwd)
  [[ $run_directory == "$repository_root/test-results/service-integration/run."* ]] || verification_fail 'Invalid integration run directory.'
  container_run_directory=/app/${run_directory#"$repository_root/"}
  state=$(run_node state "$container_run_directory")
  IFS=$'\t' read -r project_name source_root relative_run_directory <<< "$state"
  timeout --signal=TERM --kill-after=10s 45s env SYNC_SOURCE_ROOT="$source_root" SYNC_RUN_DIRECTORY="$relative_run_directory" \
    SYNC_ADMIN_PASSWORD=removed SYNC_VIEWER_PASSWORD=removed SYNC_EDGE_TOKEN=removed SYNC_CAMERA_TOKEN=removed SYNC_MEDIA_TOKEN=removed \
    bash "$repository_root/scripts/cleanup-service-project.sh" "$project_name" docker compose --project-name "$project_name" --file "$repository_root/integration/compose.yaml"
  run_node clear-secrets "$container_run_directory"
  printf 'Cleaned integration project %s.\n' "$project_name"
  exit 0
fi
[[ $# -eq 0 ]] || verification_fail "Usage: $0 [--cleanup <integration-run-directory>]"

mkdir -p "$repository_root/test-results/service-integration"
run_directory=$(mktemp -d "$repository_root/test-results/service-integration/run.XXXXXXXX")
container_run_directory=/app/${run_directory#"$repository_root/"}
export SYNC_SOURCE_ROOT=${SYNC_SOURCE_ROOT:-$(mktemp -d /tmp/dashboard-service-sources.XXXXXXXX)}
SYNC_SOURCE_ROOT=$(cd -- "$SYNC_SOURCE_ROOT" && pwd)
unset SYNC_ADMIN_PASSWORD SYNC_VIEWER_PASSWORD SYNC_EDGE_TOKEN SYNC_CAMERA_TOKEN SYNC_MEDIA_TOKEN SYNC_RUN_DIRECTORY
run_node prepare "$container_run_directory" "$SYNC_SOURCE_ROOT"
state=$(run_node state "$container_run_directory")
IFS=$'\t' read -r project_name source_root relative_run_directory <<< "$state"
compose=(docker compose --project-name "$project_name" --env-file "$run_directory/private/compose.env" --file "$repository_root/integration/compose.yaml")
step_log=$run_directory/private/steps.log

cleanup() {
  local result=$? cleanup_result=0
  trap - EXIT INT TERM
  set +e
  stop_active_step
  timeout --signal=TERM --kill-after=5s 10s "${compose[@]}" ps --all --format json >"$run_directory/private/services.json" 2>>"$step_log"
  timeout --signal=TERM --kill-after=10s 45s bash "$repository_root/scripts/cleanup-service-project.sh" "$project_name" "${compose[@]}" >>"$step_log" 2>&1 || cleanup_result=$?
  if [[ $cleanup_result -ne 0 ]]; then
    printf 'Integration cleanup failed (exit %s).\n' "$cleanup_result" >&2
    [[ $result -ne 0 ]] || result=1
  fi
  if ! run_node publish "$container_run_directory" "$result"; then
    printf 'Artifact validation failed; no raw diagnostics are uploaded.\n' >&2
    [[ $result -ne 0 ]] || result=1
  fi
  if [[ $cleanup_result -eq 0 ]]; then run_node clear-secrets "$container_run_directory" || { [[ $result -ne 0 ]] || result=1; }; fi
  printf 'Integration artifacts: %s/artifacts\n' "$run_directory"
  printf 'Private diagnostics: %s/private\n' "$run_directory"
  printf 'Reference sources retained at %s\n' "$SYNC_SOURCE_ROOT"
  printf 'Recovery command: sudo %s --cleanup %s\n' "$repository_root/scripts/verify-service-integration.sh" "$run_directory"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf 'Integration project: %s\n' "$project_name"
printf 'Integration run directory: %s\n' "$run_directory"
printf 'Recovery command: sudo %s --cleanup %s\n' "$repository_root/scripts/verify-service-integration.sh" "$run_directory"
sources=$(timeout 30s docker run --rm --network none --mount "type=bind,source=$repository_root,target=/app,readonly" --workdir /app "$node_image" node scripts/backend-contract.ts --sources)
while IFS=$'\t' read -r directory repository revision; do
  source_path=$SYNC_SOURCE_ROOT/$directory
  if [[ ! -d $source_path ]]; then
    run_step "clone-$directory" 180s git clone --quiet "https://github.com/$repository.git" "$source_path"
    git -C "$source_path" checkout --quiet --detach "$revision"
  fi
  [[ $(git -c safe.directory="$source_path" -C "$source_path" rev-parse HEAD) == "$revision" ]] || verification_fail "Unexpected source revision: $source_path"
  [[ -z $(git -c safe.directory="$source_path" -C "$source_path" status --porcelain) ]] || verification_fail "Source checkout is dirty: $source_path"
done <<< "$sources"
run_step compose-config 30s "${compose[@]}" config --quiet
run_step service-build 1200s "${compose[@]}" build
run_step service-readiness 150s "${compose[@]}" up --detach --wait --wait-timeout 120 backend media dashboard dashboard-alt camera-input
runtime_images=$(timeout 10s docker container inspect "$project_name-dashboard-1" "$project_name-dashboard-alt-1" --format '{{.Image}}')
mapfile -t runtime_image_ids <<< "$runtime_images"
[[ ${#runtime_image_ids[@]} -eq 2 && ${runtime_image_ids[0]} =~ ^sha256:[a-f0-9]{64}$ && ${runtime_image_ids[0]} == "${runtime_image_ids[1]}" ]] || verification_fail 'Runtime configuration fixtures must use the same production image.'
printf 'Same production image verified for both runtime configurations.\n'
run_step browser-install 180s "${compose[@]}" run --rm --no-deps --entrypoint pnpm browser install --frozen-lockfile
run_step edge-input 120s "${compose[@]}" run --rm edge-input
run_step browser-tests 300s "${compose[@]}" run --rm browser
