FROM alpine:3.20 AS rustcache
RUN mkdir -p /app /cli

FROM node:24-bookworm-slim AS frontend-deps
WORKDIR /source/frontend
RUN corepack enable && corepack prepare pnpm@10.22.0 --activate
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
COPY frontend/apps/web/package.json apps/web/package.json
COPY frontend/packages/core/package.json packages/core/package.json
COPY frontend/packages/form-foundation/package.json packages/form-foundation/package.json
COPY frontend/packages/i18n/package.json packages/i18n/package.json
COPY frontend/packages/material-ui/package.json packages/material-ui/package.json
COPY frontend/packages/schemas/package.json packages/schemas/package.json
COPY frontend/packages/state-foundation/package.json packages/state-foundation/package.json
COPY frontend/packages/types/package.json packages/types/package.json
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

FROM frontend-deps AS frontend
ARG MAIL_WEB_REVISION=development
ARG MAIL_WEB_SKIP_NEXT_TYPECHECK=0
ENV MAIL_WEB_REVISION=$MAIL_WEB_REVISION
ENV MAIL_WEB_SKIP_NEXT_TYPECHECK=$MAIL_WEB_SKIP_NEXT_TYPECHECK
ENV NEXT_TELEMETRY_DISABLED=1
COPY frontend/ ./
COPY release-version.txt /source/release-version.txt
RUN pnpm build

FROM rust:1-bookworm AS backend-deps
WORKDIR /source
COPY Cargo.toml Cargo.lock ./
COPY backend/Cargo.toml backend/Cargo.toml
COPY crates/mailweb-shared/Cargo.toml crates/mailweb-shared/Cargo.toml
COPY crates/mailwebctl/Cargo.toml crates/mailwebctl/Cargo.toml
RUN --mount=type=cache,id=mailweb-cargo-registry,target=/usr/local/cargo/registry \
    mkdir -p backend/src crates/mailweb-shared/src crates/mailwebctl/src /export/app \
 && printf 'fn main() {}\n' > backend/src/main.rs \
 && printf 'fn main() {}\n' > crates/mailwebctl/src/main.rs \
 && : > crates/mailweb-shared/src/lib.rs \
 && cargo build --locked --release -p mail-web \
 && find target/release -maxdepth 2 \( -name 'mail_web*' -o -name 'libmailweb*' -o -name 'mail-web*' \) -exec rm -rf {} + \
 && mv target/release /export/app/release

FROM rust:1-bookworm AS backend
ARG MAIL_WEB_REVISION=development
ENV MAIL_WEB_REVISION=$MAIL_WEB_REVISION
WORKDIR /source
COPY Cargo.toml Cargo.lock ./
COPY backend/ ./backend/
COPY crates/ ./crates/
COPY compose.yaml install.sh ./
COPY deploy/ ./deploy/
RUN --mount=type=bind,from=rustcache,target=/seed \
    --mount=type=cache,id=mailweb-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=mailweb-app-target,target=/source/target \
    if [ ! -d target/release/.fingerprint ] && [ -d /seed/app/release ]; then mkdir -p target/release && cp -a /seed/app/release/. target/release/; fi \
 && find backend/src backend/migrations crates -type f -exec touch {} + \
 && touch backend/Cargo.toml crates/mailweb-shared/Cargo.toml crates/mailwebctl/Cargo.toml \
 && cargo build --locked --release -p mail-web && cp /source/target/release/mail-web /source/mail-web

