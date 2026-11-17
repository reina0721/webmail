# Changelog

Notable changes are recorded here using [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Unreleased entries describe source changes, not published or verified releases.

## [Unreleased]

## [0.4.0-alpha.4] - 2026-11-17

### Added

- Token-based Turnstile repair for an installed site, with Account ID fallback and no repeat Stalwart administrative authorization.
- Visible readiness-check results and direct links to verification setup and the real human/mail verification page.
- Upgrade guidance in the deployment console and release acceptance using the published v0.4.0-alpha.2 Rust CLI, including restore and repeat upgrade.

- English and Simplified Chinese project entry points, contributor guidance, security reporting guidance, GitHub issue/PR templates and agent discovery instructions.
- Unattended installation and infrastructure examples, with dedicated deployment and release guides.
- Linux ARM64 artifact selection for the bootstrap installer, application downloads and Rust CLI self-update.
- Native AMD64/ARM64 CI and release-install matrices, architecture-specific manifests and an aggregate checksum list.
- Version consistency and immutable-release guards, plus release packaging regression tests.

### Changed

- Supplying a Cloudflare token without an account now blocks initialization instead of silently skipping Turnstile. Skipped creation is no longer reported as completed.
- Missing Turnstile configuration no longer reports otherwise valid mail-service credentials as missing.
- URLs are rejected as Turnstile keys. Invalid saved values remain repairable; widget initialization and script failures show an actionable message without crashing the verification page.

- Both architectures must pass real draft-asset installation and restore checks before a release becomes public. Full client and sustained business validation runs after publication against the same source commit, with its result recorded in release notes.
- Release bundles include corresponding source from the recorded Git commit; existing AMD64 artifact names and manifest fields remain compatible.
- Installed documentation includes bilingual entry points and examples, with installer fixtures cleaned up after their coexistence checks.

For historical releases, see [GitHub Releases](https://github.com/reina0721/webmail/releases). The existing [candidate release notes](docs/release-notes.md) and acceptance reports retain their original scope and are not reclassified as new verification.
