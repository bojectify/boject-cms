# GraphQL Relation Where Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let GraphQL clients filter dynamic-type list queries by RELATION and MULTIRELATION field values, so a sport-site frontend can ask "all `Player`s where `team = $teamId`", "all `Article`s tagged with any of `[$tagId1, $tagId2]`", and "all `Player`s with no team set" without N+1 client-side filtering.

**Architecture:** Two new Pothos input types (`DynRelationFilter`, `DynMultirelationFilter`) are registered in `jsonbFilters.ts` and exposed on each per-type `<Type>Where` input alongside the existing scalar filters. The `queryDynamicEntries` SQL builder learns to translate them into JSONB predicates against `ContentEntryVersion.data`. A single GIN index on `ContentEntryVersion(data jsonb_path_ops)` is added in a new Prisma migration so MULTIRELATION containment queries can use index lookups as content grows. No new tables, no schema rebuild triggers (existing `invalidateSchema()` already covers RELATION/MULTIRELATION field changes).

**Tech Stack:** Pothos schema builder, GraphQL Yoga, Prisma `$queryRaw` with `Prisma.sql` template tags, PostgreSQL JSONB operators (`->`, `->>`, `@>`, `jsonb_array_elements`).

**Non-goals:**

- REST endpoint filtering (`/api/content`, `/api/content-entries`) — GraphQL only.
- Cross-type relation filters on `contentEntryList` — system-field-only as today.
- Reverse-traversal `linkedFrom` — explicitly deferred per the brainstorm.
- RICHTEXT body reference filtering — explicitly deferred. Editors who need "carousel of related news on a player page" should add a `MULTIRELATION` field (e.g. `Article.associatedPlayers`) and use `containsAny`.

---

## File Structure

**Modify:**

- `apps/cms/server/graphql/jsonbFilters.ts` — register `DynRelationFilter` + `DynMultirelationFilter`; extend `FIELD_TYPE_TO_FILTER_KEY`; extend `queryDynamicEntries` with RELATION + MULTIRELATION SQL.
- `apps/cms/server/graphql/dynamicTypes.ts` — `filterableFields` filter currently rejects RELATION/MULTIRELATION via `getFilterKeyForFieldType` returning `null`. Once the keys exist, no code change is needed there — but verify the Where input now includes them.
- `CLAUDE.md` — document the new filter operators in the "GraphQL" / "Where filtering" entry.

**Create:**

- `apps/cms/prisma/migrations/20260430120000_add_content_entry_version_data_gin/migration.sql` — `CREATE INDEX CONCURRENTLY` on `ContentEntryVersion(data jsonb_path_ops)`.

**Test:**

- `apps/cms/server/api/graphql/graphql.test.ts` — new `describe('Relation filtering', ...)` block with self-contained Player/Team/Tag fixtures.

---

## Filter shape (locked)

```graphql
input DynRelationFilter {
  equals: ID # entryId == value
  in: [ID!] # entryId IN (...)
  isNull: Boolean # true → field missing/null/no entryId; false → field has any entryId
}

input DynMultirelationFilter {
  contains: ID # array contains a ref with this entryId
  containsAny: [ID!] # array contains any of these entryIds
  containsAll: [ID!] # array contains all of these entryIds
  isEmpty: Boolean # true → field missing/null/empty array
}
```

Reasoning for the surface:

- We filter by `entryId` only, never `contentTypeId`. UUIDs are globally unique, and the field's own `targetContentTypeIds` already constrains which type the id belongs to. Adding `contentTypeId` would be redundant.
- All filters compose via AND with sibling fields, matching the existing pattern.
- `isNull: false` is supported but uncommon; documented for completeness.

---

## Task 1: Register `DynRelationFilter` and `DynMultirelationFilter` input types

**Files:**

- Modify: `apps/cms/server/graphql/jsonbFilters.ts:11-57` (the `registerDynamicFilterInputs` function and its return value).

- [ ] **Step 1: Write the failing test**

