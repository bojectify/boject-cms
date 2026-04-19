# Onboarding C2 — `create-boject-cms` Scaffolder

## Overview

Build the `packages/create-boject-cms/` npm package. A single-prompt TypeScript CLI that writes a runnable Docker-based boject-cms project into a target directory. No network, no docker, no node_modules install — just file generation. This is the first CLI half of the onboarding flow; C3 wires it into the dev loop via Verdaccio, and C4 adds `boject upgrade`.

Parent spec: [`2026-04-18-onboarding-cli-design.md`](./2026-04-18-onboarding-cli-design.md) — see **`create-boject-cms` (scaffolder)** section.

End state after this plan: `pnpm --filter create-boject-cms build` produces a compiled CLI. Running the compiled binary against a target directory generates a working project skeleton. C1's dev registries are unused here — C3 wires them in.

## Scope

**In:**

- New package `packages/create-boject-cms/` with `bin: { "create-boject-cms": "./dist/index.js" }`.
- Single interactive prompt for starter choice via `@clack/prompts`.
- Flag parsing: `<target-dir>` (positional, required), `--force`, `--starter <name>`, `--image <tag>`.
- Secret generation: `NUXT_SESSION_PASSWORD` (32 bytes base64) and `BOJECT_ADMIN_PASSWORD` (16 bytes base64) via `crypto.randomBytes`.
- Template rendering for six files (`docker-compose.yml`, `.env`, `package.json`, `.gitignore`, `README.md`, plus the chosen starter bundle copied into `starters/`).
- Build pipeline: `tsup` for TypeScript → ESM + shebang, plus a `copyStarters.ts` script that ships `starters/*.boject.json` inside the package tarball.
- Unit tests for secrets, templates, and prompt short-circuit logic; E2E tests that scaffold into a temp directory and assert file contents.
- Committed `src/version.ts` with placeholder `export const IMAGE_TAG = 'ghcr.io/boject/cms:latest'`.

**Out (deferred to later C-plans or Plan D):**

- Publishing to Verdaccio (C3) or npm (Plan D).
- `dev:publish` / `dev:scaffold` / `dev:verify` root scripts (C3).
- Release-time rewriting of `version.ts` (Plan D).
- The generated project actually booting successfully — that's C3's E2E check.
- `boject upgrade` (C4).

## Design Decisions

### Publish later, not now

C2 builds the package but does not publish it. The parent spec treats public publishing as part of the release pipeline (Plan D). Deferring avoids pre-claiming `create-boject-cms` on npmjs.org, avoids committing a version.ts that matches a specific tag, and avoids entangling the scaffolder with the release workflow before that workflow exists. C3 will publish to the local Verdaccio with the real publish command — the flow is real from C3 onward, we just skip public registries.

### `@clack/prompts` over alternatives

One interactive prompt (starter choice). `@clack/prompts` is the community standard for new scaffolders (used by `create-vite`, `create-astro`, `create-nuxt`, `nuxi init`) — users get familiar UX across the ecosystem. Small dep (~30KB), ESM-native, Vite-team maintained. Rejected: `prompts` (lightly maintained, older default), hand-rolled `readline` (still need flag short-circuit + non-TTY gate; not worth saving a dep).

### Literal TS strings for small files, file copy for starters

Six template files are written, five of which are small (tens of lines) with variable interpolation. Literal TS template functions give us type safety on the parameters, single-source refactoring, and easy unit testing. Starter bundles live at the repo root (`starters/base.boject.json` etc.), are large, and already tested separately — the scaffolder copies them verbatim at build time into `dist/starters/` so the published tarball carries them. Rejected: a separate `templates/` directory of raw files for the small templates (loses type safety for a marginal gain), or inlining the starter JSON as a string (500+ line string literal, ugly diffs, duplicates the canonical source).

### `tsup` build over plain `tsc`

