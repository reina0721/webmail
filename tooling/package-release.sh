#!/bin/sh
set -eu
version=${1:?v-prefixed release required}
case "$version" in v[0-9]*.[0-9]*.[0-9]*) ;; *) exit 1;; esac
case "$version" in *[!a-zA-Z0-9.-]*) exit 1;; esac
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
image="mail-web:${version#v}"
destination="$root/build/release/$version"
mkdir -p "$destination/package" "$destination/cli/bin"
docker build --target cli-artifact --output "type=local,dest=$destination/cli-build" .
cp "$destination/cli-build/mailwebctl" "$destination/cli/bin/mailwebctl"
chmod 755 "$destination/cli/bin/mailwebctl"
cp LICENSE NOTICE "$destination/cli/"
mkdir -p "$destination/cli/docs/upstream"
cp -R docs/upstream/dsh "$destination/cli/docs/upstream/"
printf '{"version":"%s","architecture":"linux/amd64"}\n' "$version" > "$destination/cli/cli-manifest.json"
test "$("$destination/cli/bin/mailwebctl" --version)" = "mailwebctl ${version#v}"
tar -czf "$destination/mailwebctl-linux-amd64.tar.gz" -C "$destination/cli" .
mkdir -p "$destination/package/bin"
cp "$destination/cli/bin/mailwebctl" "$destination/package/bin/"
test "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")" = linux/amd64
docker save "$image" -o "$destination/package/image.tar"
runtime=$(docker run --rm --pull never "$image" --runtime-info)
image_id=$(docker image inspect --format '{{.Id}}' "$image")
commit=$(git rev-parse HEAD)
migration_version=$(python3 -c 'from pathlib import Path;print(max(int(p.name.split("_")[0]) for p in Path("backend/migrations/sqlite").glob("*.sql")))')
jq -n --argjson migration "$migration_version" --arg version "$version" --arg commit "$commit" --arg image "$image" --arg id "$image_id" --argjson runtime "$runtime" '{cliVersion:($version|ltrimstr("v")),version:$version,sourceCommit:$commit,architecture:"linux/amd64",image:$image,imageId:$id,sqliteVersion:$runtime.sqlite,database:{engine:"sqlite",migrationVersion:$migration,rollback:"restore-matching-backup"}}' > "$destination/package/release-manifest.json"
cp compose.yaml .env.example README.md LICENSE NOTICE install.sh "$destination/package/"
cp -R deploy "$destination/package/"
cp -R docs "$destination/package/"
cp -R backend/contract "$destination/package/"
# Include the corresponding modified source with every binary release.
tar --exclude=.git --exclude=__pycache__ --exclude='*.pyc' --exclude='*.tsbuildinfo' --exclude=node_modules --exclude=target --exclude=.next --exclude=out --exclude=.cache --exclude=.pnpm-store --exclude=tests/runtime --exclude=.env -czf "$destination/package/source.tar.gz" Cargo.toml Cargo.lock Dockerfile release-version.txt compose.yaml .env.example .dockerignore .gitignore .gitattributes .github frontend backend crates tooling tests deploy docs LICENSE NOTICE README.md install.sh
(cd "$destination/package"; sha256sum image.tar > image.sha256)
tar -czf "$destination/mail-web-linux-amd64.tar.gz" -C "$destination/package" .
cp "$destination/package/release-manifest.json" "$destination/"
cp install.sh "$destination/install.sh"
(cd "$destination"; sha256sum mail-web-linux-amd64.tar.gz mailwebctl-linux-amd64.tar.gz release-manifest.json install.sh > SHA256SUMS)
printf '%s\n' "$destination"
