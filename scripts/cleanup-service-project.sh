#!/usr/bin/env bash
set -euo pipefail

project_name=${1:-}
[[ $project_name =~ ^dashboard-sync-[a-z0-9]{8}$ && $# -gt 1 ]] || { printf 'Invalid integration cleanup target.\n' >&2; exit 1; }
shift
empty_checks=0

# Docker가 완료하는 생성 요청까지 확인한 뒤 해당 project의 자원을 회수한다.
for attempt in {1..20}; do
  "$@" down --volumes --rmi local --remove-orphans
  containers=$(docker container ls --all --filter "label=com.docker.compose.project=$project_name" --quiet)
  networks=$(docker network ls --filter "label=com.docker.compose.project=$project_name" --quiet)
  volumes=$(docker volume ls --filter "label=com.docker.compose.project=$project_name" --quiet)
  if [[ -n $containers$networks$volumes ]]; then
    empty_checks=0
  else
    empty_checks=$((empty_checks + 1))
    [[ $empty_checks -lt 3 ]] || exit 0
  fi
  sleep 1
done
printf 'Integration project resources remain after cleanup.\n' >&2
exit 1
