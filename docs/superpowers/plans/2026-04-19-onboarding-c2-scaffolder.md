# Onboarding C2 — `create-boject-cms` Scaffolder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `packages/create-boject-cms/` npm package — a single-prompt TypeScript CLI that writes a runnable Docker-based boject-cms project into a target directory. No publishing, no docker interaction, no network.

**Architecture:** New workspace package at `packages/create-boject-cms/`. TypeScript source under `src/`, compiled to ESM via `tsup` into `dist/`. Small files rendered by typed template functions that return strings; large starter bundles copied from repo-root `starters/` into `dist/starters/` at build time by a tsx script. Unit tests per renderer; one E2E test that scaffolds into a temp directory and asserts file contents. Dev-loop wiring (publishing to Verdaccio, scaffold-and-verify script) is out of scope — C3 handles it.

**Tech Stack:** TypeScript (ESM), `@clack/prompts` for the interactive prompt, `tsup` for the build, Vitest for tests, Node 24 runtime.

**Spec:** [`docs/superpowers/specs/2026-04-19-onboarding-c2-scaffolder-design.md`](../specs/2026-04-19-onboarding-c2-scaffolder-design.md)

---

## File Structure

| File                                                        | Responsibility                                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `packages/create-boject-cms/package.json`                   | Package manifest: name, bin entry, files, deps.                                    |
| `packages/create-boject-cms/tsconfig.json`                  | TS config for the package (ESM, strict).                                           |
| `packages/create-boject-cms/tsup.config.ts`                 | Build config: `src/index.ts` → `dist/index.js`, shebang, ESM, externalise deps.    |
| `packages/create-boject-cms/vitest.config.ts`               | Test config scoped to the package.                                                 |
| `packages/create-boject-cms/src/version.ts`                 | `export const IMAGE_TAG = 'ghcr.io/boject/cms:latest'`. Plan D will rewrite.       |
| `packages/create-boject-cms/src/secrets.ts`                 | `generateSessionPassword()` (32B base64) + `generateAdminPassword()` (16B base64). |
| `packages/create-boject-cms/src/projectName.ts`             | `sanitiseProjectName(raw: string): string` — npm-compatible name derivation.       |
| `packages/create-boject-cms/src/templates/gitignore.ts`     | Static gitignore string.                                                           |
| `packages/create-boject-cms/src/templates/packageJson.ts`   | `renderPackageJson({ name }): string`.                                             |
| `packages/create-boject-cms/src/templates/envFile.ts`       | `renderEnvFile({ sessionPassword, adminPassword, starter }): string`.              |
| `packages/create-boject-cms/src/templates/dockerCompose.ts` | `renderDockerCompose({ imageTag, starter }): string`.                              |
| `packages/create-boject-cms/src/templates/readme.ts`        | `renderReadme({ starter, adminEmail }): string`.                                   |
| `packages/create-boject-cms/src/render.ts`                  | Barrel re-export of the five render functions + shared `StarterChoice` type.       |
| `packages/create-boject-cms/src/prompts.ts`                 | `resolveStarter({ flag, isTTY }): Promise<StarterChoice>`. Wraps `@clack/prompts`. |
| `packages/create-boject-cms/src/writeProject.ts`            | Orchestrator: target-dir checks, render, write, copy starter bundle.               |
| `packages/create-boject-cms/src/index.ts`                   | CLI entrypoint: argv parse → prompts → writeProject → print next steps.            |
| `packages/create-boject-cms/scripts/copyStarters.ts`        | Build step: copies `starters/*.boject.json` from repo root into `dist/starters/`.  |
| `packages/create-boject-cms/tests/unit/*.test.ts`           | One unit test file per pure module.                                                |
| `packages/create-boject-cms/tests/e2e/scaffold.test.ts`     | End-to-end scaffold into a temp directory.                                         |

---

## Task 1: Scaffold the package

**Files:**

- Create: `packages/create-boject-cms/package.json`
- Create: `packages/create-boject-cms/tsconfig.json`
- Create: `packages/create-boject-cms/tsup.config.ts`
- Create: `packages/create-boject-cms/vitest.config.ts`
- Create: `packages/create-boject-cms/src/index.ts` (stub)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "create-boject-cms",
  "version": "0.0.0-dev",
  "private": true,
  "type": "module",
  "description": "Scaffold a new boject-cms project.",
  "bin": {
    "create-boject-cms": "./dist/index.js"
  },
  "main": "./dist/index.js",
  "files": ["dist"],
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "build": "tsup && tsx scripts/copyStarters.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run tests/unit",
    "test:e2e": "vitest run tests/e2e"
  },
  "dependencies": {
    "@clack/prompts": "^0.8.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsup": "^8.3.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^4.0.18"
  }
}
```

`"private": true` stays here until the publish pipeline lands — it guards against accidental `pnpm publish` runs during development. C3 flips this to `false` when it wires Verdaccio publishing.

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
  "include": [
    "src/**/*",
    "tests/**/*",
    "scripts/**/*",
    "tsup.config.ts",
    "vitest.config.ts"
  ]
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
  external: ['@clack/prompts'],
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
    testTimeout: 10_000,
  },
});
```

- [ ] **Step 5: Create stub `src/index.ts`**

```ts
export {};
```

This exists solely so `tsup build` has an entry point; real content comes in Task 12.

- [ ] **Step 6: Install dependencies**

From the repo root:

```bash
pnpm install
```

Expected: pnpm resolves the new workspace package and installs `@clack/prompts`, `tsup`, `tsx`, `typescript`, `vitest`, `@types/node`.

- [ ] **Step 7: Verify typecheck passes on empty package**

```bash
pnpm --filter create-boject-cms typecheck
```

