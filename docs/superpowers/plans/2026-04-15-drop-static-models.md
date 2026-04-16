# Drop Static Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every hardcoded content model (Team, Club, Competition, Season, Fixture, Score, Player, PlayerTeamHistory, Position, Image, Author, Tag, TagGroup, Article, Link, Navigation, NavigationItem) and make `ContentType` / `ContentTypeField` / `ContentEntry` the sole content layer. After the dust settles, `starters/base.boject.json` is the canonical way to populate a fresh install.

**Architecture:** Top-down removal in dependency order. UI (pages, sidebar) → REST routes + their tests → GraphQL types/filters/queries → Prisma schema + client regen → drop migration → apply the base starter to verify the CMS runs end-to-end on dynamic types only. Each task leaves the repo in a typechecking, test-passing state so we can commit between steps.

**Tech Stack:** Nuxt 4, Nitro, Prisma 7 + `@prisma/adapter-pg`, Pothos (GraphQL), Vitest, pnpm. Runs against a cloned `boject_worktree` DB on the local Postgres container.

**Context:** See GitHub issue #44 for the scope summary. The worktree is `.worktrees/drop-static-models/` on branch `drop-static-models`, with its own `.env` pointing at `postgresql://boject:boject@localhost:5432/boject_worktree` (cloned from `boject` via `CREATE DATABASE ... TEMPLATE boject`).

**Out of scope:** production data migration, rebranding, building a new general-purpose starter CLI.

---

## File Structure

### Deleted (entire files/dirs)

**Prisma schema**

- `prisma/schema/team.prisma`
- `prisma/schema/club.prisma`
- `prisma/schema/competition.prisma`
- `prisma/schema/season.prisma`
- `prisma/schema/fixture.prisma`
- `prisma/schema/player.prisma`
- `prisma/schema/image.prisma`
- `prisma/schema/author.prisma`
- `prisma/schema/tag.prisma`
- `prisma/schema/tagGroup.prisma`
- `prisma/schema/article.prisma`
- `prisma/schema/link.prisma`
- `prisma/schema/navigation.prisma`
- `prisma/schema/navigationItem.prisma`

**GraphQL types**

- `server/graphql/types/image.ts`
- `server/graphql/types/position.ts`
- `server/graphql/types/season.ts`
- `server/graphql/types/team.ts`
- `server/graphql/types/club.ts`
- `server/graphql/types/competition.ts`
- `server/graphql/types/teamsOnCompetitions.ts`
- `server/graphql/types/player.ts`
- `server/graphql/types/playerTeamHistory.ts`
- `server/graphql/types/fixture.ts`
- `server/graphql/types/score.ts`
- `server/graphql/types/author.ts`
- `server/graphql/types/tag.ts`
- `server/graphql/types/tagGroup.ts`
- `server/graphql/types/article.ts`
- `server/graphql/types/link.ts`
- `server/graphql/types/navigationItem.ts`
- `server/graphql/types/navigation.ts`

**REST routes + tests**

- `server/api/teams.get.ts` and `server/api/teams/**`
- `server/api/clubs.get.ts` and `server/api/clubs/**`
- `server/api/competitions.get.ts` and `server/api/competitions/**`
- `server/api/seasons.get.ts` and `server/api/seasons/**`
- `server/api/fixtures.get.ts` and `server/api/fixtures/**`
- `server/api/players.get.ts` and `server/api/players/**`
- `server/api/positions/**`
- `server/api/images.get.ts` and `server/api/images/**` (keep `server/api/files/**` — unrelated to static Image model)
- `server/api/authors.get.ts` and `server/api/authors/**`
- `server/api/tags.get.ts` and `server/api/tags/**`
- `server/api/tag-groups.get.ts` and `server/api/tag-groups/**`
- `server/api/articles.get.ts` and `server/api/articles/**`
- `server/api/links.get.ts` and `server/api/links/**`
- `server/api/navigations.get.ts` and `server/api/navigations/**`
- `server/api/navigation-items.get.ts` and `server/api/navigation-items/**`
- `server/api/lists/lists.test.ts`

**CMS pages**

- `pages/teams/**`
- `pages/clubs/**`
- `pages/competitions/**`
- `pages/seasons/**`
- `pages/fixtures/**`
- `pages/players/**`
- `pages/images/**`
- `pages/authors/**`
- `pages/tags/**`
- `pages/tag-groups/**`
- `pages/articles/**`
- `pages/links/**`
- `pages/navigations/**`

**CmsEmbed (hardcoded-model-only feature)**

- `extensions/cmsEmbed.ts`
- `components/CmsEmbedNode.vue`
- `components/CmsEmbedModal.vue`

### Modified

