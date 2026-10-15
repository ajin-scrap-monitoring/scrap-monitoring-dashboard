#!/usr/bin/env bash

set -euo pipefail

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

usage() {
  printf '%s\n' 'Usage: bash scripts/remote-development.sh {sync|start|watch|stop}' \
    'Required: DASHBOARD_DEV_SSH_TARGET, DASHBOARD_DEV_REMOTE_PATH' \
    'Optional: DASHBOARD_DEV_SSH_RELAY' \
    'start copies the local .env.remote; watch synchronizes source every two seconds.'
}

action=${1:-}
if [[ $action == --help || $action == -h ]]; then
  usage
  exit 0
fi
[[ $# == 1 ]] || { usage >&2; exit 1; }
case $action in sync|start|watch|stop) ;; *) usage >&2; exit 1 ;; esac

target=${DASHBOARD_DEV_SSH_TARGET:-}
relay=${DASHBOARD_DEV_SSH_RELAY:-}
remote_path=${DASHBOARD_DEV_REMOTE_PATH:-}
[[ $target =~ ^([A-Za-z0-9][A-Za-z0-9._-]*@)?[A-Za-z0-9][A-Za-z0-9._-]*$ ]] \
  || fail 'Set DASHBOARD_DEV_SSH_TARGET to an SSH host or user@host.'
[[ -z $relay || $relay =~ ^([A-Za-z0-9][A-Za-z0-9._-]*@)?[A-Za-z0-9][A-Za-z0-9._-]*$ ]] \
  || fail 'DASHBOARD_DEV_SSH_RELAY must be an SSH host or user@host.'
[[ $remote_path =~ ^/[A-Za-z0-9._/-]+/scrap-monitoring-dashboard-dev$ ]] \
  || fail 'Use an absolute remote path ending in /scrap-monitoring-dashboard-dev.'
[[ $remote_path != *'/../'* && $remote_path != *'/./'* && $remote_path != *'//'* ]] \
  || fail 'The remote path must not contain dot segments or duplicate separators.'

for required_command in git ssh rsync; do
  command -v "$required_command" >/dev/null || fail "Install $required_command on the synchronization client."
done
rsync_help=$(rsync --help)
[[ $rsync_help == *'--from0'* && $rsync_help == *'--delete-missing-args'* ]] \
  || fail 'rsync must support --from0 and --delete-missing-args.'

project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
git -C "$project_root" rev-parse --is-inside-work-tree >/dev/null
ssh_command=(ssh -o BatchMode=yes -o ConnectTimeout=8)
if [[ -n $relay ]]; then
  ssh_command+=("$relay" ssh -o BatchMode=yes -o ConnectTimeout=8)
fi
printf -v remote_shell '%q ' "${ssh_command[@]}"