Scaffolder CLIs need an ESM-compatible compiled JS output with a shebang in the `bin` entry. `tsup` (esbuild-based) handles shebang injection, ESM output, and externalising runtime dependencies with zero config. `tsc` would require explicit `.js` extensions on every import and manual shebang plumbing. `tsup` is also what the comparable ecosystem scaffolders use. ~10MB devDep accepted.

### Image tag pin defaults to `ghcr.io/boject/cms:latest`

`src/version.ts` is committed with `IMAGE_TAG = 'ghcr.io/boject/cms:latest'`. When Plan D's release pipeline lands, a release PR step rewrites this to a concrete version (`ghcr.io/boject/cms:1.2.3`). `:latest` is a clear placeholder, never surprises users running the scaffolder from a dev checkout, and C3 overrides it with `--image localhost:5555/boject/cms:dev` for the local loop.

### Generated project name derived from target directory

The scaffolded `package.json`'s `name` field is derived from the user-supplied target directory basename — lowercase, runs of non-alphanumerics replaced with `-`, leading/trailing `-` stripped. Empty result falls back to `boject-site`. This keeps the scaffold single-prompt (no "what should we call this project?" question) while producing a valid npm-compatible name. The user project is `"private": true` so the name never needs to be unique on npmjs.

## Package Layout

```
packages/create-boject-cms/
  package.json              # name, bin, files, deps
  tsconfig.json             # ESM, strict
  tsup.config.ts            # src/index.ts → dist/index.js, shebang, ESM
  src/
    index.ts                # CLI entrypoint (argv parse → prompts → writeProject → print)
    prompts.ts              # @clack/prompts select for starter choice
    secrets.ts              # randomBytes wrappers
    render.ts               # re-exports the per-file template renderers
    version.ts              # export const IMAGE_TAG
    writeProject.ts         # orchestrator: targetDir checks, render, write, copy starter
    templates/
      dockerCompose.ts      # render({ imageTag, includeStarter, starterChoice }) => string
      envFile.ts            # render({ sessionPassword, adminPassword, starterChoice }) => string
      packageJson.ts        # render({ name }) => string
      gitignore.ts          # constant string export
      readme.ts             # render({ starterChoice, adminEmail }) => string
  tests/
    unit/
      secrets.test.ts
      render.test.ts
      prompts.test.ts
    e2e/
      scaffold.test.ts
  scripts/
    copyStarters.ts         # tsx script: copies starters/*.boject.json → dist/starters/
```

## Scaffolder Behaviour

**Invocation:** `pnpm create boject-cms <target-dir>` or `npx create-boject-cms <target-dir>`.

**Flow:**

1. Parse argv.
   - Positional `<target-dir>`: required. Missing → print usage, exit 1.
   - `--force`: allow scaffolding into a non-empty target.
   - `--starter <name>`: one of `base` | `sport` | `rugby` | `none`. Invalid value → exit 1.
   - `--image <tag>`: override the compiled-in `IMAGE_TAG`.
2. Resolve target to an absolute path. If it exists and is non-empty and `--force` is not set, exit 1 with `Target directory "<path>" is not empty. Pass --force to scaffold anyway.`. If it doesn't exist, create it.
3. Resolve starter:
   - If `--starter` supplied, use it.
   - Else, if stdin is a TTY, prompt via `@clack/prompts` (`select`: "Which starter?" with four options).
   - Else (no TTY, no flag), exit 1 with `Non-interactive shell detected. Pass --starter <base|sport|rugby|none>.`.
4. Generate secrets: `NUXT_SESSION_PASSWORD = randomBytes(32).toString('base64')`, `BOJECT_ADMIN_PASSWORD = randomBytes(16).toString('base64')`.
5. Render templates and write to target. If starter ≠ `none`, also copy `dist/starters/<choice>.boject.json` → `<target>/starters/<choice>.boject.json`.
6. Print next-steps to stdout including the admin email (`admin@local`) and the generated admin password. This is the **only** time the password appears in stdout — the rest lives in `.env`.

**Generated files:**

