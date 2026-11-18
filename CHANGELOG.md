# Changelog

Notable changes are recorded here using [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Unreleased entries describe source changes, not published or verified releases.

## [Unreleased]

## [0.4.0-alpha.14] - 2026-11-18

### Added

- Repair a saved Turnstile widget after an origin change and explicitly replace a missing widget.
- Show the Cloudflare account, widget name, public Site Key, confirmed hostnames and credential status.

### Fixed

- Keep the Cloudflare Account ID field visible during setup and repair, including when a Token is pasted after Stalwart authorization.
- Report what configuration was reloaded and preserve the current form draft.

## [0.4.0-alpha.13] - 2026-11-18

### Fixed

- Explain SMTP connectivity failures and clear old setup confirmation before authorization is renewed.
- Clear prior credentials and confirmation when the Stalwart source changes.
- Retry console and registration readiness reads during brief configuration restarts.

## [0.4.0-alpha.12] - 2026-11-18

### Fixed

- Show the actual public registration and verification status above the checklist.
- Match the setup guide to console actions and document the final registration switch.

## [0.4.0-alpha.11] - 2026-11-18

### Fixed

- Cancel queued toolbar and draft status callbacks when the relevant view closes.
- Keep a prior draft status timer from clearing the status of a different save in progress.

## [0.4.0-alpha.10] - 2026-11-18

### Fixed

- Keep the send result visible when the Turnstile widget fails during a retry.
- Distinguish widget configuration errors from connection failures and let operators copy the verification link for another browser.

## [0.4.0-alpha.9] - 2026-11-18

### Fixed

- Identify HTTPS certificate validation failures during registration readiness checks.
- Repair a Stalwart callback with a masked bearer secret when the encrypted initialization record confirms the service, Hook ID and original callback.
- Exercise the documented CLI-first upgrade from v0.4.0-alpha.2 and use matching Host and Origin headers in the isolated setup checks.

## [0.4.0-alpha.8] - 2026-11-18

### Changed

- Discover a single Cloudflare account, create its Turnstile widget and save its keys from one console action. Explain missing account-read permission or ask for a choice when the token can list multiple accounts.

## [0.4.0-alpha.7] - 2026-11-17

### Fixed

- Diagnose a stale Stalwart submission callback independently of Webmail connectivity and authentication.
- Update the dedicated callback from the console after testing the configured HTTPS address. Restore the previous callback if Stalwart rejects the switch.
- Keep registration checks and verification links visible at the top of the page.
- Run the account-context check with native Node type stripping and use the containerd image store for the historical AMD64 installer fixture.

## [0.4.0-alpha.6] - 2026-11-17

### Fixed

- Save site branding and the public origin independently of stale Turnstile keys and Stalwart availability.
- Separate first-time installation, mail service repair, and registration verification. Show the target domain for Turnstile and how to continue when account discovery returns no results.
- Show the verification path before the public registration switch and keep a visible loading state while the mailbox opens.

## [0.4.0-alpha.5] - 2026-11-17

### Added

- Keep a configured IP and port available for mail and administration when the public reverse proxy or domain is unavailable.
- View the installed version, upgrade to a published release, and restore a matching snapshot from the operator console.
- Run version changes in a separate host service that records progress and can recover from an interrupted switch.
- Show the direct address in status output and open the repair wizard at that address with `mailweb setup --direct`.

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
- Docker classic and containerd image stores share a canonical config digest for offline installation and snapshot restore; older installations should update the CLI first.
- URLs are rejected as Turnstile keys. Invalid saved values remain repairable; widget initialization and script failures show an actionable message without crashing the verification page.

- Both architectures must pass real draft-asset installation and restore checks before a release becomes public. Full client and sustained business validation runs after publication against the same source commit, with its result recorded in release notes.
- Release bundles include corresponding source from the recorded Git commit; existing AMD64 artifact names and manifest fields remain compatible.
- Installed documentation includes bilingual entry points and examples, with installer fixtures cleaned up after their coexistence checks.

For historical releases, see [GitHub Releases](https://github.com/reina0721/webmail/releases). The existing [candidate release notes](docs/release-notes.md) and acceptance reports retain their original scope and are not reclassified as new verification.
