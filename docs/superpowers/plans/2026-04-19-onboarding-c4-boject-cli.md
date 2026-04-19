# Onboarding C4 — `@boject/cli` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/boject-cli/` — the `@boject/cli` npm package exposing a `boject` binary with one command, `upgrade`, that reads the scaffolded project's `docker-compose.yml`, discovers a newer image tag from the registry the image already points at, rewrites the compose file in place (preserving comments), pulls + restarts the container, and waits for health. Extends the dev loop so the upgrade flow is exercisable end-to-end.

**Architecture:** Standalone TS package mirroring C2's shape (`tsup` build, Vitest, ESM, shebang). Domain split: `compose.ts` (YAML round-trip via the `yaml` package), `registry.ts` (Docker Registry v2 tag listing with OCI Bearer-token flow), `health.ts` (fetch-poll, duplicated from `scripts/dev-verify.ts`), `commands/upgrade.ts` (orchestration), `index.ts` (argv parsing via `node:util.parseArgs`). Unit tests per module with mocked `fetch` + injected command runner. One E2E test spins an in-process HTTP mock of the Registry v2 API. The dev loop unifies all three dev artifacts (image + scaffolder + CLI) at `0.0.1-rc.1`.

**Tech Stack:** TypeScript (ESM), `yaml` package for comment-preserving compose edits, `semver` for tag ordering, Node 24's native `fetch` and `node:util.parseArgs`, `tsup` build, Vitest, `tsx` runner.

**Spec:** [`docs/superpowers/specs/2026-04-19-onboarding-c4-boject-cli-design.md`](../specs/2026-04-19-onboarding-c4-boject-cli-design.md)

---

## File Structure

| File                                               | Responsibility                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `packages/boject-cli/package.json`                 | Package manifest: `@boject/cli`, `bin.boject`, version `0.0.1-rc.1`, runtime deps (`yaml`, `semver`).           |
| `packages/boject-cli/tsconfig.json`                | ESM + strict, bundler resolution, matches C2's shape.                                                           |
| `packages/boject-cli/tsup.config.ts`               | Build: `src/index.ts` → `dist/index.js` ESM + shebang, externalise `yaml` + `semver`.                           |
| `packages/boject-cli/vitest.config.ts`             | Vitest config scoped to this package.                                                                           |
| `packages/boject-cli/src/version.ts`               | `export const CLI_VERSION = '0.0.1-rc.1'`. Plan D will rewrite.                                                 |
| `packages/boject-cli/src/compose.ts`               | `readComposeImage(path)`, `writeComposeImage(path, newRef)` — `yaml.parseDocument` round-trip.                  |
| `packages/boject-cli/src/registry.ts`              | `parseImageRef`, `listTags` (with Bearer-token retry), `pickHighestSemver`.                                     |
| `packages/boject-cli/src/health.ts`                | `pollHealth(url, timeoutMs)` — fetch loop.                                                                      |
| `packages/boject-cli/src/commands/upgrade.ts`      | Orchestrator: ties compose + registry + health + a command runner (injected for tests).                         |
| `packages/boject-cli/src/index.ts`                 | CLI entry — `node:util.parseArgs`, subcommand dispatch (only `upgrade` for now).                                |
| `packages/boject-cli/tests/unit/compose.test.ts`   | Compose round-trip fidelity (comments, other services untouched).                                               |
| `packages/boject-cli/tests/unit/registry.test.ts`  | Image-ref parse, tag listing with mock fetch, Bearer-flow, semver sort.                                         |
| `packages/boject-cli/tests/unit/health.test.ts`    | Poll success, timeout, connection-refused resilience.                                                           |
| `packages/boject-cli/tests/unit/upgrade.test.ts`   | Command handler with mocked deps + injected runner.                                                             |
| `packages/boject-cli/tests/e2e/upgrade.test.ts`    | In-process Registry v2 mock + real CLI invocation against a fixture dir.                                        |
| `packages/create-boject-cms/package.json` (modify) | Bump `version` from `0.0.0-dev` to `0.0.1-rc.1`.                                                                |
| `package.json` (repo root, modify)                 | Rework `dev:publish` for both CLIs at `0.0.1-rc.1`; update `dev:publish:image` tag; add `dev:publish:image:as`. |
| `scripts/dev-scaffold.ts` (modify)                 | Update `IMAGE` constant to `localhost:5555/boject/cms:0.0.1-rc.1`.                                              |
| `scripts/dev-verify.ts` (modify)                   | Add `--upgrade` flag: build + push second image, invoke `@boject/cli`, assert rewrite, re-poll.                 |
| `README.md` (modify)                               | Document `boject upgrade`, the unified `0.0.1-rc.1` version, and `dev:verify --upgrade`.                        |

---

## Task 1: Scaffold `@boject/cli` package

**Files:**

- Create: `packages/boject-cli/package.json`
- Create: `packages/boject-cli/tsconfig.json`
- Create: `packages/boject-cli/tsup.config.ts`
- Create: `packages/boject-cli/vitest.config.ts`
- Create: `packages/boject-cli/src/index.ts` (stub)
- Create: `packages/boject-cli/src/version.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@boject/cli",
  "version": "0.0.1-rc.1",
  "private": false,
  "type": "module",
  "description": "Boject CMS maintenance CLI.",
  "bin": {
    "boject": "./dist/index.js"
  },
  "main": "./dist/index.js",
  "files": ["dist"],
  "engines": {
    "node": ">=24"
  },
  "publishConfig": {
    "registry": "http://localhost:4873",
    "access": "public"
  },
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run tests/unit",
    "test:e2e": "vitest run tests/e2e"
  },
  "dependencies": {
    "semver": "^7.6.3",
    "yaml": "^2.6.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/semver": "^7.5.8",
    "tsup": "^8.3.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^4.0.18"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": false,
    "sourceMap": false,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src/**/*", "tests/**/*", "tsup.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Create `tsup.config.ts`**

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node24',
  clean: true,
  shims: false,
  splitting: false,
  sourcemap: false,
  dts: false,
  external: ['yaml', 'semver'],
  banner: { js: '#!/usr/bin/env node' },
});
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
  },
});
```