Open `apps/cms/server/api/graphql/graphql.test.ts` and add a new describe block at the bottom of the outer `describe('GraphQL API', async () => { ... })`, just before the closing `});` of that outer block. (The exact line number depends on prior edits; place it after `describe('RICHTEXT references', ...)` ends.)

```typescript
describe('Relation filtering', () => {
  let teamTypeId: string;
  let playerTypeId: string;
  let articleTypeId: string;
  let tagTypeId: string;
  let teamA: string;
  let teamB: string;
  let tagX: string;
  let tagY: string;
  let playerOnA: string;
  let playerOnB: string;
  let unassignedPlayer: string;
  let articleTaggedXY: string;
  let articleTaggedX: string;
  let articleUntagged: string;

  it('sets up relation filtering test data', async () => {
    const teamType = await $fetch<{ id: string }>('/api/content-types', {
      method: 'POST',
      headers: { Cookie: await getSessionCookie() },
      body: {
        name: 'Filter Team',
        identifier: 'FilterTeam',
        fields: [
          {
            identifier: 'name',
            name: 'Name',
            type: 'ENTRY_TITLE',
            required: true,
          },
        ],
      },
    });
    teamTypeId = teamType.id;

    const tagType = await $fetch<{ id: string }>('/api/content-types', {
      method: 'POST',
      headers: { Cookie: await getSessionCookie() },
      body: {
        name: 'Filter Tag',
        identifier: 'FilterTag',
        fields: [
          {
            identifier: 'name',
            name: 'Name',
            type: 'ENTRY_TITLE',
            required: true,
          },
        ],
      },
    });
    tagTypeId = tagType.id;

    const playerType = await $fetch<{ id: string }>('/api/content-types', {
      method: 'POST',
      headers: { Cookie: await getSessionCookie() },
      body: {
        name: 'Filter Player',
        identifier: 'FilterPlayer',
        fields: [
          {
            identifier: 'name',
            name: 'Name',
            type: 'ENTRY_TITLE',
            required: true,
          },
          {
            identifier: 'team',
            name: 'Team',
            type: 'RELATION',
            options: { targetContentTypeIds: [teamTypeId] },
          },
        ],
      },
    });
    playerTypeId = playerType.id;

    const articleType = await $fetch<{ id: string }>('/api/content-types', {
      method: 'POST',
      headers: { Cookie: await getSessionCookie() },
      body: {
        name: 'Filter Article',
        identifier: 'FilterArticle',
        fields: [
          {
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
          },
          {
            identifier: 'tags',
            name: 'Tags',
            type: 'MULTIRELATION',
            options: { targetContentTypeIds: [tagTypeId] },
          },
        ],
      },
    });
    articleTypeId = articleType.id;

    const ta = await $fetch<{ id: string }>('/api/content-entries', {
      method: 'POST',
      headers: { Cookie: await getSessionCookie() },
      body: {
        contentTypeId: teamTypeId,
        data: { name: 'Team A' },
        status: 'PUBLISHED',
      },
    });
    teamA = ta.id;
    const tb = await $fetch<{ id: string }>('/api/content-entries', {
      method: 'POST',
      headers: { Cookie: await getSessionCookie() },
      body: {
        contentTypeId: teamTypeId,
        data: { name: 'Team B' },
        status: 'PUBLISHED',
      },
    });
    teamB = tb.id;
    const tx = await $fetch<{ id: string }>('/api/content-entries', {
      method: 'POST',
      headers: { Cookie: await getSessionCookie() },
      body: {
        contentTypeId: tagTypeId,
        data: { name: 'X' },
        status: 'PUBLISHED',
      },
    });
    tagX = tx.id;
    const ty = await $fetch<{ id: string }>('/api/content-entries', {
      method: 'POST',
      headers: { Cookie: await getSessionCookie() },
      body: {
        contentTypeId: tagTypeId,
        data: { name: 'Y' },
        status: 'PUBLISHED',
      },
    });
    tagY = ty.id;

    const pA = await $fetch<{ id: string }>('/api/content-entries', {
      method: 'POST',
      headers: { Cookie: await getSessionCookie() },
      body: {
        contentTypeId: playerTypeId,
        data: {
          name: 'P-OnA',
          team: { contentTypeId: teamTypeId, entryId: teamA },
        },
        status: 'PUBLISHED',
      },
    });
    playerOnA = pA.id;
    const pB = await $fetch<{ id: string }>('/api/content-entries', {
      method: 'POST',
      headers: { Cookie: await getSessionCookie() },
      body: {
        contentTypeId: playerTypeId,
        data: {
          name: 'P-OnB',
          team: { contentTypeId: teamTypeId, entryId: teamB },
        },
        status: 'PUBLISHED',
      },
    });
    playerOnB = pB.id;
    const pU = await $fetch<{ id: string }>('/api/content-entries', {
      method: 'POST',
      headers: { Cookie: await getSessionCookie() },
      body: {
        contentTypeId: playerTypeId,
        data: { name: 'P-Unassigned' },
        status: 'PUBLISHED',
      },
    });
    unassignedPlayer = pU.id;

    const aXY = await $fetch<{ id: string }>('/api/content-entries', {
      method: 'POST',
      headers: { Cookie: await getSessionCookie() },
      body: {
        contentTypeId: articleTypeId,
        data: {
          title: 'A-XY',
          tags: [
            { contentTypeId: tagTypeId, entryId: tagX },
            { contentTypeId: tagTypeId, entryId: tagY },
          ],
        },
        status: 'PUBLISHED',
      },
    });
    articleTaggedXY = aXY.id;
    const aX = await $fetch<{ id: string }>('/api/content-entries', {
      method: 'POST',
      headers: { Cookie: await getSessionCookie() },
      body: {
        contentTypeId: articleTypeId,
        data: {
          title: 'A-X',
          tags: [{ contentTypeId: tagTypeId, entryId: tagX }],
        },
        status: 'PUBLISHED',
      },
    });
    articleTaggedX = aX.id;
    const aU = await $fetch<{ id: string }>('/api/content-entries', {
      method: 'POST',
      headers: { Cookie: await getSessionCookie() },
      body: {
        contentTypeId: articleTypeId,
        data: { title: 'A-U' },
        status: 'PUBLISHED',
      },
    });
    articleUntagged = aU.id;
  });

  it('exposes RELATION filter on the per-type Where input', async () => {
    const { data } = await gql<{
      __type: {
        inputFields: Array<{
          name: string;
          type: { name: string | null; ofType: { name: string | null } | null };
        }>;
      } | null;
    }>(`{
        __type(name: "FilterPlayerWhere") {
          inputFields { name type { name ofType { name } } }
        }
      }`);
    expect(data.__type).not.toBeNull();
    const teamField = data.__type!.inputFields.find((f) => f.name === 'team');
    expect(teamField).toBeDefined();
    expect(teamField!.type.name ?? teamField!.type.ofType?.name).toBe(
      'DynRelationFilter'
    );
  });

  it('exposes MULTIRELATION filter on the per-type Where input', async () => {
    const { data } = await gql<{
      __type: {
        inputFields: Array<{
          name: string;
          type: { name: string | null; ofType: { name: string | null } | null };
        }>;
      } | null;
    }>(`{
        __type(name: "FilterArticleWhere") {
          inputFields { name type { name ofType { name } } }
        }
      }`);
    expect(data.__type).not.toBeNull();
    const tagsField = data.__type!.inputFields.find((f) => f.name === 'tags');
    expect(tagsField).toBeDefined();
    expect(tagsField!.type.name ?? tagsField!.type.ofType?.name).toBe(
      'DynMultirelationFilter'
    );
  });
});
```

