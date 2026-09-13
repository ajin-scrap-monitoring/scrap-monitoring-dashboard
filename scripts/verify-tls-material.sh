#!/usr/bin/env bash

set -euo pipefail

certificate_file=${DASHBOARD_TLS_CERTIFICATE_FILE:-.secrets/tls/dashboard-fullchain.pem}
private_key_file=${DASHBOARD_TLS_PRIVATE_KEY_FILE:-.secrets/tls/dashboard-private-key.pem}
root_ca_file=${DASHBOARD_ROOT_CA_FILE:-.secrets/tls/root-ca.crt}

for required_file in "$certificate_file" "$private_key_file" "$root_ca_file"; do
  if [[ ! -r "$required_file" ]]; then
    printf 'Required TLS file is not readable: %s\n' "$required_file" >&2
    exit 1
  fi
done

certificate_count=$(grep -c -- '-----BEGIN CERTIFICATE-----' "$certificate_file")
if (( certificate_count < 2 )); then
  printf 'TLS certificate file must contain the server certificate followed by its intermediate chain.\n' >&2
  exit 1
fi

if ! openssl pkey -in "$private_key_file" -check -noout >/dev/null 2>&1; then
  printf 'TLS private key validation failed.\n' >&2
  exit 1
fi

certificate_public_key=$(
  openssl x509 -in "$certificate_file" -pubkey -noout |
    openssl pkey -pubin -outform DER 2>/dev/null |
    openssl dgst -sha256
)
private_public_key=$(
  openssl pkey -in "$private_key_file" -pubout -outform DER 2>/dev/null |
    openssl dgst -sha256
)
if [[ "$certificate_public_key" != "$private_public_key" ]]; then
  printf 'TLS server certificate and private key do not match.\n' >&2
  exit 1
fi

if ! openssl x509 -in "$root_ca_file" -noout -ext basicConstraints 2>/dev/null | grep -q 'CA:TRUE'; then
  printf 'Root CA certificate does not declare CA:TRUE.\n' >&2
  exit 1
fi

if ! openssl x509 -in "$certificate_file" -noout -ext subjectAltName >/dev/null 2>&1; then
  printf 'TLS server certificate does not contain a subjectAltName extension.\n' >&2
  exit 1
fi

if ! openssl x509 -in "$certificate_file" -purpose -noout | grep -q '^SSL server *: Yes$'; then
  printf 'TLS server certificate is not valid for server authentication.\n' >&2
  exit 1
fi

if ! openssl x509 -in "$certificate_file" -checkend 2592000 -noout >/dev/null; then
  printf 'TLS server certificate is expired or expires within 30 days.\n' >&2
  exit 1
fi

openssl verify \
  -CAfile "$root_ca_file" \
  -untrusted "$certificate_file" \
  "$certificate_file"
printf 'TLS certificate chain, validity and private key checks passed.\n'