- [ ] **Step 5: Create stub `src/index.ts`**

```ts
export {};
```

- [ ] **Step 6: Create `src/version.ts`**

```ts
export const CLI_VERSION = '0.0.1-rc.1';
```

- [ ] **Step 7: Add the package-level lefthook hook for typecheck**

Open `lefthook.yml` at repo root and add a new `typecheck-cli` job that mirrors `typecheck-scaffolder`:

```yaml
- name: typecheck-cli
  glob: 'packages/boject-cli/**/*.ts'
  run: pnpm --filter @boject/cli typecheck
```

Place it immediately below the existing `typecheck-scaffolder` job.

- [ ] **Step 8: Install dependencies**

```bash
pnpm install
```

Expected: pnpm resolves the new workspace package and installs `yaml`, `semver`, and the dev deps.

- [ ] **Step 9: Verify typecheck passes on empty package**

```bash
pnpm --filter @boject/cli typecheck
```

Expected: exit 0 with no output.

- [ ] **Step 10: Commit**

```bash
git add packages/boject-cli lefthook.yml pnpm-lock.yaml
git commit -m "feat(c4): scaffold @boject/cli package"
```

---

## Task 2: Compose module

**Files:**

- Create: `packages/boject-cli/src/compose.ts`
- Create: `packages/boject-cli/tests/unit/compose.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/compose.test.ts
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readComposeImage, writeComposeImage } from '../../src/compose.js';

const FIXTURE = `services:
  # This is the CMS container — managed by \`boject upgrade\`.
  cms:
    image: ghcr.io/boject/cms:1.2.3
    restart: unless-stopped
    ports:
      - '4000:3000'
    env_file:
      - .env
    depends_on:
      - db
  db:
    image: postgres:17
    restart: unless-stopped
    environment:
      POSTGRES_USER: boject
      POSTGRES_PASSWORD: boject
      POSTGRES_DB: boject
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
`;

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'boject-cli-compose-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('readComposeImage', () => {
  it('extracts services.cms.image', async () => {
    const path = join(workDir, 'docker-compose.yml');
    await writeFile(path, FIXTURE);
    expect(await readComposeImage(path)).toBe('ghcr.io/boject/cms:1.2.3');
  });

  it('throws when services.cms.image is missing', async () => {
    const path = join(workDir, 'docker-compose.yml');
    await writeFile(path, 'services:\n  db:\n    image: postgres:17\n');
    await expect(readComposeImage(path)).rejects.toThrow(
      /services\.cms\.image/
    );
  });

  it('throws when the file is missing', async () => {
    const path = join(workDir, 'no-such.yml');
    await expect(readComposeImage(path)).rejects.toThrow();
  });
});

describe('writeComposeImage', () => {
  it('rewrites services.cms.image and preserves comments + other services', async () => {
    const path = join(workDir, 'docker-compose.yml');
    await writeFile(path, FIXTURE);
    await writeComposeImage(path, 'ghcr.io/boject/cms:1.3.0');
    const out = await readFile(path, 'utf8');
    expect(out).toContain('image: ghcr.io/boject/cms:1.3.0');
    expect(out).toContain(
      '# This is the CMS container — managed by `boject upgrade`.'
    );
    expect(out).toContain('image: postgres:17');
    expect(out).toContain('POSTGRES_USER: boject');
  });

  it('leaves the db image untouched', async () => {
    const path = join(workDir, 'docker-compose.yml');
    await writeFile(path, FIXTURE);
    await writeComposeImage(path, 'ghcr.io/boject/cms:2.0.0');
    const out = await readFile(path, 'utf8');
    expect(out).toContain('image: ghcr.io/boject/cms:2.0.0');
    expect(out).toContain('image: postgres:17');
    expect(out).not.toContain('ghcr.io/boject/cms:1.2.3');
  });

  it('preserves unrelated formatting exactly', async () => {
    const path = join(workDir, 'docker-compose.yml');
    const withBlankLines = `services:\n\n  cms:\n    image: x:1\n\n  db:\n    image: postgres:17\n`;
    await writeFile(path, withBlankLines);
    await writeComposeImage(path, 'x:2');
    const out = await readFile(path, 'utf8');
    // The yaml package may normalise trailing blank lines within a block, but
    // structural comments and key ordering must be preserved.
    expect(out).toContain('image: x:2');
    expect(out).toContain('image: postgres:17');
    expect(out.indexOf('cms:')).toBeLessThan(out.indexOf('db:'));
  });
});
```

- [ ] **Step 2: Run, expect module-not-found failure**

```bash
pnpm --filter @boject/cli test:unit
```

Expected: `Cannot find module '../../src/compose.js'` across all tests.

- [ ] **Step 3: Implement `src/compose.ts`**

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { parseDocument } from 'yaml';

export async function readComposeImage(path: string): Promise<string> {
  const raw = await readFile(path, 'utf8');
  const doc = parseDocument(raw);
  const image = doc.getIn(['services', 'cms', 'image']);
  if (typeof image !== 'string' || image.length === 0) {
    throw new Error(`services.cms.image not found in ${path}`);
  }
  return image;
}

