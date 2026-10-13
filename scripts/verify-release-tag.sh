#!/usr/bin/env bash

set -euo pipefail

[[ $# -eq 2 ]] || { echo "Usage: $0 <tag> <revision>" >&2; exit 2; }
release_tag=$1
release_revision=$2
[[ "$release_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Release tag must match vX.Y.Z." >&2; exit 1; }
[[ "$release_revision" =~ ^[0-9a-f]{40}$ ]] || { echo "Release revision must be a full Git SHA." >&2; exit 1; }
[[ $(git rev-parse --verify "refs/tags/$release_tag^{commit}") == "$release_revision" ]] || { echo "Release tag does not match the revision." >&2; exit 1; }
git merge-base --is-ancestor "$release_revision" refs/remotes/origin/main || { echo "Release revision is not in origin/main history." >&2; exit 1; }

echo "Verified $release_tag at $release_revision in origin/main history."
