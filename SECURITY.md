# Security policy

Mail Web is currently a development preview. No long-term support schedule or response-time commitment is established. Fixes target current development; historical releases may lack subsequent fixes. Check the [release history](https://github.com/reina0721/webmail/releases) and use a current verified release.

## Reporting a vulnerability

Do not post credentials, setup tokens, session cookies, encryption keys, private mail, database dumps or exploit details in public issues.

If GitHub displays **Security → Advisories → Report a vulnerability** for this repository, use that private reporting form. This document does not assert that private reporting is enabled. If no private form is available, open an issue titled “Request a private security reporting channel” containing only a contact request; wait for a maintainer to establish a private channel before sharing details. No security email address has been configured in this policy.

A private report should identify the affected version/commit, deployment mode, reproducible steps with synthetic data, impact, and any suggested mitigation. Remove secrets from logs and attachments.

## Deployment boundaries

Use a trusted HTTPS origin for normal deployment. Explicit HTTP mode has separate security limitations described in the [deployment guide](docs/deployment.md). Setup capabilities grant administrative access. Backups include sensitive configuration and encryption keys; store protected copies separately.

SHA-256 checks establish download integrity relative to the checksum list. Trust in the release source still depends on GitHub access and repository publication permissions. Database rollback requires a matching backup; do not run an older application against a migrated database.

Maintainer setup: enable GitHub private vulnerability reporting in repository security settings before advertising it as an available reporting channel. Repository files alone do not enable this setting.