export async function writeComposeImage(
  path: string,
  newRef: string
): Promise<void> {
  const raw = await readFile(path, 'utf8');
  const doc = parseDocument(raw);
  doc.setIn(['services', 'cms', 'image'], newRef);
  await writeFile(path, doc.toString());
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
pnpm --filter @boject/cli test:unit
```

Expected: 7/7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/boject-cli/src/compose.ts packages/boject-cli/tests/unit/compose.test.ts
git commit -m "feat(c4): add compose read/write helpers"
```

---

## Task 3: Registry module

**Files:**

- Create: `packages/boject-cli/src/registry.ts`
- Create: `packages/boject-cli/tests/unit/registry.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/registry.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listTags,
  parseImageRef,
  pickHighestSemver,
} from '../../src/registry.js';

describe('parseImageRef', () => {
  it('parses registry/repo:tag form', () => {
    expect(parseImageRef('ghcr.io/boject/cms:1.2.3')).toEqual({
      registry: 'ghcr.io',
      repository: 'boject/cms',
      tag: '1.2.3',
    });
  });

  it('parses host:port/repo:tag', () => {
    expect(parseImageRef('localhost:5555/boject/cms:0.0.1-rc.1')).toEqual({
      registry: 'localhost:5555',
      repository: 'boject/cms',
      tag: '0.0.1-rc.1',
    });
  });

  it('parses multi-segment repository', () => {
    expect(parseImageRef('registry.example.com/team/app/cms:1.0.0')).toEqual({
      registry: 'registry.example.com',
      repository: 'team/app/cms',
      tag: '1.0.0',
    });
  });

  it('throws on missing tag', () => {
    expect(() => parseImageRef('ghcr.io/boject/cms')).toThrow(/tag/);
  });

  it('throws on missing registry', () => {
    expect(() => parseImageRef('boject/cms:1.0.0')).toThrow(/registry/);
  });
});

describe('pickHighestSemver', () => {
  it('returns the highest semver, ignoring non-semver tags', () => {
    expect(
      pickHighestSemver(['latest', '1.0.0', '1.2.0', '1.1.5', 'dev', 'main'])
    ).toBe('1.2.0');
  });

  it('handles prerelease ordering correctly', () => {
    expect(pickHighestSemver(['1.2.3-rc.1', '1.2.3', '1.2.3-rc.2'])).toBe(
      '1.2.3'
    );
  });

  it('returns null when no semver tags are present', () => {
    expect(pickHighestSemver(['latest', 'dev', 'main'])).toBeNull();
  });

  it('returns null for an empty input', () => {
    expect(pickHighestSemver([])).toBeNull();
  });
});

describe('listTags', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches tags from /v2/<repo>/tags/list with no auth on 200', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ name: 'boject/cms', tags: ['1.0.0', '1.1.0'] }),
        {
          status: 200,
        }
      )
    );
    const tags = await listTags({
      registry: 'localhost:5555',
      repository: 'boject/cms',
    });
    expect(tags).toEqual(['1.0.0', '1.1.0']);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5555/v2/boject/cms/tags/list',
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it('uses https by default for non-localhost registries', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ name: 'boject/cms', tags: ['1.0.0'] }), {
        status: 200,
      })
    );
    await listTags({ registry: 'ghcr.io', repository: 'boject/cms' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://ghcr.io/v2/boject/cms/tags/list',
      expect.any(Object)
    );
  });

  it('follows the Bearer-token flow on 401', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response('unauthorized', {
          status: 401,
          headers: {
            'www-authenticate':
              'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:boject/cms:pull"',
          },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'tok-1' }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ name: 'boject/cms', tags: ['1.2.3'] }), {
          status: 200,
        })
      );

    const tags = await listTags({
      registry: 'ghcr.io',
      repository: 'boject/cms',
    });
    expect(tags).toEqual(['1.2.3']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://ghcr.io/token?service=ghcr.io&scope=repository%3Aboject%2Fcms%3Apull'
    );
    expect(fetchMock.mock.calls[2][1]?.headers).toMatchObject({
      Authorization: 'Bearer tok-1',
    });
  });

  it('throws a descriptive error on non-200 / non-401 responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response('oops', { status: 500 }));
    await expect(
      listTags({ registry: 'localhost:5555', repository: 'boject/cms' })
    ).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run, expect module-not-found**

```bash
pnpm --filter @boject/cli test:unit
```

Expected: `Cannot find module '../../src/registry.js'`.

- [ ] **Step 3: Implement `src/registry.ts`**

```ts
import semver from 'semver';

export interface ImageRef {
  registry: string;
  repository: string;
  tag: string;
}

export function parseImageRef(ref: string): ImageRef {
  const lastColon = ref.lastIndexOf(':');
  const firstSlash = ref.indexOf('/');
  if (lastColon <= firstSlash || firstSlash < 0) {
    if (firstSlash < 0) {
      throw new Error(`Image ref "${ref}" has no registry component`);
    }
    throw new Error(`Image ref "${ref}" has no tag`);
  }
  const registry = ref.slice(0, firstSlash);
  if (
    !registry.includes('.') &&
    !registry.includes(':') &&
    registry !== 'localhost'
  ) {
    throw new Error(
      `Image ref "${ref}" has no registry component (expected e.g. ghcr.io/<repo>:<tag>)`
    );
  }
  const repository = ref.slice(firstSlash + 1, lastColon);
  const tag = ref.slice(lastColon + 1);
  if (repository.length === 0 || tag.length === 0) {
    throw new Error(`Image ref "${ref}" is malformed`);
  }
  return { registry, repository, tag };
}

export function pickHighestSemver(tags: string[]): string | null {
  const semverTags = tags.filter((t) => semver.valid(t) !== null);
  if (semverTags.length === 0) return null;
  semverTags.sort(semver.rcompare);
  return semverTags[0] ?? null;
}

export interface ListTagsParams {
  registry: string;
  repository: string;
}

function registryScheme(registry: string): string {
  return registry.startsWith('localhost') ? 'http' : 'https';
}

interface BearerChallenge {
  realm: string;
  service?: string;
  scope?: string;
}

function parseBearerChallenge(header: string): BearerChallenge | null {
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const params: Record<string, string> = {};
  const body = header.slice(7);
  for (const match of body.matchAll(/(\w+)="([^"]*)"/g)) {
    params[match[1]] = match[2];
  }
  if (!params.realm) return null;
  return { realm: params.realm, service: params.service, scope: params.scope };
}

