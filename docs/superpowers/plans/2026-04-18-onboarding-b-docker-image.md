# Onboarding Plan B — Docker Image + Entrypoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the Nuxt CMS as a self-bootstrapping Docker image at `ghcr.io/boject/cms` that runs migrations, seeds an admin from env vars, optionally imports a starter bundle, and launches the server — all in a single `docker run`.

**Architecture:** Multi-stage Dockerfile (`node:24-alpine` for both stages) builds the Nuxt app and copies the runtime artifacts into a slim image. A bash entrypoint orchestrates startup: waits for the DB, runs `prisma migrate deploy`, then conditionally seeds an admin + imports a starter (both idempotent — no-op if the DB already has data), then execs the Nuxt server. Storage is driver-configurable (`local`/`s3`/`r2`) via `STORAGE_DRIVER` env vars; default is `local` with a named Docker volume.

**Tech Stack:** Docker, node:24-alpine, Prisma v7, Nitro + unstorage drivers (`fs` / `s3`), existing `scripts/content-bundle/import.ts`, bash.

**Reference spec:** `docs/superpowers/specs/2026-04-18-onboarding-cli-design.md` (Docker Image section).

**Branch:** `feat/onboarding-b-docker-image`, based off `main` (Plan A merged as `c504c1c`).

---

## Layout at a glance

**New files** (all under `apps/cms/`):

```
apps/cms/
├── Dockerfile                       # multi-stage, node:24-alpine
├── .dockerignore                    # excludes .nuxt, .output, node_modules, storage, generated, .env, tests
├── docker/
│   ├── entrypoint.sh                # bash orchestrator — PID 1 at runtime
│   └── smoke-test.sh                # builds image, runs against ephemeral postgres, asserts first-boot
└── scripts/
    ├── docker-entrypoint/
    │   ├── wait-for-db.ts           # polls DATABASE_URL until reachable (30s timeout)
    │   ├── seed-admin.ts            # creates admin from BOJECT_ADMIN_* env vars if User table is empty
    │   ├── import-starter.ts        # imports BOJECT_INITIAL_STARTER bundle if ContentType table is empty
    │   ├── wait-for-db.test.ts
    │   ├── seed-admin.test.ts
    │   └── import-starter.test.ts
```

**Modified files:**

- `apps/cms/package.json` — add `"engines": { "node": ">=24" }`; move `tsx` from `devDependencies` to `dependencies` (needed at runtime to execute entrypoint TS scripts).
- `apps/cms/nuxt.config.ts` — wire `STORAGE_DRIVER` env var to Nitro storage config (`local`/`s3`/`r2`).

**Unchanged elsewhere** — this plan touches nothing outside `apps/cms/` except a docs update in Task 13.

---

## Ground rules

- All tasks run from the repo root `/Users/ollyharkness/Sites/boject-cms`. Use `pnpm --filter cms` when a command targets only the Nuxt app.
- Use `git mv` for moves. Use TDD for the three entrypoint TS scripts (test first, then implement).
- Plan A is merged; `apps/cms/` is authoritative. Don't recreate pre-restructure paths.
- Don't commit half-broken state. Each task ends with green hooks.
- Docker builds are slow; cache layers aggressively via `.dockerignore` + layer ordering.

---

### Task 1: Preflight — create branch, verify green baseline

**Files:** none

- [ ] **Step 1: Start on a fresh branch from main**

Run:

```bash
git checkout main
git pull
git checkout -b feat/onboarding-b-docker-image
```

Verify: `git status` shows clean working tree. `git log --oneline -1` shows `c504c1c chore(restructure): convert to pnpm monorepo with apps/cms (#74)`.

- [ ] **Step 2: Confirm dependencies install cleanly**

Run: `pnpm install`
Expected: success, no errors.

- [ ] **Step 3: Confirm test suite is green**

Run: `pnpm test`
Expected: 312/312 pass.

- [ ] **Step 4: Verify Docker daemon is reachable**

Run: `docker info | head -5`
Expected: output begins with `Client:` / `Server:`, no "Cannot connect" errors.

If Docker isn't running: start Docker Desktop and retry.

- [ ] **Step 5: Verify Postgres container is running (needed for integration tests throughout plan)**

Run: `docker compose up -d && docker ps --filter name=boject-cms-db`
Expected: `boject-cms-db-1` listed as running.

No commit for this task.

---

### Task 2: Add engines constraint + promote tsx to dependencies

**Files:**

- Modify: `apps/cms/package.json`

Runtime entrypoint scripts (Tasks 3–5) are written in TypeScript and executed with `tsx` inside the running container. `tsx` is currently a `devDependency`; promote it so it's installed when we do `pnpm install --prod` in the Dockerfile's runtime stage.

- [ ] **Step 1: Edit `apps/cms/package.json`**

Add `"engines": { "node": ">=24" }` between the top-level `"type"` and `"scripts"` fields. Move `"tsx": "^4.21.0"` from `devDependencies` to `dependencies`.

Relevant snippet (the rest of the file unchanged):

```json
{
  "name": "cms",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    ...
  },
  "dependencies": {
    ...existing deps...,
    "tsx": "^4.21.0"
  },
  "devDependencies": {
    ...existing devDeps WITHOUT tsx...
  }
}
```

- [ ] **Step 2: Re-install and re-lock**

Run: `pnpm install`
Expected: lockfile updates. No errors.

- [ ] **Step 3: Verify tsx is reachable from apps/cms**

Run: `pnpm --filter cms exec tsx --version`
Expected: prints the tsx version (e.g. `tsx v4.21.0`), exits 0.

- [ ] **Step 4: Run the full suite as a safety check**

Run: `pnpm test`
Expected: 312/312 pass (tsx's location in the dep tree doesn't affect test discovery).

- [ ] **Step 5: Commit**

```bash
git add apps/cms/package.json pnpm-lock.yaml
git commit -m "chore(docker): add node>=24 engines constraint; promote tsx to runtime dep"
```

---

### Task 3: `wait-for-db.ts` — standalone DB-reachability polling script

**Files:**

- Create: `apps/cms/scripts/docker-entrypoint/wait-for-db.ts`
- Create: `apps/cms/scripts/docker-entrypoint/wait-for-db.test.ts`

**Design:** The script polls a `DATABASE_URL` until a connection succeeds or a timeout fires. Uses `pg` directly (already a transitive dep via `@prisma/adapter-pg`) so we don't need to load the full Prisma client just to ping.

Exports two things:

