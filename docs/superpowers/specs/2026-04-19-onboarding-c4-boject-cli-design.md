# Onboarding C4 — `@boject/cli` with `upgrade` Command

## Overview

Build the second half of the onboarding CLI surface. A new `@boject/cli` npm package exposes a `boject` binary whose first (and currently only) command is `upgrade` — reads the scaffolded project's `docker-compose.yml`, discovers a newer image tag from whatever registry the image is already pulled from, rewrites the compose file in place (preserving user edits), pulls the new image, restarts the container, and waits for health. Plus the dev-loop wiring that exercises the upgrade path end-to-end.

Parent spec: [`2026-04-18-onboarding-cli-design.md`](./2026-04-18-onboarding-cli-design.md) — see **`boject upgrade`** section.

End state after this plan: running `pnpm dev:publish` publishes both `create-boject-cms@0.0.1-rc.1` AND `@boject/cli@0.0.1-rc.1` to the local Verdaccio, alongside `localhost:5555/boject/cms:0.0.1-rc.1`. One version across all three dev artifacts. `pnpm dev:verify <dir> --upgrade` scaffolds, boots, publishes a second image at a higher semver, runs `boject upgrade` inside the scaffold, and asserts the compose file was rewritten and the container restarted. End users never touch Verdaccio — they run `npx @boject/cli@latest upgrade` in a project produced by `pnpm create boject-cms`.

## Scope

**In:**

- New workspace package `packages/boject-cli/` with `bin: { "boject": "./dist/index.js" }`, version `0.0.1-rc.1`.
- Single `upgrade` command with `--to <version>`, `--dry-run`, `--check` flags.
- Compose file rewrite via the `yaml` package's Document API (preserves comments + formatting).
- Tag discovery via the Docker Registry v2 API with the OCI Bearer-token flow; works against GHCR, the local `registry:2`, or any compliant registry.
- Semver filtering + selection via the `semver` package.
- Unit tests per module + one E2E test that starts an ephemeral in-process HTTP mock of the Docker Registry v2 API and exercises the CLI end-to-end against it (without booting the actual CMS).
- Dev loop extensions: `dev:publish` publishes both CLIs to Verdaccio at `0.0.1-rc.1`; `dev:verify` gains a `--upgrade` flag that builds + pushes a second image and runs the CLI in the scaffolded project, asserting the rewrite + restart path.
- Switch the local image tag from `dev` to `0.0.1-rc.1` throughout the dev loop so the upgrade flow exercises real semver semantics.
- Align the Verdaccio-published scaffolder version with the image tag: `packages/create-boject-cms/package.json` bumps from `0.0.0-dev` to `0.0.1-rc.1`. One coordinated version across image + scaffolder + CLI.

**Out (deferred):**

- Publishing to public npm or GHCR — Plan D.
- Release-time rewriting of `src/version.ts` — Plan D.
- CI running the upgrade loop — Plan C5.
- Auto-update of the CLI itself — explicitly out of scope per parent spec.
- Multi-service upgrades, rollback, major-version-jump warnings — out of scope per parent spec and YAGNI.

## Design Decisions

### Registry auto-detection over explicit flag

The CLI reads `services.cms.image` from the compose file, parses it into `{ registry, repository, tag }`, and uses that `registry` as the source for tag discovery. A project pinned to `ghcr.io/boject/cms:1.2.3` lists tags from ghcr.io; a local-loop project pinned to `localhost:5555/boject/cms:0.0.1-rc.1` lists tags from localhost:5555. End users never pass a flag to control this; the compose file already declares the registry they're consuming. Rejected: a `--registry` flag (one more thing for end users to get wrong, and the compose file is already the source of truth) and hard-coding `ghcr.io` (would make the dev loop inoperable for upgrade testing until Plan D).

### Docker Registry v2 API with Bearer-token flow

Tag listing uses `GET <registry>/v2/<repository>/tags/list`. If the response is 401 with a `WWW-Authenticate: Bearer realm=…,service=…,scope=…` header, the CLI follows the realm URL to fetch an anonymous token, then retries with `Authorization: Bearer <token>`. This is the OCI Distribution Specification auth flow — works across ghcr.io, Docker Hub, ECR, GCR, and plain unauthenticated registries (like our local `registry:2`). One code path, zero config.

### `yaml` library's Document API for compose rewrite

