#!/usr/bin/env bash
# Run: PUBLIC_ORIGIN=https://mail.example.org bash examples/install-unattended.sh
set -Eeuo pipefail
: "${PUBLIC_ORIGIN:?Set PUBLIC_ORIGIN to your existing HTTPS reverse-proxy origin}"
case "$PUBLIC_ORIGIN" in https://*) ;; *) echo 'Use an HTTPS origin for this example' >&2; exit 1;; esac
repository=${MAIL_WEB_REPOSITORY:-reina0721/webmail}
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
curl -fsSL "https://raw.githubusercontent.com/$repository/main/install.sh" -o "$stage/install.sh"
bash "$stage/install.sh" --yes --repository "$repository" \
 --dir "${INSTALL_DIR:-$HOME/apps/mail-web}" --container-name "${CONTAINER_NAME:-my-webmail}" \
 --bind 127.0.0.1 --port "${PORT:-18090}" --public-origin "$PUBLIC_ORIGIN" "$@"
