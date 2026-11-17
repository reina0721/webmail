# Contributing to Mail Web

Mail Web is a development preview maintained as one repository: Rust/Axum, the Rust host CLI and a statically exported Next.js client share a release version. For substantial changes, open an issue explaining the user problem before submitting a PR. Report sensitive issues according to [SECURITY.md](SECURITY.md).

## Development setup

Development commands require a source checkout, rather than an installed runtime directory.

Use a current stable Rust toolchain (edition 2024), Node.js 24, pnpm 10.22.0 and Python 3.11+. Full integration checks require Linux AMD64/ARM64, Docker Engine, Compose v2, curl, jq, OpenSSL and util-linux (`flock`). Docker access is required; do not point fixtures at production installations.

```sh
corepack enable
corepack prepare pnpm@10.22.0 --activate
pnpm --dir frontend install --frozen-lockfile
rustup component add rustfmt clippy
```

Read any `AGENTS.md` applying to the files you change. Keep platform behavior in Rust, reusable frontend packages within their existing boundaries, and generated API files synchronized.

## Local checks

From the repository root:

```sh
cargo fmt --all -- --check
cargo test --locked --workspace
cargo clippy --locked --workspace --all-targets -- -D warnings
pnpm --dir frontend typecheck
pnpm --dir frontend build
pnpm --dir frontend --filter @mail-web/web test:client
node frontend/tooling/check-boundaries.mjs
node frontend/tooling/check-boundaries-fixtures.mjs
node tooling/check-persistence.mjs
node tooling/check-upstream.mjs
node --test tests/motion-styles.test.mjs tests/operation-id.test.mjs tests/admin-access.test.mjs tests/setup-guidance.test.mjs tests/platform-account-context.test.mjs
python3 tests/release-acceptance.py
python3 tests/release-packaging.py
python3 tooling/check-repository.py
```

Check shell syntax with the correct interpreter:

```sh
bash -n install.sh
bash -n examples/install-unattended.sh
for script in deploy/*.sh tooling/*.sh tests/*.sh; do sh -n "$script"; done
```

The Docker `quality` target also runs Rust and client quality checks on the native platform:

```sh
docker build --target quality -t mail-web-quality:local .
```

For the complete disposable environment and real Stalwart tests:

```sh
sh deploy/test-env.sh up --build --verify
sh deploy/test-env.sh status
sh deploy/test-env.sh down
```

The complete check includes a registration soak of at least 30 minutes. It manages dedicated fixtures and requires Docker permissions. [Deployment](docs/deployment.md) and [acceptance boundaries](docs/rebuild-blockers.md) explain its scope. Development hot reload uses `sh deploy/dev.sh up`; return to the production test build with `sh deploy/dev.sh down`.

## API contract changes

Generate the OpenAPI contract from Rust, then regenerate TypeScript:

```sh
sh tooling/export-contract.sh
pnpm --dir frontend exec openapi-typescript ../backend/contract/openapi.json -o apps/web/src/platform/lib/generated-api.ts
```

Review and commit both generated files with the Rust change. CI checks that regeneration produces no diff. Do not hand-edit generated contracts.

## Upstream changes and pull requests

Preserve LICENSE, NOTICE and pinned source records. Changes to imported Bulwark files must follow the [upstream provenance process](docs/upstream/README.md); do not modify upstream fixtures to conceal a failing check.

Describe the resulting behavior, relevant compatibility changes and tests actually run. Include screenshots for UI changes and distinguish local evidence from public production verification. Keep secrets, mailbox contents, runtime databases, build output and caches out of commits. Release changes follow the [release guide](docs/releasing.md); ordinary contributions do not need a version bump.
