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
architecture=$(sh "$root/tooling/platform.sh")
python3 "$root/tooling/release_metadata.py" verify-assets "$version" --inputs "$assets"
# Published historical shell releases only exist for AMD64.
if [ "$architecture" = amd64 ]; then
 python3 "$root/tests/installer-integration.py" "$assets/mail-web-linux-$architecture.tar.gz" --legacy
else
 python3 "$root/tests/installer-integration.py" "$assets/mail-web-linux-$architecture.tar.gz"
fi