Note: the cleanup `it` is added in Task 6; do not delete fixtures yet — later tasks reuse `teamA`, `tagX`, etc.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter cms test apps/cms/server/api/graphql/graphql.test.ts -t "exposes RELATION filter"
```

Expected: FAIL — the `team` field does not appear on `FilterPlayerWhere` because `getFilterKeyForFieldType('RELATION')` returns `null`.

- [ ] **Step 3: Add the new filter input types**

Edit `apps/cms/server/graphql/jsonbFilters.ts`. After the existing `DynContentStatusFilter` declaration (around line 48) and before the `return` statement, add:

```typescript
const DynRelationFilter = builder.inputType('DynRelationFilter', {
  fields: (t) => ({
    equals: t.id(),
    in: t.idList(),
    isNull: t.boolean(),
  }),
});

const DynMultirelationFilter = builder.inputType('DynMultirelationFilter', {
  fields: (t) => ({
    contains: t.id(),
    containsAny: t.idList(),
    containsAll: t.idList(),
    isEmpty: t.boolean(),
  }),
});
```

Update the `return` block to include the two new refs:

```typescript
return {
  DynStringFilter,
  DynFloatFilter,
  DynBooleanFilter,
  DynDateTimeFilter,
  DynContentStatusFilter,
  DynRelationFilter,
  DynMultirelationFilter,
};
```

- [ ] **Step 4: Wire RELATION + MULTIRELATION into the field-type mapping**

Still in `apps/cms/server/graphql/jsonbFilters.ts`, change the `FIELD_TYPE_TO_FILTER_KEY` map (around line 61) so the two field types resolve to the new keys:

```typescript
const FIELD_TYPE_TO_FILTER_KEY: Record<string, keyof DynFilterRefs | null> = {
  ENTRY_TITLE: 'DynStringFilter',
  SLUG: 'DynStringFilter',
  TEXT: 'DynStringFilter',
  TEXTAREA: 'DynStringFilter',
  NUMBER: 'DynFloatFilter',
  BOOLEAN: 'DynBooleanFilter',
  DATETIME: 'DynDateTimeFilter',
  SELECT: 'DynStringFilter',
  RICHTEXT: null,
  RELATION: 'DynRelationFilter',
  MULTIRELATION: 'DynMultirelationFilter',
};
```

- [ ] **Step 5: Run the introspection tests to verify they pass**

```bash
pnpm --filter cms test apps/cms/server/api/graphql/graphql.test.ts -t "exposes RELATION filter"
pnpm --filter cms test apps/cms/server/api/graphql/graphql.test.ts -t "exposes MULTIRELATION filter"
```

Expected: PASS — both inputs are now exposed. (Filter args still no-op at the SQL level — that's Tasks 2–3.)

- [ ] **Step 6: Commit**

```bash
git add apps/cms/server/graphql/jsonbFilters.ts apps/cms/server/api/graphql/graphql.test.ts
git commit -m "feat(graphql): expose DynRelationFilter and DynMultirelationFilter input types"
```

---

## Task 2: RELATION SQL predicates in `queryDynamicEntries`

**Files:**

- Modify: `apps/cms/server/graphql/jsonbFilters.ts:179-232` (the per-field `for` loop in `queryDynamicEntries`).
- Test: `apps/cms/server/api/graphql/graphql.test.ts` — append within `describe('Relation filtering', ...)`.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('Relation filtering', ...)` block, after the introspection tests:

