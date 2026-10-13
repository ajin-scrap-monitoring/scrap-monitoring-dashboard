#!/usr/bin/env bash

set -euo pipefail

[[ $# -eq 2 ]] || { echo "Usage: $0 <empty-directory> <image-reference>" >&2; exit 2; }
release_directory=$1
image_reference=$2
repository_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
[[ -d "$release_directory" && ! -L "$release_directory" ]] || { echo "Release directory must be an existing directory." >&2; exit 1; }
[[ -z $(find "$release_directory" -mindepth 1 -print -quit) ]] || { echo "Release directory must be empty." >&2; exit 1; }
[[ "$image_reference" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] || { echo "Release image must use a GHCR digest reference." >&2; exit 1; }

cp "$repository_root/runtime-config.example.json" "$repository_root/docs/contracts/runtime-config.schema.json" "$release_directory/"
printf '%s\n' "$image_reference" > "$release_directory/image-reference.txt"
git -C "$repository_root" ls-files -z nginx | tar --directory "$repository_root" --null --files-from - \
  --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner --create --gzip --file "$release_directory/nginx-config.tar.gz"
(
  cd -- "$release_directory"
  sha256sum runtime-config.example.json runtime-config.schema.json image-reference.txt nginx-config.tar.gz > SHA256SUMS
)

echo "Prepared public release assets and SHA256SUMS."