Expected: exit 0 with no output.

- [ ] **Step 8: Commit**

```bash
git add packages/create-boject-cms pnpm-lock.yaml
git commit -m "feat(c2): scaffold create-boject-cms package"
```

---

## Task 2: Secret generation

**Files:**

- Create: `packages/create-boject-cms/src/secrets.ts`
- Create: `packages/create-boject-cms/tests/unit/secrets.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/secrets.test.ts
import { describe, expect, it } from 'vitest';
import {
  generateAdminPassword,
  generateSessionPassword,
} from '../../src/secrets.js';

describe('generateSessionPassword', () => {
  it('returns a 44-char base64 string (32 decoded bytes)', () => {
    const secret = generateSessionPassword();
    expect(secret).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(Buffer.from(secret, 'base64')).toHaveLength(32);
  });

  it('returns unique values across calls', () => {
    const a = generateSessionPassword();
    const b = generateSessionPassword();
    expect(a).not.toBe(b);
  });
});

describe('generateAdminPassword', () => {
  it('returns a 24-char base64 string (16 decoded bytes)', () => {
    const secret = generateAdminPassword();
    expect(secret).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(Buffer.from(secret, 'base64')).toHaveLength(16);
  });

  it('returns unique values across calls', () => {
    const a = generateAdminPassword();
    const b = generateAdminPassword();
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run test, expect it to fail**

```bash
pnpm --filter create-boject-cms test:unit
```

Expected: `Cannot find module '../../src/secrets.js'`.

- [ ] **Step 3: Implement `src/secrets.ts`**

```ts
import { randomBytes } from 'node:crypto';

export function generateSessionPassword(): string {
  return randomBytes(32).toString('base64');
}

