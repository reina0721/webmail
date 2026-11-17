#!/bin/sh
# Legacy installer URL; the release-pinned root bootstrap is authoritative.
set -eu
repository=${MAIL_WEB_REPOSITORY:-reina0721/webmail}
case "$repository" in *[!a-zA-Z0-9_./-]*|/*|*..*|*/*/*) exit 1;; */*) ;; *) exit 1;; esac
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT HUP INT TERM
curl -fsSL --proto '=https' --proto-redir '=https' "https://raw.githubusercontent.com/$repository/main/install.sh" -o "$stage/install.sh"
MAIL_WEB_REPOSITORY="$repository" bash "$stage/install.sh" "$@"