# Opt-in quality target used by the one-command verification workflow.
FROM frontend AS client-quality
RUN pnpm --filter @mail-web/web typecheck && pnpm --filter @mail-web/web test:client
WORKDIR /source
COPY tooling/ ./tooling/
COPY tests/*.mjs ./tests/
COPY deploy/ ./deploy/
COPY docs/ ./docs/
COPY backend/ ./backend/
RUN node frontend/tooling/check-boundaries.mjs && node frontend/tooling/check-boundaries-fixtures.mjs && node tooling/check-persistence.mjs && node tooling/check-upstream.mjs && node --test tests/motion-styles.test.mjs tests/operation-id.test.mjs tests/admin-access.test.mjs tests/setup-guidance.test.mjs tests/platform-account-context.test.mjs
RUN cp frontend/apps/web/src/platform/lib/generated-api.ts /tmp/api-before.ts && pnpm --dir frontend exec openapi-typescript ../backend/contract/openapi.json -o apps/web/src/platform/lib/generated-api.ts && cmp /tmp/api-before.ts frontend/apps/web/src/platform/lib/generated-api.ts

FROM backend AS backend-quality
RUN rustup component add rustfmt clippy
RUN --mount=type=cache,id=mailweb-cargo-registry,target=/usr/local/cargo/registry --mount=type=cache,id=mailweb-app-target,target=/source/target cargo fmt --all -- --check && cargo test --locked --workspace && cargo clippy --locked --workspace --all-targets -- -D warnings && cargo run --locked -p mail-web -- --openapi > /tmp/openapi.json && diff -u backend/contract/openapi.json /tmp/openapi.json && touch /source/backend-quality.done

FROM client-quality AS quality
COPY --from=backend-quality /source/backend-quality.done /source/backend-quality.done

FROM debian:bookworm-slim AS application
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 10001 mail-web && useradd -u 10001 -g 10001 -M mail-web
WORKDIR /app
COPY --from=backend /source/mail-web /app/mail-web
COPY --from=frontend /source/frontend/apps/web/out /app/static
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/app/mail-web"]

# Static host CLI release asset; never included as an application runtime service.
FROM rust:1-alpine AS cli-deps
WORKDIR /source
RUN apk add --no-cache musl-dev
COPY Cargo.toml Cargo.lock ./
COPY backend/Cargo.toml backend/Cargo.toml
COPY crates/mailweb-shared/Cargo.toml crates/mailweb-shared/Cargo.toml
COPY crates/mailwebctl/Cargo.toml crates/mailwebctl/Cargo.toml
RUN --mount=type=cache,id=mailweb-cargo-registry-alpine,target=/usr/local/cargo/registry \
    mkdir -p backend/src crates/mailweb-shared/src crates/mailwebctl/src /export/cli \
 && printf 'fn main() {}\n' > backend/src/main.rs \
 && printf 'fn main() {}\n' > crates/mailwebctl/src/main.rs \
 && : > crates/mailweb-shared/src/lib.rs \
 && cargo build --locked --release -p mailwebctl \
 && find target/release -maxdepth 2 \( -name 'mailweb*' -o -name 'libmailweb*' -o -name 'mail_web*' \) -exec rm -rf {} + \
 && mv target/release /export/cli/release

FROM rust:1-alpine AS cli-release
WORKDIR /source
RUN apk add --no-cache musl-dev
COPY Cargo.toml Cargo.lock ./
COPY backend/ ./backend/
COPY crates/ ./crates/
COPY compose.yaml install.sh ./
COPY deploy/ ./deploy/
RUN --mount=type=bind,from=rustcache,target=/seed \
    --mount=type=cache,id=mailweb-cargo-registry-alpine,target=/usr/local/cargo/registry \
    --mount=type=cache,id=mailweb-cli-target,target=/source/target \
    if [ ! -d target/release/.fingerprint ] && [ -d /seed/cli/release ]; then mkdir -p target/release && cp -a /seed/cli/release/. target/release/; fi \
 && find crates compose.yaml deploy/mail-web.sh deploy/install.sh -type f -exec touch {} + \
 && cargo build --locked --release -p mailwebctl && mkdir /output && cp target/release/mailwebctl /output/mailwebctl

FROM scratch AS rust-cache-export
COPY --from=backend-deps /export/app /app
COPY --from=cli-deps /export/cli /cli

FROM scratch AS cli-artifact
COPY --from=cli-release /output/mailwebctl /mailwebctl

FROM application AS final
