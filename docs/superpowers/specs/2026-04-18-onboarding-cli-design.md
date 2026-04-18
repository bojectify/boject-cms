# Onboarding CLI + Container Distribution

## Overview

Distribute boject-cms as a self-contained Docker image and scaffold new projects with a single `pnpm create boject-cms` command. Users never fork or install the CMS as source; they consume a pinned image tag pointed at their own Postgres and storage.

End-user experience:

```
pnpm create boject-cms my-site        → scaffolds docker-compose.yml + .env + starter
cd my-site && docker compose up -d    → image entrypoint migrates, seeds admin, imports
                                        starter, launches Nuxt
(later) boject upgrade                → rewrites the image tag, pulls, restarts
```

## Approach

**Container-first, not package-first.** We rejected a Nuxt-layer / npm-package distribution. "No ejection" is a product rule: users don't own or edit CMS source. Without ejection, Nuxt layers buy nothing that a container doesn't, at meaningful extra cost (multi-package publish, Prisma schema distribution, consumer Nuxt config surface).

**Self-bootstrapping image.** The container's entrypoint handles migrations, admin seeding, and starter import. The scaffolder writes files only — never shells out to docker — so `pnpm create boject-cms` works offline and finishes in seconds.

**Lockstep versioning across one monorepo.** The image, the scaffolder, and the upgrade CLI share one version. Releasing `1.4.0` publishes all three together.

**Scope boundaries:**

- One prompt at scaffold time: starter choice.
- Two CLI binaries total: `create-boject-cms` and `boject` (with a single `upgrade` subcommand). No `boject start/stop/logs` — the scaffolded `package.json` wraps `docker compose` for those.
- Docker Desktop (or equivalent) is a hard prerequisite for running the CMS. The scaffold step itself requires only Node + pnpm.
- Three storage drivers: `local` (default, Docker volume), `s3`, `r2`. Configured by env var, switchable without rebuilding.
- Multi-environment (dev/staging/prod) needs no architectural change — different `.env` files, same image.

## Repo Layout

Restructure the current repo into a pnpm workspace monorepo:

```
apps/
  cms/                         # the Nuxt app (everything currently at repo root)
    Dockerfile
    nuxt.config.ts
    prisma/
    server/
    components/
    ...
packages/
  create-boject-cms/           # npm — the scaffolder
    src/
      index.ts
      templates/               # files written into the user's directory
      prompts.ts
      version.ts               # generated at release time; pins image tag
    package.json
    README.md
  boject-cli/                  # npm — the `boject upgrade` command
    src/
      index.ts
      upgrade.ts
      compose.ts               # docker-compose.yml parser/writer
      registry.ts              # GHCR tag lookup
    package.json
starters/                      # shared — read by image build AND scaffolder
  base.boject.json
  sport.boject.json
  rugby.boject.json
  src/                         # overlays (authoring source)
docs/
pnpm-workspace.yaml            # lists apps/* and packages/*
package.json                   # root — scripts only (dev, build, release)
```

**Monorepo tooling: vanilla pnpm workspaces.** No Nx, no Turborepo. The graph (1 app + 2 CLIs + starters) is small enough that `pnpm --filter` covers all needs. Revisit if CI wall-clock becomes painful.

**One-time restructure cost.** All paths in `CLAUDE.md`, `README.md`, `nuxt.config.ts` aliases, `vitest.config.ts` projects, and `lefthook.yml` globs move from repo root to `apps/cms/`. Starters stay at repo root. This is a single mechanical PR.

## Docker Image

**Registry:** `ghcr.io/boject/cms`. Public read, authenticated push via `GITHUB_TOKEN`. Chosen over Docker Hub for saner rate limits on anonymous pulls and tight repo integration.

**Dockerfile** lives at `apps/cms/Dockerfile`. Multi-stage:

1. **build** — `node:22-alpine`, installs pnpm, runs `pnpm install --frozen-lockfile`, `prisma generate`, `pnpm build`.
2. **runtime** — `node:22-alpine` (slim), copies `.output/`, `node_modules/`, `prisma/`, `starters/`, and the entrypoint script. Non-root user.

**Entrypoint script** (`apps/cms/docker/entrypoint.sh`), executed by the container on start:

1. Wait for `DATABASE_URL` to be reachable. Retry loop, ~30s timeout, fail loud if exhausted.
2. Run `prisma migrate deploy`. Idempotent.
3. `SELECT count(*) FROM "User"`. If zero → create admin from `BOJECT_ADMIN_EMAIL` + `BOJECT_ADMIN_PASSWORD` using the existing scrypt `hashPassword` helper.
4. `SELECT count(*) FROM "ContentType"`. If zero AND `BOJECT_INITIAL_STARTER` points to a readable file → import that starter bundle via the existing `scripts/content-bundle/import.ts` code.
5. `exec node .output/server/index.mjs`.

Steps 3 and 4 are independently gated. Seeding an admin doesn't require a starter; importing a starter doesn't require a fresh admin seed. This keeps bootstrap predictable when the two knobs move independently (e.g. re-using `BOJECT_ADMIN_EMAIL` to recover an orphaned DB).