The compose file is round-tripped through `yaml.parseDocument` → `doc.setIn(['services','cms','image'], newRef)` → `doc.toString()`. This preserves all comments, indentation, key ordering, and whitespace around the unchanged sections. Critical because users will hand-edit their compose file (adding services, env entries, comments) and an upgrade that silently reformats their edits is a bad tool. Rejected: regex substitution (brittle when users modify formatting), full `js-yaml` reserialize (loses comments and reflows whitespace).

### Unified version `0.0.1-rc.1` across image + both CLI packages

To exercise `boject upgrade` locally the image must be tagged with a real semver — otherwise the tag-listing + semver-filter step finds no candidates. Rather than keep `dev` as a sentinel and bolt on a parallel semver tag, the whole dev loop moves to `0.0.1-rc.1`. And rather than leave `create-boject-cms@0.0.0-dev` and `@boject/cli@0.0.0-dev` on a different versioning scheme from the image, both Verdaccio-published packages also move to `0.0.1-rc.1`. One coordinated version across all three dev artifacts. When Plan D's release pipeline lands, bumping the monorepo version bumps all three in lockstep. For upgrade testing specifically, a maintainer then publishes a second image at a higher version (`0.0.1-rc.2`, etc.) via a small helper; `dev:verify --upgrade` automates that.

### Duplicate the ~20 lines of health-poll code

The CLI needs the same `fetch + retry + timeout` pattern as C3's `scripts/dev-verify.ts`. The natural de-duplication target would be a shared internal package — but one shared function doesn't justify the overhead of a new workspace package with its own build/test config. Duplicate for now; extract if a third caller emerges. YAGNI.

### Testing: unit + one focused E2E, no CMS-boot coverage in this package

Unit tests cover the pure logic (compose rewrite fidelity, image-ref parsing, tag selection, flag handling, health poll edge cases). The E2E test starts an in-process HTTP server (plain `node:http`) on a random port that mimics the Docker Registry v2 API — responding to `/v2/<repo>/tags/list` with a fixed tag list, and optionally exercising the 401+token flow to prove the auth path works. A fixture compose file is written to a temp dir pointing at `<mock-host:port>/boject/cms:0.0.1`, and the CLI is invoked against it. The test asserts the rewrite + `--dry-run` + `--check` paths without shelling out to Docker (the upgrade handler accepts an injected command runner so tests can stub `docker compose pull`/`up`). "Actually restart the CMS after upgrade" coverage lives in `dev:verify --upgrade`, where the full loop is exercised against a real scaffolded project.

## Package Layout

```
packages/boject-cli/
  package.json              # name: "@boject/cli", bin: { "boject": "./dist/index.js" }
  tsconfig.json             # ESM, strict, bundler resolution
  tsup.config.ts            # entry: src/index.ts, format: esm, shebang, external: yaml + semver
  vitest.config.ts
  src/
    index.ts                # argv parse → command dispatch
    commands/
      upgrade.ts            # orchestrates read → list → rewrite → pull → up → poll
    compose.ts              # parseCompose(path) / writeComposeImage(path, newRef)
    registry.ts             # parseImageRef / listSemverTags / pickHighest
    health.ts               # pollHealth(url, timeoutMs)
    version.ts              # export const CLI_VERSION = '0.0.1-rc.1'
  tests/
    unit/
      compose.test.ts
      registry.test.ts
      health.test.ts
      upgrade.test.ts       # command handler with mocked deps
    e2e/
      upgrade.test.ts       # ephemeral registry:2, two fake images, real CLI invocation
```

## `boject upgrade` Contract

**Invocation:** `boject upgrade [--to <version>] [--dry-run] [--check]`

**Preconditions:**