- `prisma/seed.ts` — strip everything except User, ApiKey, and a minimal dev `ContentType` or import of `starters/base.boject.json`
- `prisma/schema/base.prisma` — unchanged (generators, datasource, `ContentStatus` enum still used by `ContentEntry`)
- `server/graphql/buildSchema.ts` — remove static-type/query/filter registrations
- `server/graphql/filters.ts` — delete `registerStaticFilters` (leave scalar filters only if `jsonbFilters.ts` needs them; otherwise delete the file and its re-exports)
- `server/graphql/query/index.ts` — delete `registerStaticQueries`; if the file becomes empty, delete it too
- `server/api/content.get.ts` — query `ContentEntry` only; drop the static `UNION ALL` branches
- `server/api/content/content.test.ts` — update expectations: no static-type cases, drop `contentType=Article` / `Team` / etc. tests
- `components/RichTextEditor.vue` — remove the CmsEmbed extension and any toolbar button that inserts it
- `layouts/default.vue` — remove the static per-model sidebar links (lines referencing `/teams`, `/clubs`, …, `/navigations`). Keep All Content + the dynamic Content Types block.
- `CLAUDE.md` — rewrite Architecture §Domain Models, §Dynamic Content Types, Key Files, and Testing sections to reflect the dynamic-only layer

### Created

- `prisma/migrations/<timestamp>_drop_static_models/migration.sql` — handwritten `DROP TABLE` migration (static tables only; `ContentType`, `ContentTypeField`, `ContentEntry`, `User`, `ApiKey` untouched; `ContentStatus` enum retained)

---

## Task 1: Guard the baseline

Verify the worktree is green before deleting anything. If the baseline is red, we can't tell whether a later failure is ours.

**Files:**

- None (sanity checks only)

- [ ] **Step 1: Confirm the worktree DB is the clone**

Run: `grep -c 'boject_worktree' .env`
Expected: `1` (the `DATABASE_URL` line has been rewritten).

- [ ] **Step 2: Confirm Prisma generate works**

Run: `pnpm prisma:generate`
Expected: exits 0; `generated/prisma/client.ts` present.

- [ ] **Step 3: Confirm typecheck passes**

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 4: Confirm tests pass**

Run: `pnpm test:run 2>&1 | tail -20`
Expected: no failing suites. If tests don't currently all pass on `main`, note which suites fail and skip only those going forward — everything else must stay green.

- [ ] **Step 5: Commit**

```bash
git status
```

Expected: clean working tree. No commit needed — this task is verification-only.

---

## Task 2: Strip the seed of static-model content

The seed currently seeds 13 static tables. Once those Prisma models are gone, the seed file won't compile. Strip it now so every subsequent `prisma migrate reset` / `pnpm prisma:seed` still runs.

**Files:**

- Modify: `prisma/seed.ts`

- [ ] **Step 1: Replace `prisma/seed.ts` with a dynamic-only seed**

The new seed must:

1. Seed the `admin@example.com` / `password` user (use the existing `hashPasswordForSeed`).
2. Seed the deterministic test API key (`boject_test_key_for_integration_tests_only`) into `ApiKey`.
3. Do **nothing else** — no static-model calls, no content-type seeding. The dev DB gets its content types via `pnpm content:import starters/base.boject.json --all` which is documented in `CLAUDE.md`.

Rewrite the file to:

