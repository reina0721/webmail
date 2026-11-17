#!/bin/sh
set -eu
version=${1:?Usage: sh tooling/package-release.sh VERSION [amd64|arm64]}
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
native=$(sh tooling/platform.sh)
architecture=${2:-$native}
case "$architecture" in amd64|arm64) ;; *) echo 'Unsupported release architecture' >&2; exit 1;; esac
test "$architecture" = "$native" || { echo 'Build and verify releases on a matching native host' >&2; exit 1; }
test "$(docker info --format '{{.OSType}}/{{.Architecture}}' | sed 's/x86_64/amd64/;s/aarch64/arm64/')" = "linux/$architecture"
python3 tooling/release_metadata.py check-version "$version"
# Runtime/source correspondence requires committed build inputs. The full local
# integration suite may update docs/feature-parity.json with fresh evidence.
git diff --quiet HEAD -- . ':!docs/feature-parity.json' || { echo 'Commit tracked changes before packaging a release' >&2; exit 1; }
untracked=$(git ls-files --others --exclude-standard)
test -z "$untracked" || { echo 'Commit new build inputs before packaging a release' >&2; exit 1; }
image="mail-web:${version#v}"
destination="$root/build/release/$version/$architecture"
mkdir -p "$destination"
# Each invocation owns a new staging directory; stale files cannot enter a bundle.
stage=$(mktemp -d "$root/build/release-stage.XXXXXX")
trap 'rm -rf "$stage"' EXIT HUP INT TERM
mkdir -p "$stage/package/bin" "$stage/cli/bin"
docker build --platform "linux/$architecture" --target cli-artifact --output "type=local,dest=$stage/cli-build" .
cp "$stage/cli-build/mailwebctl" "$stage/cli/bin/mailwebctl"
chmod 755 "$stage/cli/bin/mailwebctl"
python3 - "$stage/cli/bin/mailwebctl" "$architecture" <<'PY'
import pathlib, struct, sys
with pathlib.Path(sys.argv[1]).open('rb') as stream:
    header = stream.read(20)
assert header[:6] == b'\x7fELF\x02\x01', 'Expected a 64-bit little-endian ELF CLI'
assert struct.unpack('<H', header[18:20])[0] == {'amd64': 62, 'arm64': 183}[sys.argv[2]], 'CLI architecture mismatch'
PY
test "$("$stage/cli/bin/mailwebctl" --version)" = "mailwebctl ${version#v}"
cp LICENSE NOTICE "$stage/cli/"
mkdir -p "$stage/cli/docs/upstream"
cp -R docs/upstream/dsh "$stage/cli/docs/upstream/"
printf '{"version":"%s","architecture":"linux/%s"}\n' "$version" "$architecture" > "$stage/cli/cli-manifest.json"
tar -czf "$destination/mailwebctl-linux-$architecture.tar.gz" -C "$stage/cli" .
cp "$stage/cli/bin/mailwebctl" "$stage/package/bin/"
test "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")" = "linux/$architecture"
runtime=$(docker run --rm --pull never "$image" --runtime-info)
commit=$(git rev-parse HEAD)
printf '%s' "$runtime" | jq -e --arg version "${version#v}" --arg commit "$commit" '.version == $version and .revision == $commit' >/dev/null
docker save "$image" -o "$stage/package/image.tar"
image_id=$(python3 tooling/image_config_id.py "$stage/package/image.tar" "$image")
migration_version=$(python3 -c 'from pathlib import Path; print(max(int(p.name.split("_")[0]) for p in Path("backend/migrations/sqlite").glob("*.sql")))')
jq -n --argjson migration "$migration_version" --arg version "$version" --arg commit "$commit" --arg arch "linux/$architecture" --arg image "$image" --arg id "$image_id" --argjson runtime "$runtime" '{cliVersion:($version|ltrimstr("v")),version:$version,sourceCommit:$commit,architecture:$arch,image:$image,imageId:$id,sqliteVersion:$runtime.sqlite,database:{engine:"sqlite",migrationVersion:$migration,rollback:"restore-matching-backup"}}' > "$stage/package/release-manifest.json"
cp compose.yaml .env.example README.md README_ZH.md CONTRIBUTING.md CHANGELOG.md SECURITY.md llms.txt LICENSE NOTICE install.sh "$stage/package/"
cp -R deploy docs examples "$stage/package/"
cp -R backend/contract "$stage/package/"
# The source corresponds to the recorded commit, never to test-generated state.
git archive --format=tar.gz HEAD > "$stage/package/source.tar.gz"
python3 tooling/release_metadata.py verify-source "$version" --inputs "$stage/package/source.tar.gz"
(cd "$stage/package"; sha256sum image.tar > image.sha256)
tar -czf "$destination/mail-web-linux-$architecture.tar.gz" -C "$stage/package" .
cp "$stage/package/release-manifest.json" "$destination/release-manifest-linux-$architecture.json"
printf '%s\n' "$destination"