remote_command() {
  if [[ -n $relay ]]; then
    local quoted_command
    quoted_command=${1//\'/\'\\\'\'}
    quoted_command="'$quoted_command'"
    ssh -o BatchMode=yes -o ConnectTimeout=8 "$relay" \
      "ssh -o BatchMode=yes -o ConnectTimeout=8 $target $quoted_command"
  else
    "${ssh_command[@]}" "$target" "$1"
  fi
}

prepare_directory() {
  remote_command "if [ -L '$remote_path' ] || [ -e '$remote_path/.git' ]; then
    printf '%s\\n' 'Refusing to overwrite a remote Git worktree.' >&2; exit 1
  fi
  if [ -d '$remote_path' ] && [ ! -f '$remote_path/compose.remote-development.yaml' ] &&
    [ -n \"\$(find '$remote_path' -mindepth 1 -maxdepth 1 -print -quit)\" ]; then
    printf '%s\\n' 'The remote development directory must be empty or a dashboard development mirror.' >&2; exit 1
  fi
  mkdir -p '$remote_path'"
}

public_source_path() {
  local remaining=$1 component
  [[ $remaining != runtime-config.json ]] || return 1
  while :; do
    component=${remaining%%/*}
    case $component in
      .env.example) ;;
      ''|.|..|.git|.secrets|.env|.env.*|*.key|*.pem|*.crt|*.p12|*.pfx) return 1 ;;
    esac
    [[ $remaining == */* ]] || break
    remaining=${remaining#*/}
  done
}

sync_source() (
  umask 077
  local git_directory manifest_directory manifest_key manifest previous temporary path path_key path_keys=$'\n'
  git_directory=$(git -C "$project_root" rev-parse --absolute-git-dir) || return
  manifest_directory=$git_directory/dashboard-development-sync
  manifest_key=$(printf '%s\0' "$target" "$relay" "$remote_path" | git -C "$project_root" hash-object --stdin) || return
  manifest=$manifest_directory/$manifest_key
  mkdir -p "$manifest_directory" || return
  temporary=$(mktemp -d "$manifest_directory/sync.XXXXXX") || return
  trap 'rm -f -- "$temporary/git-files" "$temporary/transfer" "$temporary/deletions" "$temporary/next" "$temporary/pending"; find "$temporary" -depth -type d -exec rmdir -- {} \;' EXIT
  git -C "$project_root" ls-files --cached --others --exclude-standard -z > "$temporary/git-files" || return
  : > "$temporary/transfer"
  : > "$temporary/deletions"
  : > "$temporary/next"
  while IFS= read -r -d '' path; do
    public_source_path "$path" || continue
    [[ ! -d $project_root/$path || -L $project_root/$path ]] || continue
    if [[ ! -e $project_root/$path && ! -L $project_root/$path && $path == */* && ! -d $project_root/${path%/*} ]]; then
      continue
    fi
    printf -v path_key '%q' "$path"
    case $path_keys in *$'\n'"$path_key"$'\n'*) continue ;; esac
    path_keys+="$path_key"$'\n'
    if [[ -e $project_root/$path || -L $project_root/$path ]]; then
      printf '%s\0' "$path" >> "$temporary/transfer"
      printf '%s\0' "$path" >> "$temporary/next"
    else
      printf '%s\0' "$path" >> "$temporary/deletions"
    fi
  done < "$temporary/git-files"
  previous=$manifest
  [[ ! -f $manifest.pending ]] || previous=$manifest.pending
  if [[ -f $previous ]]; then
    while IFS= read -r -d '' path; do
      public_source_path "$path" || continue
      printf -v path_key '%q' "$path"
      case $path_keys in *$'\n'"$path_key"$'\n'*) continue ;; esac
      path_keys+="$path_key"$'\n'
      if [[ -L $project_root/$path || ( -e $project_root/$path && ! -d $project_root/$path ) ]]; then
        # Git에서 제외한 기존 경로는 삭제 추적만 유지하고 현재 내용을 전송하지 않는다.
        printf '%s\0' "$path" >> "$temporary/next"
      else
        printf '%s\0' "$path" >> "$temporary/deletions"
      fi
    done < "$previous"
  fi
  # rsync가 일부 파일을 전송한 뒤 실패해도 다음 실행에서 삭제를 추적한다.
  cat "$temporary/next" "$temporary/deletions" > "$temporary/pending" || return
  mv -f "$temporary/pending" "$manifest.pending" || return
  if [[ -s $temporary/deletions ]]; then
    mkdir -p "$temporary/deletion-source" || return
    while IFS= read -r -d '' path; do
      [[ $path != */* ]] || mkdir -p "$temporary/deletion-source/${path%/*}" || return
    done < "$temporary/deletions"
    # rsync는 삭제 경로만 처리하며 임시 parent directory의 권한을 원격에 적용하지 않는다.
    rsync --delete-missing-args --from0 --files-from="$temporary/deletions" \
      --itemize-changes --out-format='%i %n' \
      -e "$remote_shell" "$temporary/deletion-source/" "$target:$remote_path/" || return
    # 삭제 성공 후에는 공개 파일 전송의 부분 실패만 추적한다.
    cp "$temporary/next" "$temporary/pending" || return
    mv -f "$temporary/pending" "$manifest.pending" || return
  fi
  # rsync는 Git에서 현재 공개한 파일만 복사하며 directory를 순회하지 않는다.
  rsync --archive --compress --delete-missing-args --from0 \
    --files-from="$temporary/transfer" \
    --include='.env.example' --exclude='.env' --exclude='.env.*' \
    --exclude='.git' --exclude='.secrets/' --exclude='/runtime-config.json' \
    --exclude='*.key' --exclude='*.pem' --exclude='*.crt' --exclude='*.p12' --exclude='*.pfx' \
    --itemize-changes --out-format='%i %n' \
    -e "$remote_shell" "$project_root/" "$target:$remote_path/" || return
  mv -f "$temporary/next" "$manifest" || return
  rm -f -- "$manifest.pending"
)

compose_command="cd '$remote_path' && sudo -n docker compose -p scrap-monitoring-dashboard-dev \
--env-file .env.remote -f compose.yaml -f compose.remote-development.yaml"

case $action in
  sync)
    prepare_directory
    sync_source
    ;;
  start)
    [[ -f $project_root/.env.remote ]] || fail 'Copy development/.env.example to .env.remote and configure the existing services.'
    prepare_directory
    sync_source
    rsync --archive --chmod=F600 -e "$remote_shell" "$project_root/.env.remote" "$target:$remote_path/.env.remote"
    remote_command "$compose_command up --detach --build --force-recreate --wait --wait-timeout 180 development development-gateway"
    ;;
  watch)
    prepare_directory
    trap 'exit 0' INT TERM
    printf '%s\n' 'Synchronizing dashboard source every two seconds. Stop with Ctrl+C.'
    while :; do
      if ! sync_source; then
        printf '%s\n' 'Synchronization failed; retrying in two seconds.' >&2
      fi
      sleep 2
    done
    ;;
  stop)
    remote_command "$compose_command down"
    ;;
esac