```ts
import 'dotenv/config';
import {
  createHash,
  randomBytes,
  scrypt as scryptCb,
  type ScryptOptions,
} from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keyLength, options, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

async function hashPasswordForSeed(password: string): Promise<string> {
  const n = 16384;
  const r = 8;
  const p = 1;
  const keyLength = 64;
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, keyLength, {
    cost: n,
    blockSize: r,
    parallelization: p,
    maxmem: 32 * 1024 * 1024,
  });
  const saltB64 = salt.toString('base64').replace(/=+$/, '');
  const hashB64 = derived.toString('base64').replace(/=+$/, '');
  return `$scrypt$n=${n},r=${r},p=${p}$${saltB64}$${hashB64}`;
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = process.env.INTEGRATION_TEST_USERNAME ?? 'admin@example.com';
  const password = process.env.INTEGRATION_TEST_PASSWORD ?? 'password';

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      password: await hashPasswordForSeed(password),
      firstName: 'Admin',
      lastName: 'User',
    },
  });

  const rawKey = 'boject_test_key_for_integration_tests_only';
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 11);
  await prisma.apiKey.upsert({
    where: { keyHash },
    update: { revokedAt: null },
    create: {
      name: 'Integration tests',
      keyHash,
      keyPrefix,
    },
  });

  console.log('Seed complete (user + test API key).');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Run the seed against the cloned DB**

Run: `pnpm prisma:seed`
Expected: "Seed complete (user + test API key)." — no errors. (The static tables still exist in the clone at this point; the seed just doesn't touch them.)

- [ ] **Step 3: Commit**

```bash
git add prisma/seed.ts
git commit -m "Strip seed of static-model content"
```

---

## Task 3: Delete CmsEmbed

CmsEmbed hits `/api/${embedType}s/${embedId}` for `team`/`club`/`competition`/`season` — all models about to be deleted. The dynamic editor already has RELATION / MULTIRELATION fields + `EntryPickerModal` for inline references.

**Files:**

- Delete: `extensions/cmsEmbed.ts`
- Delete: `components/CmsEmbedNode.vue`
- Delete: `components/CmsEmbedModal.vue`
- Modify: `components/RichTextEditor.vue`
- Modify: `scripts/content-bundle/portable.ts` (the cmsEmbed walker becomes a no-op over `type === 'cmsEmbed'` nodes — just delete the walker branch if present)

- [ ] **Step 1: Grep for every CmsEmbed reference**

Run: `grep -rn "CmsEmbed\|cmsEmbed" --include="*.ts" --include="*.vue" .`
Capture the file list. Anything outside the three component/extension files and `RichTextEditor.vue` + `portable.ts` must be re-checked manually.

- [ ] **Step 2: Delete the three files**

```bash
rm extensions/cmsEmbed.ts components/CmsEmbedNode.vue components/CmsEmbedModal.vue
```

- [ ] **Step 3: Remove CmsEmbed from `components/RichTextEditor.vue`**

Open the file and remove:

- The `import ... from '../extensions/cmsEmbed'` line (and any related import).
- The `CmsEmbed` / `CmsEmbedModal` entries in the `extensions: [...]` Tiptap config.
- Any toolbar button / handler that inserts a `cmsEmbed` node (e.g. a `+ Content` button).
- Any `CmsEmbedModal` usage in the template.

- [ ] **Step 4: Update `scripts/content-bundle/portable.ts`**

Find the RICHTEXT walker that handles `node.type === 'cmsEmbed'`. Delete that branch entirely (the walker can still traverse other node types, but it no longer needs to rewrite CmsEmbed ids). If the walker existed _only_ for CmsEmbed, delete the walker and any calls to it, and adjust the exported `encodeDataRefs` / `decodeDataRefs` signatures to match.

- [ ] **Step 5: Regrep to confirm clean**

Run: `grep -rn "CmsEmbed\|cmsEmbed" --include="*.ts" --include="*.vue" .`
Expected: no matches.

- [ ] **Step 6: Verify typecheck + tests**

Run: `pnpm typecheck && pnpm test:run 2>&1 | tail -10`
Expected: exit 0. Editor still opens, bundle tests still pass (the bundles in `fixtures/` don't use cmsEmbed).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Remove CmsEmbed editor extension and modal"
```

---

## Task 4: Rewrite `content.get.ts` to ContentEntry-only

`/api/content` currently UNIONs 13 static tables with `ContentEntry`. After table drop those UNION branches crash. Cut them now while the static tables still exist — lets us verify the ContentEntry-only implementation before the schema changes.

**Files:**

- Modify: `server/api/content.get.ts`
- Modify: `server/api/content/content.test.ts`

- [ ] **Step 1: Rewrite the handler**

Replace the contents of `server/api/content.get.ts` with:

```ts
import { Prisma } from '#prisma';

const VALID_STATUSES = new Set<string>([
  'DRAFT',
  'PUBLISHED',
  'CHANGED',
  'ARCHIVED',
]);

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 15));
  const offset = (page - 1) * perPage;

  const status =
    typeof query.status === 'string' && VALID_STATUSES.has(query.status)
      ? query.status
      : null;

  let contentTypeId: string | null = null;
  if (typeof query.contentType === 'string' && query.contentType.length > 0) {
    const ct = await prisma.contentType.findUnique({
      where: { identifier: query.contentType },
      select: { id: true },
    });
    if (ct) contentTypeId = ct.id;
    else return { items: [], total: 0 };
  }

  const where: Prisma.ContentEntryWhereInput = {};
  if (contentTypeId) where.contentTypeId = contentTypeId;
  if (status) where.status = status as Prisma.EnumContentStatusFilter['equals'];

  const [rows, total] = await Promise.all([
    prisma.contentEntry.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: offset,
      take: perPage,
      select: {
        id: true,
        entryTitle: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        contentType: { select: { name: true } },
      },
    }),
    prisma.contentEntry.count({ where }),
  ]);

  const items = rows.map((r) => ({
    id: r.id,
    entryTitle: r.entryTitle,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    contentType: r.contentType.name,
  }));

  return { items, total };
});
```

Notes:

