#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s <dashboard-image>\n' "$0" >&2
  exit 2
fi

for required_command in curl docker openssl; do
  command -v "$required_command" >/dev/null || {
    printf 'Required command is unavailable: %s\n' "$required_command" >&2
    exit 1
  }
done
docker compose version >/dev/null

image=$1
script_directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repository_root=$(cd "$script_directory/../.." && pwd)
work_directory=$(mktemp -d "${VERIFY_RUN_DIRECTORY:-/tmp}/tls.XXXXXXXX")
project_name="scrap-tls-test-${VERIFY_RUN_ID:-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')}"
[[ $project_name =~ ^scrap-tls-test-[a-z0-9-]+$ ]] || { printf 'Invalid verification identifier.\n' >&2; exit 1; }
server_name=dashboard.test

export TLS_TEST_IMAGE=$image
export TLS_TEST_CERTIFICATE_FILE=$work_directory/dashboard-fullchain.pem
export TLS_TEST_PRIVATE_KEY_FILE=$work_directory/dashboard-private-key.pem
export TLS_TEST_NGINX_CONFIG=$script_directory/nginx.conf
export TLS_TEST_RUNTIME_LOCATION_FILE=$script_directory/runtime-location.conf
export TLS_TEST_RUNTIME_CONFIG_FILE=$work_directory/runtime-config.json
cp "$repository_root/integration/runtime-config.json" "$TLS_TEST_RUNTIME_CONFIG_FILE"
chmod 644 "$TLS_TEST_RUNTIME_CONFIG_FILE"

compose() {
  docker compose --project-name "$project_name" --file "$script_directory/compose.yaml" "$@"
}

cleanup() {
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf -- "$work_directory"
}
trap cleanup EXIT

chmod 700 "$work_directory"

openssl genpkey \
  -algorithm EC \
  -pkeyopt ec_paramgen_curve:P-256 \
  -out "$work_directory/root-ca.key" 2>/dev/null
openssl req \
  -x509 \
  -new \
  -sha256 \
  -days 3650 \
  -key "$work_directory/root-ca.key" \
  -subj '/CN=Dashboard TLS Test Root CA' \
  -addext 'basicConstraints=critical,CA:TRUE,pathlen:1' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign' \
  -out "$work_directory/root-ca.crt" 2>/dev/null

openssl genpkey \
  -algorithm EC \
  -pkeyopt ec_paramgen_curve:P-256 \
  -out "$work_directory/intermediate-ca.key" 2>/dev/null
openssl req \
  -new \
  -sha256 \
  -key "$work_directory/intermediate-ca.key" \
  -subj '/CN=Dashboard TLS Test Intermediate CA' \
  -addext 'basicConstraints=critical,CA:TRUE,pathlen:0' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign' \
  -out "$work_directory/intermediate-ca.csr" 2>/dev/null
openssl x509 \
  -req \
  -sha256 \
  -days 1825 \
  -in "$work_directory/intermediate-ca.csr" \
  -CA "$work_directory/root-ca.crt" \
  -CAkey "$work_directory/root-ca.key" \
  -CAcreateserial \
  -copy_extensions copy \
  -out "$work_directory/intermediate-ca.crt" 2>/dev/null

openssl genpkey \
  -algorithm EC \
  -pkeyopt ec_paramgen_curve:P-256 \
  -out "$TLS_TEST_PRIVATE_KEY_FILE" 2>/dev/null
openssl req \
  -new \
  -sha256 \
  -key "$TLS_TEST_PRIVATE_KEY_FILE" \
  -subj "/CN=$server_name" \
  -addext "subjectAltName=DNS:$server_name" \
  -addext 'basicConstraints=critical,CA:FALSE' \
  -addext 'keyUsage=critical,digitalSignature' \
  -addext 'extendedKeyUsage=serverAuth' \
  -out "$work_directory/dashboard.csr" 2>/dev/null
openssl x509 \
  -req \
  -sha256 \
  -days 365 \
  -in "$work_directory/dashboard.csr" \
  -CA "$work_directory/intermediate-ca.crt" \
  -CAkey "$work_directory/intermediate-ca.key" \
  -CAcreateserial \
  -copy_extensions copy \
  -out "$work_directory/dashboard.crt" 2>/dev/null