```typescript
it('filters RELATION by equals', async () => {
  const { data } = await gql<{
    filterPlayerList: Connection<{ id: string; name: string }>;
  }>(`{
        filterPlayerList(first: 10, where: { team: { equals: "${teamA}" } }) {
          edges { node { id name } }
        }
      }`);
  const ids = data.filterPlayerList.edges.map((e) => e.node.id);
  expect(ids).toEqual([playerOnA]);
});

it('filters RELATION by in', async () => {
  const { data } = await gql<{
    filterPlayerList: Connection<{ id: string; name: string }>;
  }>(`{
        filterPlayerList(first: 10, where: { team: { in: ["${teamA}", "${teamB}"] } }) {
          edges { node { id name } }
        }
      }`);
  const ids = data.filterPlayerList.edges.map((e) => e.node.id).sort();
  expect(ids).toEqual([playerOnA, playerOnB].sort());
});

it('filters RELATION by isNull true (unassigned)', async () => {
  const { data } = await gql<{
    filterPlayerList: Connection<{ id: string; name: string }>;
  }>(`{
        filterPlayerList(first: 10, where: { team: { isNull: true } }) {
          edges { node { id name } }
        }
      }`);
  const ids = data.filterPlayerList.edges.map((e) => e.node.id);
  expect(ids).toEqual([unassignedPlayer]);
});

it('filters RELATION by isNull false (only assigned)', async () => {
  const { data } = await gql<{
    filterPlayerList: Connection<{ id: string }>;
  }>(`{
        filterPlayerList(first: 10, where: { team: { isNull: false } }) {
          edges { node { id } }
        }
      }`);
  const ids = data.filterPlayerList.edges.map((e) => e.node.id).sort();
  expect(ids).toEqual([playerOnA, playerOnB].sort());
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter cms test apps/cms/server/api/graphql/graphql.test.ts -t "filters RELATION by"
```