- An unknown `contentType` identifier now returns `{ items: [], total: 0 }` (was: "ignore filter and return everything"). That's the correct behaviour for the new shape — there is no "all static tables" fallback anymore.
- The response shape (`items[].contentType` as a display name string) is preserved.

- [ ] **Step 2: Update the content endpoint tests**

Edit `server/api/content/content.test.ts`:

- Delete every test case that filters by a static table name (`contentType=Team`, `Club`, `Article`, `Link`, `Navigation`, etc.).
- Keep tests that filter by dynamic identifiers (seed the necessary ContentType + entries in `beforeAll`).
- Add one test: `GET /api/content?contentType=DoesNotExist` returns `{ items: [], total: 0 }`.
- Add one test: `GET /api/content?status=PUBLISHED` returns only published dynamic entries and each item has a `contentType` string (not `undefined`).

After editing, the file should have no references to `prisma.team`, `prisma.club`, `prisma.article`, etc. in its setup.

- [ ] **Step 3: Run the content tests**

Run: `pnpm vitest run server/api/content/content.test.ts`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/api/content.get.ts server/api/content/content.test.ts
git commit -m "Rewrite /api/content to query ContentEntry only"
```

---

## Task 5: Delete the CMS pages and trim the sidebar

Removing UI first means the REST/GraphQL deletions don't break pages we'd then have to delete anyway.

**Files:**

- Delete: `pages/teams/`, `pages/clubs/`, `pages/competitions/`, `pages/seasons/`, `pages/fixtures/`, `pages/players/`, `pages/images/`, `pages/authors/`, `pages/tags/`, `pages/tag-groups/`, `pages/articles/`, `pages/links/`, `pages/navigations/`
- Modify: `layouts/default.vue`

- [ ] **Step 1: Delete the static-model page directories**

```bash
rm -rf pages/teams pages/clubs pages/competitions pages/seasons pages/fixtures \
       pages/players pages/images pages/authors pages/tags pages/tag-groups \
       pages/articles pages/links pages/navigations
```

- [ ] **Step 2: Trim the sidebar in `layouts/default.vue`**

Open `layouts/default.vue`. In the primary sidebar nav array, delete the entries for:
`Teams, Players, Fixtures, Clubs, Competitions, Seasons, Images, Articles, Authors, Tags, Tag Groups, Links, Navigations`.

The remaining nav should be:

```ts
const primaryNav = [
  { label: 'All Content', icon: 'i-lucide-layout-grid', to: '/' },
];
```

Leave the dynamic "Content Types" block (fetched from `/api/content-types`) completely untouched — that's the post-migration navigation story.

- [ ] **Step 3: Verify build still boots**

Run: `pnpm dev` in one shell; in another, run `curl -s http://localhost:4000/ -o /dev/null -w '%{http_code}\n'` then stop the dev server. A `200` or `302` (redirect to `/login`) is fine. Any 500 means something still imports a deleted page — grep for the offending name.