**Storage driver** is chosen at Nuxt boot from `STORAGE_DRIVER`. Nitro's `useStorage()` is already the abstraction; we wire the three drivers behind it in `nuxt.config.ts` runtime config:

| `STORAGE_DRIVER`  | Required env vars                                                        | Persistence                           |
| ----------------- | ------------------------------------------------------------------------ | ------------------------------------- |
| `local` (default) | none                                                                     | Docker named volume at `/app/storage` |
| `s3`              | `AWS_REGION`, `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`  | AWS-managed                           |
| `r2`              | `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Cloudflare-managed                    |

Switching drivers requires no image rebuild — edit `.env`, restart.

**Image tags published per release:**

- `1.2.3` (exact)
- `1.2` (minor)
- `1` (major)
- `latest`

## `create-boject-cms` (scaffolder)

**Invocation:** `pnpm create boject-cms <target-dir>` (or `npm create boject-cms@latest <target-dir>`).

**Behaviour:**

1. Resolve target directory. If it exists and is non-empty, fail unless `--force`.
2. Single interactive prompt: **Which starter?** → `base` / `sport` / `rugby` / `none`.
3. Generate secrets: `NUXT_SESSION_PASSWORD` (32 bytes, base64) and `BOJECT_ADMIN_PASSWORD` (16 bytes, base64).
4. Write files (see table below).
5. Print next-steps including the generated admin email + password — **once**, to stdout. Not persisted anywhere except `.env`.

**Files written:**

| File                            | Content                                                                                                                                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker-compose.yml`            | Two services: `cms` (image pinned to this CLI's version) and `db` (`postgres:17`). Named volumes for `pgdata` and `storage`. `./starters:/starters:ro` bind-mount. `env_file: .env`.                                                                                                        |
| `.env`                          | `DATABASE_URL`, `NUXT_SESSION_PASSWORD`, `BOJECT_ADMIN_EMAIL=admin@local`, `BOJECT_ADMIN_PASSWORD`, `STORAGE_DRIVER=local`, `BOJECT_INITIAL_STARTER=/starters/<choice>.boject.json` (omitted if "none")                                                                                     |
| `package.json`                  | `scripts`: `start` → `docker compose up -d`, `stop` → `docker compose down`, `logs` → `docker compose logs -f cms`, `upgrade` → `npx @boject/cli@latest upgrade`. `dependencies`: none. The `upgrade` script uses `npx` so users never need a global install and always run the latest CLI. |
| `.gitignore`                    | `.env`, `storage/`, `pgdata/`                                                                                                                                                                                                                                                               |
| `starters/<choice>.boject.json` | Copied verbatim from this repo's `starters/` (bundled into the npm package at build time). Omitted for "none".                                                                                                                                                                              |
| `README.md`                     | "What you got" + next steps                                                                                                                                                                                                                                                                 |

**Flags:**

- `--force` — allow scaffolding into a non-empty directory.
- `--starter <name>` — skip the prompt.
- `--image <tag>` — override the image pin (undocumented; used for maintainer E2E tests).

**Does not:** shell out to docker, hit the network, install node_modules, or touch anything outside the target directory.

## `boject upgrade`

**Invocation:** `boject upgrade [flags]`, run from the directory containing `docker-compose.yml`.

**Behaviour:**

1. Read and parse `./docker-compose.yml`. Extract `services.cms.image`. Fail if not in the format `ghcr.io/boject/cms:<tag>`.
2. Query GHCR's tag listing for the image. Select the highest semver tag.
3. If the current tag equals the latest: print "up to date" and exit 0.
4. Otherwise: rewrite the `image:` line in `docker-compose.yml` to the new tag.
5. Run `docker compose pull cms` then `docker compose up -d`.
6. Poll the CMS health endpoint; print "upgraded 1.2.3 → 1.3.0" on success.

**Flags:**

- `--to <version>` — pin to a specific tag (including downgrades).
- `--dry-run` — print the diff without applying.
- `--check` — print whether an update is available; exit 0 if up to date, 1 if not.

**Invariants:**

- Never touches user data. The Postgres volume survives container replacement.
- Never runs Prisma commands directly. Migrations are the new container's entrypoint's concern.
- Operates on the `docker-compose.yml` the user owns. The CLI is the mechanism; the compose file is the source of truth for "which version is running."

## Release Pipeline

A release PR bumps all three package versions and rewrites `packages/create-boject-cms/src/version.ts` to `export const IMAGE_TAG = '1.2.3'`. Merging that PR and pushing the matching `v1.2.3` tag triggers the release workflow.

CI jobs, in order:

1. **Validate.** Full test suite across the monorepo (`pnpm test`). Typecheck. Lint.
2. **Build image.** `docker buildx build` for `linux/amd64,linux/arm64`. Tags: `1.2.3`, `1.2`, `1`, `latest`.
3. **Push image.** `docker push` each tag to `ghcr.io/boject/cms`.
4. **Publish CLIs.** `pnpm --filter create-boject-cms publish` and `pnpm --filter boject-cli publish`, both at version `1.2.3`.
5. **GitHub Release.** Auto-generated notes from the monorepo CHANGELOG.

Versions move together. A scaffolder at `1.2.3` always pins `ghcr.io/boject/cms:1.2.3`.

## Multi-Environment Support (no code changes)

Multi-environment (dev / staging / prod) is a configuration concern, not an architectural one. The same image runs everywhere; each environment has its own `.env` with a different `DATABASE_URL`, storage credentials, and session secret.

Two kinds of promotion exist:

- **Infra promotion** (schema + code): bump the image tag in staging, observe, promote the same tag to prod. Migrations apply automatically via entrypoint. Covered by `boject upgrade` + the self-bootstrapping container design.
- **Content promotion** (entries, content types): use the existing `scripts/content-bundle/` CLI with `--portable` mode. Export from staging, import into prod. Already implemented.

**Starter bundles never apply to non-empty DBs.** The first-boot check (`SELECT count(*) FROM "ContentType" = 0`) guarantees this. Staging and prod DBs should not have `BOJECT_INITIAL_STARTER` set in their `.env` once they hold real content.

No code in this spec supports multi-environment beyond what fell out of other decisions. Documentation will cover the pattern.

## Maintainer Dev Workflow

End-to-end testing of the scaffold → bootstrap journey without publishing to public registries.

**Local registries:** a `docker-compose.dev.yml` at repo root stands up:

- `registry:2` on `localhost:5000` — local Docker registry.
- `verdaccio/verdaccio` on `localhost:4873` — local npm registry.

**Commands** (root `package.json` scripts):

| Command                    | Action                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev:registries:up`   | `docker compose -f docker-compose.dev.yml up -d`                                                                                                         |
| `pnpm dev:registries:down` | `docker compose -f docker-compose.dev.yml down`                                                                                                          |
| `pnpm dev:publish`         | Builds `apps/cms` image (tags `localhost:5000/boject/cms:dev`, pushes). Publishes `create-boject-cms@0.0.0-dev` and `boject-cli@0.0.0-dev` to Verdaccio. |
| `pnpm dev:scaffold <dir>`  | Runs `create-boject-cms` from Verdaccio into `<dir>`, patches the compose file to reference `localhost:5000/boject/cms:dev`.                             |
| `pnpm dev:verify`          | `cd <dir> && docker compose up -d`; polls health; asserts admin login works; asserts starter was imported. Tears the container down at end.              |

**CI E2E:** the same flow runs on every PR, with `registry` and `verdaccio` stood up as GitHub Actions services.

## Testing

**Unit tests** (vitest, per-package):

- `create-boject-cms`: template rendering, secret generation, flag parsing, directory conflict handling, starter bundling.
- `boject-cli`: compose file parsing + rewriting, GHCR tag selection (semver sort, pre-release filtering), dry-run output.

**Integration tests:**

- `create-boject-cms` E2E: write into a temp dir, assert file contents match snapshots, assert `.env` contains valid secret shapes.
- `boject-cli` E2E: fixture compose file + mocked GHCR tag list, assert rewrite behaviour and compose command invocation. Shells out to a stub `docker` binary that records calls.
- **Image entrypoint** tests: stand up Postgres + the image, assert migrations apply, admin gets seeded on empty DB, starter imports, second start is idempotent (no duplicate admin, no re-import).

**Full E2E** (via the maintainer dev workflow above): scaffold + boot + login + publish an entry + shutdown + restart + verify persistence. Runs in CI on every PR.

## Out of Scope

- **Hosted "boject cloud."** Separate product.
- **Running without Docker.** Docker Desktop (macOS/Windows) or a docker-compatible runtime (Linux) is required.
- **Multi-tenant single-image deployments.** One image = one CMS instance.
- **Nuxt-layer / npm-package distribution.** Considered and rejected for reasons in the Approach section.
- **Ejection.** Users do not fork CMS source. Customisation is via config, content types, and — in a future feature not covered here — user-space content models.
- **Self-updating CLI.** `boject upgrade` upgrades the image, not itself. Users update the CLI via `npm update -g @boject/cli`.
- **Telemetry / analytics.** The CLIs report no usage data.
- **Custom/private registries** and **air-gapped installs.** All flows assume internet access to GHCR and npm. Revisit if needed.

## Migration Notes (from current repo)

This spec requires restructuring the existing repo. The restructure is a **prerequisite PR** that must land before any CLI/image work begins — it isn't the focus of this feature, but the implementation plan depends on it:

- Move the entire current codebase into `apps/cms/`. Every path in `CLAUDE.md`, `README.md`, `nuxt.config.ts`, `vitest.config.ts`, `lefthook.yml`, and `prisma.config.ts` changes accordingly.
- Move `starters/` to stay at repo root.
- Add `pnpm-workspace.yaml` entries for `apps/*` and `packages/*`.
- Add root `package.json` with monorepo scripts.
- Verify all existing tests still pass post-restructure.