- Current working directory contains `docker-compose.yml`.
- `services.cms.image` is a valid OCI image reference.
- Docker CLI is on PATH (only needed for the apply path; `--dry-run` and `--check` don't shell out to docker).

**Flow:**

1. Read `./docker-compose.yml` → `yaml.parseDocument`.
2. Extract `services.cms.image` — if missing, exit 1 with a clear error.
3. Parse the image ref: `<registry>/<repository>:<tag>`.
4. Resolve the target tag:
   - `--to <version>` → use that verbatim.
   - Otherwise → fetch `<registry>/v2/<repository>/tags/list` (following the Bearer-token flow on 401), filter to semver, pick highest via `semver.rcompare`.
5. Compare current ↔ target:
   - Equal → print `Already on <tag>.` exit 0.
   - `--check` and not equal → print `Update available: <current> → <target>` exit 1.
   - `--check` and equal → print `Up to date: <tag>` exit 0.
   - `--dry-run` → print `-     image: <repository>:<current>` / `+     image: <repository>:<target>` exit 0.
   - Default path → continue.
6. Apply: rewrite `services.cms.image` in the document, `writeFile` the result. Run `docker compose pull cms` then `docker compose up -d`. Poll `http://localhost:4000/api/health` for up to 120s. On success: print `Upgraded <current> → <target>.` exit 0. On any failure: print the error, exit 1 (no rollback — the old compose content is in git history; the user does their own rollback if they want one).

**Exit codes:**

- 0 — success (applied, or `--dry-run`/`--check` determined no-op).
- 1 — failure, OR `--check` determined an upgrade is available.

## Dev Loop Extensions

### `dev:publish` unifies all three artifacts at `0.0.1-rc.1`

Update the existing chain in root `package.json`:

- The unpublish step on `create-boject-cms` changes from `@0.0.0-dev` to `@0.0.1-rc.1`.
- Add a parallel unpublish + publish pair for `@boject/cli@0.0.1-rc.1`.
- Move the local image tag from `dev` to `0.0.1-rc.1` in `dev:publish:image`.

Resulting chain (rough shape):

```
pnpm dev:publish:image
  && pnpm --filter create-boject-cms build
  && pnpm --filter @boject/cli build
  && (npm unpublish ... create-boject-cms@0.0.1-rc.1 --force 2>/dev/null || true)
  && (npm unpublish ... @boject/cli@0.0.1-rc.1 --force 2>/dev/null || true)
  && pnpm --filter create-boject-cms publish --no-git-checks
  && pnpm --filter @boject/cli publish --no-git-checks
```

Add a sibling helper `dev:publish:image:as` that takes a version arg — `pnpm dev:publish:image:as 0.0.1-rc.2` builds + pushes that specific tag. Used by `dev:verify --upgrade` and available for ad-hoc upgrade testing.

### `dev:verify --upgrade` exercises the full upgrade loop

Extend `scripts/dev-verify.ts`:

1. Run the existing C3 verify (boot, health, login, content-type check).
2. If `--upgrade` flag is present, **don't** tear down yet.
3. Build + push a second image at `localhost:5555/boject/cms:0.0.1-rc.2` (via the `dev:publish:image:as` helper or an equivalent `spawnSync`).
4. Inside `<dir>`, run `pnpm dlx @boject/cli@latest upgrade` with `npm_config_registry=http://localhost:4873` so the scaffolded project pulls the CLI from Verdaccio.
5. Re-read the compose file, assert `services.cms.image` now equals `localhost:5555/boject/cms:0.0.1-rc.2`.
6. Re-poll health against the upgraded container.
7. Tear down in the `finally` block as before.

### Scaffolder's generated `upgrade` script stays identical

`packages/create-boject-cms/src/templates/packageJson.ts` already emits:

```json
"upgrade": "npx @boject/cli@latest upgrade"
```

No change needed. Production users hit `@boject/cli@latest` via public npm (after Plan D); the dev loop overrides the registry with `npm_config_registry=http://localhost:4873` via the invocation shell in `dev:verify`.

## Files Added or Modified

| File                                      | Change                                                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/boject-cli/` (new)              | Full package with CLI source, tests, build config. Version `0.0.1-rc.1`.                                                                   |
| `packages/create-boject-cms/package.json` | Bump `version` from `0.0.0-dev` to `0.0.1-rc.1` for alignment with the image + CLI.                                                        |
| `package.json` (repo root)                | Rework `dev:publish` to unpublish/publish both CLIs at `0.0.1-rc.1` and push the image at the same tag; add `dev:publish:image:as` helper. |
| `scripts/dev-scaffold.ts`                 | Update `IMAGE` constant from `localhost:5555/boject/cms:dev` to `localhost:5555/boject/cms:0.0.1-rc.1`.                                    |
| `scripts/dev-verify.ts`                   | Add `--upgrade` code path (build + push second image at `0.0.1-rc.2`, run CLI, assert rewrite, re-poll).                                   |
| `README.md`                               | Document the unified `0.0.1-rc.1` version across artifacts, the `boject upgrade` command, and the `dev:verify --upgrade` flag.             |

## Out of Scope

- Plan D — public npm + GHCR publishing, release-time version rewriting.
- Plan C5 — CI integration.
- Self-update (`boject upgrade --self` etc.) — explicitly excluded by parent spec.
- Multi-service upgrades, rollback, major-version warnings — not in parent spec, YAGNI.
- Shared health-poll util — deferred until a third consumer appears.