Expected: FAIL — currently the `team` filter argument is silently ignored, so all three players come back for every test.

- [ ] **Step 3: Implement RELATION SQL in `queryDynamicEntries`**

Edit `apps/cms/server/graphql/jsonbFilters.ts`. Inside `queryDynamicEntries`'s per-field `for` loop, after the existing `DATETIME` branch (around line 231) and before the closing `}` of the `for (const field of fields)` block, add:

```typescript
      } else if (field.type === 'RELATION') {
        const ident = Prisma.raw(`'${field.identifier}'`);
        if (typeof filter.equals === 'string' && filter.equals.length > 0) {
          conditions.push(
            Prisma.sql`v."data"->${ident}->>'entryId' = ${filter.equals}`
          );
        }
        if (Array.isArray(filter.in) && filter.in.length > 0) {
          const ids = (filter.in as unknown[]).filter(
            (x): x is string => typeof x === 'string' && x.length > 0
          );
          if (ids.length === 0) {
            conditions.push(Prisma.sql`FALSE`);
          } else {
            conditions.push(
              Prisma.sql`v."data"->${ident}->>'entryId' = ANY(${ids})`
            );
          }
        }
        if (filter.isNull === true) {
          conditions.push(
            Prisma.sql`(v."data"->${ident} IS NULL OR v."data"->${ident} = 'null'::jsonb OR v."data"->${ident}->>'entryId' IS NULL)`
          );
        } else if (filter.isNull === false) {
          conditions.push(
            Prisma.sql`(v."data"->${ident} IS NOT NULL AND v."data"->${ident} <> 'null'::jsonb AND v."data"->${ident}->>'entryId' IS NOT NULL)`
          );
        }
      }
```

Note the use of `Prisma.raw(`'${field.identifier}'`)` matches the existing pattern in this file (the identifier comes from a content-type field whose name is validated by `assertFieldIdentifier` to be camelCase, so SQL-injection-safe). Do not change to template-bound parameters — Postgres rejects parameterised JSONB key extraction operators.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter cms test apps/cms/server/api/graphql/graphql.test.ts -t "filters RELATION by"
```

Expected: PASS for all four tests.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/graphql/jsonbFilters.ts apps/cms/server/api/graphql/graphql.test.ts
git commit -m "feat(graphql): filter dynamic-type lists by RELATION field (equals/in/isNull)"
```

---

## Task 3: MULTIRELATION SQL predicates in `queryDynamicEntries`

**Files:**

- Modify: `apps/cms/server/graphql/jsonbFilters.ts` — same `for` loop, add `MULTIRELATION` branch after the `RELATION` branch from Task 2.
- Test: `apps/cms/server/api/graphql/graphql.test.ts` — append within `describe('Relation filtering', ...)`.

- [ ] **Step 1: Write the failing tests**

Append inside the same describe block, after the RELATION tests:

