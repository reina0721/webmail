# Changelog

Notable changes are recorded here using [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Unreleased entries describe source changes, not published or verified releases.

## [Unreleased]

### Added

- English and Simplified Chinese project entry points, contributor guidance, security reporting guidance, GitHub issue/PR templates and agent discovery instructions.
- Unattended installation and infrastructure examples, with dedicated deployment and release guides.
- Linux ARM64 artifact selection for the bootstrap installer, application downloads and Rust CLI self-update.
- Native AMD64/ARM64 CI and release-install matrices, architecture-specific manifests and an aggregate checksum list.
- Version consistency and immutable-release guards, plus release packaging regression tests.

### Changed

- Both architectures must pass real draft-asset installation and restore checks before a release becomes public.
- Release bundles include corresponding source from the recorded Git commit; existing AMD64 artifact names and manifest fields remain compatible.
- Installed documentation includes bilingual entry points and examples, with installer fixtures cleaned up after their coexistence checks.

For historical releases, see [GitHub Releases](https://github.com/reina0721/webmail/releases). The existing [candidate release notes](docs/release-notes.md) and acceptance reports retain their original scope and are not reclassified as new verification.