cp "$work_directory/dashboard.crt" "$TLS_TEST_CERTIFICATE_FILE"
cat "$work_directory/intermediate-ca.crt" >> "$TLS_TEST_CERTIFICATE_FILE"
rm -- "$work_directory/root-ca.key" "$work_directory/intermediate-ca.key"
chmod 644 \
  "$TLS_TEST_CERTIFICATE_FILE" \
  "$work_directory/root-ca.crt"
docker run \
  --rm \
  --user 0 \
  --mount "type=bind,source=$work_directory,target=/work" \
  "$image" \
  chgrp 101 /work/dashboard-private-key.pem
chmod 640 "$TLS_TEST_PRIVATE_KEY_FILE"

DASHBOARD_TLS_CERTIFICATE_FILE=$TLS_TEST_CERTIFICATE_FILE \
DASHBOARD_TLS_PRIVATE_KEY_FILE=$TLS_TEST_PRIVATE_KEY_FILE \
DASHBOARD_ROOT_CA_FILE=$work_directory/root-ca.crt \
  "$repository_root/scripts/verify-tls-material.sh" >/dev/null

compose config --quiet
compose up --detach --wait dashboard dashboard-unconfigured >/dev/null
compose exec --no-TTY dashboard sh -c "
  test \"\$(id -u)\" = 101 &&
  test \"\$(stat -c %g /run/secrets/dashboard_tls_private_key)\" = 101 &&
  test \"\$(stat -c %a /run/secrets/dashboard_tls_private_key)\" = 640 &&
  test -r /run/secrets/dashboard_tls_private_key &&
  test ! -w /run/secrets/dashboard_tls_private_key &&
  test -r /run/certs/dashboard-fullchain.pem &&
  test ! -w /run/certs/dashboard-fullchain.pem &&
  test -r /usr/share/nginx/html/runtime-config.json &&
  test ! -w /usr/share/nginx/html/runtime-config.json
"
compose exec --no-TTY dashboard nginx -t >/dev/null

