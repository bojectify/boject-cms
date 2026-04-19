# Onboarding C3 — Dev Publish / Scaffold / Verify Loop

## Overview

Wire C1 (local registries) and C2 (`create-boject-cms` scaffolder) together into an end-to-end maintainer loop. Three root `pnpm` scripts drive the flow: `dev:publish` pushes the CMS image and the scaffolder to the local registries, `dev:scaffold <dir>` runs the published scaffolder into a target directory with local-registry defaults, and `dev:verify <dir>` boots the scaffolded project, asserts admin login + starter import, and tears it down. This is the first time the onboarding flow is exercised end-to-end in this repo — once C3 lands, every future change to the scaffolder, image, or entrypoint can be validated with a single local pipeline before shipping.

Parent spec: [`2026-04-18-onboarding-cli-design.md`](./2026-04-18-onboarding-cli-design.md) — see **Maintainer Dev Workflow** section.

End state after this plan: on a fresh clone with Docker Desktop running, `pnpm dev:registries:up && pnpm dev:publish && pnpm dev:scaffold /tmp/try && pnpm dev:verify /tmp/try` succeeds and leaves the host in a clean state.

## Scope

**In:**

- Root `pnpm` scripts: `dev:publish`, `dev:scaffold`, `dev:verify`.
- Two new TS files run via `tsx`: `scripts/dev-scaffold.ts` (argv wrapper around `pnpm create`) and `scripts/dev-verify.ts` (boot + assert + teardown).
- Flip `packages/create-boject-cms/package.json` to `"private": false` and add a `publishConfig.registry` pointing at Verdaccio.
- Update `README.md`'s "Local dev registries (maintainers)" section to document the new commands.

**Out (deferred to later plans):**

- Publishing `@boject/cli` to Verdaccio — C4 extends `dev:publish` to cover both CLIs.
- `boject upgrade` command — C4.
- The "always-seed SiteSettings even with `--starter none`" behaviour — separate onboarding-defaults spec, not tied to C3.
- CI running this loop on every PR — Plan C5.
- Publishing to public npm or GHCR — Plan D.

## Design Decisions

### Flip `private: false` + pin `publishConfig.registry`

The scaffolder was created with `"private": true` in C2 to guard against accidental publishes before the publish pipeline existed. C3 is the pipeline. Flipping `private: false` and adding `"publishConfig": { "registry": "http://localhost:4873" }` makes Verdaccio the default publish target for this package — `pnpm publish` anywhere else just goes to Verdaccio on localhost. Plan D's release PR rewrites `publishConfig.registry` (or removes it to inherit the default npmjs URL) when the public publish flow lands. Rejected: keep `private: true` and publish via `pnpm pack` + direct HTTP upload to Verdaccio — more custom code for no real safety win.

### Fixed version `0.0.0-dev`, unpublish-then-publish

The package.json version stays `0.0.0-dev` in source. `dev:publish` first runs `npm unpublish --registry http://localhost:4873 create-boject-cms@0.0.0-dev --force` (error-ignored, Verdaccio is configured for anonymous unpublish on this package), then `pnpm --filter create-boject-cms publish`. Idempotent. No version bumping, no source-tree churn, no tarball-mangling. Rejected: timestamped versions (dirties the working tree per publish) and letting versions accumulate in Verdaccio storage (grows unbounded).

### pnpm-store caching: `--prefer-online` for the consumer

Because we republish the same `0.0.0-dev` version, pnpm's local package store may serve a stale copy from a previous publish when `dev:scaffold` runs. Passing `--prefer-online` forces a fresh fetch from Verdaccio. Verdaccio itself always serves the current tarball (it overwrites on republish). If caching proves flaky in practice, the escape hatch is to switch to a rotating version (e.g. `0.0.0-dev.<timestamp>`) — not done pre-emptively because it adds complexity for a problem we haven't seen yet.

### `dev:verify` and `dev:scaffold` as TS files; `dev:publish` as shell

Of the three scripts, two need real code. `dev:publish` is a pure shell chain — it lives as a one-liner in root `package.json`. `dev:scaffold` needs to compose `pnpm create boject-cms <dir> --image ... --starter ... --force` where the target dir is a positional arg and `--image`/`--force` are always injected; a tiny wrapper (`scripts/dev-scaffold.ts`) parses argv, applies a `--starter base` default when absent, and spawns `pnpm create`. `dev:verify` needs `.env` parsing, HTTP polling, JSON assertions, cookie extraction, and guaranteed teardown — shell is the wrong tool; it lives at `scripts/dev-verify.ts`. Both TS scripts run via `tsx` (already a devDependency).

### Boot timeout: 60 seconds