async function fetchToken(challenge: BearerChallenge): Promise<string> {
  const url = new URL(challenge.realm);
  if (challenge.service) url.searchParams.set('service', challenge.service);
  if (challenge.scope) url.searchParams.set('scope', challenge.scope);
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Token endpoint ${url.toString()} returned ${res.status}`);
  }
  const body = (await res.json()) as { token?: string; access_token?: string };
  const token = body.token ?? body.access_token;
  if (!token) {
    throw new Error(`Token endpoint ${url.toString()} returned no token`);
  }
  return token;
}

export async function listTags(params: ListTagsParams): Promise<string[]> {
  const url = `${registryScheme(params.registry)}://${params.registry}/v2/${params.repository}/tags/list`;
  const res = await fetch(url, { headers: {} });
  if (res.status === 200) {
    const body = (await res.json()) as { tags?: string[] };
    return body.tags ?? [];
  }
  if (res.status === 401) {
    const challenge = parseBearerChallenge(
      res.headers.get('www-authenticate') ?? ''
    );
    if (!challenge) {
      throw new Error(
        `${url} returned 401 without a parseable WWW-Authenticate header`
      );
    }
    const token = await fetchToken(challenge);
    const retry = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!retry.ok) {
      throw new Error(`${url} returned ${retry.status} after token auth`);
    }
    const body = (await retry.json()) as { tags?: string[] };
    return body.tags ?? [];
  }
  throw new Error(`${url} returned ${res.status}`);
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
pnpm --filter @boject/cli test:unit
```

Expected: all registry tests pass (~13 assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/boject-cli/src/registry.ts packages/boject-cli/tests/unit/registry.test.ts
git commit -m "feat(c4): add registry tag-listing with OCI Bearer auth"
```

---

## Task 4: Health module

**Files:**

- Create: `packages/boject-cli/src/health.ts`
- Create: `packages/boject-cli/tests/unit/health.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/health.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pollHealth } from '../../src/health.js';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pollHealth', () => {
  it('resolves when fetch returns ok on first try', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await expect(
      pollHealth('http://x/api/health', { timeoutMs: 1000, intervalMs: 50 })
    ).resolves.toBeUndefined();
  });

  it('retries through connection errors and resolves when ok arrives', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await expect(
      pollHealth('http://x/api/health', { timeoutMs: 1000, intervalMs: 10 })
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('throws a timeout error when the deadline passes without success', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));
    await expect(
      pollHealth('http://x/api/health', { timeoutMs: 100, intervalMs: 10 })
    ).rejects.toThrow(/timed out/i);
  });
});
```

- [ ] **Step 2: Run, expect module-not-found**

```bash
pnpm --filter @boject/cli test:unit
```

- [ ] **Step 3: Implement `src/health.ts`**

```ts
export interface PollHealthOptions {
  timeoutMs: number;
  intervalMs: number;
}

export async function pollHealth(
  url: string,
  { timeoutMs, intervalMs }: PollHealthOptions
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // connection refused / DNS flake while container still booting
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Health check at ${url} timed out after ${timeoutMs}ms`);
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
pnpm --filter @boject/cli test:unit
```

Expected: 3 new health tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/boject-cli/src/health.ts packages/boject-cli/tests/unit/health.test.ts
git commit -m "feat(c4): add health poll helper"
```

---

## Task 5: Upgrade command

**Files:**

- Create: `packages/boject-cli/src/commands/upgrade.ts`
- Create: `packages/boject-cli/tests/unit/upgrade.test.ts`

The command accepts an injected `CommandRunner` interface so tests can stub out `docker compose` shell-outs. Registry and health calls are mocked at the module level via `vi.mock`.

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/upgrade.test.ts
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runUpgrade } from '../../src/commands/upgrade.js';

vi.mock('../../src/registry.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/registry.js')>(
    '../../src/registry.js'
  );
  return {
    ...actual,
    listTags: vi.fn(),
  };
});

vi.mock('../../src/health.js', () => ({
  pollHealth: vi.fn(),
}));

import { listTags } from '../../src/registry.js';
import { pollHealth } from '../../src/health.js';

const FIXTURE = `services:
  cms:
    image: ghcr.io/boject/cms:1.0.0
  db:
    image: postgres:17
`;