published_endpoint=$(compose port dashboard 8443)
published_port=${published_endpoint##*:}

verify_runtime_config() {
  curl --fail --silent --show-error --cacert "$work_directory/root-ca.crt" \
    --resolve "$server_name:$published_port:127.0.0.1" --dump-header "$work_directory/runtime-headers" \
    "https://$server_name:$published_port/runtime-config.json" --output "$work_directory/runtime-response.json"
  grep --ignore-case --quiet '^content-type: application/json' "$work_directory/runtime-headers"
  grep --ignore-case --quiet '^cache-control: no-store' "$work_directory/runtime-headers"
  cmp "$TLS_TEST_RUNTIME_CONFIG_FILE" "$work_directory/runtime-response.json"
}
verify_runtime_config

https_get() {
  curl --fail --silent --show-error --cacert "$work_directory/root-ca.crt" \
    --resolve "$server_name:$published_port:127.0.0.1" \
    --dump-header "$work_directory/site-headers" \
    --output "$work_directory/site-response" "https://$server_name:$published_port$1"
}

compose exec --no-TTY dashboard cat /usr/share/nginx/html/index.html > "$work_directory/index.html"
https_get /
cmp "$work_directory/index.html" "$work_directory/site-response"
for header in \
  'x-content-type-options: nosniff' \
  'referrer-policy: no-referrer' \
  'x-frame-options: deny' \
  "content-security-policy: .*frame-ancestors 'none'" \
  'permissions-policy: camera=(), microphone=()' \
  'x-request-id: '; do
  grep --ignore-case --quiet "^$header" "$work_directory/site-headers"
done
grep --ignore-case --quiet '^cache-control: no-store' "$work_directory/site-headers"
if grep --ignore-case --quiet '^server: nginx/' "$work_directory/site-headers"; then
  printf 'HTTPS response exposed the Nginx version.\n' >&2
  exit 1
fi
https_get /recordings
cmp "$work_directory/index.html" "$work_directory/site-response"
grep --ignore-case --quiet '^cache-control: no-store' "$work_directory/site-headers"
asset_path=$(compose exec --no-TTY dashboard sh -c "find /usr/share/nginx/html/assets -type f -name '*.js' | head -n 1")
[[ -n $asset_path ]] || { printf 'JavaScript asset is missing.\n' >&2; exit 1; }
https_get "/assets/${asset_path##*/}"
grep --ignore-case --quiet '^cache-control: public, max-age=31536000, immutable' "$work_directory/site-headers"
grep --ignore-case --quiet '^x-content-type-options: nosniff' "$work_directory/site-headers"
[[ $(curl --silent --show-error --cacert "$work_directory/root-ca.crt" \
  --resolve "$server_name:$published_port:127.0.0.1" \
  --output /dev/null --write-out '%{http_code}' "https://$server_name:$published_port/assets/missing.js") == 404 ]]
https_get /tls-test-runtime
grep --fixed-strings --line-regexp --quiet 'runtime location ok' "$work_directory/site-response"

first_image=$(docker inspect --format '{{.Image}}' "$(compose ps --quiet dashboard)")
export TLS_TEST_RUNTIME_CONFIG_FILE=$work_directory/runtime-config-alt.json
cp "$repository_root/integration/runtime-config-alt.json" "$TLS_TEST_RUNTIME_CONFIG_FILE"
chmod 644 "$TLS_TEST_RUNTIME_CONFIG_FILE"
compose up --detach --force-recreate --wait dashboard >/dev/null
[[ $(docker inspect --format '{{.Image}}' "$(compose ps --quiet dashboard)") == "$first_image" ]] || { printf 'Runtime configuration changed the image.\n' >&2; exit 1; }
published_endpoint=$(compose port dashboard 8443)
published_port=${published_endpoint##*:}
verify_runtime_config
unconfigured_endpoint=$(compose port dashboard-unconfigured 8443)
unconfigured_port=${unconfigured_endpoint##*:}
unconfigured_status=$(curl --silent --show-error --cacert "$work_directory/root-ca.crt" \
  --resolve "$server_name:$unconfigured_port:127.0.0.1" --dump-header "$work_directory/unconfigured-headers" \
  --output /dev/null --write-out '%{http_code}' "https://$server_name:$unconfigured_port/runtime-config.json")
[[ $unconfigured_status == 404 ]] || { printf 'Missing HTTPS runtime configuration used the SPA fallback.\n' >&2; exit 1; }
grep --ignore-case --quiet '^cache-control: no-store' "$work_directory/unconfigured-headers"

curl \
  --fail \
  --silent \
  --show-error \
  --cacert "$work_directory/root-ca.crt" \
  --resolve "$server_name:$published_port:127.0.0.1" \
  "https://$server_name:$published_port/healthz" |
  grep --fixed-strings --line-regexp --quiet ok

invalid_server_name=invalid.dashboard.test
if curl \
  --fail \
  --silent \
  --cacert "$work_directory/root-ca.crt" \
  --resolve "$invalid_server_name:$published_port:127.0.0.1" \
  "https://$invalid_server_name:$published_port/healthz" >/dev/null 2>&1; then
  printf 'TLS hostname verification unexpectedly accepted an invalid name.\n' >&2
  exit 1
fi

example_directory=$repository_root/deploy/example
cat > "$work_directory/example-override.env" <<EOF
DASHBOARD_IMAGE=$image
DASHBOARD_TLS_CERTIFICATE_FILE=$TLS_TEST_CERTIFICATE_FILE
DASHBOARD_TLS_PRIVATE_KEY_FILE=$TLS_TEST_PRIVATE_KEY_FILE
DASHBOARD_RUNTIME_CONFIG_FILE=$TLS_TEST_RUNTIME_CONFIG_FILE
EOF
docker compose --project-directory "$example_directory" --file "$example_directory/compose.yaml" \
  --env-file "$example_directory/example.env" --env-file "$work_directory/example-override.env" config --quiet
docker run --rm --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --mount "type=bind,source=$TLS_TEST_CERTIFICATE_FILE,target=/run/certs/dashboard-fullchain.pem,readonly" \
  --mount "type=bind,source=$TLS_TEST_PRIVATE_KEY_FILE,target=/run/secrets/dashboard_tls_private_key,readonly" \
  --mount "type=bind,source=$example_directory/nginx/https.conf,target=/etc/nginx/conf.d/https.conf,readonly" \
  --mount "type=bind,source=$example_directory/nginx/upstreams/10-dashboard-upstreams.conf,target=/etc/nginx/upstreams/10-dashboard-upstreams.conf,readonly" \
  --mount "type=bind,source=$example_directory/nginx/runtime/20-dashboard-locations.conf,target=/etc/nginx/runtime/20-dashboard-locations.conf,readonly" \
  "$image" nginx -t >/dev/null 2>&1 || { printf 'Deployment example Nginx configuration failed nginx -t.\n' >&2; exit 1; }

printf 'Verified TLS certificate chain, Docker Secret, Nginx HTTPS and deployment example for %s.\n' "$image"
