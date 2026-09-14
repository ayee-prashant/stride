#!/usr/bin/env bash
set -euo pipefail
umask 077

# A dedicated private CA already exists on this Stride database volume.
# Keys are used only inside the database container and are never printed/exported.
stride_cert_dir=/var/lib/postgresql/data/certs
stride_database_name=postgres.railway.internal
for stride_cert_file in root.crt root.key server.key; do
  test -s "$stride_cert_dir/$stride_cert_file"
done

if ! openssl verify -CAfile "$stride_cert_dir/root.crt" -verify_hostname "$stride_database_name" "$stride_cert_dir/server.crt" >/dev/null 2>&1 ||
   ! openssl x509 -in "$stride_cert_dir/server.crt" -noout -checkend 2592000 >/dev/null 2>&1; then
  stride_cert_temp=$(mktemp -d "$stride_cert_dir/stride-tls.XXXXXX")
  trap 'rm -rf "$stride_cert_temp"' EXIT
  openssl req -new -key "$stride_cert_dir/server.key" -subj "/CN=$stride_database_name" -out "$stride_cert_temp/server.csr"
  cat > "$stride_cert_temp/extensions" <<'EXT'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:postgres.railway.internal,DNS:localhost
EXT
  openssl x509 -req -in "$stride_cert_temp/server.csr" -CA "$stride_cert_dir/root.crt" -CAkey "$stride_cert_dir/root.key" -CAcreateserial -days 365 -sha256 -extfile "$stride_cert_temp/extensions" -out "$stride_cert_temp/server.crt"
  openssl verify -CAfile "$stride_cert_dir/root.crt" -verify_hostname "$stride_database_name" "$stride_cert_temp/server.crt" >/dev/null
  # Preserve the image's original file ownership, and replace only the leaf certificate.
  chown --reference="$stride_cert_dir/server.crt" "$stride_cert_temp/server.crt"
  chmod --reference="$stride_cert_dir/server.crt" "$stride_cert_temp/server.crt"
  cp -p "$stride_cert_dir/server.crt" "$stride_cert_dir/server.crt.previous"
  mv "$stride_cert_temp/server.crt" "$stride_cert_dir/server.crt"
  rm -rf "$stride_cert_temp"
  trap - EXIT
fi

openssl verify -CAfile "$stride_cert_dir/root.crt" -verify_hostname "$stride_database_name" "$stride_cert_dir/server.crt" >/dev/null
exec docker-entrypoint.sh postgres -p 5432 -c 'listen_addresses=*'