- `waitForDb(opts)` — async function that polls; resolves on success, throws on timeout. Takes `{ databaseUrl, timeoutMs, intervalMs, now?, sleep? }` where `now` + `sleep` are injectable for tests.
- Default export / `main()` — CLI wrapper that reads `DATABASE_URL` from env, calls `waitForDb` with sensible defaults, prints progress, exits 0 on success or 1 on timeout.

- [ ] **Step 1: Write the failing tests**

Create `apps/cms/scripts/docker-entrypoint/wait-for-db.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { waitForDb } from './wait-for-db';

describe('waitForDb', () => {
  it('resolves immediately when probe succeeds on first try', async () => {
    const probe = vi.fn().mockResolvedValueOnce(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await waitForDb({
      databaseUrl: 'postgresql://localhost:5432/nope',
      timeoutMs: 5000,
      intervalMs: 500,
      probe,
      sleep,
    });

    expect(probe).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries until probe succeeds', async () => {
    const probe = vi
      .fn()
      .mockRejectedValueOnce(new Error('refused'))
      .mockRejectedValueOnce(new Error('refused'))
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await waitForDb({
      databaseUrl: 'postgresql://localhost:5432/nope',
      timeoutMs: 5000,
      intervalMs: 500,
      probe,
      sleep,
    });

    expect(probe).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it('throws when timeout is exhausted', async () => {
    const probe = vi.fn().mockRejectedValue(new Error('refused'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    let t = 0;
    const now = () => (t += 200); // each call advances 200ms

    await expect(
      waitForDb({
        databaseUrl: 'postgresql://localhost:5432/nope',
        timeoutMs: 500,
        intervalMs: 100,
        probe,
        sleep,
        now,
      })
    ).rejects.toThrow(/timed out/i);

    expect(probe).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests — expect FAIL**

Run: `pnpm --filter cms test:unit -- wait-for-db`
Expected: test file errors out with `Cannot find module './wait-for-db'` or similar.

- [ ] **Step 3: Implement the script**

Create `apps/cms/scripts/docker-entrypoint/wait-for-db.ts`:

```ts
import { Client } from 'pg';