| File                            | Content                                                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker-compose.yml`            | `services.cms` (image: `<resolved tag>`, `env_file: .env`, `depends_on: db`, `ports: 4000:3000`, volume mounts for storage + starters), `services.db` (`postgres:17`, `env`, `pgdata` volume).          |
| `.env`                          | `DATABASE_URL`, `NUXT_SESSION_PASSWORD`, `BOJECT_ADMIN_EMAIL=admin@local`, `BOJECT_ADMIN_PASSWORD`, `STORAGE_DRIVER=local`. If starter ≠ none: `BOJECT_INITIAL_STARTER=/starters/<choice>.boject.json`. |
| `package.json`                  | `name` (sanitised), `version: "0.1.0"`, `private: true`, `scripts: { start, stop, logs, upgrade }`. No deps.                                                                                            |
| `.gitignore`                    | `.env`, `storage/`, `pgdata/`.                                                                                                                                                                          |
| `starters/<choice>.boject.json` | Byte-for-byte copy from the bundled `dist/starters/`. Omitted when starter is `none`.                                                                                                                   |
| `README.md`                     | "What you got" summary + next-steps snippet (`docker compose up -d`, login URL with the admin email) + brief note that the admin password is in `.env`.                                                 |

**Non-behaviour:** does not shell out to docker, does not hit any network, does not run `pnpm install` or similar, does not touch anything outside the target directory.

## Testing

**Unit tests** (fast, no filesystem):

- `secrets.test.ts` — byte lengths (32 / 16), base64 format (only `A-Za-z0-9+/=`), uniqueness across back-to-back calls.
- `render.test.ts` — one test per template. Explicit `toContain` / `toMatch` assertions on load-bearing substrings (image tag appears in compose, admin email in env, script values in package.json). No full-file snapshots.
- `prompts.test.ts` — with `--starter` passed, `@clack/prompts` is not called (mocked). With non-TTY and no flag, resolver throws the expected error.

**E2E tests** (temp directory, real filesystem, single file):

- Happy path with `--starter base`: all six files exist, `.env` has valid secret shapes (44-char base64 for 32 bytes incl. padding, 24-char for 16 bytes), `starters/base.boject.json` matches the repo-root source byte-for-byte.
- `--starter none`: five files, no `starters/` directory, no `BOJECT_INITIAL_STARTER` line in `.env`.
- Non-empty target without `--force`: exits non-zero, target is untouched.
- Non-empty target with `--force`: succeeds.
- Missing target arg: exits 1, usage on stderr.
- `--image custom/tag:1.0` override: generated compose's `image:` line matches exactly, not the default `:latest`.

Tests use Vitest (already configured for the monorepo). A new vitest config scoped to this package adds it to the root `pnpm test` run via workspace filter.

## Build Pipeline

`pnpm --filter create-boject-cms build` runs two steps:

1. `tsup` — compiles `src/` → `dist/`, emits ESM with `#!/usr/bin/env node` shebang on `index.js`, externalises `@clack/prompts` (users get it via npm install).
2. `tsx scripts/copyStarters.ts` — reads `../../starters/{base,sport,rugby}.boject.json` and writes them to `dist/starters/`. Fails loudly if any expected starter is missing.

The scaffolder at runtime resolves starters via `fileURLToPath(import.meta.url)` → walks up to the package root (once, cached) → reads `dist/starters/<choice>.boject.json`. Works both in local dev (after a build) and in the published tarball.

## Monorepo Wiring

- `pnpm-workspace.yaml` already lists `packages/*` — no change.
- Root `package.json` gains no new scripts in C2. The package is driven via `pnpm --filter create-boject-cms <script>`. C3 adds root-level `dev:publish` etc. that orchestrate this package plus Verdaccio.

## Out of Scope

- Publishing (npm or Verdaccio) — C3 publishes to Verdaccio; Plan D publishes to npm.
- Release-time `version.ts` rewriting — Plan D.
- `boject upgrade` — C4.
- Any runtime verification that the scaffolded project boots — C3's `dev:verify` handles that.
- A `create-boject-cms --update` check (self-updating the scaffolder) — explicitly out of scope per parent spec.
