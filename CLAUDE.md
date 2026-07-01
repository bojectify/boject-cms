# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

boject-cms is a general-purpose TypeScript headless CMS built with Nuxt 4 (Vue) and Prisma v7 on PostgreSQL. Content is modelled entirely through user-defined ContentTypes — there are no hardcoded domain models.

## Dev environment containerisation

All `pnpm` and `pnpx` commands documented below route into a Docker container (the `dev` service in `docker-compose.yml`, built from `Dockerfile.dev`) via host shims at `scripts/host-shims/`. This is a supply-chain hardening measure — dependency code never executes with access to host secrets (`~/.ssh`, `~/.aws`, `~/.npmrc`, gh tokens, keychain).

For your purposes as Claude: when you call `pnpm` or `pnpx` via the Bash tool, the host shim handles routing transparently — you don't need to prefix anything with `docker compose exec`. Non-pnpm commands (`git`, `gh`, file operations, `docker compose` itself) run on host as normal. **lefthook is installed on host via `brew install lefthook`** (not via pnpm) — git hooks fire on host and dispatch each job into the container via the shim.

`.git` is bind-mounted into the container read-only so a compromised dep can read history (acceptable — repo is public) but cannot rewrite refs, amend commits, or stage anything. `GIT_OPTIONAL_LOCKS=0` is set in the dev service env so refresh-lock attempts on the read-only mount don't surface as warnings.

If a `pnpm` command fails with "service 'dev' not running", the shim's auto-start has a problem; recover with `docker compose up -d dev`.

## Repository structure

pnpm monorepo (`apps/*`, `packages/*`, `perf`). Project-specific guidance lives in nested `CLAUDE.md` files that Claude Code auto-loads on demand when you read/edit files in that subtree (NOT at launch) — so a session that doesn't touch a project never loads its docs:

- `apps/cms/CLAUDE.md` — the Nuxt 4 CMS app: architecture, Prisma schema, GraphQL, components, server API, Key Files, Docker image. The bulk of the codebase, and where cross-project contracts that originate in CMS code are documented (e.g. the `packages/boject-cli/src/vendor/` sync rule, which loads whenever you touch `apps/cms/scripts/content-bundle/`).
- `packages/boject-cli/`, `packages/create-boject-cms/`, `perf/` — no nested `CLAUDE.md` yet; their conventions currently live in `apps/cms/CLAUDE.md`'s Key Files list and will re-home into per-package files later.

This root file holds monorepo-wide concerns only: dev containerisation, workspace commands, linting/formatting, and the cross-package test topology. Do NOT pull the nested files in with `@import` — that loads everything at launch and defeats the on-demand saving.

## Commands

