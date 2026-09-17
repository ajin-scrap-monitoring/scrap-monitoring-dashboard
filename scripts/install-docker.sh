#!/usr/bin/env bash

set -euo pipefail

minimum_docker_version=29.8.0
minimum_compose_version=5.5.1

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

version_at_least() {
  local actual_version=$1
  local required_version=$2

  [[ $(printf '%s\n%s\n' "$required_version" "$actual_version" | sort --version-sort | head --lines 1) == "$required_version" ]]
}

[[ -r /etc/os-release ]] || fail 'This script requires a supported Ubuntu host.'

. /etc/os-release
[[ $ID == ubuntu ]] || fail 'This script supports Ubuntu 22.04, 24.04, and 26.04 only.'
case $VERSION_ID in
  22.04 | 24.04 | 26.04) ;;
  *) fail 'This script supports Ubuntu 22.04, 24.04, and 26.04 only.' ;;
esac
[[ $(dpkg --print-architecture) == amd64 ]] || fail 'This script supports the amd64 architecture only.'

sudo apt-get update
sudo apt-get install --yes ca-certificates curl
sudo install --mode 0755 --directory /etc/apt/keyrings
sudo curl --fail --silent --show-error --location \
  https://download.docker.com/linux/ubuntu/gpg \
  --output /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt-get update
sudo apt-get install --yes \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin
sudo systemctl enable --now docker.service containerd.service

docker_version=$(sudo docker version --format '{{.Server.Version}}')
compose_version=$(sudo docker compose version --short)
docker_version=${docker_version#v}
docker_version=${docker_version%%+*}
compose_version=${compose_version#v}
compose_version=${compose_version%%+*}

version_at_least "$docker_version" "$minimum_docker_version" || fail "Docker Engine $docker_version is below $minimum_docker_version."
version_at_least "$compose_version" "$minimum_compose_version" || fail "Docker Compose plugin $compose_version is below $minimum_compose_version."

printf 'Installed Docker Engine %s and Docker Compose plugin %s.\n' "$docker_version" "$compose_version"
printf 'Run Docker commands with sudo.\n'