```typescript
it('filters MULTIRELATION by contains', async () => {
  const { data } = await gql<{
    filterArticleList: Connection<{ id: string; title: string }>;
  }>(`{
        filterArticleList(first: 10, where: { tags: { contains: "${tagX}" } }) {
          edges { node { id title } }
        }
      }`);
  const ids = data.filterArticleList.edges.map((e) => e.node.id).sort();
  expect(ids).toEqual([articleTaggedX, articleTaggedXY].sort());
});

it('filters MULTIRELATION by containsAny (OR)', async () => {
  const { data } = await gql<{
    filterArticleList: Connection<{ id: string }>;
  }>(`{
        filterArticleList(first: 10, where: { tags: { containsAny: ["${tagX}", "${tagY}"] } }) {
          edges { node { id } }
        }
      }`);
  const ids = data.filterArticleList.edges.map((e) => e.node.id).sort();
  expect(ids).toEqual([articleTaggedX, articleTaggedXY].sort());
});

it('filters MULTIRELATION by containsAll (AND)', async () => {
  const { data } = await gql<{
    filterArticleList: Connection<{ id: string }>;
  }>(`{
        filterArticleList(first: 10, where: { tags: { containsAll: ["${tagX}", "${tagY}"] } }) {
          edges { node { id } }
        }
      }`);
  const ids = data.filterArticleList.edges.map((e) => e.node.id);
  expect(ids).toEqual([articleTaggedXY]);
});

it('filters MULTIRELATION by isEmpty true', async () => {
  const { data } = await gql<{
    filterArticleList: Connection<{ id: string }>;
  }>(`{
        filterArticleList(first: 10, where: { tags: { isEmpty: true } }) {
          edges { node { id } }
        }
      }`);
  const ids = data.filterArticleList.edges.map((e) => e.node.id);
  expect(ids).toEqual([articleUntagged]);
});

it('filters MULTIRELATION by isEmpty false', async () => {
  const { data } = await gql<{
    filterArticleList: Connection<{ id: string }>;
  }>(`{
        filterArticleList(first: 10, where: { tags: { isEmpty: false } }) {
          edges { node { id } }
        }
      }`);
  const ids = data.filterArticleList.edges.map((e) => e.node.id).sort();
  expect(ids).toEqual([articleTaggedX, articleTaggedXY].sort());
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter cms test apps/cms/server/api/graphql/graphql.test.ts -t "filters MULTIRELATION"
```

Expected: FAIL — `tags` filter is silently ignored, so all three articles come back for each.

- [ ] **Step 3: Implement MULTIRELATION SQL**

Edit `apps/cms/server/graphql/jsonbFilters.ts`. Add a new branch in the same `for (const field of fields)` loop, immediately after the `RELATION` branch from Task 2:

```typescript
      } else if (field.type === 'MULTIRELATION') {
        const ident = Prisma.raw(`'${field.identifier}'`);
        if (typeof filter.contains === 'string' && filter.contains.length > 0) {
          conditions.push(
            Prisma.sql`v."data"->${ident} @> jsonb_build_array(jsonb_build_object('entryId', ${filter.contains}::text))`
          );
        }
        if (Array.isArray(filter.containsAny) && filter.containsAny.length > 0) {
          const ids = (filter.containsAny as unknown[]).filter(
            (x): x is string => typeof x === 'string' && x.length > 0
          );
          if (ids.length === 0) {
            conditions.push(Prisma.sql`FALSE`);
          } else {
            conditions.push(
              Prisma.sql`EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v."data"->${ident}, '[]'::jsonb)) AS ref WHERE ref->>'entryId' = ANY(${ids}))`
            );
          }
        }
        if (Array.isArray(filter.containsAll) && filter.containsAll.length > 0) {
          const ids = (filter.containsAll as unknown[]).filter(
            (x): x is string => typeof x === 'string' && x.length > 0
          );
          for (const id of ids) {
            conditions.push(
              Prisma.sql`v."data"->${ident} @> jsonb_build_array(jsonb_build_object('entryId', ${id}::text))`
            );
          }
        }
        if (filter.isEmpty === true) {
          conditions.push(
            Prisma.sql`(v."data"->${ident} IS NULL OR v."data"->${ident} = 'null'::jsonb OR (jsonb_typeof(v."data"->${ident}) = 'array' AND jsonb_array_length(v."data"->${ident}) = 0))`
          );
        } else if (filter.isEmpty === false) {
          conditions.push(
            Prisma.sql`(jsonb_typeof(v."data"->${ident}) = 'array' AND jsonb_array_length(v."data"->${ident}) > 0)`
          );
        }
      }
```

Notes:

