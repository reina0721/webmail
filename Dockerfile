FROM node:24-bookworm-slim AS frontend
ARG MAIL_WEB_REVISION=development
ENV MAIL_WEB_REVISION=$MAIL_WEB_REVISION
WORKDIR /source/frontend
RUN corepack enable && corepack prepare pnpm@10.22.0 --activate
COPY frontend/ ./
COPY release-version.txt /source/release-version.txt
RUN pnpm install --frozen-lockfile && pnpm build

FROM rust:1-bookworm AS backend
ARG MAIL_WEB_REVISION=development
ENV MAIL_WEB_REVISION=$MAIL_WEB_REVISION
WORKDIR /source
COPY Cargo.toml Cargo.lock ./
COPY backend/ ./backend/
COPY crates/ ./crates/
COPY compose.yaml install.sh ./
COPY deploy/ ./deploy/
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/source/target cargo build --locked --release -p mail-web && cp /source/target/release/mail-web /source/mail-web

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
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/source/target cargo fmt --all -- --check && cargo test --locked --workspace && cargo clippy --locked --workspace --all-targets -- -D warnings && cargo run --locked -p mail-web -- --openapi > /tmp/openapi.json && diff -u backend/contract/openapi.json /tmp/openapi.json && touch /source/backend-quality.done

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
FROM rust:1-alpine AS cli-release
WORKDIR /source
RUN apk add --no-cache musl-dev
COPY Cargo.toml Cargo.lock ./
COPY backend/ ./backend/
COPY crates/ ./crates/
COPY compose.yaml install.sh ./
COPY deploy/ ./deploy/
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/source/target cargo build --locked --release -p mailwebctl && mkdir /output && cp target/release/mailwebctl /output/mailwebctl

FROM scratch AS cli-artifact
COPY --from=cli-release /output/mailwebctl /mailwebctl

FROM application AS final
