# Onboarding C3 — Dev Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire C1's dev registries and C2's scaffolder into an end-to-end loop via three root `pnpm` scripts: `dev:publish` (publishes image + scaffolder), `dev:scaffold <dir>` (runs published scaffolder with local-registry defaults), `dev:verify <dir>` (boots, asserts health + admin login + starter import, tears down).

**Architecture:** Two small `tsx`-run TS scripts live at repo-root `scripts/` — one thin argv wrapper around `pnpm create` (`dev-scaffold.ts`), one that drives docker compose + HTTP assertions (`dev-verify.ts`). `dev:publish` is a shell chain in root `package.json` that reuses the existing `dev:publish:image` (C1) and `pnpm --filter create-boject-cms build/publish`. The scaffolder package flips to `"private": false` with `publishConfig.registry: http://localhost:4873`, and a Verdaccio dummy auth token is registered in the root `.npmrc` so npm/pnpm accept the anonymous publish/unpublish operations.

**Tech Stack:** Node 24 + `tsx`, Verdaccio's npm registry protocol, `docker compose` CLI, `fetch`/`Headers.getSetCookie()` for the HTTP work.

**Spec:** [`docs/superpowers/specs/2026-04-19-onboarding-c3-dev-loop-design.md`](../specs/2026-04-19-onboarding-c3-dev-loop-design.md)

---

## File Structure

| File                                               | Responsibility                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/create-boject-cms/package.json` (modify) | Flip `private: false`; add `publishConfig.registry: http://localhost:4873`.                                                          |
| `.npmrc` (modify)                                  | Append a dummy `_authToken` entry for `localhost:4873` so `npm`/`pnpm` accept anonymous publish/unpublish.                           |
| `scripts/dev-scaffold.ts` (new)                    | Parse `<dir>` + optional `--starter`, spawn `pnpm create boject-cms` with the local-registry image tag injected.                     |
| `scripts/dev-verify.ts` (new)                      | Read scaffolded `.env`, boot compose, poll health, login, assert content types when a starter was selected, teardown with `down -v`. |
| `package.json` (repo root, modify)                 | Add `dev:publish`, `dev:scaffold`, `dev:verify` scripts.                                                                             |
| `README.md` (modify)                               | Extend the existing "Local dev registries (maintainers)" section with the three new commands.                                        |

No automated tests — the whole loop is the test. Manual verification is Task 6.

---

## Task 1: Flip scaffolder to publishable + register Verdaccio auth token

**Files:**

- Modify: `packages/create-boject-cms/package.json`
- Modify: `.npmrc` at repo root

- [ ] **Step 1: Flip `private` and add `publishConfig` in the scaffolder's `package.json`**

Open `packages/create-boject-cms/package.json` and change the two lines:

```json
"private": true,
```

to

```json
"private": false,
"publishConfig": {
  "registry": "http://localhost:4873"
},
```

The resulting top of the file (after the edit) should look like:

```json
{
  "name": "create-boject-cms",
  "version": "0.0.0-dev",
  "private": false,
  "publishConfig": {
    "registry": "http://localhost:4873"
  },
  "type": "module",
  "description": "Scaffold a new boject-cms project.",
  ...
}
```

- [ ] **Step 2: Append a dummy auth token to the root `.npmrc`**

The repo root already has a `.npmrc`. Append two lines:

```
//localhost:4873/:_authToken="dev-registry-noop"
//localhost:5555/:_authToken="dev-registry-noop"
```

