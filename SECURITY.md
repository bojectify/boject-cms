# Security Policy

We take the security of boject-cms seriously, and we're grateful to the security
researchers and users who help keep it and its users safe.

## Supported versions

boject-cms is pre-1.0 and moves quickly. Security fixes land on the latest
release and `main`; there is no long-term-support branch yet. To receive fixes,
run the most recent release.

| Version             | Supported |
| ------------------- | --------- |
| Latest release      | ✅        |
| `main` (unreleased) | ✅        |
| Older releases      | ❌        |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.**

Report privately through either channel:

- **GitHub Private Vulnerability Reporting** (preferred) — open the repository's
  **[Security](https://github.com/bojectify/boject-cms/security/advisories/new)**
  tab and choose **Report a vulnerability**. This creates a private advisory
  visible only to maintainers.
- **Email** — [security@boject.com](mailto:security@boject.com).

Please include as much of the following as you can:

- a description of the vulnerability and its impact,
- steps to reproduce (a proof-of-concept if possible),
- the affected version(s) or commit SHA, and
- any suggested remediation.

## What to expect

- We'll acknowledge your report within a few business days.
- We'll investigate, keep you updated on progress, and agree a fix and
  disclosure timeline with you.
- We practise **coordinated disclosure** — please give us a reasonable window to
  ship a fix before any public disclosure.
- boject-cms does not currently run a paid bug-bounty programme. We're grateful
  for responsible disclosure and will credit reporters who wish to be named.

## Scope

This policy covers the boject-cms codebase in this repository and its published
artefacts: the `ghcr.io/bojectify/boject-cms` image, `@boject/cli`, and
`create-boject-cms`. Vulnerabilities in third-party dependencies should be
reported to their upstream maintainers — but a heads-up is welcome so we can bump
the affected dependency.
