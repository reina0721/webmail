#!/bin/sh
# Read-only publication guard. Prints new or existing; never moves a tag.
set -eu
version=${1:?v-prefixed release required}
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
python3 tooling/release_metadata.py check-version "$version"
commit=$(git rev-parse HEAD)
repository=${GITHUB_REPOSITORY:-reina0721/webmail}
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT HUP INT TERM
if [ "${GITHUB_REF:-}" = refs/heads/main ]; then
 test "$(git ls-remote origin refs/heads/main | cut -f1)" = "$commit" || { echo 'Superseded main commit' >&2; exit 1; }
fi
# Prefer the peeled commit for annotated tags, otherwise use the lightweight ref.
git ls-remote origin "refs/tags/$version" "refs/tags/$version^{}" > "$stage/tag"
tag_commit=$(awk 'NR == 1 {sha=$1} /\^\{\}$/ {sha=$1} END {print sha}' "$stage/tag")
if [ -n "$tag_commit" ]; then
 test "$tag_commit" = "$commit" || { echo 'Version tag belongs to another commit; choose a new version' >&2; exit 1; }
fi
python3 tooling/release_status.py --lookup --repository "$repository" --version "$version" > "$stage/release"
if jq -e 'type == "object"' "$stage/release" >/dev/null; then
 # GitHub ignores target_commitish when the tag already exists. A symbolic
 # target is acceptable only with a tag already verified against this commit.
 jq -e --arg commit "$commit" --arg tag "$tag_commit" '.draft == true and
   (.target_commitish == $commit or
    ($tag == $commit and (.target_commitish | test("^[0-9a-fA-F]{40}$") | not)))' "$stage/release" >/dev/null || {
  echo 'Published versions are immutable; draft retries must use the same source commit' >&2; exit 1;
 }
 echo existing
else
 echo new
fi