- `@> jsonb_build_array(jsonb_build_object('entryId', $1::text))` uses parameterised values for the entry id. The JSONB key `'entryId'` is a literal so containment matches an array element shaped `{ contentTypeId, entryId }`.
- `containsAll` decomposes into N separate `@>` predicates; this works because each `@>` is independent and AND-composed. It's slightly less efficient than a single bigger `@>`, but easier to reason about and equally indexable.
- `containsAny` uses `jsonb_array_elements` because `@>` cannot express OR. This branch will not use the GIN index added in Task 4 — it falls back to a sequential scan, which is acceptable for the CMS profile.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter cms test apps/cms/server/api/graphql/graphql.test.ts -t "filters MULTIRELATION"
```

Expected: PASS for all five tests.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/graphql/jsonbFilters.ts apps/cms/server/api/graphql/graphql.test.ts
git commit -m "feat(graphql): filter dynamic-type lists by MULTIRELATION field (contains/containsAny/containsAll/isEmpty)"
```

---

## Task 4: Add a GIN index on `ContentEntryVersion.data`

**Files:**

- Create: `apps/cms/prisma/migrations/20260430120000_add_content_entry_version_data_gin/migration.sql`.

This optimises `@>` containment queries used by the MULTIRELATION `contains` and `containsAll` operators. The user's CLAUDE.md notes that `prisma migrate dev` cannot run via MCP — apply manually with `pnpx prisma migrate deploy` after writing the SQL.

- [ ] **Step 1: Verify the migrations directory layout**

```bash
ls apps/cms/prisma/migrations | tail -3
```

Expected output includes `20260428163314_add_user_password_version` and `migration_lock.toml`. Confirm no conflicting `_data_gin` migration already exists.

- [ ] **Step 2: Create the migration SQL**

Create `apps/cms/prisma/migrations/20260430120000_add_content_entry_version_data_gin/migration.sql`:

```sql
CREATE INDEX "ContentEntryVersion_data_gin_idx"
  ON "ContentEntryVersion"
  USING gin ("data" jsonb_path_ops);
```

`jsonb_path_ops` is smaller and faster than the default `jsonb_ops` for our usage (we only need `@>`), and PostgreSQL plans `@>` against this index automatically.