The second line is for symmetry with the Docker registry should any npm tooling ever hit it (it won't, but cheap to have). The scaffolder won't publish there.

The resulting `.npmrc` should look like:

```
public-hoist-pattern[]=vitest
public-hoist-pattern[]=@vitest/*
public-hoist-pattern[]=vite-node
public-hoist-pattern[]=eslint
public-hoist-pattern[]=@typescript-eslint/*
public-hoist-pattern[]=semver
//localhost:4873/:_authToken="dev-registry-noop"
//localhost:5555/:_authToken="dev-registry-noop"
```

- [ ] **Step 3: Verify the package is now publishable**

```bash
pnpm --filter create-boject-cms build
pnpm --filter create-boject-cms pack --pack-destination /tmp
```

Expected: a file like `/tmp/create-boject-cms-0.0.0-dev.tgz` exists. Clean up:

```bash
rm /tmp/create-boject-cms-0.0.0-dev.tgz
```

- [ ] **Step 4: Commit**

```bash
git add packages/create-boject-cms/package.json .npmrc
git commit -m "feat(c3): make create-boject-cms publishable to verdaccio"
```

---

## Task 2: `scripts/dev-scaffold.ts`

**Files:**

- Create: `scripts/dev-scaffold.ts`
- Modify: `package.json` (repo root) — add `dev:scaffold` script

- [ ] **Step 1: Create the `scripts/` directory and `dev-scaffold.ts`**

Write `scripts/dev-scaffold.ts`:

```ts
#!/usr/bin/env tsx
import { spawnSync } from 'node:child_process';

const REGISTRY = 'http://localhost:4873';
const IMAGE = 'localhost:5555/boject/cms:dev';

function main(): void {
  const args = process.argv.slice(2);
  const targetDir = args[0];
  if (!targetDir || targetDir.startsWith('-')) {
    process.stderr.write('Usage: pnpm dev:scaffold <dir> [--starter <name>]\n');
    process.exit(1);
  }

  const rest = args.slice(1);
  const starterIdx = rest.indexOf('--starter');
  const starter =
    starterIdx >= 0 && rest[starterIdx + 1] !== undefined
      ? rest[starterIdx + 1]
      : 'base';

  const result = spawnSync(
    'pnpm',
    [
      '--registry',
      REGISTRY,
      '--prefer-online',
      'create',
      'boject-cms',
      targetDir,
      '--image',
      IMAGE,
      '--starter',
      starter,
      '--force',
    ],
    { stdio: 'inherit' }
  );

  process.exit(result.status ?? 1);
}

main();
```

- [ ] **Step 2: Add the `dev:scaffold` script to root `package.json`**

Insert this line into the `scripts` block, immediately after `"dev:publish:image"`:

```json
"dev:scaffold": "tsx scripts/dev-scaffold.ts",
```

- [ ] **Step 3: Install tsx at the workspace root**

`tsx` is already a devDependency of the scaffolder package. For root-level use, install it at the workspace root:

```bash
pnpm add -wD tsx
```

Expected: `tsx` appears under `devDependencies` in root `package.json`.

- [ ] **Step 4: Smoke-check the wrapper refuses missing args**

```bash
pnpm dev:scaffold
```

Expected: exits 1, prints `Usage: pnpm dev:scaffold <dir> [--starter <name>]` to stderr.

- [ ] **Step 5: Commit**

```bash
git add scripts/dev-scaffold.ts package.json pnpm-lock.yaml
git commit -m "feat(c3): add dev:scaffold wrapper script"
```

---

## Task 3: `dev:publish` root script

**Files:**

- Modify: `package.json` (repo root) — add `dev:publish` script

- [ ] **Step 1: Add the `dev:publish` script**

Insert into the `scripts` block, immediately after `"dev:publish:image"`:

```json
"dev:publish": "pnpm dev:publish:image && pnpm --filter create-boject-cms build && (npm unpublish --registry http://localhost:4873 create-boject-cms@0.0.0-dev --force 2>/dev/null || true) && pnpm --filter create-boject-cms publish --no-git-checks",
```

Note:

- `dev:publish:image` — builds + pushes the CMS image (from C1).
- `pnpm --filter create-boject-cms build` — compiles the scaffolder + copies starters.
- `npm unpublish ... || true` — wipes any existing `0.0.0-dev` on Verdaccio. First run fails silently; subsequent runs succeed.
- `pnpm --filter create-boject-cms publish --no-git-checks` — publishes the compiled package to Verdaccio (routed via `publishConfig.registry`). `--no-git-checks` skips pnpm's "uncommitted changes" guard, which would otherwise block publishing during development.

The resulting `scripts` block around that area should read (order matters for readability):

```json
"dev:registries:up": "docker compose -f docker-compose.dev.yml up -d",
"dev:registries:down": "docker compose -f docker-compose.dev.yml down",
"dev:publish:image": "docker build -f apps/cms/Dockerfile -t localhost:5555/boject/cms:dev . && docker push localhost:5555/boject/cms:dev",
"dev:publish": "pnpm dev:publish:image && pnpm --filter create-boject-cms build && (npm unpublish --registry http://localhost:4873 create-boject-cms@0.0.0-dev --force 2>/dev/null || true) && pnpm --filter create-boject-cms publish --no-git-checks",
"dev:scaffold": "tsx scripts/dev-scaffold.ts",
```

- [ ] **Step 2: Run `pnpm dev:publish` end-to-end**

Preconditions: `pnpm dev:registries:up` has already been run in the current session.

```bash
pnpm dev:publish
```

Expected:

- Docker build succeeds and `localhost:5555/boject/cms:dev` is pushed.
- Scaffolder builds (`dist/index.js` + `dist/starters/*.boject.json`).
- First unpublish emits a warning (no such version); subsequent runs succeed silently.
- `pnpm publish` reports success and prints the published tarball URL on `http://localhost:4873`.

Verify the publish registered:

```bash
curl -s http://localhost:4873/-/all | grep -c '"create-boject-cms"'
```

Expected: `1` (or more — exact count depends on the JSON shape; any non-zero match means Verdaccio has the package).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat(c3): add dev:publish orchestration script"
```

---

## Task 4: `scripts/dev-verify.ts`

**Files:**

- Create: `scripts/dev-verify.ts`
- Modify: `package.json` (repo root) — add `dev:verify` script

- [ ] **Step 1: Implement `scripts/dev-verify.ts`**

```ts
#!/usr/bin/env tsx
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const HEALTH_URL = 'http://localhost:4000/api/health';
const LOGIN_URL = 'http://localhost:4000/api/auth/login';
const CONTENT_TYPES_URL = 'http://localhost:4000/api/content-types';
const BOOT_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;

interface EnvVars {
  adminEmail: string;
  adminPassword: string;
  hasStarter: boolean;
}

function parseEnv(contents: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    map.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  return map;
}

async function readEnv(dir: string): Promise<EnvVars> {
  const contents = await readFile(resolve(dir, '.env'), 'utf8');
  const env = parseEnv(contents);
  const adminEmail = env.get('BOJECT_ADMIN_EMAIL');
  const adminPassword = env.get('BOJECT_ADMIN_PASSWORD');
  if (!adminEmail) throw new Error('.env missing BOJECT_ADMIN_EMAIL');
  if (!adminPassword) throw new Error('.env missing BOJECT_ADMIN_PASSWORD');
  return {
    adminEmail,
    adminPassword,
    hasStarter: env.has('BOJECT_INITIAL_STARTER'),
  };
}

function composeUp(dir: string): void {
  const r = spawnSync('docker', ['compose', 'up', '-d'], {
    cwd: dir,
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error('docker compose up failed');
}

function composeDown(dir: string): void {
  spawnSync('docker', ['compose', 'down', '-v'], {
    cwd: dir,
    stdio: 'inherit',
  });
}

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTH_URL);
      if (res.ok) return;
    } catch {
      // connection refused while container still booting
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Health check timed out after ${BOOT_TIMEOUT_MS}ms`);
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed: HTTP ${res.status}`);
  const setCookies = res.headers.getSetCookie();
  if (setCookies.length === 0)
    throw new Error('Login response missing Set-Cookie');
  return setCookies.map((c) => c.split(';')[0]).join('; ');
}

