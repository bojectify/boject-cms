# Onboarding Plan A — Monorepo Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the current Nuxt app into `apps/cms/`, convert the repo into a pnpm workspace monorepo, and leave the existing test suite, typecheck, and lint passing.

**Architecture:** Mechanical refactor. Zero behaviour change. The Nuxt app gets a `package.json` of its own and lives under `apps/cms/`. A slim workspace-root `package.json` forwards common scripts via `pnpm --filter cms`. `packages/` is created empty, ready for Plans B/C. Data dirs that future packages need to share (`starters/`) stay at the repo root. Workspace-wide tooling (Prettier, Lefthook, pnpm config) stays at the root. Everything else moves.

**Tech Stack:** pnpm workspaces, existing Nuxt 4 / Prisma v7 / Vitest toolchain — unchanged.

**Reference spec:** `docs/superpowers/specs/2026-04-18-onboarding-cli-design.md`

---

## Layout at a glance

**Before:**

```
/
├── app.vue, nuxt.config.ts, server/, pages/, etc.   (Nuxt app at root)
├── prisma/, scripts/, generated/, storage/
├── starters/*.boject.json
├── docker-compose.yml, lefthook.yml, docs/
└── package.json (app deps + scripts)
```

**After:**

```
/
├── apps/
│   └── cms/
│       ├── app.vue, nuxt.config.ts, server/, pages/, etc.
│       ├── prisma/, prisma.config.ts
│       ├── scripts/
│       ├── generated/ (gitignored)
│       ├── storage/ (gitignored)
│       ├── assets/, components/, composables/, layouts/, middleware/,
│       │   pages/, types/, utils/, auth.d.ts
│       ├── eslint.config.mjs
│       ├── tsconfig.json
│       ├── vitest.config.ts, vitest.globalSetup.ts
│       ├── .env, .env.example, .nuxtrc
│       ├── starters.test.ts               # (moved from starters/starters.test.ts)
│       └── package.json                   # (the Nuxt app's deps + scripts)
├── packages/                              # empty — Plans B/C populate
├── starters/                              # data stays at root
│   ├── base.boject.json, sport.boject.json, rugby.boject.json
│   ├── README.md
│   └── src/
├── docs/, docker/, patches/
├── docker-compose.yml                     # dev postgres — stays at root
├── lefthook.yml, .prettierrc.yml, .prettierignore, .npmrc
├── CLAUDE.md, README.md
├── package.json                           # slim workspace root
├── pnpm-workspace.yaml
└── pnpm-lock.yaml
```

---

## Ground rules

- Use `git mv` (not `mv`) for every file and directory move so history tracks cleanly.
- Don't commit half-broken state. Each task ends with a passing verification step and a commit.
- Don't change behaviour. No logic edits. No test edits beyond import-path updates.
- If you hit an unexpected path issue, **stop and ask** — don't guess.

---

### Task 1: Preflight — confirm clean baseline

**Files:** none

- [ ] **Step 1: Confirm clean working tree**

Run: `git status`
Expected: `nothing to commit, working tree clean`

If not clean, stop and resolve first.

- [ ] **Step 2: Install dependencies**

Run: `pnpm install`
Expected: success, no error output

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: all tests pass (green)

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: no errors

- [ ] **Step 5: Run lint**

Run: `pnpm lint`
Expected: no errors

- [ ] **Step 6: Start Postgres if not already running**

Run: `docker compose up -d`
Expected: `boject-cms-db-1` running