```bash
docker compose up -d          # Start local PostgreSQL (required before dev/migrate)
docker compose down           # Stop local PostgreSQL (data persists in pgdata volume)
pnpm install                  # Install dependencies (runs nuxt prepare + prisma generate via postinstall)
pnpm dev                      # Start Nuxt development server (http://localhost:4000)
pnpm build                    # Build for production (outputs to .output/)
pnpm preview                  # Preview production build locally
pnpm db:up                    # Start local PostgreSQL container (alias for docker compose up -d)
pnpm prisma:generate          # Regenerate Prisma client + Pothos types (required after schema changes)
pnpm prisma:migrate           # Run database migrations
pnpm dev:bootstrap-admin      # Bootstrap a single admin user in the dev DB (requires BOJECT_ADMIN_EMAIL + BOJECT_ADMIN_PASSWORD; no API keys created)
pnpm prisma:seed:test         # Seed the `boject_test` DB (admin + integration test API key; hardcoded URL — mirrors prisma:studio:test)
pnpm prisma:seed:perf         # Seed the `boject_perf` DB (admin + perf load-test API key; hardcoded URL — mirrors prisma:studio:perf)
pnpm lint                     # Lint with ESLint
pnpm lint:fix                 # Lint and auto-fix
pnpm format                   # Check formatting with Prettier
pnpm format:fix               # Format all files with Prettier
pnpm test                     # Run all tests across the workspace (cms + packages + perf)
pnpm test:integration         # Run CMS integration tests only (server/api + server/middleware)
pnpm test:unit                # Run unit tests across all packages (`pnpm -r --if-present test:unit`)
pnpm test:storybook           # Run Storybook interaction tests in browser mode
pnpm --filter @boject/cli test:integration   # Run CLI integration tests (real-pg, boject_perf_test DB)
pnpm typecheck                # Run TypeScript type checker (nuxi typecheck)
pnpm apikey:create <name>     # Create a new API key (prints raw key once)
pnpm apikey:list              # List all API keys (prefix, name, status, last used)
pnpm apikey:revoke <prefix>   # Revoke an API key by its prefix
pnpm search:reindex [--content-type <Identifier>] [--dry-run] [--batch-size <n>] [--rebuild]   # Rebuild the Meilisearch entries index from current Postgres state (first-time adoption + disaster recovery). Walks every entry with an indexable (DRAFT/CHANGED/PUBLISHED) version, runs buildEntrySearchDocuments() to emit one doc per version (key ${entryId}__${status}), upserts to Meili in batches. Upsert-only by default (no clear-first) so it's safe to run while the app is live and is idempotent. --content-type scopes to one type (others' docs remain); --dry-run counts without writing; --batch-size overrides the 1000-doc batch; --rebuild clears the index first (clear-then-upsert) — the one-time migration that re-keys the legacy entry-id-keyed index to the per-version key. Requires Meilisearch running.
pnpm content:export [--schema|--entries|--all] [--portable] [--out <path>] [--no-assets] [--max-asset-size <MB>] [--max-bundle-size <MB>]   # Export dynamic content types and/or entries as a JSON bundle. A directory --out (trailing slash / existing dir) writes bundle.json + assets/<storageKey> with original IMAGE bytes; a .json target (or no --out) writes a single JSON file with no assets (status quo). --no-assets forces references-only even for a directory target. --max-asset-size (default 25)/--max-bundle-size (default 1024) cap bytes; export fails fast on a missing storageKey or a breached cap.
pnpm content:import <path> [--schema|--entries|--all] [--apply] [--allow-destructive] [--author <string>] [--on-conflict <fail|skip|replace>] [--dry-run]   # Import a JSON bundle into the CMS. A directory source (containing bundle.json + assets/) restores IMAGE bytes to target storage (skip-if-exists) BEFORE the DB import; a .json file imports references-only. With --schema --apply, runs idempotent schema apply via applySchema (Spec 3). --allow-destructive unlocks safe removals. --on-conflict controls entry-collision behaviour (default fail; skip leaves existing entries alone; replace wholesale-overwrites preserving id+entryKey+createdAt). --dry-run reports planned counts without writing.
pnpm content:validate <path>                                                  # Validate a JSON bundle's shape without touching the DB. For a directory bundle that carries contentTypes, also runs an offline asset-completeness check (every referenced IMAGE storageKey must have a file in assets/).
pnpm starters:build           # Build sport.boject.json / rugby.boject.json from overlays in starters/src/
pnpm starters:check           # Verify committed starter outputs are up to date (CI)
pnpm nuke:packages            # Wipe every node_modules in the workspace and reinstall — recovery for "Could not resolve <pkg>" / orphaned symlink errors after dep churn
```

Note: commands run from the repo root forward to `apps/cms` via `pnpm --filter cms`. The Nuxt app source, Prisma schema, and tests all live under `apps/cms/`. Starter bundle JSONs stay at the repo root's `starters/` directory (shared data, consumed by multiple packages).

Note: `prisma migrate dev` requires an interactive terminal. When running from a non-interactive context, use `prisma migrate diff` to generate the SQL and `prisma migrate deploy` to apply it.

## Linting & Formatting

