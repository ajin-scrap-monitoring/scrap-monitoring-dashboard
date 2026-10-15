#!/usr/bin/env bash
set -euo pipefail
umask 077

fail() { printf '%s\n' "$1" >&2; exit 1; }
usage() {
  printf '%s\n' 'Usage: bash scripts/remote-browser.sh {build|capture|clear-session} [browser options]' \
    'Required: DASHBOARD_DEV_SSH_TARGET, DASHBOARD_DEV_REMOTE_PATH' \
    'Optional: DASHBOARD_DEV_SSH_RELAY' \
    'Capture options: --path /recordings --width 1920 --height 1080 --recording-index 0 --recording-status --full-page'
}
[[ ${1:-} != --help && ${1:-} != -h ]] || { usage; exit 0; }
action=${1:-}
[[ $# -gt 0 ]] || { usage >&2; exit 1; }
shift
case $action in build|capture|clear-session) ;; *) usage >&2; exit 1 ;; esac
[[ $action == capture || $# == 0 ]] || fail 'Only capture accepts browser options.'
target=${DASHBOARD_DEV_SSH_TARGET:-}
relay=${DASHBOARD_DEV_SSH_RELAY:-}
remote_path=${DASHBOARD_DEV_REMOTE_PATH:-}
[[ $target =~ ^([A-Za-z0-9][A-Za-z0-9._-]*@)?[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || fail 'Invalid SSH target.'
[[ -z $relay || $relay =~ ^([A-Za-z0-9][A-Za-z0-9._-]*@)?[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || fail 'Invalid SSH relay.'
[[ $remote_path =~ ^/[A-Za-z0-9._/-]+/scrap-monitoring-dashboard-dev$ && $remote_path != *'/../'* && $remote_path != *'/./'* && $remote_path != *'//'* ]] || fail 'Invalid dashboard development mirror path.'
for command in ssh rsync; do command -v "$command" >/dev/null || fail "Install $command."; done
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
state_path=$remote_path/.secrets/dashboard-browser
image=scrap-monitoring-dashboard-dev-browser:local
ssh_command=(ssh -o BatchMode=yes -o ConnectTimeout=8)
[[ -z $relay ]] || ssh_command+=("$relay" ssh -o BatchMode=yes -o ConnectTimeout=8)
printf -v remote_shell '%q ' "${ssh_command[@]}"
shell_quote() { local value=${1//\'/\'\\\'\'}; printf "'%s'" "$value"; }
remote_command() {
  if [[ -n $relay ]]; then
    ssh -o BatchMode=yes -o ConnectTimeout=8 "$relay" "ssh -o BatchMode=yes -o ConnectTimeout=8 $target $(shell_quote "$1")"
  else
    "${ssh_command[@]}" "$target" "$1"
  fi
}
remote_command "test -f '$remote_path/compose.remote-development.yaml' && test ! -e '$remote_path/.git' && test ! -L '$remote_path' && test ! -L '$remote_path/.secrets' && test ! -L '$state_path' && test ! -L '$state_path/captures'" || fail 'Expected an existing dedicated dashboard development mirror without linked private directories.'
case $action in
  build)
    remote_command "cd '$remote_path' && timeout --signal=TERM --kill-after=10s 900s sudo -n docker build --target browser-inspection --tag '$image' ."
    ;;
  clear-session)
    remote_command "if [ -f '$state_path/session.json' ] && [ ! -L '$state_path/session.json' ]; then rm -- '$state_path/session.json'; fi"
    printf '%s\n' 'Removed the inspection browser session. Backend accounts and personal browser sessions are unchanged.'
    ;;
  capture)
    arguments=''
    while [[ $# -gt 0 ]]; do
      case $1 in
        --path)
          [[ $# -ge 2 ]] || fail 'Missing route.'
          case $2 in /|/login|/history|/recordings|/admin) ;; *) fail 'Unsupported inspection route.' ;; esac
          ;;
        --width|--height|--recording-index)
          [[ $# -ge 2 && $2 =~ ^[0-9]+$ ]] || fail 'Expected a numeric browser option.'
          ;;
        --full-page|--recording-status) arguments+=" $(shell_quote "$1")"; shift; continue ;;
        *) fail 'Unsupported browser option.' ;;
      esac
      arguments+=" $(shell_quote "$1") $(shell_quote "$2")"
      shift 2
    done
    local_private=$project_root/test-results/browser-inspection
    [[ ! -L $project_root/test-results && ! -L $local_private ]] || fail 'Private captures must not use symbolic links.'
    mkdir -p "$local_private"
    chmod 700 "$local_private"
    local_run=$(mktemp -d "$local_private/run.XXXXXXXX")
    run_id=${local_run##*/}
    container_name=dashboard-browser-$(printf '%s' "$run_id" | tr '[:upper:]' '[:lower:]')
    remote_output=$state_path/captures/$run_id
    remote_command "umask 077; mkdir -p '$state_path' '$remote_output'; chmod 700 '$state_path' '$remote_output'"
    credentials=$project_root/.secrets/dashboard-browser/credentials.json
    [[ ! -L $project_root/.secrets && ! -L $project_root/.secrets/dashboard-browser && ! -L $credentials ]] || fail 'Private credentials must not use symbolic links.'
    remote_command "test ! -L '$state_path/credentials.json' && test ! -L '$state_path/session.json'" || fail 'Remote credentials and sessions must not use symbolic links.'
    if [[ -f $credentials && ! -L $credentials ]]; then
      chmod 600 "$credentials"
      rsync --archive --chmod=F600 -e "$remote_shell" "$credentials" "$target:$state_path/credentials.json"
    fi
    remote_command "set -eu
cleanup() {
  owner=\$(sudo -n docker inspect --format '{{index .Config.Labels \"com.ajin.dashboard.browser-run\"}}' '$container_name' 2>/dev/null) || return 0
  if [ \"\$owner\" = '$run_id' ]; then sudo -n docker stop --time 5 '$container_name' >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
timeout --signal=TERM --kill-after=10s 120s sudo -n docker run --rm --init \\
  --name '$container_name' --label com.ajin.dashboard.browser-inspection=true --label 'com.ajin.dashboard.browser-run=$run_id' \\
  --network host --user \"\$(id -u):\$(id -g)\" --read-only --cap-drop ALL \\
  --security-opt no-new-privileges --memory 1g --cpus 1.0 --pids-limit 256 \\
  --tmpfs /tmp:rw,nosuid,nodev,size=512m,mode=1777 --shm-size 256m \\
  --mount 'type=bind,source=$state_path,target=/state' \\
  --mount 'type=bind,source=$remote_output,target=/artifacts' \\
  --mount 'type=bind,source=$remote_path/scripts/browser-inspection.ts,target=/app/scripts/browser-inspection.ts,readonly' \\
  '$image'$arguments"
    rsync --archive --chmod=D700,F600 -e "$remote_shell" "$target:$remote_output/" "$local_run/"
    printf 'Private capture directory: %s\n' "$local_run"
    ;;
esac