(Integration tests need Postgres. If Docker isn't running, start Docker Desktop and retry.)

If any step above fails, **stop and fix before doing anything else**. The restructure must start from green.

No commit on this task.

---

### Task 2: Update `pnpm-workspace.yaml` to declare the workspace

**Files:**

- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: Add the `packages` field at the top**

Open `pnpm-workspace.yaml`. Replace its entire content with:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'

onlyBuiltDependencies:
  - esbuild
  - '@parcel/watcher'
  - prisma
  - lefthook
  - sharp

patchedDependencies:
  '@nuxt/test-utils@4.0.0': patches/@nuxt__test-utils@4.0.0.patch
```

- [ ] **Step 2: Verify pnpm still reads it**

Run: `pnpm list --depth -1 2>&1 | head -5`
Expected: output mentions the root package name, no errors about workspace config.

- [ ] **Step 3: Commit**

```bash
git add pnpm-workspace.yaml
git commit -m "chore(restructure): declare apps/* and packages/* as workspace members"
```

---

### Task 3: Create empty workspace directories

**Files:**

- Create: `apps/` (empty)
- Create: `apps/cms/` (empty)
- Create: `packages/` (empty)

- [ ] **Step 1: Make the directories**

Run:

```bash
mkdir -p apps/cms packages
```

- [ ] **Step 2: Add `.gitkeep` for `packages/` so the empty dir commits**

`apps/cms/` will be populated by the next task, so it doesn't need a keeper. `packages/` stays empty through this plan.

Run:

```bash
touch packages/.gitkeep
```

- [ ] **Step 3: Verify**

Run: `ls apps packages`
Expected:

```
apps:
cms

packages:
```

- [ ] **Step 4: Commit**

```bash
git add packages/.gitkeep
git commit -m "chore(restructure): create apps/ and packages/ directories"
```

(`apps/` isn't committed yet because it's empty — it gets committed implicitly with Task 4's moves.)

---

### Task 4: Move the Nuxt app source directories into `apps/cms/`

This moves every source directory that's part of the Nuxt app. Configs and package.json move in later tasks (separated so each commit is reviewable).

**Files to move** (each with `git mv`):

- `app.vue`
- `assets/`
- `auth.d.ts`
- `components/`
- `composables/`
- `layouts/`
- `middleware/`
- `pages/`
- `server/`
- `types/`
- `utils/`
- `prisma/`
- `scripts/`
- `docker/` (contains `init-test-db.sql` — Nuxt-test-db infrastructure)

- [ ] **Step 1: Move the directories**

Run each command individually (copy-paste safer than combining):

```bash
git mv app.vue apps/cms/
git mv assets apps/cms/
git mv auth.d.ts apps/cms/
git mv components apps/cms/
git mv composables apps/cms/
git mv layouts apps/cms/
git mv middleware apps/cms/
git mv pages apps/cms/
git mv server apps/cms/
git mv types apps/cms/
git mv utils apps/cms/
git mv prisma apps/cms/
git mv scripts apps/cms/
git mv docker apps/cms/
```

- [ ] **Step 2: Verify no stray Nuxt source at root**

Run: `ls apps/cms`
Expected: the 14 entries listed above (all present).

Run: `ls | grep -E '^(app\.vue|assets|auth\.d\.ts|components|composables|layouts|middleware|pages|server|types|utils|prisma|scripts|docker)$'`
Expected: no output (all gone from root).

- [ ] **Step 3: Commit (intermediate — state is broken here but reviewable)**

```bash
git add -A
git commit -m "chore(restructure): move Nuxt app source dirs into apps/cms/"
```

(The app won't run right now — configs still live at root referencing moved paths. Task 5 fixes that.)

---

### Task 5: Move Nuxt app config files into `apps/cms/`

**Files to move:**

- `nuxt.config.ts`
- `prisma.config.ts`
- `tsconfig.json`
- `vitest.config.ts`
- `vitest.globalSetup.ts`
- `eslint.config.mjs`
- `.env`
- `.env.example`
- `.nuxtrc`

**Stays at root** (workspace-wide):

- `.prettierrc.yml`, `.prettierignore`
- `.npmrc`
- `.gitignore`
- `lefthook.yml`
- `pnpm-lock.yaml`, `pnpm-workspace.yaml`
- `docker-compose.yml` (dev Postgres)
- `patches/` (pnpm patch files)

- [ ] **Step 1: Move the config files**

```bash
git mv nuxt.config.ts apps/cms/
git mv prisma.config.ts apps/cms/
git mv tsconfig.json apps/cms/
git mv vitest.config.ts apps/cms/
git mv vitest.globalSetup.ts apps/cms/
git mv eslint.config.mjs apps/cms/
git mv .env apps/cms/
git mv .env.example apps/cms/
git mv .nuxtrc apps/cms/
```

- [ ] **Step 2: Verify**

Run: `ls apps/cms/*.ts apps/cms/*.mjs apps/cms/.env* apps/cms/.nuxtrc apps/cms/tsconfig.json`
Expected: all nine entries present.

No commit yet — Task 6 splits `package.json` in the same logical step.

---

### Task 6: Split `package.json` into workspace root + `apps/cms/package.json`

The current root `package.json` mixes workspace-level concerns (pnpm config, prettier, lefthook) with the Nuxt app's deps and scripts. Split it.

**Files:**

- Create: `apps/cms/package.json`
- Modify: `package.json` (root, dramatically slimmed)

- [ ] **Step 1: Write `apps/cms/package.json` — this is where the app's deps + scripts live**

Create `apps/cms/package.json` with:

```json
{
  "name": "cms",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "nuxt dev",
    "build": "nuxt build",
    "preview": "nuxt preview",
    "postinstall": "nuxt prepare && prisma generate",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:seed": "tsx prisma/seed.ts",
    "prisma:seed:test": "DATABASE_URL=postgresql://boject:boject@localhost:5432/boject_test tsx prisma/seed.ts",
    "prisma:studio": "prisma studio",
    "prisma:studio:test": "DATABASE_URL=postgresql://boject:boject@localhost:5432/boject_test prisma studio",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "test": "vitest run",
    "test:integration": "vitest run --project integration",
    "test:unit": "vitest run --project unit",
    "typecheck": "nuxi typecheck",
    "apikey:create": "tsx scripts/manage-api-keys/index.ts create",
    "apikey:list": "tsx scripts/manage-api-keys/index.ts list",
    "apikey:revoke": "tsx scripts/manage-api-keys/index.ts revoke",
    "content:export": "tsx scripts/content-bundle/index.ts export",
    "content:import": "tsx scripts/content-bundle/index.ts import",
    "content:validate": "tsx scripts/content-bundle/index.ts validate",
    "starters:build": "tsx scripts/build-starters/index.ts build",
    "starters:check": "tsx scripts/build-starters/index.ts check"
  },
  "devDependencies": {
    "@iconify-json/lucide": "^1.2.98",
    "@nuxt/eslint": "^1.15.1",
    "@nuxt/test-utils": "^4.0.0",
    "@types/lodash": "^4.17.24",
    "@types/node": "^24.12.2",
    "@vitest/coverage-v8": "^4.1.1",
    "@vue/test-utils": "^2.4.6",
    "dotenv": "^17.3.1",
    "eslint-config-prettier": "^10.1.8",
    "happy-dom": "^20.7.0",
    "prisma": "^7.4.1",
    "tsx": "^4.21.0",
    "vitest": "^4.0.18"
  },
  "dependencies": {
    "@escape.tech/graphql-armor-max-depth": "^2.4.2",
    "@nuxt/ui": "4.4.0",
    "@pothos/core": "^4.12.0",
    "@pothos/plugin-prisma": "^4.14.2",
    "@pothos/plugin-prisma-utils": "^1.3.3",
    "@pothos/plugin-relay": "^4.7.0",
    "@prisma/adapter-pg": "^7.4.1",
    "@prisma/client": "^7.4.1",
    "@tiptap/core": "^3.20.4",
    "@tiptap/extension-code-block-lowlight": "^3.20.4",
    "@tiptap/extension-image": "^3.20.4",
    "@tiptap/extension-link": "^3.20.4",
    "@tiptap/extension-table": "^3.20.4",
    "@tiptap/extension-table-cell": "^3.20.4",
    "@tiptap/extension-table-header": "^3.20.4",
    "@tiptap/extension-table-row": "^3.20.4",
    "@tiptap/pm": "^3.20.4",
    "@tiptap/starter-kit": "^3.20.4",
    "@tiptap/vue-3": "^3.20.4",
    "dayjs": "^1.11.19",
    "graphql": "^16.12.0",
    "graphql-yoga": "^5.18.0",
    "h3": "1.15.5",
    "lodash": "^4.18.1",
    "lowlight": "^3.3.0",
    "nuxt": "^4.3.1",
    "nuxt-auth-utils": "^0.5.29",
    "sharp": "^0.34.5",
    "tailwindcss": "^4.2.0",
    "vue": "^3.5.28",
    "vuedraggable": "^4.1.0"
  }
}
```

- [ ] **Step 2: Rewrite root `package.json` to a slim workspace root**

Replace the entire content of `/package.json` with:

```json
{
  "name": "boject-cms-workspace",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.30.1",
  "scripts": {
    "dev": "pnpm --filter cms dev",
    "build": "pnpm --filter cms build",
    "preview": "pnpm --filter cms preview",
    "db:up": "docker compose up -d",
    "db:down": "docker compose down",
    "lint": "pnpm --filter cms lint",
    "lint:fix": "pnpm --filter cms lint:fix",
    "format": "prettier --check .",
    "format:fix": "prettier --write .",
    "test": "pnpm --filter cms test",
    "test:integration": "pnpm --filter cms test:integration",
    "test:unit": "pnpm --filter cms test:unit",
    "typecheck": "pnpm --filter cms typecheck",
    "prisma:generate": "pnpm --filter cms prisma:generate",
    "prisma:migrate": "pnpm --filter cms prisma:migrate",
    "prisma:seed": "pnpm --filter cms prisma:seed",
    "prisma:seed:test": "pnpm --filter cms prisma:seed:test",
    "prisma:studio": "pnpm --filter cms prisma:studio",
    "prisma:studio:test": "pnpm --filter cms prisma:studio:test",
    "apikey:create": "pnpm --filter cms apikey:create",
    "apikey:list": "pnpm --filter cms apikey:list",
    "apikey:revoke": "pnpm --filter cms apikey:revoke",
    "content:export": "pnpm --filter cms content:export",
    "content:import": "pnpm --filter cms content:import",
    "content:validate": "pnpm --filter cms content:validate",
    "starters:build": "pnpm --filter cms starters:build",
    "starters:check": "pnpm --filter cms starters:check"
  },
  "devDependencies": {
    "lefthook": "^2.1.1",
    "prettier": "^3.8.1"
  }
}
```

- [ ] **Step 3: Re-install to pick up the workspace layout**

Run: `pnpm install`
Expected: pnpm detects `apps/cms`, links workspace packages, regenerates `node_modules/.pnpm/`. No errors.

- [ ] **Step 4: Verify both package.jsons**

Run: `cat package.json | grep '"name"'`
Expected: `"name": "boject-cms-workspace",`

Run: `cat apps/cms/package.json | grep '"name"'`
Expected: `"name": "cms",`

Run: `pnpm list --depth -1`
Expected: shows `boject-cms-workspace` at root and `cms@1.0.0` inside the workspace.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(restructure): split package.json into workspace root + apps/cms"
```

---

### Task 7: Move `starters/starters.test.ts` into `apps/cms/`

The `starters/` directory holds data + a test. The JSON bundles stay at the repo root so future packages can share them. The test moves into `apps/cms/` since its import target (`scripts/content-bundle/validate.ts`) now lives there.

**Files:**

- Move: `starters/starters.test.ts` → `apps/cms/starters.test.ts`
- Modify: `apps/cms/starters.test.ts` (update import paths)
- Modify: `apps/cms/vitest.config.ts` (update the `starters/**` glob)

- [ ] **Step 1: Move the file**

```bash
git mv starters/starters.test.ts apps/cms/starters.test.ts
```

- [ ] **Step 2: Update import paths inside `apps/cms/starters.test.ts`**

Open `apps/cms/starters.test.ts`. The current file content is:

```ts
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateBundle } from '../scripts/content-bundle/validate';

const here = new URL('.', import.meta.url).pathname;

const bundleFiles = readdirSync(here).filter((f) => f.endsWith('.boject.json'));
// ...describe block...
```

Two changes:

- The import `../scripts/content-bundle/validate` assumed the file lived inside `starters/`. Now the file is at `apps/cms/starters.test.ts` and `scripts/` is a sibling at `apps/cms/scripts/`. Change to `./scripts/content-bundle/validate`.
- `const here = new URL('.', import.meta.url).pathname` now resolves to `apps/cms/`, but the starter JSON files are at the repo root's `starters/` dir. Change to resolve upward.

The updated top of the file should read:

```ts
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateBundle } from './scripts/content-bundle/validate';

const here = new URL('../../starters/', import.meta.url).pathname;

const bundleFiles = readdirSync(here).filter((f) => f.endsWith('.boject.json'));
```

The rest of the file (the `describe`/`it.each` block) needs no changes — it uses `join(here, filename)` which continues to work once `here` points at the right directory.

- [ ] **Step 3: Update the vitest glob**

Open `apps/cms/vitest.config.ts`. In the `unit` project's `include` array, replace `'starters/**/*.test.ts'` with `'starters.test.ts'`. The final `include` should read:

```ts
include: [
  'scripts/**/*.test.ts',
  'starters.test.ts',
  'server/utils/**/*.test.ts',
  'utils/**/*.test.ts',
],
```

- [ ] **Step 4: Run the starter test to verify**

Run: `pnpm --filter cms test:unit -- starters.test`
Expected: test passes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(restructure): move starters.test.ts into apps/cms/"
```

---

### Task 8: Verify the full test suite, typecheck, and lint from the new layout

This is the big "did the restructure actually work?" gate.

- [ ] **Step 1: Re-install (ensures pnpm generates scripts for the new workspace paths)**

Run: `pnpm install`
Expected: success. `apps/cms/node_modules/` should exist (it's a symlink to `node_modules/.pnpm/`).

- [ ] **Step 2: Regenerate Prisma client in its new location**

Run: `pnpm prisma:generate`
Expected: `Generated Prisma Client` success message. `apps/cms/generated/prisma/client.ts` exists.

- [ ] **Step 3: Reset + seed the test database**

Run: `pnpm prisma:seed:test`
Expected: seed runs successfully against `boject_test`.

(Integration tests auto-reset via `vitest.globalSetup.ts`, but a manual seed now catches Prisma config issues earlier.)

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: no errors.

If typecheck fails on a path alias or relative import, stop and debug. Most likely causes:

- `tsconfig.json` extends path — should still be `./.nuxt/tsconfig.json`, unchanged (both moved together).
- `#prisma` / `#generated` aliases — resolved via `apps/cms/nuxt.config.ts`'s `__dirname`; should work.

- [ ] **Step 5: Run lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 6: Run full tests**

Run: `pnpm test`
Expected: all tests pass.

If a test fails on a path (e.g. the content-bundle fixture test reading from `fixtures/`), fix the path to be relative to its new location.

- [ ] **Step 7: Smoke-test the dev server**

Run: `pnpm dev` in one terminal; in another, `curl -s http://localhost:4000/api/health`
Expected: JSON with `status: "ok"` and a database connectivity field.

Stop the dev server (Ctrl-C).

- [ ] **Step 8: Commit (no code changes expected; this is a verification checkpoint)**

If anything was adjusted in Steps 4–6, the fixes belong in this commit:

```bash
git add -A
git commit -m "chore(restructure): fix paths surfaced by post-move test/typecheck runs" \
  --allow-empty
```

(`--allow-empty` covers the case where no fixes were needed — commit anyway so the "green after restructure" moment is recorded.)

---

### Task 9: Update `lefthook.yml` to use workspace-aware commands

Currently `lefthook.yml` calls `pnpm lint` / `pnpm typecheck` / `pnpm test`. All three still work because the workspace-root `package.json` forwards them. But the glob `{staged_files}` passed to Prettier needs to stay at repo-root scope (which it does — Prettier walks the whole tree from root).

The only adjustment needed is confirming the hooks still run correctly after the move. The file probably needs **no change** — verify first.

**Files:**

- Modify: `lefthook.yml` (only if the verification step fails)

- [ ] **Step 1: Stage a TS file inside `apps/cms/` to dry-run the hooks**

Run:

```bash
echo "" >> apps/cms/app.vue
git add apps/cms/app.vue
lefthook run pre-commit
```

Expected: `lint`, `format`, and `typecheck` all run and pass.

- [ ] **Step 2: Reset the stage**

Run:

```bash
git reset HEAD apps/cms/app.vue
git checkout -- apps/cms/app.vue
```

- [ ] **Step 3: If Step 1 passed, no commit needed for this task.**

If Step 1 failed (e.g. pnpm lint couldn't find the workspace), update `lefthook.yml`'s commands to use `pnpm --filter cms <cmd>` explicitly:

```yaml
pre-commit:
  parallel: true
  jobs:
    - name: lint
      glob: 'apps/cms/**/*.{js,mjs,ts,vue}'
      run: pnpm --filter cms lint

    - name: format
      glob: '*.{js,mjs,ts,vue,json,yml,yaml,css,scss,md}'
      exclude: 'pnpm-lock.yaml'
      run: pnpm prettier --check {staged_files}

    - name: typecheck
      glob: 'apps/cms/**/*.{ts,vue}'
      run: pnpm --filter cms typecheck

pre-push:
  jobs:
    - name: test
      run: pnpm --filter cms test
      skip:
        - run: test "$WALLABY_VERIFIED" = "1"
```

Then commit:

```bash
git add lefthook.yml
git commit -m "chore(restructure): scope lefthook hooks to apps/cms"
```

---

### Task 10: Update `.gitignore` for the new paths

The current `.gitignore` ignores `generated/`, `.nuxt/`, `storage/`, `.env`, etc. relative to repo root. After the move, those paths are under `apps/cms/`.

**Files:**

- Modify: `.gitignore`

- [ ] **Step 1: Replace `.gitignore` with the rescoped version**

The Nuxt-app-specific entries need `apps/cms/` prefixes; workspace-wide entries stay untouched. Replace `.gitignore` with exactly:

```gitignore
# Dependencies
node_modules/

# Environment variables (scoped to apps/cms now)
apps/cms/.env
apps/cms/.env.local
apps/cms/.env.*.local

# Build output
dist/
build/
*.tsbuildinfo

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

# OS files
.DS_Store
Thumbs.db

# IDE/Editor
.vscode/
.idea/
.mcp.json
*.swp
*.swo
*~
.project
.classpath
.settings/

# Testing
coverage/
.nyc_output/

# Temporary files
*.tmp
.cache/
.temp/

# Prisma + Pothos generated types
/apps/cms/generated

# Local image storage (dev)
apps/cms/storage/

# Nuxt
apps/cms/.nuxt/
apps/cms/.output/

# Claude Code host-local
.claude/*.lock
.claude/settings.local.json
.claude/worktrees/

# Git worktrees
.worktrees/
```

- [ ] **Step 2: Verify git still ignores the right files**

Run: `git status --ignored | grep apps/cms | head -20`
Expected: entries like `apps/cms/.nuxt/`, `apps/cms/generated/`, `apps/cms/storage/`, `apps/cms/.env` show up as ignored.

Run: `git check-ignore apps/cms/.env`
Expected: `apps/cms/.env` (matched).

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore(restructure): rescope .gitignore to apps/cms paths"
```

---

### Task 11: Update `CLAUDE.md` to reflect the new layout

`CLAUDE.md` has dozens of file-path references that all moved. Rewrite the affected sections.

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the "Commands" section**

The block at the top listing `pnpm install`, `pnpm dev`, etc. — most commands still work at root because the workspace forwards them. Confirm each command is still valid (they should be). Add a one-line note near the top:

```markdown
Note: commands run from the repo root forward to `apps/cms` via `pnpm --filter cms`.
The Nuxt app source, Prisma schema, and tests all live under `apps/cms/`.
```

- [ ] **Step 2: Update the "Architecture" section**

Replace any reference to repo-root paths with their new `apps/cms/` location. Key lines to update:

- `server/utils/prisma.ts` → `apps/cms/server/utils/prisma.ts`
- `prisma.config.ts` → `apps/cms/prisma.config.ts`
- `components/content-editor/ContentEditor.vue` → `apps/cms/components/content-editor/ContentEditor.vue`
- And so on for every `server/...`, `components/...`, `composables/...`, `pages/...`, `types/...`, `utils/...`, `middleware/...`, `layouts/...`, `scripts/...`, `prisma/...`, `generated/...`, `assets/...`, `starters/starters.test.ts` reference.

Use find-and-replace carefully: `server/` → `apps/cms/server/`, etc. Review the diff before committing.

- [ ] **Step 3: Update the "Key Files" section**

Same treatment — prefix every Nuxt-app file path with `apps/cms/`. `starters/*.boject.json` stay at root (no prefix). `docs/...`, `CLAUDE.md`, `README.md` stay at root (no prefix). `lefthook.yml`, `package.json` (root), `pnpm-workspace.yaml` stay at root.

Add a new entry for the workspace layout:

```markdown
- `apps/cms/` — the Nuxt app (every Nuxt-specific file lives here)
- `packages/` — empty; reserved for `create-boject-cms` and `boject-cli` (Plans B/C)
- `starters/` — shared starter bundle JSON files (data, not code)
```

- [ ] **Step 4: Update the "Testing" section**

If any test path is listed (e.g. "colocated with source files (e.g. `server/api/graphql/graphql.test.ts`)"), prefix with `apps/cms/`.

- [ ] **Step 5: Verify format**

Run: `pnpm prettier --check CLAUDE.md`
Expected: `All matched files use Prettier code style!`

If not: `pnpm prettier --write CLAUDE.md`.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(restructure): update CLAUDE.md paths for apps/cms layout"
```

---

### Task 12: Update `README.md` project structure section

`README.md` has a "Project Structure" tree and several path references.

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Replace the Project Structure tree**

Find the section starting `## Project Structure` and replace the tree with the new layout (shown in this plan's "Layout at a glance" section, adapted to README tone). Keep the narrative entries; only rewrite the tree.

- [ ] **Step 2: Update path references in "Key Files" and inline mentions**

Same find-and-replace as CLAUDE.md: `server/`, `components/`, `prisma/`, `scripts/`, `composables/`, `pages/`, etc. → prefix with `apps/cms/`. `starters/` JSON files unchanged. `docker-compose.yml`, `package.json` (root), `docs/` unchanged.

- [ ] **Step 3: Update the Getting Started block**

The commands in Getting Started should still work unchanged (they all forward through the workspace root). Add a note if helpful:

```markdown
All commands run from the repo root. The Nuxt app lives under `apps/cms/` — you shouldn't need to `cd` into it during normal development.
```

- [ ] **Step 4: Verify format**

Run: `pnpm prettier --check README.md`
Expected: passes. If not, `--write` to fix.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(restructure): update README project structure for monorepo"
```

---

### Task 13: Final verification — full green suite

One last pass with everything committed and the workspace settled.

**Files:** none

- [ ] **Step 1: Confirm clean working tree**

Run: `git status`
Expected: clean.

- [ ] **Step 2: Re-install from scratch (smoke test)**

Run:

```bash
rm -rf node_modules apps/cms/node_modules
pnpm install
```

Expected: pnpm resolves and installs cleanly. `apps/cms/node_modules/` is a symlink to `node_modules/.pnpm/`.

- [ ] **Step 3: Regenerate Prisma**

Run: `pnpm prisma:generate`
Expected: success.

- [ ] **Step 4: Full verification suite**

Run each in sequence and confirm all pass:

```bash
pnpm typecheck       # expect: no errors
pnpm lint            # expect: no errors
pnpm format          # expect: all files use Prettier code style
pnpm test:unit       # expect: all unit tests pass
pnpm test:integration # expect: all integration tests pass
```

(`pnpm test` runs both; running them separately isolates failures faster if anything broke.)

- [ ] **Step 5: Smoke-test the dev server one more time**

Run: `pnpm dev`
In another terminal: `curl -s http://localhost:4000/api/health | head -c 200`
Expected: JSON with `ok: true` and a database-reachable status.

Kill the server (Ctrl-C).

- [ ] **Step 6: Confirm `git log` shows a clean, reviewable sequence**

Run: `git log --oneline main.. | head -20`
Expected: a readable chain of commits, each with a clear `chore(restructure):` or `docs(restructure):` prefix. Each commit is independently reviewable.

- [ ] **Step 7: Done**

No final commit needed — everything was committed task-by-task. The branch is ready for PR review.

---

## Risks and mitigations

- **Risk:** Path aliases (`~/`, `@/`, `#prisma`, `#generated`) resolve incorrectly after the move.
  **Mitigation:** All aliases are defined relative to `nuxt.config.ts`'s `__dirname`. Since the config moves with the app, they keep resolving correctly. Task 8 catches any surviving issue.

- **Risk:** Lefthook hooks break because they call repo-root `pnpm` scripts.
  **Mitigation:** Task 9 explicitly dry-runs the hooks. Fallback command forms (`pnpm --filter cms ...`) are pre-written for the common failure mode.

- **Risk:** Integration tests fail because `vitest.globalSetup.ts` calls `pnpm prisma:seed` with the old path.
  **Mitigation:** The globalSetup calls `pnpm prisma:seed` from the repo root (via the shell). The workspace-root `package.json` forwards this to `pnpm --filter cms prisma:seed`, which runs the seed in `apps/cms/`. Tested in Task 8 Step 6.

- **Risk:** `.gitignore` misses a moved path and something sensitive (e.g. `.env`) gets committed.
  **Mitigation:** Task 10 explicitly verifies `git check-ignore apps/cms/.env` returns a match before committing.

- **Risk:** The `starters.test.ts` file's path arithmetic (repo-root starters data, relocated test) is wrong.
  **Mitigation:** Task 7 Step 4 runs the specific test as a gate before committing.

## Out of scope for this plan

- Publishing a Docker image, a Dockerfile, or changes to the existing `docker-compose.yml`. That's Plan B.
- Creating `create-boject-cms` or `boject-cli` packages. That's Plan C. Task 3 leaves `packages/` empty intentionally.
- Changing the starters directory. The JSON files stay exactly where they are, at the repo root.
- Renaming the workspace root package. Kept as `boject-cms-workspace` for clarity; the public package names land when Plan C publishes them.
- Migrating to Nx / Turborepo. Vanilla pnpm workspaces per the spec.