export interface WaitForDbOptions {
  databaseUrl: string;
  timeoutMs: number;
  intervalMs: number;
  probe?: (url: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultProbe = async (url: string): Promise<void> => {
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    await client.query('SELECT 1');
  } finally {
    await client.end().catch(() => {});
  }
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function waitForDb(opts: WaitForDbOptions): Promise<void> {
  const probe = opts.probe ?? defaultProbe;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;

  const deadline = now() + opts.timeoutMs;
  let lastError: unknown;

  while (true) {
    try {
      await probe(opts.databaseUrl);
      return;
    } catch (err) {
      lastError = err;
    }

    if (now() >= deadline) {
      throw new Error(
        `waitForDb timed out after ${opts.timeoutMs}ms waiting for ${opts.databaseUrl}: ${
          lastError instanceof Error ? lastError.message : String(lastError)
        }`
      );
    }

    await sleep(opts.intervalMs);
  }
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const timeoutMs = Number(process.env.WAIT_FOR_DB_TIMEOUT_MS ?? '30000');
  const intervalMs = Number(process.env.WAIT_FOR_DB_INTERVAL_MS ?? '1000');

  console.log(`[wait-for-db] polling ${url} (timeout ${timeoutMs}ms)`);
  waitForDb({ databaseUrl: url, timeoutMs, intervalMs })
    .then(() => {
      console.log('[wait-for-db] database is reachable');
    })
    .catch((err) => {
      console.error(
        `[wait-for-db] ${err instanceof Error ? err.message : err}`
      );
      process.exit(1);
    });
}
```

- [ ] **Step 4: Run the tests — expect PASS**

Run: `pnpm --filter cms test:unit -- wait-for-db`
Expected: 3 tests pass.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/cms/scripts/docker-entrypoint/wait-for-db.ts apps/cms/scripts/docker-entrypoint/wait-for-db.test.ts
git commit -m "feat(docker): add wait-for-db polling script for entrypoint"
```

---

### Task 4: `seed-admin.ts` — idempotent admin seeding script

**Files:**

- Create: `apps/cms/scripts/docker-entrypoint/seed-admin.ts`
- Create: `apps/cms/scripts/docker-entrypoint/seed-admin.test.ts`

**Design:** Exports `seedAdminIfEmpty(prisma, { email, password, firstName, lastName, hashPassword })`. Returns a `{ seeded: boolean, reason: string }` result. Idempotent: if `User` count > 0, it's a no-op.

CLI wrapper: reads `BOJECT_ADMIN_EMAIL`, `BOJECT_ADMIN_PASSWORD` (required), `BOJECT_ADMIN_FIRST_NAME` (default `Admin`), `BOJECT_ADMIN_LAST_NAME` (default `User`). Hashes the password with the existing scrypt helper, calls `seedAdminIfEmpty`, prints a one-line result, exits 0.

The existing scrypt helper is `hashPassword` from `nuxt-auth-utils`. In Nuxt server routes it's auto-imported. Outside the Nuxt runtime we can't auto-import — we import explicitly from the package.

- [ ] **Step 1: Write the failing tests**

Create `apps/cms/scripts/docker-entrypoint/seed-admin.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { seedAdminIfEmpty } from './seed-admin';

type MockPrisma = {
  user: {
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
};

function makePrisma(count: number): MockPrisma {
  return {
    user: {
      count: vi.fn().mockResolvedValue(count),
      create: vi.fn().mockResolvedValue({ id: 'u_1' }),
    },
  };
}

describe('seedAdminIfEmpty', () => {
  it('seeds when User table is empty', async () => {
    const prisma = makePrisma(0);
    const hashPassword = vi.fn().mockResolvedValue('$scrypt$hashed');

    const result = await seedAdminIfEmpty(
      prisma as unknown as Parameters<typeof seedAdminIfEmpty>[0],
      {
        email: 'a@b.com',
        password: 'plaintext',
        firstName: 'Admin',
        lastName: 'User',
        hashPassword,
      }
    );

    expect(result).toEqual({ seeded: true, reason: 'created' });
    expect(hashPassword).toHaveBeenCalledWith('plaintext');
    expect(prisma.user.create).toHaveBeenCalledOnce();
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: 'a@b.com',
        password: '$scrypt$hashed',
        firstName: 'Admin',
        lastName: 'User',
      },
    });
  });

  it('is a no-op when User table already has rows', async () => {
    const prisma = makePrisma(5);
    const hashPassword = vi.fn();

    const result = await seedAdminIfEmpty(
      prisma as unknown as Parameters<typeof seedAdminIfEmpty>[0],
      {
        email: 'a@b.com',
        password: 'plaintext',
        firstName: 'Admin',
        lastName: 'User',
        hashPassword,
      }
    );

    expect(result).toEqual({ seeded: false, reason: 'users-already-exist' });
    expect(hashPassword).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests — expect FAIL**

Run: `pnpm --filter cms test:unit -- seed-admin`
Expected: test errors out with `Cannot find module './seed-admin'`.

- [ ] **Step 3: Implement the script**

Create `apps/cms/scripts/docker-entrypoint/seed-admin.ts`:

```ts
import type { PrismaClient } from '#prisma';

export interface SeedAdminInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  hashPassword: (password: string) => Promise<string>;
}

export interface SeedAdminResult {
  seeded: boolean;
  reason: 'created' | 'users-already-exist';
}

export async function seedAdminIfEmpty(
  prisma: Pick<PrismaClient, 'user'>,
  input: SeedAdminInput
): Promise<SeedAdminResult> {
  const existing = await prisma.user.count();
  if (existing > 0) {
    return { seeded: false, reason: 'users-already-exist' };
  }

  const hashed = await input.hashPassword(input.password);
  await prisma.user.create({
    data: {
      email: input.email,
      password: hashed,
      firstName: input.firstName,
      lastName: input.lastName,
    },
  });

  return { seeded: true, reason: 'created' };
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const email = process.env.BOJECT_ADMIN_EMAIL;
  const password = process.env.BOJECT_ADMIN_PASSWORD;

  if (!email || !password) {
    console.error(
      '[seed-admin] BOJECT_ADMIN_EMAIL and BOJECT_ADMIN_PASSWORD must be set'
    );
    process.exit(1);
  }

  const firstName = process.env.BOJECT_ADMIN_FIRST_NAME ?? 'Admin';
  const lastName = process.env.BOJECT_ADMIN_LAST_NAME ?? 'User';

  const { PrismaClient } = await import('#prisma');
  const { hashPassword } =
    await import('nuxt-auth-utils/runtime/server/utils/password');

  const prisma = new PrismaClient();
  try {
    const result = await seedAdminIfEmpty(prisma, {
      email,
      password,
      firstName,
      lastName,
      hashPassword,
    });
    console.log(
      `[seed-admin] ${result.seeded ? 'seeded admin user' : 'skipped — users already exist'}`
    );
  } catch (err) {
    console.error(
      `[seed-admin] ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}
```

- [ ] **Step 4: Run the tests — expect PASS**

Run: `pnpm --filter cms test:unit -- seed-admin`
Expected: 2 tests pass.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

If typecheck complains about the `nuxt-auth-utils` import path, inspect `node_modules/nuxt-auth-utils/package.json` exports and adjust the import. The intent is to reuse the existing scrypt hash function.

- [ ] **Step 6: Commit**

```bash
git add apps/cms/scripts/docker-entrypoint/seed-admin.ts apps/cms/scripts/docker-entrypoint/seed-admin.test.ts
git commit -m "feat(docker): add idempotent seed-admin script for entrypoint"
```

---

### Task 5: `import-starter.ts` — idempotent starter bundle import

**Files:**

- Create: `apps/cms/scripts/docker-entrypoint/import-starter.ts`
- Create: `apps/cms/scripts/docker-entrypoint/import-starter.test.ts`

**Design:** Exports `importStarterIfEmpty(prisma, { bundlePath, importBundle })`. If `ContentType` count > 0, no-op. Otherwise reads the file, parses JSON, calls `importBundle` (the existing helper from `scripts/content-bundle/import.ts`, signature `(prisma, bundle, { mode: 'all' | 'schema' | 'entries', author?: string }) => Promise<{ contentTypesCreated, entriesCreated }>`).

CLI wrapper: reads `BOJECT_INITIAL_STARTER` env var. If unset or file doesn't exist, exits 0 with a message (not an error — starter is optional). Uses the real `importBundle` from the existing module.

- [ ] **Step 1: Write the failing tests**

Create `apps/cms/scripts/docker-entrypoint/import-starter.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { importStarterIfEmpty } from './import-starter';

type MockPrisma = {
  contentType: { count: ReturnType<typeof vi.fn> };
};

function makePrisma(count: number): MockPrisma {
  return {
    contentType: { count: vi.fn().mockResolvedValue(count) },
  };
}

const SAMPLE_BUNDLE = {
  version: 2,
  exportedAt: '2026-01-01T00:00:00Z',
  contentTypes: [],
  entries: [],
};

describe('importStarterIfEmpty', () => {
  it('imports when ContentType table is empty', async () => {
    const prisma = makePrisma(0);
    const importBundle = vi.fn().mockResolvedValue({
      contentTypesCreated: 0,
      entriesCreated: 0,
    });
    const readBundle = vi.fn().mockResolvedValue(SAMPLE_BUNDLE);

    const result = await importStarterIfEmpty(
      prisma as unknown as Parameters<typeof importStarterIfEmpty>[0],
      { bundlePath: '/starters/base.boject.json', importBundle, readBundle }
    );

    expect(result).toEqual({
      imported: true,
      reason: 'imported',
      stats: { contentTypesCreated: 0, entriesCreated: 0 },
    });
    expect(readBundle).toHaveBeenCalledWith('/starters/base.boject.json');
    expect(importBundle).toHaveBeenCalledOnce();
  });

  it('is a no-op when ContentType table already has rows', async () => {
    const prisma = makePrisma(3);
    const importBundle = vi.fn();
    const readBundle = vi.fn();

    const result = await importStarterIfEmpty(
      prisma as unknown as Parameters<typeof importStarterIfEmpty>[0],
      { bundlePath: '/starters/base.boject.json', importBundle, readBundle }
    );

    expect(result).toEqual({
      imported: false,
      reason: 'content-types-already-exist',
    });
    expect(importBundle).not.toHaveBeenCalled();
    expect(readBundle).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests — expect FAIL**

Run: `pnpm --filter cms test:unit -- import-starter`
Expected: missing-module error.

- [ ] **Step 3: Implement the script**

Create `apps/cms/scripts/docker-entrypoint/import-starter.ts`:

```ts
import type { PrismaClient } from '#prisma';
import type { Bundle, ImportResult } from '../content-bundle/types';

export interface ImportStarterInput {
  bundlePath: string;
  importBundle: (
    prisma: PrismaClient,
    bundle: Bundle,
    opts: { mode: 'all'; author: string }
  ) => Promise<ImportResult>;
  readBundle?: (path: string) => Promise<Bundle>;
}

export interface ImportStarterResult {
  imported: boolean;
  reason:
    | 'imported'
    | 'content-types-already-exist'
    | 'no-bundle-path'
    | 'bundle-missing';
  stats?: ImportResult;
}

async function defaultReadBundle(path: string): Promise<Bundle> {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as Bundle;
}

export async function importStarterIfEmpty(
  prisma: Pick<PrismaClient, 'contentType'>,
  input: ImportStarterInput
): Promise<ImportStarterResult> {
  const existing = await prisma.contentType.count();
  if (existing > 0) {
    return { imported: false, reason: 'content-types-already-exist' };
  }

  const read = input.readBundle ?? defaultReadBundle;
  const bundle = await read(input.bundlePath);
  const stats = await input.importBundle(prisma as PrismaClient, bundle, {
    mode: 'all',
    author: 'system',
  });

  return { imported: true, reason: 'imported', stats };
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const bundlePath = process.env.BOJECT_INITIAL_STARTER;
  if (!bundlePath) {
    console.log('[import-starter] BOJECT_INITIAL_STARTER not set — skipping');
    process.exit(0);
  }

  const { existsSync } = await import('node:fs');
  if (!existsSync(bundlePath)) {
    console.log(
      `[import-starter] bundle not found at ${bundlePath} — skipping`
    );
    process.exit(0);
  }

  const { PrismaClient } = await import('#prisma');
  const { importBundle } = await import('../content-bundle/import');

  const prisma = new PrismaClient();
  try {
    const result = await importStarterIfEmpty(prisma, {
      bundlePath,
      importBundle,
    });
    if (result.imported) {
      console.log(
        `[import-starter] imported ${result.stats?.contentTypesCreated ?? 0} content types, ${result.stats?.entriesCreated ?? 0} entries from ${bundlePath}`
      );
    } else {
      console.log(`[import-starter] skipped — ${result.reason}`);
    }
  } catch (err) {
    console.error(
      `[import-starter] ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}
```

- [ ] **Step 4: Run the tests — expect PASS**

Run: `pnpm --filter cms test:unit -- import-starter`
Expected: 2 tests pass.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

Likely gotcha: `../content-bundle/types` and `../content-bundle/import` — verify those exports exist. Open `apps/cms/scripts/content-bundle/types.ts` to confirm `Bundle` is exported; open `apps/cms/scripts/content-bundle/import.ts` to confirm `importBundle` is exported with a compatible signature. If the signature differs, adjust the `ImportStarterInput['importBundle']` type to match.

- [ ] **Step 6: Commit**

```bash
git add apps/cms/scripts/docker-entrypoint/import-starter.ts apps/cms/scripts/docker-entrypoint/import-starter.test.ts
git commit -m "feat(docker): add idempotent import-starter script for entrypoint"
```

---

### Task 6: Wire `STORAGE_DRIVER` env var into Nitro storage config

**Files:**

- Modify: `apps/cms/nuxt.config.ts`

**Design:** The existing `nitro.devStorage` hardcodes the `fs` driver. For production, we need runtime storage that switches based on `STORAGE_DRIVER`:

- `local` (default): `fs` driver, base at `/app/storage/images/originals` (and transforms).
- `s3`: Nitro's `s3` driver wrapping `@aws-sdk/client-s3`.
- `r2`: same `s3` driver with a Cloudflare R2 endpoint override.

Nitro accepts drivers in `nitro.storage[key] = { driver: 's3', ...opts }`. The `fs-lite` and `s3` drivers come from `unstorage`.

**Scope note:** The `s3`/`r2` paths add complexity. For Plan B we'll wire the config shape for all three drivers but only implement `local` end-to-end. S3/R2 run through the same config builder; if the config is malformed we fail loud at boot. Installing the S3 driver deps and actually exercising S3/R2 storage happens in Task 7.

- [ ] **Step 1: Edit `apps/cms/nuxt.config.ts`**

Replace the existing `nitro` block (the `rollupConfig`, `externals`, `devStorage` sections) with:

```ts
  nitro: {
    rollupConfig: {
      onwarn(warning, defaultHandler) {
        if (
          warning.message?.includes('createYoga') &&
          warning.code === 'UNUSED_EXTERNAL_IMPORT'
        )
          return;
        if (
          warning.code === 'CIRCULAR_DEPENDENCY' &&
          warning.message?.includes('node_modules/')
        )
          return;
        defaultHandler(warning);
      },
    },
    externals: {
      inline: ['@prisma/adapter-pg', 'graphql-yoga'],
      external: ['sharp'],
    },
    devStorage: {
      'images:originals': {
        driver: 'fs',
        base: './storage/images/originals',
      },
      'images:transforms': {
        driver: 'fs',
        base: './storage/images/transforms',
      },
    },
    storage: buildStorageConfig(),
  },
```

Add this helper above the `export default defineNuxtConfig(...)` call:

```ts
type StorageSpec = Record<string, { driver: string; [key: string]: unknown }>;

function buildStorageConfig(): StorageSpec {
  const driver = process.env.STORAGE_DRIVER ?? 'local';

  if (driver === 'local') {
    const base = process.env.STORAGE_LOCAL_BASE ?? '/app/storage';
    return {
      'images:originals': {
        driver: 'fs',
        base: `${base}/images/originals`,
      },
      'images:transforms': {
        driver: 'fs',
        base: `${base}/images/transforms`,
      },
    };
  }

  if (driver === 's3' || driver === 'r2') {
    const bucket =
      driver === 'r2' ? required('R2_BUCKET') : required('S3_BUCKET');
    const accessKeyId =
      driver === 'r2'
        ? required('R2_ACCESS_KEY_ID')
        : required('AWS_ACCESS_KEY_ID');
    const secretAccessKey =
      driver === 'r2'
        ? required('R2_SECRET_ACCESS_KEY')
        : required('AWS_SECRET_ACCESS_KEY');
    const region = driver === 'r2' ? 'auto' : required('AWS_REGION');
    const endpoint =
      driver === 'r2'
        ? `https://${required('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`
        : undefined;

    const base = {
      driver: 's3',
      bucket,
      region,
      accessKeyId,
      secretAccessKey,
      ...(endpoint ? { endpoint } : {}),
    };

    return {
      'images:originals': { ...base, pathPrefix: 'images/originals/' },
      'images:transforms': { ...base, pathPrefix: 'images/transforms/' },
    };
  }

  throw new Error(
    `Unsupported STORAGE_DRIVER: "${driver}". Expected one of: local, s3, r2.`
  );
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var ${name} for the configured STORAGE_DRIVER`
    );
  }
  return v;
}
```

- [ ] **Step 2: Verify local driver resolves correctly**

Run the dev server with explicit env:

```bash
STORAGE_DRIVER=local STORAGE_LOCAL_BASE=./storage pnpm dev
```

In another terminal, exercise the upload endpoint briefly or just hit the login page to confirm the server starts:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/
```

Expected: 302 (login redirect). Stop the dev server (Ctrl-C).

Note: Without `STORAGE_DRIVER` set, the code should still work (defaults to `local` with `/app/storage` base — which won't exist locally but Nuxt only creates the dir on first write).

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean.

- [ ] **Step 4: Run full test suite**

Run: `pnpm test`
Expected: 312/312 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/nuxt.config.ts
git commit -m "feat(docker): wire STORAGE_DRIVER env var for local/s3/r2 storage"
```

---

### Task 7: Install unstorage S3 driver dependency

**Files:**

- Modify: `apps/cms/package.json`

Nitro's `s3` driver uses `unstorage`'s S3 driver under the hood, which needs `@aws-sdk/client-s3` at runtime. We're not shipping S3 functionality by default, but the driver must be installable for users who set `STORAGE_DRIVER=s3` or `r2`.

**Decision:** install `@aws-sdk/client-s3` as a **runtime dependency** so the image supports S3/R2 out of the box without a separate install step. Package is ~12MB unpacked but acceptable for a server image.

- [ ] **Step 1: Install**

Run: `pnpm --filter cms add @aws-sdk/client-s3`
Expected: adds to `dependencies` in `apps/cms/package.json`, updates lockfile.

- [ ] **Step 2: Verify build still succeeds**

Run: `pnpm build`
Expected: Nuxt builds successfully. Some "externalized" warnings for AWS SDK are expected and benign.

- [ ] **Step 3: Run tests**

Run: `pnpm test`
Expected: 312/312 pass. The AWS SDK being present shouldn't touch any runtime paths unless `STORAGE_DRIVER=s3`.

- [ ] **Step 4: Commit**

```bash
git add apps/cms/package.json pnpm-lock.yaml
git commit -m "feat(docker): add @aws-sdk/client-s3 for s3/r2 storage driver"
```

---

### Task 8: Write the bash entrypoint

**Files:**

- Create: `apps/cms/docker/entrypoint.sh`

**Design:** A small bash orchestrator that (a) runs each startup step in order, (b) fails loud if any step fails, (c) `exec`s the Nuxt server so the node process is the container's foreground process for signal forwarding.

- [ ] **Step 1: Create `apps/cms/docker/entrypoint.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

log() {
  echo "[entrypoint] $*"
}

: "${DATABASE_URL:?DATABASE_URL must be set}"

log "step 1/5: waiting for database"
tsx scripts/docker-entrypoint/wait-for-db.ts

log "step 2/5: applying migrations"
prisma migrate deploy --schema prisma/schema

log "step 3/5: seeding admin if needed"
if [[ -n "${BOJECT_ADMIN_EMAIL:-}" && -n "${BOJECT_ADMIN_PASSWORD:-}" ]]; then
  tsx scripts/docker-entrypoint/seed-admin.ts
else
  log "skipping admin seed — BOJECT_ADMIN_EMAIL or BOJECT_ADMIN_PASSWORD not set"
fi

log "step 4/5: importing starter if needed"
tsx scripts/docker-entrypoint/import-starter.ts

log "step 5/5: starting nuxt server"
exec node .output/server/index.mjs
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x apps/cms/docker/entrypoint.sh`

- [ ] **Step 3: Dry-run locally (not inside Docker yet)**

We can't fully execute this outside the container (path assumptions), but verify syntax:

Run: `bash -n apps/cms/docker/entrypoint.sh`
Expected: no output, exit code 0 (syntax OK).

- [ ] **Step 4: Commit**

```bash
git add apps/cms/docker/entrypoint.sh
git commit -m "feat(docker): add bash entrypoint orchestrating startup"
```

---

### Task 9: Write `.dockerignore`

**Files:**

- Create: `.dockerignore` (at repo root)

**Purpose:** Exclude files from the Docker build context to keep builds fast and images small. Because we're building a pnpm workspace image, the Docker context is the **repo root** (so the Dockerfile can see `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and `apps/cms/`). `.dockerignore` accordingly lives at the repo root.

- [ ] **Step 1: Create `/.dockerignore`**

```
# Build outputs
**/.nuxt
**/.output
**/dist
**/generated

# Dev artifacts
**/node_modules
**/storage
**/*.log
**/coverage
**/.nyc_output

# Git / worktrees
.git
.worktrees

# Env
**/.env
**/.env.local
**/.env.*.local

# IDE
.vscode
.idea
**/*.swp

# OS
**/.DS_Store
**/Thumbs.db

# Tests (we don't run tests in prod images)
**/*.test.ts
**/*.test.tsx

# Docs (root-level markdown, CLAUDE, etc. — not needed in image)
*.md
docs/

# Plan + spec working files
**/.claude
```

- [ ] **Step 2: Verify**

No test — this file only affects subsequent `docker build` invocations. Task 10 will surface any over-aggressive exclusions.

- [ ] **Step 3: Commit**

```bash
git add .dockerignore
git commit -m "feat(docker): add root .dockerignore for workspace build context"
```

---

### Task 10: Write the multi-stage Dockerfile

**Files:**

- Create: `apps/cms/Dockerfile`

**Design:** The Docker build context is the **repo root** (so pnpm can resolve the workspace). The Dockerfile copies only the files it needs — workspace manifest/lockfile at root, plus `apps/cms/package.json` for cached dep installs, then the full `apps/cms/` source for the build.

Two stages:

- **build** — installs all deps (including dev for `nuxt build`), generates Prisma client, builds Nuxt.
- **runtime** — starts clean, installs prod-only deps, copies `.output/`, `generated/`, `prisma/`, `scripts/`, and the entrypoint. Runs as non-root `cms` user.

Working directory inside the runtime image is `/app/apps/cms/` (mirrors the monorepo layout so pnpm's node_modules resolution works via the workspace links).

- [ ] **Step 1: Create `apps/cms/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7

# ============================================================================
# build stage — installs all deps, generates Prisma client, builds Nuxt
# ============================================================================
FROM node:24-alpine AS build

# pnpm via corepack (shipped with Node 24)
RUN corepack enable && corepack prepare pnpm@10.30.1 --activate

WORKDIR /workspace

# Copy workspace manifest + lockfile + workspace config for dep caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/cms/package.json ./apps/cms/

# Install deps for the cms workspace (includes dev — needed for nuxt build)
RUN pnpm install --frozen-lockfile --filter cms --ignore-scripts

# Copy app source
COPY apps/cms ./apps/cms

WORKDIR /workspace/apps/cms

# Generate Prisma client + Pothos types
RUN pnpm prisma generate --schema prisma/schema

# Build Nuxt (produces .output/)
RUN pnpm nuxt build

# ============================================================================
# runtime stage — slim image with only what's needed to run
# ============================================================================
FROM node:24-alpine AS runtime

RUN corepack enable && corepack prepare pnpm@10.30.1 --activate

# bash for the entrypoint, curl for operator debugging
RUN apk add --no-cache bash curl

# Non-root user
RUN addgroup -S cms && adduser -S cms -G cms

WORKDIR /app

# Install prod deps only, preserving the workspace layout
COPY --chown=cms:cms package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=cms:cms apps/cms/package.json ./apps/cms/
RUN pnpm install --frozen-lockfile --prod --filter cms --ignore-scripts

# Copy build artifacts + runtime-required source
COPY --from=build --chown=cms:cms /workspace/apps/cms/.output ./apps/cms/.output
COPY --from=build --chown=cms:cms /workspace/apps/cms/generated ./apps/cms/generated
COPY --from=build --chown=cms:cms /workspace/apps/cms/prisma ./apps/cms/prisma
COPY --from=build --chown=cms:cms /workspace/apps/cms/scripts ./apps/cms/scripts
COPY --from=build --chown=cms:cms /workspace/apps/cms/docker ./apps/cms/docker

# Storage dir + entrypoint perms
RUN chmod +x ./apps/cms/docker/entrypoint.sh \
 && mkdir -p /app/storage/images/originals /app/storage/images/transforms \
 && chown -R cms:cms /app/storage /app/apps

USER cms

WORKDIR /app/apps/cms

EXPOSE 3000

ENV NITRO_PORT=3000 \
    NODE_ENV=production \
    STORAGE_DRIVER=local \
    STORAGE_LOCAL_BASE=/app/storage

ENTRYPOINT ["./docker/entrypoint.sh"]
```

**Notes:**

- Port 3000 is Nuxt's production default; `NITRO_PORT=3000` makes it explicit. Plan C's docker-compose will map `4000:3000` so the user-facing port stays 4000.
- `prisma generate` uses `--schema prisma/schema` (multi-file Prisma schema, per `prisma.config.ts`).
- Scripts get copied in source form (`.ts`); `tsx` (runtime dep from Task 2) runs them.
- `--ignore-scripts` on both pnpm installs avoids running the app's `postinstall` (which tries `nuxt prepare && prisma generate`) during dep install. The build stage runs them explicitly.
- Storage is mounted under `/app/storage` (outside `/app/apps/cms`) so named Docker volumes persist across container replacements without clashing with app files.

- [ ] **Step 2: Build the image from the repo root**

The context is the whole repo (so pnpm workspace files are available):

```bash
docker build -f apps/cms/Dockerfile -t boject/cms:dev .
```

Expected: build completes in ~3–10 minutes on first run. Look for `Successfully tagged boject/cms:dev` or similar.

If the build fails, read the error carefully:

- `pnpm install --frozen-lockfile`: lockfile drift — run `pnpm install` at the host and commit updated lockfile first.
- `prisma generate`: likely a path issue — check `prisma.config.ts` schema path matches the Dockerfile's `--schema prisma/schema`.
- `pnpm nuxt build`: likely a build-time error that'd also occur outside Docker — reproduce with `pnpm build` locally.
- `COPY` failing: the path doesn't exist in the build context. Check `.dockerignore` didn't over-exclude.

- [ ] **Step 3: Verify the image has the expected layout**

Run:

```bash
docker run --rm --entrypoint sh boject/cms:dev -c 'pwd && ls -la && echo --- && ls docker && ls scripts/docker-entrypoint'
```

Expected:

- `pwd` prints `/app/apps/cms`
- `ls -la` shows `.output`, `generated`, `prisma`, `scripts`, `docker`, `package.json`, and a `node_modules` symlink (pnpm workspace layout)
- `docker/` contains `entrypoint.sh`
- `scripts/docker-entrypoint/` contains `wait-for-db.ts`, `seed-admin.ts`, `import-starter.ts` (the `.test.ts` siblings were excluded by `.dockerignore`)

- [ ] **Step 4: Commit**

```bash
git add apps/cms/Dockerfile
git commit -m "feat(docker): add multi-stage Dockerfile (node:24-alpine)"
```

---

### Task 11: Smoke test — build + run the image against ephemeral postgres

**Files:**

- Create: `apps/cms/docker/smoke-test.sh`

**Design:** A bash script that:

1. Stands up a fresh postgres container (separate from the dev `boject-cms-db-1`).
2. Builds the image (if not already built by a prior task).
3. Runs the image with a fresh storage volume + admin env vars + starter bundle mounted in.
4. Polls the container's health endpoint.
5. Asserts: container is running, admin user was created, starter imported.
6. Restarts the container and asserts: no duplicate admin, no re-import.
7. Tears down postgres and storage volume.

This runs locally by hand (part of Task 11) and becomes the basis for CI in Plan D.

- [ ] **Step 1: Create `apps/cms/docker/smoke-test.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Smoke-test the boject/cms:dev image end-to-end:
#   - builds the image
#   - runs it against an ephemeral postgres
#   - verifies first-boot: migrations applied, admin seeded, starter imported
#   - verifies restart idempotency: no duplicate admin, no re-import

PG_NAME="boject-cms-smoke-pg"
APP_NAME="boject-cms-smoke-app"
NETWORK_NAME="boject-cms-smoke-net"
VOLUME_NAME="boject-cms-smoke-storage"
IMAGE_TAG="boject/cms:dev"
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

cleanup() {
  echo "[smoke-test] cleaning up"
  docker rm -f "$APP_NAME" "$PG_NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME_NAME" >/dev/null 2>&1 || true
  docker network rm "$NETWORK_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[smoke-test] building image"
(cd "$REPO_ROOT" && docker build -f apps/cms/Dockerfile -t "$IMAGE_TAG" .)

echo "[smoke-test] creating network + volume"
docker network create "$NETWORK_NAME" >/dev/null
docker volume create "$VOLUME_NAME" >/dev/null

echo "[smoke-test] starting postgres"
docker run -d --name "$PG_NAME" \
  --network "$NETWORK_NAME" \
  -e POSTGRES_USER=boject \
  -e POSTGRES_PASSWORD=boject \
  -e POSTGRES_DB=boject \
  postgres:17 >/dev/null

# Wait for postgres
for i in {1..30}; do
  if docker exec "$PG_NAME" pg_isready -U boject -d boject >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "[smoke-test] starting cms (first boot — expect admin seed + starter import)"
docker run -d --name "$APP_NAME" \
  --network "$NETWORK_NAME" \
  -e DATABASE_URL=postgresql://boject:boject@${PG_NAME}:5432/boject \
  -e NUXT_SESSION_PASSWORD="$(head -c 32 /dev/urandom | base64)" \
  -e BOJECT_ADMIN_EMAIL=admin@smoke.test \
  -e BOJECT_ADMIN_PASSWORD=smoke-pass \
  -e BOJECT_INITIAL_STARTER=/starters/base.boject.json \
  -v "${VOLUME_NAME}:/app/storage" \
  -v "${REPO_ROOT}/starters:/starters:ro" \
  -p 4010:3000 \
  "$IMAGE_TAG" >/dev/null

# Wait for Nuxt to respond
echo "[smoke-test] waiting for cms to respond"
for i in {1..60}; do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4010/ 2>/dev/null || echo "000")
  if [[ "$code" == "200" || "$code" == "302" ]]; then
    break
  fi
  sleep 1
done
if [[ "$code" != "200" && "$code" != "302" ]]; then
  echo "[smoke-test] FAIL: cms did not respond (got $code)"
  docker logs "$APP_NAME" | tail -50
  exit 1
fi

# Grep logs for the expected seed/import messages
logs=$(docker logs "$APP_NAME" 2>&1)
if ! grep -q "seeded admin user" <<<"$logs"; then
  echo "[smoke-test] FAIL: expected admin seed log not found"
  echo "$logs" | tail -30
  exit 1
fi
if ! grep -q "imported" <<<"$logs"; then
  echo "[smoke-test] FAIL: expected starter import log not found"
  echo "$logs" | tail -30
  exit 1
fi

echo "[smoke-test] first-boot OK. Restarting to verify idempotency."
docker restart "$APP_NAME" >/dev/null

# Wait again
for i in {1..60}; do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4010/ 2>/dev/null || echo "000")
  if [[ "$code" == "200" || "$code" == "302" ]]; then
    break
  fi
  sleep 1
done

logs=$(docker logs --since 1m "$APP_NAME" 2>&1)
if ! grep -q "skipped — users already exist" <<<"$logs"; then
  echo "[smoke-test] FAIL: expected 'skipped — users already exist' on restart"
  echo "$logs" | tail -30
  exit 1
fi
if ! grep -q "content-types-already-exist" <<<"$logs"; then
  echo "[smoke-test] FAIL: expected starter-skip log on restart"
  echo "$logs" | tail -30
  exit 1
fi

echo "[smoke-test] PASS"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x apps/cms/docker/smoke-test.sh`

- [ ] **Step 3: Run it**

Run: `apps/cms/docker/smoke-test.sh`
Expected: prints `[smoke-test] PASS` and exits 0.

If it fails, read the printed docker logs. Common issues:

- `wait-for-db timed out`: the postgres container's hostname isn't reachable; check the network spec.
- `prisma migrate deploy` fails: something about the migrations was broken by Plan B's changes. Reproduce locally: `cd apps/cms && DATABASE_URL=... pnpm prisma:migrate` against a fresh DB.
- `[seed-admin] skipped — users already exist` on first boot: the test DB already had data; the `cleanup` at the top of the script should have prevented this. Re-run after ensuring cleanup ran.

- [ ] **Step 4: Commit**

```bash
git add apps/cms/docker/smoke-test.sh
git commit -m "feat(docker): add end-to-end smoke-test script for the image"
```

---

### Task 12: Update `CLAUDE.md` and `README.md` with image build + run instructions

**Files:**

- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Add a "Docker image" section to `CLAUDE.md`**

In `CLAUDE.md`, after the "Testing" section, add:

```markdown
## Docker image

- **Dockerfile:** `apps/cms/Dockerfile`. Multi-stage (`node:24-alpine`): build stage runs `pnpm install` + `prisma generate` + `nuxt build`; runtime stage copies `.output/`, `generated/`, `prisma/`, `scripts/`, and `docker/entrypoint.sh`. Runs as non-root `cms` user, exposes port 3000. Build command (from repo root): `docker build -f apps/cms/Dockerfile -t boject/cms:dev .` — context is the whole monorepo so pnpm can resolve the workspace.
- **Entrypoint:** `apps/cms/docker/entrypoint.sh`. Waits for `DATABASE_URL`, runs `prisma migrate deploy`, seeds admin from `BOJECT_ADMIN_EMAIL` + `BOJECT_ADMIN_PASSWORD` if User table is empty, imports `BOJECT_INITIAL_STARTER` bundle if ContentType table is empty, then execs Nuxt. Steps 3+4 are idempotent and independently gated.
- **Entrypoint scripts:** `apps/cms/scripts/docker-entrypoint/` contains `wait-for-db.ts`, `seed-admin.ts`, `import-starter.ts`. Each exports a pure logic function + a CLI entry. Executed at runtime via `tsx` (promoted to a prod dependency).
- **Storage drivers:** `apps/cms/nuxt.config.ts` reads `STORAGE_DRIVER` at build time. `local` (default) uses `fs` driver at `STORAGE_LOCAL_BASE` (default `/app/storage`). `s3` + `r2` use the `s3` unstorage driver; R2 overrides the endpoint. `@aws-sdk/client-s3` is shipped as a prod dep so the image supports all three out of the box.
- **Build + smoke test:** from the repo root, `cd apps/cms && docker build -t boject/cms:dev .` builds the image. `apps/cms/docker/smoke-test.sh` runs an end-to-end smoke test against an ephemeral postgres (first-boot admin/starter + restart idempotency).
- **Runtime env vars:** `DATABASE_URL` (required), `NUXT_SESSION_PASSWORD` (required in production), `BOJECT_ADMIN_EMAIL` + `BOJECT_ADMIN_PASSWORD` (required for first-boot admin seed), `BOJECT_INITIAL_STARTER` (optional, path to starter bundle), `STORAGE_DRIVER` (`local`/`s3`/`r2`), `STORAGE_LOCAL_BASE` (local driver base dir), `AWS_REGION` + `S3_BUCKET` + `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (s3), `R2_ACCOUNT_ID` + `R2_BUCKET` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` (r2).
```

- [ ] **Step 2: Add a "Docker image" section to `README.md`**

In `README.md`, after the "Environment Variables" section, add:

````markdown
## Docker image

The CMS ships as a self-contained Docker image that runs migrations, seeds an admin, and optionally imports a starter bundle on first boot.

**Build** (from the repo root — the Docker context is the whole monorepo so pnpm can resolve the workspace):

\```bash
docker build -f apps/cms/Dockerfile -t boject/cms:dev .
\```

**Run** (requires a reachable Postgres):

\```bash
docker run --rm -p 4000:3000 \\
-e DATABASE_URL=postgresql://boject:boject@host.docker.internal:5432/boject \\
-e NUXT_SESSION_PASSWORD="$(openssl rand -base64 32)" \\
-e BOJECT_ADMIN_EMAIL=admin@local \\
-e BOJECT_ADMIN_PASSWORD=changeme \\
-v boject_storage:/app/storage \\
boject/cms:dev
\```

The server starts on port 3000 inside the container (mapped to 4000 above). Log in at `http://localhost:4000/login` with the credentials you set.

**Import a starter bundle on first boot:**

\```bash
docker run ... \\
-e BOJECT_INITIAL_STARTER=/starters/base.boject.json \\
-v "$(pwd)/starters:/starters:ro" \\
boject/cms:dev
\```

**Smoke test the image** end-to-end:

\```bash
apps/cms/docker/smoke-test.sh
\```
````

(Replace the `\`` with a real backtick — the escapes above are for this plan document. The engineer writes plain backticks into the README.)

- [ ] **Step 3: Format-check**

Run: `pnpm prettier --check CLAUDE.md README.md`
Expected: passes. If not, `pnpm prettier --write CLAUDE.md README.md`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs(docker): document image build, run, env vars, and smoke test"
```

---

### Task 13: Final verification

- [ ] **Step 1: Clean tree**

Run: `git status`
Expected: clean.

- [ ] **Step 2: Full install + test**

Run: `pnpm install && pnpm test`
Expected: 312 existing tests + 7 new entrypoint-script tests = 319 pass.

- [ ] **Step 3: Typecheck + lint + format**

Run: `pnpm typecheck && pnpm lint && pnpm format`
Expected: all clean.

- [ ] **Step 4: Rebuild image to confirm reproducibility**

Run:

```bash
docker rmi boject/cms:dev 2>/dev/null || true
docker build -f apps/cms/Dockerfile -t boject/cms:dev .
```

Expected: build succeeds from scratch.

- [ ] **Step 5: Re-run smoke test**

Run: `apps/cms/docker/smoke-test.sh`
Expected: `[smoke-test] PASS`.

- [ ] **Step 6: Review commit sequence**

Run: `git log --oneline main..HEAD`
Expected: 11–12 commits, all prefixed `feat(docker):` / `chore(docker):` / `docs(docker):`. Roughly:

```
docs(docker): document image build, run, env vars, and smoke test
feat(docker): add end-to-end smoke-test script for the image
feat(docker): add multi-stage Dockerfile (node:24-alpine)
feat(docker): add .dockerignore to trim build context
feat(docker): add bash entrypoint orchestrating startup
feat(docker): add @aws-sdk/client-s3 for s3/r2 storage driver
feat(docker): wire STORAGE_DRIVER env var for local/s3/r2 storage
feat(docker): add idempotent import-starter script for entrypoint
feat(docker): add idempotent seed-admin script for entrypoint
feat(docker): add wait-for-db polling script for entrypoint
chore(docker): add node>=24 engines constraint; promote tsx to runtime dep
```

No commit for this task — branch is ready for PR.

---

## Risks and mitigations

- **Risk:** `tsx` imports of `#prisma` fail in the container because path aliases aren't wired for tsx-at-runtime the way they are for Nuxt builds.
  **Mitigation:** Each entrypoint script tests this locally (Task 5 step 5 typecheck catches missing path aliases; Task 11 smoke test catches runtime resolution). If it fails, use explicit relative imports (`../../generated/prisma/client`) instead of `#prisma`.

- **Risk:** `nuxt-auth-utils` `hashPassword` is only exposed as an auto-import inside Nuxt's runtime, not as a package export.
  **Mitigation:** Task 4 step 5 flags this — if the explicit import fails, inline the scrypt hashing (20 lines) into `seed-admin.ts`. Node ships `crypto.scrypt` in stdlib; `nuxt-auth-utils`'s implementation is a thin wrapper.

- **Risk:** Prisma client generation at build time differs from runtime expectations (Prisma's driver adapter model).
  **Mitigation:** Existing `prisma.config.ts` already handles the adapter. Smoke test catches any drift.

- **Risk:** Image bloat from `@aws-sdk/client-s3`.
  **Mitigation:** accepted trade-off per spec; image can still be optimised later. Target image size (~400MB) is acceptable for a server app.

- **Risk:** Smoke test flakes if postgres takes longer than 30s to boot on a cold machine.
  **Mitigation:** The `wait-for-db` polling inside the entrypoint has a 30s default; the smoke test's `pg_isready` loop runs for 30s before starting the app. If flakes persist, bump timeouts.

## Out of scope

- `create-boject-cms` scaffolder (Plan C).
- `boject-cli` upgrade command (Plan C).
- Local dev registries (Verdaccio + `registry:2`) (Plan C).
- CI/CD release pipeline (image publishing, npm publishing) (Plan D).
- Making the image work without `NUXT_SESSION_PASSWORD` in production (it throws at boot — that's intentional, not a bug).
- Image-size optimisation beyond what the multi-stage build provides (e.g. distroless base, Alpine musl vs glibc comparisons).
- Health-check endpoint authentication rethink (`/api/health` currently sits behind the auth middleware; either we add it to the skip-list or we document 302 as the health signal — deferred).