(`CONCURRENTLY` is intentionally omitted — Prisma migrate runs each statement in a transaction, and `CREATE INDEX CONCURRENTLY` is incompatible with that. For a fresh dev DB this is irrelevant; for production deployments at scale, the operator can later swap to a manual concurrent build outside Prisma's migration history.)

- [ ] **Step 3: Apply the migration**

```bash
pnpx prisma migrate deploy --schema apps/cms/prisma/schema
```

Expected: `Applying migration `20260430120000_add_content_entry_version_data_gin``. Verify with:

```bash
pnpx prisma migrate status --schema apps/cms/prisma/schema
```

Expected: "Database schema is up to date".

- [ ] **Step 4: Verify the index exists**

```bash
docker compose exec -T postgres psql -U boject -d boject -c "\d \"ContentEntryVersion\"" | grep -i gin
```

Expected: a line like `ContentEntryVersion_data_gin_idx" gin (data jsonb_path_ops)`.

- [ ] **Step 5: Re-run the relation-filtering tests to confirm nothing regressed**

```bash
pnpm --filter cms test apps/cms/server/api/graphql/graphql.test.ts -t "Relation filtering"
```

Expected: all 11 tests in the describe block pass (2 introspection + 4 RELATION + 5 MULTIRELATION).

- [ ] **Step 6: Commit**

```bash
git add apps/cms/prisma/migrations/20260430120000_add_content_entry_version_data_gin
git commit -m "feat(db): add GIN(jsonb_path_ops) index on ContentEntryVersion.data"
```

---

## Task 5: Cleanup test fixtures + final integration sweep

**Files:**

- Modify: `apps/cms/server/api/graphql/graphql.test.ts` — append a cleanup `it` to the `describe('Relation filtering', ...)` block.

- [ ] **Step 1: Add cleanup `it`**

Append at the end of `describe('Relation filtering', ...)`:

```typescript
it('cleans up relation filtering test data', async () => {
  const cookie = await getSessionCookie();
  const allEntryIds = [
    playerOnA,
    playerOnB,
    unassignedPlayer,
    articleTaggedXY,
    articleTaggedX,
    articleUntagged,
    teamA,
    teamB,
    tagX,
    tagY,
  ];
  for (const id of allEntryIds) {
    await $fetch<unknown>(`/api/content-entries/${id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
  }
  for (const typeId of [playerTypeId, articleTypeId, teamTypeId, tagTypeId]) {
    await $fetch<unknown>(`/api/content-types/${typeId}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
  }
});
```

- [ ] **Step 2: Run the full GraphQL test file**

```bash
pnpm --filter cms test apps/cms/server/api/graphql/graphql.test.ts
```

Expected: every test passes, no fixture residue from the new block leaks into later runs.

- [ ] **Step 3: Run the full integration suite**

```bash
pnpm --filter cms test:integration
```

Expected: all integration tests pass.

- [ ] **Step 4: Run typecheck and lint**

```bash
pnpm --filter cms typecheck
pnpm --filter cms lint
```

Expected: both clean. If lint surfaces unused-variable warnings on the new test fixtures, prefix the affected names with `_` (project convention: `varsIgnorePattern: '^_'`).

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/api/graphql/graphql.test.ts
git commit -m "test(graphql): clean up relation-filtering fixtures"
```

---

## Task 6: Document the new filters in CLAUDE.md

**Files:**

- Modify: `CLAUDE.md` — the bullet point describing GraphQL "Where filtering" under the GraphQL section.

- [ ] **Step 1: Find the existing entry**

```bash
grep -n "Where filtering" CLAUDE.md
```

Expected: one match in the GraphQL section, currently reading:

```
- **Where filtering** — Handled by `apps/cms/server/graphql/jsonbFilters.ts`, which defines Prisma-style where inputs for each dynamic ContentType. Scalar filters (string `equals`/`contains`, float `equals`/`gt`/`gte`/`lt`/`lte`, boolean `equals`, datetime `equals`/`gt`/`gte`/`lt`/`lte`, contentStatus `equals`) are declared on the builder; dynamic-field filters are generated per ContentType based on its `ContentTypeField` definitions.
```

- [ ] **Step 2: Replace it**

Use Edit to replace the bullet with:

```
- **Where filtering** — Handled by `apps/cms/server/graphql/jsonbFilters.ts`, which defines Prisma-style where inputs for each dynamic ContentType. Scalar filters: string `equals`/`contains`, float `equals`/`gt`/`gte`/`lt`/`lte`, boolean `equals`, datetime `equals`/`gt`/`gte`/`lt`/`lte`, contentStatus `equals`. Relation filters: RELATION fields accept `DynRelationFilter` (`equals: ID`, `in: [ID!]`, `isNull: Boolean`); MULTIRELATION fields accept `DynMultirelationFilter` (`contains: ID`, `containsAny: [ID!]`, `containsAll: [ID!]`, `isEmpty: Boolean`). RELATION + MULTIRELATION filters compare on `entryId`; the field's own `targetContentTypeIds` already constrains the type. RICHTEXT body references are not filterable — use a forward MULTIRELATION (e.g. `Article.associatedPlayers`) to surface the relationship instead. A `gin (data jsonb_path_ops)` index on `ContentEntryVersion` accelerates `@>` containment queries (RELATION/MULTIRELATION `contains`/`containsAll`).
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document GraphQL relation where filters"
```

---

## Final checklist

- [ ] `pnpm --filter cms test:integration` passes.
- [ ] `pnpm --filter cms typecheck` clean.
- [ ] `pnpm --filter cms lint` clean.
- [ ] Manual smoke: hit GraphiQL in dev (`pnpm dev` → `/api/graphql`) and run a `filterPlayerList(where: { team: { equals: "<id>" } })` query against seeded rugby data — confirm round-trip works end-to-end.
- [ ] CLAUDE.md updated.
- [ ] All commits pushed via the Wallaby fast-path workflow described in CLAUDE.md.
