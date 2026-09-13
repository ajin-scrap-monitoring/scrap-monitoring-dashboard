#!/usr/bin/env bash

set -euo pipefail

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

tracked_secret_paths=$(git ls-files -- '.secrets/**' '*.key' '*.p12' '*.pfx' '*.p8' '*.jks' '*.keystore')
if [[ -n "$tracked_secret_paths" ]]; then
  printf '%s\n' "$tracked_secret_paths" >&2
  fail 'Git tracks a private key or secret storage path.'
fi

tracked_environment_files=$(git ls-files -- '.env' '.env.*' | grep -v '^.env.example$' || true)
if [[ -n "$tracked_environment_files" ]]; then
  printf '%s\n' "$tracked_environment_files" >&2
  fail 'Git tracks an environment file other than .env.example.'
fi

private_key_prefix='-----BEGIN '
private_key_suffix='PRIVATE KEY-----'
tracked_private_key_blocks=$(
  git grep -I -l -E -- "${private_key_prefix}.*${private_key_suffix}" -- . \
    ':(exclude)scripts/verify-repository-secrets.sh' || true
)
if [[ -n "$tracked_private_key_blocks" ]]; then
  printf '%s\n' "$tracked_private_key_blocks" >&2
  fail 'Git tracks a PEM private key block.'
fi

for required_pattern in '.secrets' '*.key' '*.pem' '*.crt' '*.cer' '*.p12' '*.pfx' '*.p8' '*.jks' '*.keystore'; do
  grep -Fqx -- "$required_pattern" .dockerignore || fail ".dockerignore does not exclude $required_pattern."
done

printf 'Repository secret boundary checks passed.\n'
