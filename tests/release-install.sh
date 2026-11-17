#!/bin/sh
# Verify actual public or authenticated draft Release assets in isolated folders.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
version=${1:?explicit release version required}
repository=${MAIL_WEB_REPOSITORY:-reina0721/webmail}
assets=${MAIL_WEB_RELEASE_ASSET_DIR:-$root/tests/runtime/release-assets-$version}
mkdir -p "$assets"
if [ -z "${MAIL_WEB_RELEASE_ASSET_DIR:-}" ]; then
 command -v gh >/dev/null || { echo 'gh is required only for authenticated draft asset acceptance; set MAIL_WEB_RELEASE_ASSET_DIR for downloaded assets.' >&2;exit 1; }
 gh release download "$version" --repo "$repository" --dir "$assets" --clobber
fi
(cd "$assets"; sha256sum -c SHA256SUMS)
python3 "$root/tests/installer-integration.py" "$assets/mail-web-linux-amd64.tar.gz" --legacy