let workDir: string;
const calls: Array<{ cmd: string; args: string[] }> = [];
const runner = {
  run: vi.fn(async (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return { status: 0 };
  }),
};

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'boject-upgrade-'));
  await writeFile(join(workDir, 'docker-compose.yml'), FIXTURE);
  calls.length = 0;
  runner.run.mockClear();
  vi.mocked(listTags).mockReset();
  vi.mocked(pollHealth).mockReset();
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('runUpgrade', () => {
  it('applies the upgrade: rewrite + pull + up + health poll', async () => {
    vi.mocked(listTags).mockResolvedValueOnce(['1.0.0', '1.1.0', 'latest']);
    vi.mocked(pollHealth).mockResolvedValueOnce(undefined);
    const { exitCode, message } = await runUpgrade({
      cwd: workDir,
      runner,
      stdout: () => {},
      stderr: () => {},
    });
    expect(exitCode).toBe(0);
    expect(message).toContain('Upgraded 1.0.0 → 1.1.0');
    const out = await readFile(join(workDir, 'docker-compose.yml'), 'utf8');
    expect(out).toContain('image: ghcr.io/boject/cms:1.1.0');
    expect(calls).toEqual([
      { cmd: 'docker', args: ['compose', 'pull', 'cms'] },
      { cmd: 'docker', args: ['compose', 'up', '-d'] },
    ]);
    expect(vi.mocked(pollHealth)).toHaveBeenCalledOnce();
  });

  it('exits 0 with "Already on" when the latest semver matches current', async () => {
    vi.mocked(listTags).mockResolvedValueOnce(['0.9.0', '1.0.0']);
    const { exitCode, message } = await runUpgrade({
      cwd: workDir,
      runner,
      stdout: () => {},
      stderr: () => {},
    });
    expect(exitCode).toBe(0);
    expect(message).toContain('Already on 1.0.0');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('--dry-run prints the diff and leaves the file untouched', async () => {
    vi.mocked(listTags).mockResolvedValueOnce(['1.0.0', '1.2.0']);
    const { exitCode, message } = await runUpgrade({
      cwd: workDir,
      runner,
      flags: { dryRun: true },
      stdout: () => {},
      stderr: () => {},
    });
    expect(exitCode).toBe(0);
    expect(message).toContain('- image: boject/cms:1.0.0');
    expect(message).toContain('+ image: boject/cms:1.2.0');
    const out = await readFile(join(workDir, 'docker-compose.yml'), 'utf8');
    expect(out).toContain('image: ghcr.io/boject/cms:1.0.0');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('--check exits 1 with "Update available" when an upgrade exists', async () => {
    vi.mocked(listTags).mockResolvedValueOnce(['1.0.0', '1.2.0']);
    const { exitCode, message } = await runUpgrade({
      cwd: workDir,
      runner,
      flags: { check: true },
      stdout: () => {},
      stderr: () => {},
    });
    expect(exitCode).toBe(1);
    expect(message).toContain('Update available: 1.0.0 → 1.2.0');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('--check exits 0 with "Up to date" when no upgrade exists', async () => {
    vi.mocked(listTags).mockResolvedValueOnce(['0.9.0', '1.0.0']);
    const { exitCode, message } = await runUpgrade({
      cwd: workDir,
      runner,
      flags: { check: true },
      stdout: () => {},
      stderr: () => {},
    });
    expect(exitCode).toBe(0);
    expect(message).toContain('Up to date: 1.0.0');
  });

  it('--to <version> bypasses tag discovery', async () => {
    vi.mocked(pollHealth).mockResolvedValueOnce(undefined);
    const { exitCode, message } = await runUpgrade({
      cwd: workDir,
      runner,
      flags: { to: '0.5.0' },
      stdout: () => {},
      stderr: () => {},
    });
    expect(vi.mocked(listTags)).not.toHaveBeenCalled();
    expect(exitCode).toBe(0);
    expect(message).toContain('Upgraded 1.0.0 → 0.5.0');
  });

  it('exits 1 when tag discovery yields no semver tags and no --to is given', async () => {
    vi.mocked(listTags).mockResolvedValueOnce(['latest', 'dev']);
    const { exitCode, message } = await runUpgrade({
      cwd: workDir,
      runner,
      stdout: () => {},
      stderr: () => {},
    });
    expect(exitCode).toBe(1);
    expect(message).toMatch(/no semver tags/i);
  });
});
```

- [ ] **Step 2: Run, expect module-not-found**

```bash
pnpm --filter @boject/cli test:unit
```

- [ ] **Step 3: Implement `src/commands/upgrade.ts`**

```ts
import { join } from 'node:path';
import { readComposeImage, writeComposeImage } from '../compose.js';
import { pollHealth } from '../health.js';
import { listTags, parseImageRef, pickHighestSemver } from '../registry.js';

export interface CommandRunner {
  run(
    cmd: string,
    args: string[],
    opts?: { cwd?: string }
  ): Promise<{ status: number | null }>;
}

export interface UpgradeFlags {
  to?: string;
  dryRun?: boolean;
  check?: boolean;
}

export interface UpgradeParams {
  cwd: string;
  runner: CommandRunner;
  flags?: UpgradeFlags;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface UpgradeResult {
  exitCode: 0 | 1;
  message: string;
}

const HEALTH_URL = 'http://localhost:4000/api/health';
const HEALTH_TIMEOUT_MS = 120_000;
const HEALTH_INTERVAL_MS = 2_000;

export async function runUpgrade(
  params: UpgradeParams
): Promise<UpgradeResult> {
  const flags = params.flags ?? {};
  const composePath = join(params.cwd, 'docker-compose.yml');

  const currentRef = await readComposeImage(composePath);
  const { registry, repository, tag: currentTag } = parseImageRef(currentRef);

  let targetTag: string;
  if (flags.to) {
    targetTag = flags.to;
  } else {
    const tags = await listTags({ registry, repository });
    const highest = pickHighestSemver(tags);
    if (!highest) {
      return {
        exitCode: 1,
        message: `No semver tags found at ${registry}/${repository}.`,
      };
    }
    targetTag = highest;
  }

  if (currentTag === targetTag) {
    const verb = flags.check ? 'Up to date' : 'Already on';
    return { exitCode: 0, message: `${verb}: ${currentTag}` };
  }

  if (flags.check) {
    return {
      exitCode: 1,
      message: `Update available: ${currentTag} → ${targetTag}`,
    };
  }

  if (flags.dryRun) {
    return {
      exitCode: 0,
      message: [
        '--- docker-compose.yml (dry run)',
        `- image: ${repository}:${currentTag}`,
        `+ image: ${repository}:${targetTag}`,
      ].join('\n'),
    };
  }

  // Apply path.
  const newRef = `${registry}/${repository}:${targetTag}`;
  await writeComposeImage(composePath, newRef);

  const pull = await params.runner.run('docker', ['compose', 'pull', 'cms'], {
    cwd: params.cwd,
  });
  if (pull.status !== 0) {
    return {
      exitCode: 1,
      message: `docker compose pull cms failed (exit ${pull.status}).`,
    };
  }
  const up = await params.runner.run('docker', ['compose', 'up', '-d'], {
    cwd: params.cwd,
  });
  if (up.status !== 0) {
    return {
      exitCode: 1,
      message: `docker compose up -d failed (exit ${up.status}).`,
    };
  }

  await pollHealth(HEALTH_URL, {
    timeoutMs: HEALTH_TIMEOUT_MS,
    intervalMs: HEALTH_INTERVAL_MS,
  });
  return { exitCode: 0, message: `Upgraded ${currentTag} → ${targetTag}.` };
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
pnpm --filter @boject/cli test:unit
```

Expected: 7 new upgrade tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/boject-cli/src/commands/upgrade.ts packages/boject-cli/tests/unit/upgrade.test.ts
git commit -m "feat(c4): add upgrade command handler"
```

---

## Task 6: CLI entrypoint

**Files:**

- Modify: `packages/boject-cli/src/index.ts` (replace stub)

- [ ] **Step 1: Implement `src/index.ts`**

```ts
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { runUpgrade, type CommandRunner } from './commands/upgrade.js';
import { CLI_VERSION } from './version.js';

const USAGE = `Usage: boject <command> [flags]

Commands:
  upgrade            Upgrade the CMS image tag in the current directory's
                     docker-compose.yml, pull the new image, restart, and
                     wait for health.

Flags for \`upgrade\`:
  --to <version>     Use a specific target tag (bypasses tag discovery).
  --dry-run          Print the diff without applying.
  --check            Print whether an upgrade is available; exit 1 if so.
  --version          Print the CLI version and exit.
  --help             Print this message and exit.
`;

const nodeRunner: CommandRunner = {
  run(cmd, args, opts) {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd: opts?.cwd, stdio: 'inherit' });
      child.on('close', (code) => resolve({ status: code }));
    });
  },
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(USAGE);
    process.exit(argv.length === 0 ? 1 : 0);
  }

  if (argv[0] === '--version' || argv[0] === '-v') {
    process.stdout.write(`${CLI_VERSION}\n`);
    process.exit(0);
  }

  const command = argv[0];
  const rest = argv.slice(1);

  if (command !== 'upgrade') {
    process.stderr.write(`Unknown command: ${command}\n`);
    process.stderr.write(USAGE);
    process.exit(1);
  }

  const { values } = parseArgs({
    args: rest,
    allowPositionals: false,
    options: {
      to: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
    },
  });

  const { exitCode, message } = await runUpgrade({
    cwd: process.cwd(),
    runner: nodeRunner,
    flags: {
      to: values.to,
      dryRun: values['dry-run'] === true,
      check: values.check === true,
    },
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  });

  const sink = exitCode === 0 ? process.stdout : process.stderr;
  sink.write(`${message}\n`);
  process.exit(exitCode);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});
```

- [ ] **Step 2: Build and smoke-check**

```bash
pnpm --filter @boject/cli build
node packages/boject-cli/dist/index.js --version
```

Expected: prints `0.0.1-rc.1`.

```bash
node packages/boject-cli/dist/index.js --help
```

Expected: prints the usage text and exits 0.

```bash
node packages/boject-cli/dist/index.js bogus
```

Expected: exits 1 with `Unknown command: bogus` on stderr.

- [ ] **Step 3: Commit**

```bash
git add packages/boject-cli/src/index.ts
git commit -m "feat(c4): add boject CLI entrypoint"
```

---

## Task 7: E2E test against in-process registry mock

**Files:**

- Create: `packages/boject-cli/tests/e2e/upgrade.test.ts`

- [ ] **Step 1: Write the E2E test**

```ts
// tests/e2e/upgrade.test.ts
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..', '..');
const CLI_PATH = join(PACKAGE_ROOT, 'dist', 'index.js');

let server: Server;
let port: number;
const tagsToServe: { value: string[] } = { value: [] };

beforeAll(async () => {
  await run('pnpm', ['--filter', '@boject/cli', 'build'], {
    cwd: resolve(PACKAGE_ROOT, '..', '..'),
  });

  server = createServer((req, res) => {
    if (req.url === '/v2/boject/cms/tags/list') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ name: 'boject/cms', tags: tagsToServe.value }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  port = address.port;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'boject-cli-e2e-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeFixture(tag: string): Promise<string> {
  const path = join(workDir, 'docker-compose.yml');
  await writeFile(
    path,
    `services:\n  cms:\n    image: 127.0.0.1:${port}/boject/cms:${tag}\n  db:\n    image: postgres:17\n`
  );
  return path;
}

function runCli(args: string[]) {
  return run(process.execPath, [CLI_PATH, ...args], {
    cwd: workDir,
    env: { ...process.env },
  });
}

describe('boject upgrade E2E (mock registry)', () => {
  it('--check exits 1 when an update is available', async () => {
    await writeFixture('1.0.0');
    tagsToServe.value = ['1.0.0', '1.2.0', 'latest'];
    await expect(runCli(['upgrade', '--check'])).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining('Update available: 1.0.0 → 1.2.0'),
    });
  });

  it('--check exits 0 when current is latest semver', async () => {
    await writeFixture('1.2.0');
    tagsToServe.value = ['1.0.0', '1.2.0'];
    const { stdout } = await runCli(['upgrade', '--check']);
    expect(stdout).toContain('Up to date: 1.2.0');
  });

  it('--dry-run prints a diff and leaves the file untouched', async () => {
    const path = await writeFixture('1.0.0');
    tagsToServe.value = ['1.0.0', '1.1.0'];
    const { stdout } = await runCli(['upgrade', '--dry-run']);
    expect(stdout).toContain('- image: boject/cms:1.0.0');
    expect(stdout).toContain('+ image: boject/cms:1.1.0');
    const body = await readFile(path, 'utf8');
    expect(body).toContain(`127.0.0.1:${port}/boject/cms:1.0.0`);
  });

  it('exits 1 when no semver tags are available', async () => {
    await writeFixture('1.0.0');
    tagsToServe.value = ['latest', 'dev'];
    await expect(runCli(['upgrade'])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(/No semver tags/i),
    });
  });

  it('--version prints CLI_VERSION', async () => {
    const { stdout } = await run(process.execPath, [CLI_PATH, '--version']);
    expect(stdout.trim()).toBe('0.0.1-rc.1');
  });
});
```

- [ ] **Step 2: Run the E2E suite**

```bash
pnpm --filter @boject/cli test:e2e
```

Expected: 5 E2E tests pass. `beforeAll` rebuilds the CLI, starts the mock server; each test writes a fresh fixture + mutates `tagsToServe`. No Docker required.

- [ ] **Step 3: Run the full suite**

```bash
pnpm --filter @boject/cli test
```

Expected: unit + E2E all pass (~30 tests total).

- [ ] **Step 4: Commit**

```bash
git add packages/boject-cli/tests/e2e/upgrade.test.ts
git commit -m "test(c4): add boject upgrade E2E against in-process registry mock"
```

---

## Task 8: Align dev artifacts at `0.0.1-rc.1` + `dev:publish:image:as` helper

**Files:**

- Modify: `packages/create-boject-cms/package.json` (version bump)
- Modify: `package.json` (repo root — rework `dev:publish`, add `dev:publish:image:as`, update `dev:publish:image`)
- Modify: `scripts/dev-scaffold.ts` (update `IMAGE` constant)

- [ ] **Step 1: Bump `create-boject-cms` version**

In `packages/create-boject-cms/package.json`, change:

```json
"version": "0.0.0-dev",
```

to:

```json
"version": "0.0.1-rc.1",
```

- [ ] **Step 2: Rewrite root `dev:publish:image` and add `dev:publish:image:as`**

In the root `package.json` scripts block, replace:

```json
"dev:publish:image": "docker build -f apps/cms/Dockerfile -t localhost:5555/boject/cms:dev . && docker push localhost:5555/boject/cms:dev",
```

with two entries:

```json
"dev:publish:image": "pnpm dev:publish:image:as 0.0.1-rc.1",
"dev:publish:image:as": "tsx scripts/dev-publish-image.ts",
```

- [ ] **Step 3: Create `scripts/dev-publish-image.ts`**

```ts
#!/usr/bin/env tsx
import { spawnSync } from 'node:child_process';

function main(): void {
  const version = process.argv[2];
  if (!version) {
    process.stderr.write('Usage: pnpm dev:publish:image:as <version>\n');
    process.exit(1);
  }
  const tag = `localhost:5555/boject/cms:${version}`;
  const build = spawnSync(
    'docker',
    ['build', '-f', 'apps/cms/Dockerfile', '-t', tag, '.'],
    { stdio: 'inherit' }
  );
  if (build.status !== 0) process.exit(build.status ?? 1);
  const push = spawnSync('docker', ['push', tag], { stdio: 'inherit' });
  process.exit(push.status ?? 1);
}

main();
```

- [ ] **Step 4: Rewrite `dev:publish` to handle both CLIs at `0.0.1-rc.1`**

Replace the existing `dev:publish` entry with:

```json
"dev:publish": "pnpm dev:publish:image && pnpm --filter create-boject-cms build && pnpm --filter @boject/cli build && (npm unpublish --registry http://localhost:4873 create-boject-cms@0.0.1-rc.1 --force 2>/dev/null || true) && (npm unpublish --registry http://localhost:4873 @boject/cli@0.0.1-rc.1 --force 2>/dev/null || true) && pnpm --filter create-boject-cms publish --no-git-checks && pnpm --filter @boject/cli publish --no-git-checks",
```

- [ ] **Step 5: Update `scripts/dev-scaffold.ts` image tag**

Change the constant:

```ts
const IMAGE = 'localhost:5555/boject/cms:dev';
```

to:

```ts
const IMAGE = 'localhost:5555/boject/cms:0.0.1-rc.1';
```

- [ ] **Step 6: Run `dev:publish` end-to-end**

Preconditions: `pnpm dev:registries:up` already run, Docker Desktop is up with `localhost:5555` insecure-registry configured.

```bash
pnpm dev:publish
```

Expected:

- Image built and pushed as `localhost:5555/boject/cms:0.0.1-rc.1`.
- Scaffolder + CLI both build.
- Two unpublish commands run silently (404 ignored).
- Both publish commands succeed against Verdaccio.

Verify Verdaccio has both packages:

```bash
curl -s http://localhost:4873/create-boject-cms | head -c 200
curl -s http://localhost:4873/@boject%2Fcli | head -c 200
```

Both should return JSON with `_id` fields.

- [ ] **Step 7: Commit**

```bash
git add packages/create-boject-cms/package.json package.json scripts/dev-scaffold.ts scripts/dev-publish-image.ts
git commit -m "feat(c4): align image + scaffolder + cli at 0.0.1-rc.1"
```

---

## Task 9: Extend `dev:verify` with `--upgrade`

**Files:**

- Modify: `scripts/dev-verify.ts`

- [ ] **Step 1: Add the `--upgrade` flag handling**

Replace the existing `main()` function body in `scripts/dev-verify.ts` with the expanded version. Full rewrite of `main()` is easier to review than a surgical edit — here's the replacement:

```ts
async function runScaffoldedUpgrade(dir: string): Promise<void> {
  process.stdout.write('[upgrade] publishing second image at 0.0.1-rc.2...\n');
  const publish = spawnSync('pnpm', ['dev:publish:image:as', '0.0.1-rc.2'], {
    stdio: 'inherit',
  });
  if (publish.status !== 0)
    throw new Error('dev:publish:image:as 0.0.1-rc.2 failed');

  process.stdout.write(
    '[upgrade] running @boject/cli upgrade in scaffolded project...\n'
  );
  const upgrade = spawnSync('pnpm', ['dlx', '@boject/cli@latest', 'upgrade'], {
    cwd: dir,
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_registry: 'http://localhost:4873',
      npm_config_prefer_online: 'true',
    },
  });
  if (upgrade.status !== 0) throw new Error('boject upgrade failed');

  const { readFile } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const compose = await readFile(resolve(dir, 'docker-compose.yml'), 'utf8');
  if (!compose.includes('localhost:5555/boject/cms:0.0.1-rc.2')) {
    throw new Error(
      'Expected docker-compose.yml to reference 0.0.1-rc.2 after upgrade'
    );
  }

  process.stdout.write('[upgrade] re-polling health after restart...\n');
  await waitForHealth();
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const targetDir = argv.find((a) => !a.startsWith('--'));
  const doUpgrade = argv.includes('--upgrade');

  if (!targetDir) {
    process.stderr.write('Usage: pnpm dev:verify <dir> [--upgrade]\n');
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
    process.stdout.write('dev:verify: OK (initial boot)\n');

    if (doUpgrade) {
      await runScaffoldedUpgrade(dir);
      const cookie2 = await login(env.adminEmail, env.adminPassword);
      if (env.hasStarter) {
        await assertContentTypes(cookie2);
      }
      process.stdout.write('dev:verify: OK (post-upgrade)\n');
    }
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
```

The existing top-of-file imports are still valid. Leave `parseEnv`, `readEnv`, `composeUp`, `composeDown`, `waitForHealth`, `login`, `assertContentTypes`, and the bottom `main().catch(...)` block untouched.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter create-boject-cms typecheck
```

(No `dev-verify.ts` is in any package's tsconfig — but it's part of the workspace's root tooling. Run the root TS check via tsx to load the script: `tsx scripts/dev-verify.ts` without args should print usage.)

Run:

```bash
tsx scripts/dev-verify.ts
```

Expected: exits 1 with `Usage: pnpm dev:verify <dir> [--upgrade]`.

- [ ] **Step 3: Commit**

```bash
git add scripts/dev-verify.ts
git commit -m "feat(c4): add --upgrade flag to dev:verify"
```

---

## Task 10: Update README

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Extend the "Local dev registries (maintainers)" section**

In `README.md`, find the existing `### Commands` subsection inside `## Local dev registries (maintainers)`. Replace the current commands block with this updated version:

````markdown
### Commands

```bash
pnpm dev:registries:up             # Start both registries in the background
pnpm dev:registries:down           # Stop them (volumes persist)
pnpm dev:publish:image             # Build apps/cms and push to localhost:5555/boject/cms:0.0.1-rc.1
pnpm dev:publish:image:as <ver>    # Build + push the image with an arbitrary tag (for upgrade testing)
pnpm dev:publish                   # Push the image AND publish create-boject-cms + @boject/cli to verdaccio, all at 0.0.1-rc.1
pnpm dev:scaffold <dir>            # Scaffold a project using the verdaccio-published scaffolder and local image
pnpm dev:verify <dir> [--upgrade]  # Boot, assert health + admin login, optionally exercise boject upgrade, tear down
```

A typical end-to-end loop:

```bash
pnpm dev:registries:up
pnpm dev:publish
pnpm dev:scaffold /tmp/try
pnpm dev:verify /tmp/try --upgrade
```

`dev:scaffold` accepts an optional `--starter <base|sport|rugby|none>` flag (default `base`). `dev:verify --upgrade` additionally builds + pushes `localhost:5555/boject/cms:0.0.1-rc.2`, runs `boject upgrade` inside the scaffolded project, asserts the compose file was rewritten, and re-polls health.

All dev artifacts share one version: the CMS image, `create-boject-cms`, and `@boject/cli` are all published at `0.0.1-rc.1`. Plan D will introduce coordinated version bumps.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(c4): document boject upgrade and unified 0.0.1-rc.1 artifacts"
```

---

## Task 11: End-to-end manual verification

**Files:** no changes. Runtime gate.

- [ ] **Step 1: Clean slate**

```bash
pnpm dev:registries:down 2>/dev/null || true
pnpm dev:registries:up
rm -rf /tmp/dev-verify-c4
```

- [ ] **Step 2: Full publish**

```bash
pnpm dev:publish
```

Expected: succeeds, all three artifacts at `0.0.1-rc.1`.

- [ ] **Step 3: Scaffold**

```bash
pnpm dev:scaffold /tmp/dev-verify-c4
grep image: /tmp/dev-verify-c4/docker-compose.yml
```

Expected: the `services.cms.image` line shows `localhost:5555/boject/cms:0.0.1-rc.1`.

- [ ] **Step 4: Verify with upgrade**

```bash
pnpm dev:verify /tmp/dev-verify-c4 --upgrade
```

Expected:

- Initial boot succeeds, `dev:verify: OK (initial boot)` printed.
- `0.0.1-rc.2` builds + pushes.
- `boject upgrade` runs inside the scaffolded dir; compose file rewrites to `0.0.1-rc.2`.
- Container pulled + restarted; health re-polled.
- `dev:verify: OK (post-upgrade)` printed.
- Final teardown (`down -v`) runs in `finally`.

- [ ] **Step 5: Cleanup**

```bash
rm -rf /tmp/dev-verify-c4
```

- [ ] **Step 6: No commit** — this task is a runtime gate. Fix underlying issues rather than pressing on if anything fails.

---

## Out of Scope (addressed later)

- Plan C5 — CI integration of the dev loop (including `dev:verify --upgrade`).
- Plan D — public npm + GHCR publishing, release-time version rewriting, CLI version alignment with the image.
- Shared health-poll util across `scripts/dev-verify.ts` and `packages/boject-cli/src/health.ts` — defer until a third consumer appears.
- `boject` global-install docs — separate docs change if we decide to promote it.
