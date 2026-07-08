# boject-cms

[![CI](https://github.com/bojectify/boject-cms/actions/workflows/ci.yml/badge.svg)](https://github.com/bojectify/boject-cms/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/bojectify/boject-cms?include_prereleases&sort=semver)](https://github.com/bojectify/boject-cms/releases)
[![License: BUSL-1.1](https://img.shields.io/badge/license-BUSL--1.1-blue.svg)](LICENSE)

**boject-cms** is a self-hosted, source-available headless CMS. You model your content as **ContentTypes** — there are no hardcoded domain models — and consume it over a token-authed **REST + GraphQL** API from any frontend, native app, or service.

It ships as a single Docker image you run next to PostgreSQL, with a **schema-as-code** workflow (`boject schema pull` → commit → deploy) that keeps your content model in version control. Built-in full-text search (Meilisearch), response caching (Redis), and image transforms (Sharp) come standard. Built with Nuxt 4, Prisma 7, and TypeScript.

## Features

- **Dynamic content modelling** — define ContentTypes and fields in the admin UI or as code; no hardcoded models, no redeploy to add a field.
- **REST + GraphQL API** — token-authed `/api/public/*` (REST read + write) and `/api/graphql` (read), ready for any frontend, native app, or service.
- **Schema-as-code** — pull your content model to a committed JSON bundle; the container converges the schema on every deploy.
- **Full-text search** — built-in Meilisearch indexing across your entries.
- **Response caching** — Redis-backed caching on the public read and GraphQL APIs.
- **Images & assets** — Sharp-powered on-the-fly transforms, with local / S3 / R2 storage drivers.
- **Self-hosted** — one multi-arch Docker image plus PostgreSQL; you own the data.
- **Source-available** — BSL 1.1, converting to Apache-2.0 four years after each release.

## Quickstart

Scaffold a project, then bring it up with Docker Compose:

```bash
pnpm create boject-cms my-site
cd my-site
docker compose up -d
```

`create-boject-cms` generates a `docker-compose.yml` (CMS image + PostgreSQL, pinned to a release tag), a starter content schema, and a `.env` with generated secrets and an initial admin login. Once the stack is healthy, open the admin UI at **http://localhost:4000/login** and sign in with the admin credentials from the generated `.env`.

Prefer npm? `npm create boject-cms@latest my-site` works too.

From there, edit content types in the UI and adopt the [schema-as-code workflow](packages/boject-cli/README.md) to keep your model in version control.

## Published artefacts

Every release ships three coordinated artefacts at one version:

| Artefact                       | What it is                                                         | Where                                                                     |
| ------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `create-boject-cms`            | Project scaffolder (`pnpm create boject-cms`)                      | [npm](https://www.npmjs.com/package/create-boject-cms)                    |
| `ghcr.io/bojectify/boject-cms` | The CMS server image (multi-arch; pinned in the generated compose) | [GHCR](https://github.com/bojectify/boject-cms/pkgs/container/boject-cms) |
| `@boject/cli`                  | Maintenance + schema-as-code CLI (`boject …`)                      | [npm](https://www.npmjs.com/package/@boject/cli)                          |

## Documentation

- [`apps/cms/README.md`](apps/cms/README.md) — the CMS in depth: architecture, API surface, API keys, schema-as-code, storage, backups, env vars.
- [`@boject/cli`](packages/boject-cli/README.md) — the `boject` CLI: `schema pull/apply/check`, `upgrade`, `perf`.
- [`create-boject-cms`](packages/create-boject-cms/README.md) — the scaffolder and what it generates.

Most other documentation lives next to the code it describes — start from [Apps and packages](#apps-and-packages) below.

## License

boject-cms is **source-available** under the [Business Source License 1.1](LICENSE).
Each published version converts to the Apache License, Version 2.0 four years
after its release. BSL is **not** an OSI-approved open-source license: you may use
boject-cms for any purpose — including production — except offering it to third
parties as a hosted, managed, or embedded product or service that competes with
boject. See [`LICENSE`](LICENSE) for the full terms.

## Contributing

boject-cms is source-available and contributions are welcome. See
**[`CONTRIBUTING.md`](CONTRIBUTING.md)** for the full dev-environment setup
(containerised or native), how to run the test suite, and the pull-request
workflow — a new contributor can go from clone to a green test run using only
that guide. Please also read our [Code of Conduct](CODE_OF_CONDUCT.md), and
report security issues privately via our [Security Policy](SECURITY.md).

---

## Development

The sections below cover the stack and repo layout. For environment setup,
tests, and the contribution workflow, see [`CONTRIBUTING.md`](CONTRIBUTING.md).
If you only want to _run_ the CMS, the [Quickstart](#quickstart) above is all you
need.

## Tech Stack

Workspace-wide tooling:

- **pnpm 11** — package manager and workspace orchestrator
- **Node.js 24** — runtime (containerised; see [Containerised dev environment](CONTRIBUTING.md#containerised-dev-environment))
- **PostgreSQL 17** — database (local via Docker)
- **Meilisearch** — full-text search engine, run as a docker-compose sidecar (see [`apps/cms/README.md`](apps/cms/README.md#search))
- **Redis** — response cache backend for the public read + GraphQL APIs, run as a docker-compose sidecar (`REDIS_URL`, default `redis://localhost:6379`; cold-by-design — no volume)
- **Docker** + [OrbStack](https://orbstack.dev/) on macOS — container runtime
- **TypeScript** — ESM-only (`"type": "module"`)

App-specific stacks (Nuxt 4, Prisma v7, GraphQL Yoga, Pothos, Tiptap, Sharp, etc.) are documented in each app's README.

The CMS serves a token-authed external API — `/api/public/*` (REST read + write, response-cached via Redis) and `/api/graphql` (GraphQL read) — detailed in [`apps/cms/CLAUDE.md`](apps/cms/CLAUDE.md).

## Apps and packages

| Path                                                                  | Purpose                                                                         |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`apps/cms/`](apps/cms/README.md)                                     | The CMS application — Nuxt 4 + Prisma + GraphQL                                 |
| [`packages/create-boject-cms/`](packages/create-boject-cms/README.md) | Project scaffolder (`pnpm create boject-cms my-site`)                           |
| [`packages/boject-cli/`](packages/boject-cli/README.md)               | Maintenance + schema-as-code CLI for scaffolded projects (`boject ...`)         |
| [`starters/`](starters/README.md)                                     | Starter bundle data (`base`, `sport`, `rugby`) consumed by the CMS + scaffolder |
| [`perf/`](perf/README.md)                                             | Performance harness, scenarios, and committed reports                           |

## Project Structure

```
apps/
  cms/                         # The Nuxt app (everything Nuxt-specific lives here)
    prisma/                    # Prisma schema + migrations + seed
    server/                    # API routes, middleware, utils, graphql
    components/                # Vue components
    composables/               # useContentEntryEditor, useAuthedFetch, etc.
    layouts/                   # default (dashboard) + auth
    middleware/                # client route middleware (auth + entry redirect)
    pages/                     # login, index, content-types/**, entries/[...stack]
    types/                     # FieldConfig + BasicComponentProps
    utils/                     # mapFieldToConfig, paneStack, parseUniqueConflict, etc.
    scripts/                   # CLI tools: content-bundle, build-starters, manage-api-keys
    docker/                    # Dockerfile entrypoint + smoke test
    README.md                  # CMS-specific docs
packages/
  create-boject-cms/           # Scaffolder (`pnpm create boject-cms`)
  boject-cli/                  # Maintenance + schema-as-code CLI (`boject`)
starters/                      # Shared starter bundles (data, consumed by apps + packages)
  web-base.boject.json, articles.boject.json, sport.boject.json, rugby.boject.json
  modules/                     # Non-selectable composable modules (e.g. taxonomy.boject.json)
  README.md
  src/                         # Overlay sources authored directly (articles/sport/rugby derive via build)
    partials/                  # Field-partials (e.g. web-metadata.json) composed onto content types
perf/                          # Performance harness + reports
scripts/
  host-shims/                  # pnpm + pnpx shims that route into the dev container
docker-compose.yml             # Local Postgres 17 + dev container
docker-compose.dev.yml         # Local Docker / npm registries for maintainers
lefthook.yml                   # Pre-commit + pre-push hooks (run on host)
pnpm-workspace.yaml            # Declares apps/* and packages/*
package.json                   # Slim workspace root (forwards scripts to cms via pnpm --filter)
```