`dev:verify` polls the health endpoint every 2 seconds with a 60-second ceiling. First boot pulls the image from the local registry (sub-second since it's localhost), runs Prisma migrations (~5-10s on Postgres 17), seeds the admin (~1s), imports the starter (~2-5s), and starts Nuxt (~5-10s). Total ~15-30s on a warm machine; 60s leaves generous margin without wasting wall-clock on a genuinely-broken boot.

### `down -v` in `finally`

The teardown step uses `docker compose down -v` — removes the containers AND wipes the named volumes (pgdata, storage). Each `dev:verify` run starts from a clean slate. Tradeoff: a failed boot loses its diagnostic state. For that case the verify script prints a hint: re-run `docker compose up -d` manually in the target dir, or comment out the teardown to keep state.

## Files Changed

| File                                      | Change                                                                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `packages/create-boject-cms/package.json` | `private: false`, add `publishConfig.registry: http://localhost:4873`.                                                  |
| `package.json` (repo root)                | Add `dev:publish`, `dev:scaffold`, `dev:verify` scripts.                                                                |
| `scripts/dev-scaffold.ts` (new)           | Wrapper: parses `<dir>` + optional `--starter`, spawns `pnpm create boject-cms` with the local-registry image injected. |
| `scripts/dev-verify.ts` (new)             | Verify logic: env parse + compose up + health poll + login + CT check + compose down.                                   |
| `README.md`                               | Document the three new commands in the existing "Local dev registries (maintainers)" section.                           |

## Script Contracts

### `pnpm dev:publish`

Shell chain in root package.json:

```
pnpm dev:publish:image && pnpm --filter create-boject-cms build && (npm unpublish --registry http://localhost:4873 create-boject-cms@0.0.0-dev --force 2>/dev/null || true) && pnpm --filter create-boject-cms publish
```

Preconditions: `pnpm dev:registries:up` has been run. Docker daemon is running. `~/.docker/daemon.json` allows `localhost:5555` as an insecure registry.

Success: CMS image available at `localhost:5555/boject/cms:dev` and `create-boject-cms@0.0.0-dev` available at `http://localhost:4873`.

### `pnpm dev:scaffold <dir> [--starter <name>]`

Runs `tsx scripts/dev-scaffold.ts <dir> [--starter <name>]`. The wrapper:

1. Takes the first positional as the target dir (errors out with usage if missing).
2. Accepts an optional `--starter <name>` — defaults to `base`.
3. Spawns:
   ```
   pnpm --registry http://localhost:4873 --prefer-online create boject-cms \
     <dir> \
     --image localhost:5555/boject/cms:dev \
     --starter <name> \
     --force
   ```
4. Exits with the spawned process's exit code.

Why a wrapper instead of a shell one-liner: the target dir is a positional that must sit between `boject-cms` and the flags, which means we can't just concat `"$@"` to the end. A 20-line TS wrapper is cleaner than fragile shell array manipulation.

### `pnpm dev:verify <dir>`

Runs `tsx scripts/dev-verify.ts <dir>`.

**Input:** path to a directory produced by `dev:scaffold`. Must contain `docker-compose.yml` and `.env`.

**Behaviour:**

1. Resolve `<dir>` to an absolute path. Fail if `docker-compose.yml` is missing.
2. Parse `<dir>/.env` — extract `BOJECT_ADMIN_EMAIL`, `BOJECT_ADMIN_PASSWORD`, and note whether `BOJECT_INITIAL_STARTER` is set.
3. `docker compose up -d` in `<dir>`.
4. Poll `http://localhost:4000/api/health` every 2s. Accept any 200. Fail on 60s timeout.
5. `POST http://localhost:4000/api/auth/login` with `{ email, password }` JSON body. Expect 200. Extract session cookie from `Set-Cookie`.
6. If `BOJECT_INITIAL_STARTER` was set: `GET http://localhost:4000/api/content-types` with the session cookie. Expect 200 with an array of ≥1 content type. Otherwise skip.
7. `finally`: `docker compose down -v` in `<dir>`.

**Exit code:** 0 on success. 1 on any failure (after teardown).

## Testing

No automated test suite for C3 itself. The whole point is the verify script — it's the test. C5 lifts the same flow into GitHub Actions, adding `dev:verify`'s exit code to CI.

**Manual verification after this plan:** on a clean machine, in order:

1. `pnpm dev:registries:up`
2. `pnpm dev:publish` — succeeds, `http://localhost:4873/-/all` shows `create-boject-cms@0.0.0-dev`.
3. `pnpm dev:scaffold /tmp/try-base` — succeeds, `/tmp/try-base` contains the scaffolded files.
4. `pnpm dev:verify /tmp/try-base` — exits 0 within 60s.
5. `pnpm dev:scaffold /tmp/try-none --starter none && pnpm dev:verify /tmp/try-none` — exits 0, skipping the CT assertion.
6. Rerun the whole sequence — all steps are idempotent.
7. `rm -rf /tmp/try-*` to clean up.

## Out of Scope

- `@boject/cli` publishing — C4.
- Automated CI integration — C5.
- Rotating versions — will revisit if caching bites in practice.
- `boject upgrade` exercising this loop — C4 (upgrade moves an image tag; `dev:verify` plus a second publish can prove the upgrade works).
- Testing the scaffold against multiple Node versions — Node 24 only; enforced by the scaffolder's `engines`.
