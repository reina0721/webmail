#!/bin/sh
# Fast local pre-release verification before pushing [release-preview].
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

version=$(cat release-version.txt)
python3 tooling/release_metadata.py check-version "$version"
python3 tooling/check-repository.py
cargo fmt --all -- --check

node frontend/tooling/check-boundaries.mjs
node frontend/tooling/check-boundaries-fixtures.mjs
node tooling/check-persistence.mjs
node tooling/check-upstream.mjs
node --test tests/motion-styles.test.mjs tests/operation-id.test.mjs tests/admin-access.test.mjs tests/setup-guidance.test.mjs tests/platform-account-context.test.mjs tests/release-workflows.test.mjs

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  rust_image=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^rust:.*bookworm$' | head -n 1 || true)
  if [ -n "$rust_image" ]; then
    registry_mount="-v mailweb-precheck-registry:/usr/local/cargo/registry"
    offline_flag=""
    if [ -n "${CARGO_HOME:-}" ] && [ -d "$CARGO_HOME/registry" ]; then
      registry_mount="-v $CARGO_HOME/registry:/usr/local/cargo/registry"
    elif [ -d "${HOME:-}/.cargo/registry" ]; then
      registry_mount="-v $HOME/.cargo/registry:/usr/local/cargo/registry"
    fi
    docker run --rm \
      -v "$root:/source:ro" \
      $registry_mount \
      -v mailweb-precheck-target:/target-linux \
      -w /source \
      -e CARGO_TARGET_DIR=/target-linux \
      "$rust_image" \
      bash -c 'cargo check --locked --workspace --all-targets && cargo test --locked -p mailwebctl'
  else
    echo "Skipping Linux Docker check (no cached rust:*-bookworm image)" >&2
  fi
elif [ "$(uname -s)" = "Linux" ]; then
  cargo check --locked --workspace --all-targets
else
  echo "Skipping Linux workspace check (Docker daemon unavailable)" >&2
fi