async function assertContentTypes(cookie: string): Promise<void> {
  const res = await fetch(CONTENT_TYPES_URL, { headers: { Cookie: cookie } });
  if (!res.ok)
    throw new Error(`GET /api/content-types failed: HTTP ${res.status}`);
  const body = (await res.json()) as { items?: unknown[] };
  const count = Array.isArray(body.items) ? body.items.length : 0;
  if (count === 0) {
    throw new Error('Expected at least one content type but got zero');
  }
}

async function main(): Promise<void> {
  const targetDir = process.argv[2];
  if (!targetDir) {
    process.stderr.write('Usage: pnpm dev:verify <dir>\n');
    process.exit(1);
  }
  const dir = resolve(targetDir);
  if (!existsSync(resolve(dir, 'docker-compose.yml'))) {
    process.stderr.write(`No docker-compose.yml found in ${dir}\n`);
    process.exit(1);
  }

  const env = await readEnv(dir);
  let failureMessage: string | null = null;

  try {
    composeUp(dir);
    await waitForHealth();
    const cookie = await login(env.adminEmail, env.adminPassword);
    if (env.hasStarter) {
      await assertContentTypes(cookie);
    }
    process.stdout.write('dev:verify: OK\n');
  } catch (error) {
    failureMessage = error instanceof Error ? error.message : String(error);
    process.stderr.write(`dev:verify failed: ${failureMessage}\n`);
    process.stderr.write(
      `To inspect the running container manually, rerun \`docker compose up -d\` in ${dir} and check \`docker compose logs cms\`.\n`
    );
  } finally {
    composeDown(dir);
  }

  process.exit(failureMessage === null ? 0 : 1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Unhandled error: ${message}\n`);
  process.exit(1);
});
```

- [ ] **Step 2: Add the `dev:verify` script to root `package.json`**

Insert immediately after `"dev:scaffold"`:

```json
"dev:verify": "tsx scripts/dev-verify.ts",
```

- [ ] **Step 3: Smoke-check argv guards**

```bash
pnpm dev:verify
```

Expected: exits 1 with `Usage: pnpm dev:verify <dir>`.

```bash
pnpm dev:verify /tmp/does-not-exist
```

Expected: exits 1 with `No docker-compose.yml found in /tmp/does-not-exist`.

- [ ] **Step 4: Commit**

```bash
git add scripts/dev-verify.ts package.json
git commit -m "feat(c3): add dev:verify boot/login/assert/teardown script"
```

---

## Task 5: End-to-end manual verification

**Files:** no file changes. Pure runtime verification.

Run the full loop from a clean state and confirm both the starter and no-starter paths succeed.

- [ ] **Step 1: Ensure the registries are up**

```bash
pnpm dev:registries:up
```

- [ ] **Step 2: Run the full publish chain**

```bash
pnpm dev:publish
```

Expected: image pushed to `localhost:5555`, scaffolder published to Verdaccio.

- [ ] **Step 3: Scaffold and verify the `base` starter path**

```bash
pnpm dev:scaffold /tmp/dev-verify-base
pnpm dev:verify /tmp/dev-verify-base
```

Expected:

- `dev:scaffold` exits 0 and writes `/tmp/dev-verify-base/{docker-compose.yml,.env,package.json,.gitignore,README.md,starters/base.boject.json}`.
- `dev:verify` exits 0 with `dev:verify: OK` printed, after bringing the container up, polling health, logging in, and asserting `>=1` content type.
- The container is torn down (`docker compose down -v`) at the end; a `docker ps | grep dev-verify-base` shows nothing.

- [ ] **Step 4: Scaffold and verify the `none` starter path**

```bash
pnpm dev:scaffold /tmp/dev-verify-none --starter none
pnpm dev:verify /tmp/dev-verify-none
```

Expected:

- `.env` for this scaffold has no `BOJECT_INITIAL_STARTER` line.
- `dev:verify` exits 0 and skips the content-type assertion (log ends at `dev:verify: OK` after login).

- [ ] **Step 5: Re-run idempotently**

```bash
pnpm dev:publish
pnpm dev:scaffold /tmp/dev-verify-base --starter base
pnpm dev:verify /tmp/dev-verify-base
```

Expected: all three exit 0. No orphan containers or volumes.

- [ ] **Step 6: Clean up**

```bash
rm -rf /tmp/dev-verify-base /tmp/dev-verify-none
```

- [ ] **Step 7: No commit** — this task is a verification gate. If any step failed, stop and fix the underlying issue rather than continuing.

---

## Task 6: Document the new commands

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Extend the "Local dev registries (maintainers)" section**

In `README.md`, find the existing "Commands" subsection under "Local dev registries (maintainers)". Replace the current commands block with this expanded version:

````markdown
### Commands

```bash
pnpm dev:registries:up        # Start both registries in the background
pnpm dev:registries:down      # Stop them (volumes persist)
pnpm dev:publish:image        # Build apps/cms and push to localhost:5555/boject/cms:dev
pnpm dev:publish              # Push the image AND publish create-boject-cms@0.0.0-dev to verdaccio
pnpm dev:scaffold <dir>       # Scaffold a project using the verdaccio-published scaffolder and local image
pnpm dev:verify <dir>         # Boot the scaffolded project, assert health + admin login (+ content-type import if a starter was selected), then tear down
```

A typical end-to-end loop:

```bash
pnpm dev:registries:up
pnpm dev:publish
pnpm dev:scaffold /tmp/try
pnpm dev:verify /tmp/try
```

`dev:scaffold` accepts an optional `--starter <base|sport|rugby|none>` flag (default `base`).
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(c3): document dev:publish/scaffold/verify commands"
```

---

## Out of Scope (addressed in later plans)

- C4 — `@boject/cli` with `upgrade` command; `dev:publish` extends to also publish it.
- C5 — CI integration of this loop.
- Plan D — public npm/GHCR publishing + release-time version rewriting.
- "Always seed SiteSettings on empty DB" — separate onboarding-defaults spec.