export function generateAdminPassword(): string {
  return randomBytes(16).toString('base64');
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm --filter create-boject-cms test:unit
```

Expected: 4/4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/create-boject-cms/src/secrets.ts packages/create-boject-cms/tests/unit/secrets.test.ts
git commit -m "feat(c2): add secret generation helpers"
```

---

## Task 3: Project name sanitisation

**Files:**

- Create: `packages/create-boject-cms/src/projectName.ts`
- Create: `packages/create-boject-cms/tests/unit/projectName.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/projectName.test.ts
import { describe, expect, it } from 'vitest';
import { sanitiseProjectName } from '../../src/projectName.js';

describe('sanitiseProjectName', () => {
  it('lowercases the input', () => {
    expect(sanitiseProjectName('MySite')).toBe('mysite');
  });

  it('replaces spaces with hyphens', () => {
    expect(sanitiseProjectName('my great site')).toBe('my-great-site');
  });

  it('collapses runs of non-alphanumerics into a single hyphen', () => {
    expect(sanitiseProjectName('hello  @  world!!')).toBe('hello-world');
  });

  it('strips leading and trailing hyphens', () => {
    expect(sanitiseProjectName('---cool-project---')).toBe('cool-project');
  });

  it('preserves digits, dots, and underscores (valid npm name chars)', () => {
    expect(sanitiseProjectName('site_v2.0')).toBe('site_v2.0');
  });

  it('falls back to "boject-site" when input sanitises to empty', () => {
    expect(sanitiseProjectName('!!!')).toBe('boject-site');
    expect(sanitiseProjectName('')).toBe('boject-site');
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm --filter create-boject-cms test:unit
```

Expected: module not found error.

- [ ] **Step 3: Implement `src/projectName.ts`**

```ts
export function sanitiseProjectName(raw: string): string {
  const lowered = raw.toLowerCase();
  const replaced = lowered.replace(/[^a-z0-9._]+/g, '-');
  const trimmed = replaced.replace(/^-+|-+$/g, '');
  return trimmed.length > 0 ? trimmed : 'boject-site';
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm --filter create-boject-cms test:unit
```

Expected: all project-name tests pass (plus the existing secrets tests).

- [ ] **Step 5: Commit**

```bash
git add packages/create-boject-cms/src/projectName.ts packages/create-boject-cms/tests/unit/projectName.test.ts
git commit -m "feat(c2): add project name sanitisation"
```

---

## Task 4: Static templates (gitignore + version)

**Files:**

- Create: `packages/create-boject-cms/src/version.ts`
- Create: `packages/create-boject-cms/src/templates/gitignore.ts`
- Create: `packages/create-boject-cms/tests/unit/gitignore.test.ts`

- [ ] **Step 1: Create `src/version.ts`**

```ts
export const IMAGE_TAG = 'ghcr.io/boject/cms:latest';
```

- [ ] **Step 2: Write failing test for gitignore**

```ts
// tests/unit/gitignore.test.ts
import { describe, expect, it } from 'vitest';
import { GITIGNORE } from '../../src/templates/gitignore.js';

describe('GITIGNORE template', () => {
  it('ignores the .env file', () => {
    expect(GITIGNORE).toContain('.env');
  });

  it('ignores the storage directory', () => {
    expect(GITIGNORE).toContain('storage/');
  });

  it('ignores the pgdata directory', () => {
    expect(GITIGNORE).toContain('pgdata/');
  });

  it('ends with a trailing newline', () => {
    expect(GITIGNORE.endsWith('\n')).toBe(true);
  });
});
```

- [ ] **Step 3: Run test, expect failure**

```bash
pnpm --filter create-boject-cms test:unit
```

Expected: module not found.

- [ ] **Step 4: Implement `src/templates/gitignore.ts`**

```ts
export const GITIGNORE = `.env
storage/
pgdata/
`;
```

- [ ] **Step 5: Run test, expect pass**

```bash
pnpm --filter create-boject-cms test:unit
```

Expected: all gitignore tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/create-boject-cms/src/version.ts packages/create-boject-cms/src/templates/gitignore.ts packages/create-boject-cms/tests/unit/gitignore.test.ts
git commit -m "feat(c2): add static version + gitignore templates"
```

---

## Task 5: `package.json` renderer

**Files:**

- Create: `packages/create-boject-cms/src/templates/packageJson.ts`
- Create: `packages/create-boject-cms/tests/unit/packageJson.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/packageJson.test.ts
import { describe, expect, it } from 'vitest';
import { renderPackageJson } from '../../src/templates/packageJson.js';

describe('renderPackageJson', () => {
  it('returns valid JSON', () => {
    const output = renderPackageJson({ name: 'my-site' });
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('sets the name from the parameter', () => {
    const parsed = JSON.parse(renderPackageJson({ name: 'my-site' }));
    expect(parsed.name).toBe('my-site');
  });

  it('is private and unversioned (0.1.0)', () => {
    const parsed = JSON.parse(renderPackageJson({ name: 'x' }));
    expect(parsed.private).toBe(true);
    expect(parsed.version).toBe('0.1.0');
  });

  it('defines start/stop/logs/upgrade scripts', () => {
    const parsed = JSON.parse(renderPackageJson({ name: 'x' }));
    expect(parsed.scripts).toEqual({
      start: 'docker compose up -d',
      stop: 'docker compose down',
      logs: 'docker compose logs -f cms',
      upgrade: 'npx @boject/cli@latest upgrade',
    });
  });

  it('declares no dependencies', () => {
    const parsed = JSON.parse(renderPackageJson({ name: 'x' }));
    expect(parsed.dependencies).toBeUndefined();
    expect(parsed.devDependencies).toBeUndefined();
  });

  it('ends with a trailing newline', () => {
    const output = renderPackageJson({ name: 'x' });
    expect(output.endsWith('\n')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm --filter create-boject-cms test:unit
```

Expected: module not found.

- [ ] **Step 3: Implement `src/templates/packageJson.ts`**

```ts
export interface PackageJsonParams {
  name: string;
}

export function renderPackageJson({ name }: PackageJsonParams): string {
  const pkg = {
    name,
    version: '0.1.0',
    private: true,
    scripts: {
      start: 'docker compose up -d',
      stop: 'docker compose down',
      logs: 'docker compose logs -f cms',
      upgrade: 'npx @boject/cli@latest upgrade',
    },
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm --filter create-boject-cms test:unit
```

Expected: all packageJson tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/create-boject-cms/src/templates/packageJson.ts packages/create-boject-cms/tests/unit/packageJson.test.ts
git commit -m "feat(c2): add package.json renderer"
```

---

## Task 6: `.env` renderer

**Files:**

- Create: `packages/create-boject-cms/src/templates/envFile.ts`
- Create: `packages/create-boject-cms/tests/unit/envFile.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/envFile.test.ts
import { describe, expect, it } from 'vitest';
import { renderEnvFile } from '../../src/templates/envFile.js';

const baseParams = {
  sessionPassword: 'session-password-value',
  adminPassword: 'admin-password-value',
};

describe('renderEnvFile', () => {
  it('includes DATABASE_URL pointed at the compose db service', () => {
    const env = renderEnvFile({ ...baseParams, starter: 'base' });
    expect(env).toMatch(
      /^DATABASE_URL=postgresql:\/\/boject:boject@db:5432\/boject$/m
    );
  });

  it('includes NUXT_SESSION_PASSWORD from parameter', () => {
    const env = renderEnvFile({ ...baseParams, starter: 'base' });
    expect(env).toMatch(/^NUXT_SESSION_PASSWORD=session-password-value$/m);
  });

  it('includes BOJECT_ADMIN_EMAIL=admin@local', () => {
    const env = renderEnvFile({ ...baseParams, starter: 'base' });
    expect(env).toMatch(/^BOJECT_ADMIN_EMAIL=admin@local$/m);
  });

  it('includes BOJECT_ADMIN_PASSWORD from parameter', () => {
    const env = renderEnvFile({ ...baseParams, starter: 'base' });
    expect(env).toMatch(/^BOJECT_ADMIN_PASSWORD=admin-password-value$/m);
  });

  it('includes STORAGE_DRIVER=local', () => {
    const env = renderEnvFile({ ...baseParams, starter: 'base' });
    expect(env).toMatch(/^STORAGE_DRIVER=local$/m);
  });

  it('includes BOJECT_INITIAL_STARTER when starter is not "none"', () => {
    const env = renderEnvFile({ ...baseParams, starter: 'sport' });
    expect(env).toMatch(
      /^BOJECT_INITIAL_STARTER=\/starters\/sport\.boject\.json$/m
    );
  });

  it('omits BOJECT_INITIAL_STARTER when starter is "none"', () => {
    const env = renderEnvFile({ ...baseParams, starter: 'none' });
    expect(env).not.toMatch(/BOJECT_INITIAL_STARTER/);
  });

  it('ends with a trailing newline', () => {
    const env = renderEnvFile({ ...baseParams, starter: 'base' });
    expect(env.endsWith('\n')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm --filter create-boject-cms test:unit
```

Expected: module not found.

- [ ] **Step 3: Implement `src/templates/envFile.ts`**

```ts
export type StarterChoice = 'base' | 'sport' | 'rugby' | 'none';

export interface EnvFileParams {
  sessionPassword: string;
  adminPassword: string;
  starter: StarterChoice;
}

export function renderEnvFile({
  sessionPassword,
  adminPassword,
  starter,
}: EnvFileParams): string {
  const lines = [
    'DATABASE_URL=postgresql://boject:boject@db:5432/boject',
    `NUXT_SESSION_PASSWORD=${sessionPassword}`,
    'BOJECT_ADMIN_EMAIL=admin@local',
    `BOJECT_ADMIN_PASSWORD=${adminPassword}`,
    'STORAGE_DRIVER=local',
  ];
  if (starter !== 'none') {
    lines.push(`BOJECT_INITIAL_STARTER=/starters/${starter}.boject.json`);
  }
  return lines.join('\n') + '\n';
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm --filter create-boject-cms test:unit
```

Expected: all envFile tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/create-boject-cms/src/templates/envFile.ts packages/create-boject-cms/tests/unit/envFile.test.ts
git commit -m "feat(c2): add .env renderer"
```

---

## Task 7: `docker-compose.yml` renderer

**Files:**

- Create: `packages/create-boject-cms/src/templates/dockerCompose.ts`
- Create: `packages/create-boject-cms/tests/unit/dockerCompose.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/dockerCompose.test.ts
import { describe, expect, it } from 'vitest';
import { renderDockerCompose } from '../../src/templates/dockerCompose.js';

describe('renderDockerCompose', () => {
  it('pins cms.image to the supplied tag', () => {
    const yml = renderDockerCompose({
      imageTag: 'ghcr.io/boject/cms:1.2.3',
      starter: 'base',
    });
    expect(yml).toContain('image: ghcr.io/boject/cms:1.2.3');
  });

  it('wires the db service as postgres:17 with boject credentials', () => {
    const yml = renderDockerCompose({ imageTag: 'x', starter: 'base' });
    expect(yml).toContain('image: postgres:17');
    expect(yml).toContain('POSTGRES_USER: boject');
    expect(yml).toContain('POSTGRES_PASSWORD: boject');
    expect(yml).toContain('POSTGRES_DB: boject');
  });

  it('exposes cms on host port 4000 → container 3000', () => {
    const yml = renderDockerCompose({ imageTag: 'x', starter: 'base' });
    expect(yml).toContain("'4000:3000'");
  });

  it('declares pgdata and storage named volumes', () => {
    const yml = renderDockerCompose({ imageTag: 'x', starter: 'base' });
    expect(yml).toMatch(/^volumes:/m);
    expect(yml).toContain('pgdata:');
    expect(yml).toContain('storage:');
  });

  it('mounts ./starters:/starters:ro when starter is not "none"', () => {
    const yml = renderDockerCompose({ imageTag: 'x', starter: 'sport' });
    expect(yml).toContain('./starters:/starters:ro');
  });

  it('omits the starters bind-mount when starter is "none"', () => {
    const yml = renderDockerCompose({ imageTag: 'x', starter: 'none' });
    expect(yml).not.toContain('./starters:/starters:ro');
  });

  it('sets env_file to .env for the cms service', () => {
    const yml = renderDockerCompose({ imageTag: 'x', starter: 'base' });
    expect(yml).toContain('env_file:');
    expect(yml).toContain('- .env');
  });

  it('ends with a trailing newline', () => {
    const yml = renderDockerCompose({ imageTag: 'x', starter: 'base' });
    expect(yml.endsWith('\n')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm --filter create-boject-cms test:unit
```

Expected: module not found.

- [ ] **Step 3: Implement `src/templates/dockerCompose.ts`**

```ts
import type { StarterChoice } from './envFile.js';

export interface DockerComposeParams {
  imageTag: string;
  starter: StarterChoice;
}

export function renderDockerCompose({
  imageTag,
  starter,
}: DockerComposeParams): string {
  const starterMount =
    starter === 'none' ? '' : `      - ./starters:/starters:ro\n`;

  return `services:
  cms:
    image: ${imageTag}
    restart: unless-stopped
    ports:
      - '4000:3000'
    env_file:
      - .env
    depends_on:
      - db
    volumes:
      - storage:/app/storage
${starterMount}  db:
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
  storage:
`;
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm --filter create-boject-cms test:unit
```

Expected: all dockerCompose tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/create-boject-cms/src/templates/dockerCompose.ts packages/create-boject-cms/tests/unit/dockerCompose.test.ts
git commit -m "feat(c2): add docker-compose.yml renderer"
```

---

## Task 8: `README.md` renderer

**Files:**

- Create: `packages/create-boject-cms/src/templates/readme.ts`
- Create: `packages/create-boject-cms/tests/unit/readme.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/readme.test.ts
import { describe, expect, it } from 'vitest';
import { renderReadme } from '../../src/templates/readme.js';

describe('renderReadme', () => {
  it('includes the docker compose up command', () => {
    const md = renderReadme({ starter: 'base', adminEmail: 'admin@local' });
    expect(md).toContain('docker compose up -d');
  });

  it('references the login URL (http://localhost:4000/login)', () => {
    const md = renderReadme({ starter: 'base', adminEmail: 'admin@local' });
    expect(md).toContain('http://localhost:4000/login');
  });

  it('mentions the admin email', () => {
    const md = renderReadme({ starter: 'base', adminEmail: 'admin@local' });
    expect(md).toContain('admin@local');
  });

  it('tells the user the admin password lives in .env', () => {
    const md = renderReadme({ starter: 'base', adminEmail: 'admin@local' });
    expect(md).toMatch(/BOJECT_ADMIN_PASSWORD.*\.env/s);
  });

  it('mentions the selected starter when one was imported', () => {
    const md = renderReadme({ starter: 'sport', adminEmail: 'admin@local' });
    expect(md).toContain('sport');
  });

  it('does not promise a starter import when starter is "none"', () => {
    const md = renderReadme({ starter: 'none', adminEmail: 'admin@local' });
    expect(md.toLowerCase()).not.toContain('starter will be imported');
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm --filter create-boject-cms test:unit
```

Expected: module not found.

- [ ] **Step 3: Implement `src/templates/readme.ts`**

```ts
import type { StarterChoice } from './envFile.js';

export interface ReadmeParams {
  starter: StarterChoice;
  adminEmail: string;
}

export function renderReadme({ starter, adminEmail }: ReadmeParams): string {
  const starterLine =
    starter === 'none'
      ? ''
      : `The \`${starter}\` starter bundle will be imported on first boot.\n\n`;

  return `# boject-cms

A new boject-cms project scaffolded by \`create-boject-cms\`.

## Start the CMS

\`\`\`bash
docker compose up -d
\`\`\`

${starterLine}Once the container is healthy, log in at http://localhost:4000/login with:

- Email: \`${adminEmail}\`
- Password: see \`BOJECT_ADMIN_PASSWORD\` in \`.env\`

## Stop the CMS

\`\`\`bash
docker compose down
\`\`\`

## Upgrade the CMS image

\`\`\`bash
pnpm upgrade
\`\`\`

This runs \`npx @boject/cli@latest upgrade\` to rewrite the pinned image tag in \`docker-compose.yml\` and restart the container.
`;
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm --filter create-boject-cms test:unit
```

Expected: all readme tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/create-boject-cms/src/templates/readme.ts packages/create-boject-cms/tests/unit/readme.test.ts
git commit -m "feat(c2): add README.md renderer"
```

---

## Task 9: Render barrel

**Files:**

- Create: `packages/create-boject-cms/src/render.ts`

- [ ] **Step 1: Create the barrel module**

```ts
export { renderDockerCompose } from './templates/dockerCompose.js';
export { renderEnvFile } from './templates/envFile.js';
export { renderPackageJson } from './templates/packageJson.js';
export { renderReadme } from './templates/readme.js';
export { GITIGNORE } from './templates/gitignore.js';
export type { StarterChoice } from './templates/envFile.js';
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm --filter create-boject-cms typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/create-boject-cms/src/render.ts
git commit -m "feat(c2): add render barrel module"
```

---

## Task 10: Prompts module

**Files:**

- Create: `packages/create-boject-cms/src/prompts.ts`
- Create: `packages/create-boject-cms/tests/unit/prompts.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/prompts.test.ts
import { describe, expect, it, vi } from 'vitest';
import { resolveStarter } from '../../src/prompts.js';

vi.mock('@clack/prompts', () => ({
  select: vi.fn(),
  isCancel: vi.fn(() => false),
}));

import * as clack from '@clack/prompts';

describe('resolveStarter', () => {
  it('returns the flag value without calling the prompt when a valid flag is supplied', async () => {
    const result = await resolveStarter({ flag: 'sport', isTTY: true });
    expect(result).toBe('sport');
    expect(clack.select).not.toHaveBeenCalled();
  });

  it('throws on an invalid flag value', async () => {
    await expect(
      resolveStarter({ flag: 'invalid', isTTY: true })
    ).rejects.toThrow(/must be one of/);
  });

  it('throws when non-TTY and no flag is provided', async () => {
    await expect(
      resolveStarter({ flag: undefined, isTTY: false })
    ).rejects.toThrow(/non-interactive/i);
  });

  it('prompts via @clack/prompts when TTY and no flag', async () => {
    vi.mocked(clack.select).mockResolvedValueOnce('base');
    const result = await resolveStarter({ flag: undefined, isTTY: true });
    expect(result).toBe('base');
    expect(clack.select).toHaveBeenCalledOnce();
  });

  it('throws if the user cancels the prompt', async () => {
    const cancelSymbol = Symbol('cancel');
    vi.mocked(clack.select).mockResolvedValueOnce(
      cancelSymbol as unknown as string
    );
    vi.mocked(clack.isCancel).mockReturnValueOnce(true);
    await expect(
      resolveStarter({ flag: undefined, isTTY: true })
    ).rejects.toThrow(/cancelled/i);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm --filter create-boject-cms test:unit
```

Expected: module not found.

- [ ] **Step 3: Implement `src/prompts.ts`**

```ts
import { isCancel, select } from '@clack/prompts';
import type { StarterChoice } from './render.js';

const CHOICES: StarterChoice[] = ['base', 'sport', 'rugby', 'none'];

function isValidChoice(value: string): value is StarterChoice {
  return (CHOICES as string[]).includes(value);
}

export interface ResolveStarterParams {
  flag: string | undefined;
  isTTY: boolean;
}

export async function resolveStarter({
  flag,
  isTTY,
}: ResolveStarterParams): Promise<StarterChoice> {
  if (flag !== undefined) {
    if (!isValidChoice(flag)) {
      throw new Error(`--starter must be one of: ${CHOICES.join(', ')}`);
    }
    return flag;
  }

  if (!isTTY) {
    throw new Error(
      'Non-interactive shell detected. Pass --starter <base|sport|rugby|none>.'
    );
  }

  const response = await select({
    message: 'Which starter?',
    options: [
      { value: 'base', label: 'Base (8 universal content types)' },
      {
        value: 'sport',
        label: 'Sport (base + team/club/competition/fixture/player)',
      },
      { value: 'rugby', label: 'Rugby (sport + Position + patched Player)' },
      { value: 'none', label: 'None (empty database)' },
    ],
    initialValue: 'base',
  });

  if (isCancel(response)) {
    throw new Error('Scaffold cancelled by user.');
  }

  return response as StarterChoice;
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm --filter create-boject-cms test:unit
```

Expected: all prompts tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/create-boject-cms/src/prompts.ts packages/create-boject-cms/tests/unit/prompts.test.ts
git commit -m "feat(c2): add starter-choice prompt resolver"
```

---

## Task 11: `writeProject` orchestrator

**Files:**

- Create: `packages/create-boject-cms/src/writeProject.ts`
- Create: `packages/create-boject-cms/tests/unit/writeProject.test.ts`
- Create test fixture: `packages/create-boject-cms/tests/unit/fixtures/starters/base.boject.json` (minimal stub bundle)

- [ ] **Step 1: Create a fixture starter bundle**

A minimal valid stub is enough — the orchestrator only copies bytes; it doesn't validate bundle shape.

```json
// tests/unit/fixtures/starters/base.boject.json
{ "version": 2, "stub": true }
```

- [ ] **Step 2: Write failing tests**

```ts
// tests/unit/writeProject.test.ts
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeProject } from '../../src/writeProject.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures/starters');

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'create-boject-cms-test-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const baseArgs = {
  imageTag: 'ghcr.io/boject/cms:latest',
  startersSourceDir: FIXTURES,
};

describe('writeProject', () => {
  it('creates the target directory and writes the expected files for starter=base', async () => {
    const target = join(workDir, 'site');
    const result = await writeProject({
      ...baseArgs,
      targetDir: target,
      starter: 'base',
      force: false,
    });

    const files = await readdir(target);
    expect(files.sort()).toEqual(
      [
        '.env',
        '.gitignore',
        'README.md',
        'docker-compose.yml',
        'package.json',
        'starters',
      ].sort()
    );

    const starterFiles = await readdir(join(target, 'starters'));
    expect(starterFiles).toEqual(['base.boject.json']);

    expect(result.adminEmail).toBe('admin@local');
    expect(result.adminPassword.length).toBeGreaterThan(0);
  });

  it('omits the starters directory when starter=none', async () => {
    const target = join(workDir, 'site');
    await writeProject({
      ...baseArgs,
      targetDir: target,
      starter: 'none',
      force: false,
    });

    const files = await readdir(target);
    expect(files).not.toContain('starters');
  });

  it('throws when the target directory is non-empty and force is false', async () => {
    const target = join(workDir, 'site');
    await writeFile(join(workDir, 'existing.txt'), 'hi');

    await expect(
      writeProject({
        ...baseArgs,
        targetDir: workDir,
        starter: 'base',
        force: false,
      })
    ).rejects.toThrow(/not empty/);
  });

  it('succeeds in a non-empty target when force is true', async () => {
    await writeFile(join(workDir, 'existing.txt'), 'hi');
    const result = await writeProject({
      ...baseArgs,
      targetDir: workDir,
      starter: 'base',
      force: true,
    });
    expect(result.adminPassword.length).toBeGreaterThan(0);
  });

  it('writes the image tag into docker-compose.yml', async () => {
    const target = join(workDir, 'site');
    await writeProject({
      ...baseArgs,
      targetDir: target,
      starter: 'base',
      force: false,
      imageTag: 'localhost:5555/boject/cms:dev',
    });

    const compose = await readFile(join(target, 'docker-compose.yml'), 'utf8');
    expect(compose).toContain('image: localhost:5555/boject/cms:dev');
  });

  it('throws when the starter bundle is missing from the source directory', async () => {
    const target = join(workDir, 'site');
    await expect(
      writeProject({
        ...baseArgs,
        targetDir: target,
        starter: 'sport',
        force: false,
      })
    ).rejects.toThrow(/sport.boject.json/);
  });
});
```

- [ ] **Step 3: Run test, expect failure**

```bash
pnpm --filter create-boject-cms test:unit
```

Expected: module not found.

- [ ] **Step 4: Implement `src/writeProject.ts`**

```ts
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  GITIGNORE,
  renderDockerCompose,
  renderEnvFile,
  renderPackageJson,
  renderReadme,
  type StarterChoice,
} from './render.js';
import { sanitiseProjectName } from './projectName.js';
import { generateAdminPassword, generateSessionPassword } from './secrets.js';

export interface WriteProjectParams {
  targetDir: string;
  starter: StarterChoice;
  imageTag: string;
  force: boolean;
  startersSourceDir: string;
}

export interface WriteProjectResult {
  adminEmail: string;
  adminPassword: string;
}

export async function writeProject({
  targetDir,
  starter,
  imageTag,
  force,
  startersSourceDir,
}: WriteProjectParams): Promise<WriteProjectResult> {
  await mkdir(targetDir, { recursive: true });
  const existing = await readdir(targetDir);
  if (existing.length > 0 && !force) {
    throw new Error(
      `Target directory "${targetDir}" is not empty. Pass --force to scaffold anyway.`
    );
  }

  const sessionPassword = generateSessionPassword();
  const adminPassword = generateAdminPassword();
  const adminEmail = 'admin@local';
  const projectName = sanitiseProjectName(basename(targetDir));

  await writeFile(
    join(targetDir, 'docker-compose.yml'),
    renderDockerCompose({ imageTag, starter })
  );
  await writeFile(
    join(targetDir, '.env'),
    renderEnvFile({ sessionPassword, adminPassword, starter })
  );
  await writeFile(
    join(targetDir, 'package.json'),
    renderPackageJson({ name: projectName })
  );
  await writeFile(join(targetDir, '.gitignore'), GITIGNORE);
  await writeFile(
    join(targetDir, 'README.md'),
    renderReadme({ starter, adminEmail })
  );

  if (starter !== 'none') {
    const startersTarget = join(targetDir, 'starters');
    await mkdir(startersTarget, { recursive: true });
    const source = join(startersSourceDir, `${starter}.boject.json`);
    const dest = join(startersTarget, `${starter}.boject.json`);
    await copyFile(source, dest);
  }

  return { adminEmail, adminPassword };
}
```

- [ ] **Step 5: Run test, expect pass**

```bash
pnpm --filter create-boject-cms test:unit
```

Expected: all writeProject tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/create-boject-cms/src/writeProject.ts packages/create-boject-cms/tests/unit/writeProject.test.ts packages/create-boject-cms/tests/unit/fixtures
git commit -m "feat(c2): add writeProject orchestrator"
```

---

## Task 12: CLI entrypoint (`index.ts`)

**Files:**

- Modify: `packages/create-boject-cms/src/index.ts` (replace stub)

- [ ] **Step 1: Implement the entrypoint**

```ts
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { resolveStarter } from './prompts.js';
import { IMAGE_TAG } from './version.js';
import { writeProject } from './writeProject.js';

interface ParsedArgs {
  targetDir: string;
  force: boolean;
  starter: string | undefined;
  imageTag: string;
}

function parseCli(argv: string[]): ParsedArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      force: { type: 'boolean', default: false },
      starter: { type: 'string' },
      image: { type: 'string' },
    },
  });

  if (positionals.length !== 1) {
    process.stderr.write(
      'Usage: create-boject-cms <target-dir> [--force] [--starter <name>] [--image <tag>]\n'
    );
    process.exit(1);
  }

  return {
    targetDir: resolve(positionals[0]),
    force: values.force === true,
    starter: values.starter,
    imageTag: values.image ?? IMAGE_TAG,
  };
}

function resolveStartersSourceDir(): string {
  // index.js lives at dist/index.js; starters live at dist/starters/.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, 'starters');
}

async function main(): Promise<void> {
  const {
    targetDir,
    force,
    starter: starterFlag,
    imageTag,
  } = parseCli(process.argv.slice(2));
  const starter = await resolveStarter({
    flag: starterFlag,
    isTTY: process.stdin.isTTY === true,
  });

  const { adminEmail, adminPassword } = await writeProject({
    targetDir,
    starter,
    imageTag,
    force,
    startersSourceDir: resolveStartersSourceDir(),
  });

  process.stdout.write(`
Scaffolded boject-cms project at ${targetDir}

Next steps:
  cd ${targetDir}
  docker compose up -d

Once the container is healthy, log in at http://localhost:4000/login with:
  Email:    ${adminEmail}
  Password: ${adminPassword}

This password is also saved in .env — you will NOT see it again.
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm --filter create-boject-cms typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/create-boject-cms/src/index.ts
git commit -m "feat(c2): add CLI entrypoint"
```

---

## Task 13: `copyStarters` build script

**Files:**

- Create: `packages/create-boject-cms/scripts/copyStarters.ts`

- [ ] **Step 1: Implement the copy script**

```ts
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..');
const REPO_STARTERS = resolve(PACKAGE_ROOT, '..', '..', 'starters');
const DIST_STARTERS = join(PACKAGE_ROOT, 'dist', 'starters');

const EXPECTED = ['base', 'sport', 'rugby'] as const;

async function main(): Promise<void> {
  await mkdir(DIST_STARTERS, { recursive: true });
  for (const name of EXPECTED) {
    const source = join(REPO_STARTERS, `${name}.boject.json`);
    const dest = join(DIST_STARTERS, `${name}.boject.json`);
    await copyFile(source, dest);
    process.stdout.write(`copied ${name}.boject.json\n`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`copyStarters failed: ${message}\n`);
  process.exit(1);
});
```

- [ ] **Step 2: Verify the build runs end-to-end**

```bash
pnpm --filter create-boject-cms build
```

Expected:

- `tsup` reports `dist/index.js` built.
- `copyStarters` prints three `copied` lines.
- `packages/create-boject-cms/dist/` now contains `index.js` and `starters/{base,sport,rugby}.boject.json`.

- [ ] **Step 3: Manually smoke-test the compiled CLI**

```bash
node packages/create-boject-cms/dist/index.js /tmp/boject-smoke --starter base --force
```

Expected: command exits 0, prints next-steps, `/tmp/boject-smoke` now contains the six scaffolded files + a `starters/base.boject.json`.

Clean up:

```bash
rm -rf /tmp/boject-smoke
```

- [ ] **Step 4: Commit**

```bash
git add packages/create-boject-cms/scripts/copyStarters.ts
git commit -m "feat(c2): add copyStarters build script"
```

---

## Task 14: E2E scaffold test

**Files:**

- Create: `packages/create-boject-cms/tests/e2e/scaffold.test.ts`

- [ ] **Step 1: Write the E2E tests**

```ts
// tests/e2e/scaffold.test.ts
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..', '..');
const CLI_PATH = join(PACKAGE_ROOT, 'dist', 'index.js');

async function runCli(args: string[], opts: { env?: NodeJS.ProcessEnv } = {}) {
  return run(process.execPath, [CLI_PATH, ...args], {
    env: { ...process.env, ...opts.env },
  });
}

beforeAll(async () => {
  await run('pnpm', ['--filter', 'create-boject-cms', 'build'], {
    cwd: resolve(PACKAGE_ROOT, '..', '..'),
  });
}, 60_000);

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'create-boject-cms-e2e-'));
});

afterAll(async () => {
  // nothing global; per-test workDirs are removed below
});

describe('create-boject-cms E2E', () => {
  it('scaffolds the full file set with --starter base', async () => {
    const target = join(workDir, 'site');
    const { stdout } = await runCli([target, '--starter', 'base']);

    expect(stdout).toContain('Scaffolded boject-cms project');
    expect(stdout).toContain('admin@local');

    const files = await readdir(target);
    expect(files.sort()).toEqual(
      [
        '.env',
        '.gitignore',
        'README.md',
        'docker-compose.yml',
        'package.json',
        'starters',
      ].sort()
    );

    const env = await readFile(join(target, '.env'), 'utf8');
    // Session password: 32 bytes → 43 base64 chars + 1 '=' padding
    expect(env).toMatch(/^NUXT_SESSION_PASSWORD=[A-Za-z0-9+/]{43}=$/m);
    // Admin password: 16 bytes → 22 base64 chars + 2 '=' padding
    expect(env).toMatch(/^BOJECT_ADMIN_PASSWORD=[A-Za-z0-9+/]{22}==$/m);

    const starterBundle = await readFile(
      join(target, 'starters', 'base.boject.json'),
      'utf8'
    );
    const canonical = await readFile(
      resolve(PACKAGE_ROOT, '..', '..', 'starters', 'base.boject.json'),
      'utf8'
    );
    expect(starterBundle).toBe(canonical);

    await rm(target, { recursive: true, force: true });
  }, 30_000);

  it('omits starters/ and BOJECT_INITIAL_STARTER when --starter none', async () => {
    const target = join(workDir, 'site');
    await runCli([target, '--starter', 'none']);

    const files = await readdir(target);
    expect(files).not.toContain('starters');

    const env = await readFile(join(target, '.env'), 'utf8');
    expect(env).not.toMatch(/BOJECT_INITIAL_STARTER/);

    await rm(target, { recursive: true, force: true });
  }, 30_000);

  it('exits non-zero when the target is non-empty without --force', async () => {
    const target = workDir; // the tempdir itself has at least `.` / `..`; we'll put a marker
    await writeFile(join(target, 'marker.txt'), 'hi');

    await expect(runCli([target, '--starter', 'base'])).rejects.toMatchObject({
      code: 1,
    });

    const files = await readdir(target);
    expect(files).toContain('marker.txt');
    expect(files).not.toContain('.env');
  }, 30_000);

  it('succeeds into a non-empty target when --force is passed', async () => {
    const target = workDir;
    await writeFile(join(target, 'marker.txt'), 'hi');

    const { stdout } = await runCli([target, '--starter', 'base', '--force']);
    expect(stdout).toContain('Scaffolded');

    const files = await readdir(target);
    expect(files).toContain('.env');
    expect(files).toContain('marker.txt');
  }, 30_000);

  it('exits 1 with usage when no target is provided', async () => {
    await expect(runCli([])).rejects.toMatchObject({ code: 1 });
  }, 30_000);

  it('honours --image to override the default tag', async () => {
    const target = join(workDir, 'site');
    await runCli([
      target,
      '--starter',
      'base',
      '--image',
      'localhost:5555/boject/cms:dev',
    ]);

    const compose = await readFile(join(target, 'docker-compose.yml'), 'utf8');
    expect(compose).toContain('image: localhost:5555/boject/cms:dev');
    expect(compose).not.toContain('ghcr.io/boject/cms:latest');

    await rm(target, { recursive: true, force: true });
  }, 30_000);
});
```

- [ ] **Step 2: Run the E2E suite**

```bash
pnpm --filter create-boject-cms test:e2e
```

Expected: all 6 tests pass. The `beforeAll` rebuilds the CLI before running tests; subsequent runs reuse the build cache so it's fast.

- [ ] **Step 3: Run the full test suite**

```bash
pnpm --filter create-boject-cms test
```

Expected: all unit + E2E tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/create-boject-cms/tests/e2e/scaffold.test.ts
git commit -m "test(c2): add create-boject-cms E2E scaffold tests"
```

---

## Task 15: Final verification

**Files:** no new files — this task runs the full pipeline from a clean slate.

- [ ] **Step 1: Clean and rebuild from scratch**

```bash
rm -rf packages/create-boject-cms/dist
pnpm --filter create-boject-cms build
```

Expected: build succeeds, `dist/index.js` and `dist/starters/*.boject.json` are present.

- [ ] **Step 2: Run all tests**

```bash
pnpm --filter create-boject-cms test
pnpm --filter create-boject-cms typecheck
```

Expected: both exit 0. Unit tests (~35) + E2E tests (~6) all pass.

- [ ] **Step 3: Run the monorepo-wide lint/format checks**

```bash
pnpm lint
pnpm format
```

Expected: both pass. The create-boject-cms package inherits the repo's Prettier config; ESLint does not currently scan `packages/` — confirm by running and observing no errors/warnings.

- [ ] **Step 4: Run the full repo test suite**

```bash
pnpm test
```

Expected: all existing tests (310+ in `apps/cms`) still pass, plus the new create-boject-cms tests.

- [ ] **Step 5: Final smoke via the compiled binary**

```bash
node packages/create-boject-cms/dist/index.js /tmp/boject-final --starter sport --force
ls /tmp/boject-final
cat /tmp/boject-final/docker-compose.yml | grep image:
cat /tmp/boject-final/.env | grep STARTER
rm -rf /tmp/boject-final
```

Expected:

- The listing includes `docker-compose.yml`, `.env`, `package.json`, `.gitignore`, `README.md`, and `starters/`.
- The compose file has `image: ghcr.io/boject/cms:latest`.
- The env shows `BOJECT_INITIAL_STARTER=/starters/sport.boject.json`.

- [ ] **Step 6: No new commit**

Nothing changed on disk; this task is purely a verification gate before handoff.

---

## Out of Scope (addressed in later plans)

- C3 — `dev:publish` (publishes this package to local Verdaccio), `dev:scaffold` / `dev:verify` root scripts, end-to-end boot test against `localhost:5555/boject/cms:dev`.
- C4 — `@boject/cli` with `upgrade` command.
- C5 — CI E2E of the full loop.
- Plan D — release pipeline, version.ts rewrite, npm publish, GHCR image push.