- **ESLint** — Via `@nuxt/eslint` module (registered in `apps/cms/nuxt.config.ts`). Includes Vue, TypeScript, and Nuxt-specific rules. Config in `apps/cms/eslint.config.mjs`. Custom config covers `**/*.ts` files with `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin`. A separate block sets `parserOptions.parser` to `@typescript-eslint/parser` for `**/*.vue` files (the Nuxt-generated config uses `vue-eslint-parser` but doesn't configure a TypeScript sub-parser). Underscore-prefixed variables are allowed as unused (`varsIgnorePattern: '^_'`). Destructured rest siblings are also ignored (`ignoreRestSiblings: true`).
- **Prettier** — Single quotes, trailing commas (es5), semicolons, 2-space indent, 80 char width. Config in `.prettierrc.yml`.
- **eslint-config-prettier** — Disables ESLint rules that conflict with Prettier.
- **Lefthook** — Pre-commit hooks run ESLint, Prettier, and a single workspace-wide `pnpm typecheck` job (which fans out via `pnpm -r typecheck` plus the root `scripts/` tsconfig) in parallel on staged files. Pre-push runs the full `pnpm test` suite plus `pnpm --filter cms test:storybook`; the storybook-test job can be skipped via `SKIP_STORYBOOK_TEST=1`. Config in `lefthook.yml`.

## Testing

- **Vitest** — Test runner, configured via `apps/cms/vitest.config.ts` with plain `defineConfig` (not `@nuxt/test-utils/config` due to Nuxt 4.3 incompatibility). Three test projects: `integration` (server/api + server/middleware tests, with `globalSetup` for DB reset/seed), `unit` (scripts, server/utils, utils tests, no DB needed), and `storybook` (browser-mode interaction tests). The `integration` project now runs in parallel across `pool: 'forks'` workers (required — the `threads` pool shares `process.env` and would corrupt per-worker scoping), capped by `maxWorkers: resolveMaxTestWorkers()` (default `min(cores-2, 4)`, override via `TEST_MAX_WORKERS`); each worker gets its own isolated Postgres DB / Meili index / Redis logical DB / Nuxt buildDir / Vite cache scoped by `VITEST_POOL_ID` (see `apps/cms/test/workerScope.ts`). The repo root `vitest.config.ts` aggregates `apps/cms`, `packages/boject-cli`, `packages/create-boject-cms`, and `perf` into a single workspace for `pnpm test` (root).
- **Test databases** — Three isolated Postgres DBs share the local container: `boject` (dev), `boject_test` (cms integration suite — migrated+seeded by `apps/cms/vitest.globalSetup.ts` as a template, then cloned per vitest worker into `boject_test_<id>`, which the integration suite actually runs against), and `boject_perf_test` (CLI integration suite — owned by `packages/boject-cli/tests/integration/globalSetup.ts`, schema-reset on every suite run via `pnpx prisma migrate reset --force` against the cms package's prisma config, then directly seeded with a `PerfArticle` ContentType). The CLI globalSetup explicitly issues `CREATE DATABASE boject_perf_test` against the admin DB if missing, since Prisma v7's `migrate reset` does not auto-create.
- **CLI integration tests** — `packages/boject-cli/tests/integration/` holds real-pg tests for the SQL writer; run with `pnpm --filter @boject/cli test:integration`. File pattern: `*.integration.test.ts`. Tests share a single pg `Client` per file (opened in `beforeAll`, closed in `afterAll`); `beforeEach` truncates `ContentEntryVersion` + `ContentEntry` to isolate per-test state. The `boject_perf_test` ContentType row is seeded once per suite and reused across all tests.
- **@nuxt/test-utils** — Starts a Nuxt dev server for integration tests. Tests must use `setup({ dev: true })` (production mode masks GraphQL errors).
- **Meilisearch test harness** — Search-backed integration tests run against the real `meilisearch` docker-compose service. `MEILI_INDEX` is per-worker (`entries_test_<id>`, scoped by `VITEST_POOL_ID` — see `apps/cms/test/workerScope.ts`), read by `resolveEntriesIndex()` in `server/utils/searchIndex.ts`; the booted Nitro server inherits it, like `DATABASE_URL`, so the suite never clobbers the dev `entries` index. `vitest.globalSetup.ts` bootstraps one `entries_test_<id>` index per worker alongside the per-worker test DB (non-fatal if Meili is down — non-search tests still run). Helpers in `apps/cms/server/test/meiliTestUtils.ts` (`clearTestIndex` / `addTestDocuments` / `waitForIndexing` / `getAllDocuments` / `assertDocumentExists` / `assertAttributeValues`) operate on the resolved index; each search test file clears it in its own `beforeAll`. See `apps/cms/server/test/README.md`. (This repo has no GitHub Actions; the lefthook `pre-push` `pnpm test` + docker-compose services are the quality gate.)
- **Test location** — Colocated with source files (e.g. `apps/cms/server/api/graphql/graphql.test.ts`).
- **Co-located test fixtures (`*.fixtures.ts`)** — When a test file grows large from inlined test data, its named test data is extracted into a sibling `<name>.fixtures.ts` (data only; reserve "stub"/"mock" naming for fake collaborators like an in-memory storage driver, which stay inline in the test). Generic shape builders are shared in a colocated factories module rather than duplicated per fixture file — `apps/cms/scripts/content-bundle/bundleFactories.ts` (`makeBundle`/`ct`/`field`/`entry`/`version`/`snapshot`) is the first such module. `.fixtures.ts` files match no `*.test.ts` glob, so they are plain importable modules (typechecked + linted, never executed as tests). Fixtures carrying per-test `randomUUID()` ids are exported as factory functions taking the ids as params (a module-level const would bake one id at import time and share it across tests). Each extraction must be proven equivalent to the original literal with a temporary `toStrictEqual` parity assertion (strict catches `Map`-vs-object, nested-`Map`, and `null`-vs-absent drift), removed once green in the same commit. Test files use named imports for the fixtures (`import { fooBundle } from './foo.fixtures'`); files with a large fixture surface (e.g. `planSchema`, `import.integration`) use a namespace import (`import * as fx from './foo.fixtures'`) so call sites read `fx.fooBundle` rather than maintaining a long named-import block. This is a repo-wide convention; `apps/cms/scripts/content-bundle/` is the first application (#274).
- **Test API key** — All REST and GraphQL integration tests authenticate with a deterministic test key (`boject_test_key_for_integration_tests_only`) seeded via `apps/cms/prisma/seed.ts`.
- **GraphQL tests** — Integration tests covering dynamic-type list queries, single-item lookups, where filtering, Relay cursor pagination, and dev-mode unauthenticated access.
- **Content tests** — Integration tests for `/api/all-content` covering `contentType` identifier filter, `status` filter, combined filters, and invalid value handling.
- **Auth tests** — Integration tests covering login validation, credential checking, session handling, and middleware behaviour.
- **File tests** — Integration tests covering primitive upload (auth, mime/size validation, successful upload returning `{ storageKey, ... }`), transform endpoint (resize, format conversion, public access, rate limiting).
- **Content type tests** — Integration tests covering content type CRUD, field management (add, update, delete, reorder), identifier validation (PascalCase for types, camelCase for fields), uniqueness constraints, and ENTRY_TITLE/SLUG field rules.
- **Content entry tests** — Integration tests covering entry CRUD, data validation (required fields, type checking, select choices), slug uniqueness, versioning workflows (draft save, publish, discard draft, CHANGED status), `entryTitle` populate + uniqueness, and IMAGE field end-to-end coverage.
- **CSRF tests** — Integration tests covering origin/referer enforcement and the Bearer-key bypass.
- **Storybook** — Storybook 10 via `@storybook/vue3-vite` (direct, not `@nuxtjs/storybook` — Nuxt 4 peer incompatibility). Interaction tests run as a third Vitest project (`storybook`) in browser mode via `@storybook/addon-vitest` + `@vitest/browser-playwright` on Chromium. See `apps/cms/.storybook/README.md` for the three-layer mocking conventions (MSW for network, module aliases / auto-import shim dirs for imports, decorators for provide/inject). Seed stories live at `apps/cms/components/relation-field/RelationField.stories.ts` and `apps/cms/components/multi-relation-field/MultiRelationField.stories.ts`. Run with `pnpm --filter cms test:storybook`.