Alternative non-interactive check: `pnpm build 2>&1 | tail -20` should exit 0.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Delete static-model CMS pages and trim sidebar"
```

---

## Task 6: Delete the REST routes and per-model tests

The REST layer is the easiest to prune because nothing Vue-side imports the handlers — Nitro auto-registers them.

**Files:**

- Delete (entire directories and the matching `.get.ts` entry routes):
  - `server/api/teams/` + `server/api/teams.get.ts`
  - `server/api/clubs/` + `server/api/clubs.get.ts`
  - `server/api/competitions/` + `server/api/competitions.get.ts`
  - `server/api/seasons/` + `server/api/seasons.get.ts`
  - `server/api/fixtures/` + `server/api/fixtures.get.ts`
  - `server/api/players/` + `server/api/players.get.ts`
  - `server/api/positions/`
  - `server/api/images/` + `server/api/images.get.ts`
  - `server/api/authors/` + `server/api/authors.get.ts`
  - `server/api/tags/` + `server/api/tags.get.ts`
  - `server/api/tag-groups/` + `server/api/tag-groups.get.ts`
  - `server/api/articles/` + `server/api/articles.get.ts`
  - `server/api/links/` + `server/api/links.get.ts`
  - `server/api/navigations/` + `server/api/navigations.get.ts`
  - `server/api/navigation-items/` + `server/api/navigation-items.get.ts`
  - `server/api/lists/lists.test.ts` (the directory may now be empty — delete it too)
- Keep: `server/api/files/**` (primitive file pipeline — survives).
- Keep: `server/api/content-entries*`, `server/api/content-types*`, `server/api/content.get.ts`, `server/api/auth/**`, `server/api/graphql/**`, `server/api/health.get.ts`.

- [ ] **Step 1: Delete the route files and directories**

```bash
rm -rf server/api/teams server/api/clubs server/api/competitions \
       server/api/seasons server/api/fixtures server/api/players \
       server/api/positions server/api/images server/api/authors \
       server/api/tags server/api/tag-groups server/api/articles \
       server/api/links server/api/navigations server/api/navigation-items \
       server/api/lists

rm -f server/api/teams.get.ts server/api/clubs.get.ts \
      server/api/competitions.get.ts server/api/seasons.get.ts \
      server/api/fixtures.get.ts server/api/players.get.ts \
      server/api/images.get.ts server/api/authors.get.ts \
      server/api/tags.get.ts server/api/tag-groups.get.ts \
      server/api/articles.get.ts server/api/links.get.ts \
      server/api/navigations.get.ts server/api/navigation-items.get.ts
```

- [ ] **Step 2: Grep for leftover references**

Run: `grep -rn "'/api/\(teams\|clubs\|competitions\|seasons\|fixtures\|players\|positions\|images\|authors\|tags\|tag-groups\|articles\|links\|navigations\|navigation-items\)" --include="*.ts" --include="*.vue" .`
Expected: no matches outside of deleted files (the grep runs against the working tree). If anything in `components/` or `composables/` still calls these, fix or delete those files.

Also grep for the singular `prisma.team.`, `prisma.article.`, etc.:

Run: `grep -rn "prisma\.\(team\|club\|competition\|season\|fixture\|score\|player\|playerTeamHistory\|position\|image\|author\|authorSocialLink\|tag\|tagGroup\|article\|link\|navigation\|navigationItem\)\." --include="*.ts" .`
Expected: matches only in `scripts/content-bundle/` test fixtures (if any) or files you haven't touched yet (GraphQL types — next task). No matches in `server/api/`.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0. If it fails, the failing file is importing one of the deleted routes/types — fix or delete it.

- [ ] **Step 4: Run the dynamic-content tests**

Run: `pnpm vitest run server/api/content-types server/api/content-entries server/api/content`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Delete static-model REST routes and integration tests"
```

---

## Task 7: Delete the GraphQL static layer

**Files:**

- Delete every file in `server/graphql/types/` except `contentFields.ts`, `contentStatus.ts` (the three files the dynamic layer needs).
- Delete: `server/graphql/filters.ts` (entirely — scalar filters are re-declared by `dynamicTypes.ts` if needed)
- Delete or empty: `server/graphql/query/index.ts` (delete if empty after changes)
- Modify: `server/graphql/buildSchema.ts`
- Delete: `server/api/graphql/graphql.test.ts` tests that assert static-model queries; keep any that assert auth / dynamic-type behaviour

- [ ] **Step 1: Check what `dynamicTypes.ts` actually needs**

Run: `grep -n "from './filters'\|from './query\|ContentStatusEnum\|from './types/" server/graphql/dynamicTypes.ts`
Capture the imports. If `dynamicTypes.ts` imports anything from `./filters` or `./query/index`, those pieces must be preserved (or inlined into `dynamicTypes.ts`). Most likely it only needs `ContentStatusEnum` — in which case the filter file can be deleted.

- [ ] **Step 2: Delete the static type files**

```bash
cd server/graphql/types
rm image.ts position.ts season.ts team.ts club.ts competition.ts \
   teamsOnCompetitions.ts player.ts playerTeamHistory.ts fixture.ts \
   score.ts author.ts tag.ts tagGroup.ts article.ts link.ts \
   navigationItem.ts navigation.ts
cd ../../..
```

Remaining files in `server/graphql/types/` must be: `contentFields.ts`, `contentStatus.ts`.

If `contentFields.ts` is only used by the deleted static types (grep it), delete it too.

- [ ] **Step 3: Delete static filters and queries**

```bash
rm server/graphql/filters.ts
rm server/graphql/query/index.ts
rmdir server/graphql/query 2>/dev/null || true
```

- [ ] **Step 4: Rewrite `buildSchema.ts`**

Replace with:

```ts
import type { GraphQLSchema } from 'graphql';
import { createBuilder } from './builder';
import { registerContentStatusEnum } from './types/contentStatus';
import { registerDynamicTypes } from './dynamicTypes';
import { prisma } from '../utils/prisma';

export async function buildSchema(): Promise<GraphQLSchema> {
  const builder = createBuilder();

  const ContentStatusEnum = registerContentStatusEnum(builder);

  const contentTypes = await prisma.contentType.findMany({
    include: { fields: { orderBy: { order: 'asc' } } },
  });
  registerDynamicTypes(builder, contentTypes, ContentStatusEnum);

  return builder.toSchema();
}
```

- [ ] **Step 5: Check `builder.ts`**

Open `server/graphql/builder.ts`. If it registers the `JSON` scalar solely for the removed `Article.body` field, leave it — `RICHTEXT` dynamic fields still need `JSON`. If it references any static Prisma model (e.g. `Article` in a plugin config), remove those references.

- [ ] **Step 6: Update `server/api/graphql/graphql.test.ts`**

Delete every test that queries a static root field (`teams`, `clubs`, `articles`, `authors`, `tags`, `fixtures`, `players`, `links`, `navigations`, `images`, `positions`, `seasons`, `competitions`, `scores`).

Keep tests that verify:

- API-key auth (missing key → 401, valid key → 200, revoked key → 401)
- GET request gating in dev
- Dynamic content-type root fields (seed a ContentType in `beforeAll`, then query it)
- The `ContentStatus` enum exposure

If after trimming the file is empty, leave a single auth-gate test (since that behaviour is independent of schema content).

- [ ] **Step 7: Regenerate Prisma client + Pothos types**

Run: `pnpm prisma:generate`
Expected: exit 0. (We haven't dropped the Prisma models yet, so the generated client still has `prisma.team` etc. — that's fine; nothing imports them anymore after this task.)

- [ ] **Step 8: Typecheck and run tests**

Run: `pnpm typecheck && pnpm test:run 2>&1 | tail -20`
Expected: exit 0, all remaining tests pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Delete static-model GraphQL types, filters, queries"
```

---

## Task 8: Drop the static Prisma models

Schema file deletion + a handwritten migration to drop the tables. Split in two: delete schema files, then write the migration.

**Files:**

- Delete: `prisma/schema/{team,club,competition,season,fixture,player,image,author,tag,tagGroup,article,link,navigation,navigationItem}.prisma`
- Keep: `prisma/schema/base.prisma`, `auth.prisma`, `contentType.prisma`, `contentEntry.prisma`
- Create: `prisma/migrations/<timestamp>_drop_static_models/migration.sql`

- [ ] **Step 1: Inspect `base.prisma`**

Read `prisma/schema/base.prisma`. Confirm it defines:

- generator
- datasource
- `ContentStatus` enum
- `FieldType` enum
- `ScoreType` enum (**to remove** — `ScoreType` is only used by the deleted `Score` model)

Remove the `ScoreType` enum definition from `base.prisma`. Leave `ContentStatus` and `FieldType`.

- [ ] **Step 2: Delete the static schema files**

```bash
cd prisma/schema
rm team.prisma club.prisma competition.prisma season.prisma fixture.prisma \
   player.prisma image.prisma author.prisma tag.prisma tagGroup.prisma \
   article.prisma link.prisma navigation.prisma navigationItem.prisma
cd ../..
```

Remaining: `base.prisma`, `auth.prisma`, `contentType.prisma`, `contentEntry.prisma`.

- [ ] **Step 3: Diff the schema vs the DB**

Run: `pnpx prisma migrate diff --from-schema-datasource prisma/schema --to-schema-datamodel prisma/schema --script`

Expected output is empty — the diff is _from_ the DB _to_ the (new) schema, so we need the **opposite** direction. Use:

Run: `pnpx prisma migrate diff --from-schema-datamodel prisma/schema --to-schema-datasource prisma/schema --script > /tmp/drop-migration.sql`

Read `/tmp/drop-migration.sql` — this is the SQL to go _from_ the new datamodel _back to_ the DB (i.e. the inverse of what we want). Invert it manually in the next step.

Actually the simpler invocation is: `--from-schema-datasource` = current DB, `--to-schema-datamodel` = target. So:

Run: `pnpx prisma migrate diff --from-schema-datasource prisma/schema --to-schema-datamodel prisma/schema --script > /tmp/drop-migration.sql`

Inspect `/tmp/drop-migration.sql`. It should contain a sequence of `DROP TABLE`, `DROP TYPE "ScoreType"`, and possibly `ALTER TABLE ... DROP CONSTRAINT` statements for the 14 dropped models.

- [ ] **Step 4: Create the migration directory and SQL file**

```bash
TS=$(date +%Y%m%d%H%M%S)
mkdir -p "prisma/migrations/${TS}_drop_static_models"
cp /tmp/drop-migration.sql "prisma/migrations/${TS}_drop_static_models/migration.sql"
```

Open the new `migration.sql` and verify it only drops:

- Tables: `Team`, `Club`, `Competition`, `Season`, `Fixture`, `Score`, `Player`, `PlayerTeamHistory`, `Position`, `Image`, `Author`, `AuthorSocialLink`, `Tag`, `TagGroup`, `Article`, `Link`, `Navigation`, `NavigationItem`, `TeamsOnCompetitions`, `_ArticleToTag` (Prisma implicit join)
- Types: `ScoreType`
- Any foreign-key constraints + indexes that reference the above

It must **not** touch: `User`, `ApiKey`, `ContentType`, `ContentTypeField`, `ContentEntry`, `ContentStatus`, `FieldType`, `_prisma_migrations`.

If the diff includes anything else, manually edit the file to the intended subset.

- [ ] **Step 5: Apply the migration to the worktree DB**

Run: `pnpx prisma migrate deploy`
Expected: "1 migration applied." — the new migration is the only pending one.

Verify: `docker exec boject-cms-db-1 psql -U boject -d boject_worktree -c "\dt"` — remaining tables should be `User`, `ApiKey`, `ContentType`, `ContentTypeField`, `ContentEntry`, `_prisma_migrations`.

- [ ] **Step 6: Regenerate Prisma client**

Run: `pnpm prisma:generate`
Expected: exit 0. `generated/prisma/client.ts` no longer contains `prisma.team`, `prisma.article`, etc.

- [ ] **Step 7: Typecheck + tests**

Run: `pnpm typecheck && pnpm test:run 2>&1 | tail -20`
Expected: exit 0, all tests pass. If a test references a deleted model, delete/fix that test — it's orphaned.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema prisma/migrations
git commit -m "Drop static content model tables"
```

---

## Task 9: Verify `content:import starters/base.boject.json`

End-to-end check: a fresh DB + the base starter gives a functioning CMS.

**Files:**

- None (verification only)

- [ ] **Step 1: Reset the worktree DB to empty**

Terminate any active connections, then drop-and-recreate from template0:

```bash
docker exec boject-cms-db-1 psql -U boject -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'boject_worktree' AND pid <> pg_backend_pid();"
docker exec boject-cms-db-1 psql -U boject -d postgres -c "DROP DATABASE boject_worktree;"
docker exec boject-cms-db-1 psql -U boject -d postgres -c "CREATE DATABASE boject_worktree;"
```

- [ ] **Step 2: Apply migrations fresh**

Run: `pnpx prisma migrate deploy`
Expected: every migration in `prisma/migrations/` applied in order; the final state has only `User`, `ApiKey`, `ContentType`, `ContentTypeField`, `ContentEntry`, `_prisma_migrations`.

- [ ] **Step 3: Seed**

Run: `pnpm prisma:seed`
Expected: "Seed complete (user + test API key)."

- [ ] **Step 4: Import the base starter**

Run: `pnpm content:import starters/base.boject.json --all`
Expected: successful import report ("8 content types created, 1 entry created" or similar).

Verify:

```bash
docker exec boject-cms-db-1 psql -U boject -d boject_worktree -c 'SELECT identifier FROM "ContentType" ORDER BY identifier;'
```

Expected output: `Article, Author, Image, Navigation, NavigationItem, Page, SiteSettings, Tag`.

- [ ] **Step 5: Smoke-test the CMS via the dev server**

Run: `pnpm dev` in the background.

```bash
pnpm dev &
sleep 5
curl -s http://localhost:4000/api/content-types -H "Cookie: $(...)" | jq 'length'
```

(Skip the auth dance if it's painful — the real proof is that the server boots without any reference to a dropped table. Watch the dev-server logs for Prisma errors for ~30s, then kill it.)

Alternative: run the full test suite one more time:

Run: `pnpm test:run 2>&1 | tail -30`
Expected: all tests pass.

- [ ] **Step 6: No commit needed** (verification step). If any fix was required to reach green, fold it into the appropriate earlier task and re-run from the point of the change.

---

## Task 10: Update `CLAUDE.md` and related docs

The project description, the architecture blurb, and the Key Files list are now largely wrong. Rewrite the sections that refer to the deleted code.

**Files:**

- Modify: `CLAUDE.md`
- Modify: `README.md` (only if it references the deleted rugby models)

- [ ] **Step 1: Rewrite the `## Project` line**

From `TypeScript CMS for a rugby club…` to something accurate for the post-migration state, e.g. `General-purpose TypeScript headless CMS built with Nuxt 4 (Vue) and Prisma 7 on PostgreSQL. Content is modelled entirely via user-defined ContentTypes (no hardcoded rugby/content models).`

- [ ] **Step 2: Delete the `### Domain Models` section**

The whole subsection under `## Database Schema` listing Team/Club/Player/Fixture/etc. — delete it.

- [ ] **Step 3: Update `### Content Metadata`**

Currently lists metadata on "Content models (Team, Club, …, Navigation)". Rewrite to describe the metadata fields on `ContentEntry` only.

- [ ] **Step 4: Delete/trim the `### Users & API Keys` paragraph**

It's fine — nothing there is going away. Leave it.

- [ ] **Step 5: Update the `## GraphQL` section**

- Remove every reference to static-model queries, `LinkTarget` union, `ArticleRef`, `FixtureWhere`, `ArticleWhere`, `TeamsOnCompetitions`, etc.
- Rewrite to describe the dynamic-only GraphQL surface: schema is built from `ContentType` rows at startup; each ContentType becomes a GraphQL type via `registerDynamicTypes`; auth gate via API key is unchanged.

- [ ] **Step 6: Trim the `### REST API filtering` bullet**

Delete the per-endpoint filter list (fixtures/players/competitions/etc.). Replace with a single paragraph about `/api/content-entries` and `/api/content` filters only.

- [ ] **Step 7: Delete the `## Key Files` entries for deleted files**

Every bullet referring to a deleted page / route / type file goes. Keep entries for the dynamic layer, auth, files pipeline, starters, content-bundle CLI, middleware, tests that survived.

- [ ] **Step 8: Update the `## Testing` section**

Remove test-count bullets for fixtures/lists/authors/tags/articles/links/navigations/images-via-static. Keep: GraphQL (update count after trimming), Auth, Content, Files, ContentTypes, ContentEntries.

- [ ] **Step 9: Update `prisma/schema/` listing in Architecture**

Currently enumerates 16 schema files. Change to the remaining four: `base.prisma, auth.prisma, contentType.prisma, contentEntry.prisma`.

- [ ] **Step 10: Grep `README.md` for rugby references**

Run: `grep -in "rugby\|team\|fixture\|club" README.md || true`
If anything in the README describes rugby-specific features, update it or flag as follow-up.

- [ ] **Step 11: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "Update CLAUDE.md and README for dynamic-only content layer"
```

---

## Task 11: Final verification

One clean slate full run before declaring done.

**Files:**

- None

- [ ] **Step 1: Full typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 2: Full lint**

Run: `pnpm lint`
Expected: exit 0. Fix any unused imports left behind by the deletions.

- [ ] **Step 3: Full test suite**

Run: `pnpm test:run`
Expected: exit 0.

- [ ] **Step 4: Reset DB and full reseed/import flow**

```bash
docker exec boject-cms-db-1 psql -U boject -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'boject_worktree' AND pid <> pg_backend_pid();"
docker exec boject-cms-db-1 psql -U boject -d postgres -c "DROP DATABASE boject_worktree;"
docker exec boject-cms-db-1 psql -U boject -d postgres -c "CREATE DATABASE boject_worktree;"
pnpx prisma migrate deploy
pnpm prisma:seed
pnpm content:import starters/base.boject.json --all
```

Expected: each step exits 0 and the final state has 8 ContentTypes + 1 ContentEntry (SiteSettings).

- [ ] **Step 5: Smoke-test the dev server**

Run: `pnpm dev` in a background shell, tail the logs for ~30 seconds. Visit `/` (redirects to `/login`), log in as `admin@example.com` / `password`, confirm the "All Content" page lists the SiteSettings entry, and the sidebar shows the 8 ContentType links.

Kill the dev server.

- [ ] **Step 6: Push-ready check**

```bash
git log --oneline main..HEAD
```

Expected: one commit per task (10 commits). If anything needs a squash, do it now. Plan is complete — PR against `main` referencing issue #44.

---

## Self-Review

**Spec coverage:**

- Prisma schema deletion → Task 8
- GraphQL types / filters / queries deletion → Task 7
- REST routes + tests deletion → Task 6
- CMS pages deletion + sidebar trim → Task 5
- `content.get.ts` rewrite → Task 4
- Seed rewrite → Task 2
- CmsEmbed cleanup → Task 3
- Drop-table migration → Task 8 Step 3–5
- Prisma regenerate → Task 7 Step 7 and Task 8 Step 6
- Base starter import → Task 9
- CLAUDE.md / README update → Task 10
- Final verification → Task 11

All gotchas from issue #44 are covered: seed updated _before_ migration (Task 2), Prisma regenerate called at both the GraphQL-cleanup and schema-drop boundaries, `content.get.ts` rewrite happens before tables disappear, CmsEmbed removed.

**Placeholder scan:** No `TBD`, `TODO`, "implement later", "similar to Task N", or unshown code blocks. The one handwave is Task 8 Step 3 where the exact Prisma `migrate diff` invocation may need tweaking based on the actual output — the plan acknowledges this and says to inspect + hand-edit. That's the safer option than prescribing an SQL blob that might not match.

**Type consistency:** `contentTypeId` / `ContentEntry` / `ContentType` / `ContentTypeField` names consistent across tasks. `buildSchema()` export preserved. `registerDynamicTypes(builder, contentTypes, ContentStatusEnum)` signature preserved in Task 7 Step 4.
