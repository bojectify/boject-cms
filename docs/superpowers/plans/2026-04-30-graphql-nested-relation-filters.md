# GraphQL Nested Relation Where Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the GraphQL where-filter surface with nested relation filtering so clients can ask `articleList(where: { author: { is: { slug: { equals: "olly" } } } })` and `articleList(where: { tags: { some: { name: { equals: "rugby" } } } })` without a two-hop client-side query. This builds on PR #140's flat RELATION/MULTIRELATION filters by adding `is` (one-to-one traversal) and `some` (one-to-many traversal) operators that take a target-type `Where` input.

**Architecture:** Replace the shared `DynRelationFilter` / `DynMultirelationFilter` references on each per-type `<X>Where` with newly-built per-(content-type, field) filter inputs (e.g. `ArticleAuthorRelationFilter`, `ArticleTagsMultirelationFilter`). Each per-relation input keeps the existing flat operators and adds an `is` (RELATION) or `some` (MULTIRELATION) field whose type is the target content type's `Where`. `queryDynamicEntries` is refactored into a recursive condition builder that takes a SQL alias depth so nested `EXISTS` subqueries don't collide with the outer `e`/`v` aliases. Polymorphic relations (multi-target) are explicitly excluded from nested filtering and continue to use the shared inputs from PR #140. Recursion is capped at depth 5 to bound query cost and prevent runaway cycles.

**Tech Stack:** Pothos schema builder, GraphQL Yoga, Prisma `$queryRaw` with `Prisma.sql` template tags, PostgreSQL JSONB operators (`->`, `->>`, `jsonb_array_elements`), `EXISTS` subqueries.

**Non-goals:**

- `isNot` / `every` / `none` operators — combinable with `equals`/`isNull` already; defer until a use case appears.
- Polymorphic (multi-target) nested filtering via discriminated input — deferred per the scoping discussion (option B). Multi-target relations keep the flat shared filters.
- Cross-type `contentEntryList` nested filtering — system-field-only stays.
- REST endpoint nested filtering — GraphQL only.
- New indexes — JOINs hit existing PK + `(entryId, status)` composite, no new index needed.

---

## File Structure

**Modify:**

- `apps/cms/server/graphql/jsonbFilters.ts` — split `queryDynamicEntries` into a top-level executor + a recursive `buildEntryConditions(args, contentType, fields, contentTypes, alias, depth)` helper. Remove `DynRelationFilter` / `DynMultirelationFilter` references from per-type usage when the relation is single-target (they remain registered for polymorphic). Add `MAX_RELATION_FILTER_DEPTH` constant.
- `apps/cms/server/graphql/dynamicTypes.ts` — replace the per-type `WhereInput` registration with a two-pass approach: first register a `whereInputRefs: Map<contentTypeId, InputRef>`, then attach fields lazily so per-relation filter inputs can reference target Where refs via closure. Build per-(type, field) filter inputs for single-target RELATION / MULTIRELATION fields. Pass `contentTypes` into `queryDynamicEntries` for target lookup.
- `CLAUDE.md` — extend the "Where filtering" bullet with `is` / `some` semantics and the depth cap.

**Test:**

- `apps/cms/server/api/graphql/graphql.test.ts` — new `describe('Nested relation filtering', ...)` block; reuses the same fixture setup style as PR #140's `describe('Relation filtering', ...)`.

---

## Filter shape (locked)

For each single-target RELATION field on `${ct.identifier}`, we register `${ct.identifier}${PascalField}RelationFilter`:

```graphql
input ArticleAuthorRelationFilter {
  equals: ID
  in: [ID!]
  isNull: Boolean
  is: AuthorWhere # NEW — single-target RELATION only
}
```

For each single-target MULTIRELATION field, `${ct.identifier}${PascalField}MultirelationFilter`:

```graphql
input ArticleTagsMultirelationFilter {
  contains: ID
  containsAny: [ID!]
  containsAll: [ID!]
  isEmpty: Boolean
  some: TagWhere # NEW — single-target MULTIRELATION only
}
```

Polymorphic (multi-target) RELATION / MULTIRELATION fields **continue to use** the shared `DynRelationFilter` / `DynMultirelationFilter` inputs (no `is` / `some`).

**Composition:** sibling fields AND together (existing behaviour). Operators within a single per-relation input AND together — `where: { author: { equals: "x", is: { slug: { equals: "y" } } } }` is the conjunction.

**Depth cap:** 5 levels of nested `is` / `some`. Beyond that, the resolver throws `400 Bad Request: relation filter nesting exceeds maximum depth (5)`. Depth 0 = top-level query, depth 1 = first nested `is`/`some`, etc.

---

## Task 1: Refactor `queryDynamicEntries` into a recursive condition builder

**Goal:** extract the per-field condition logic so it can be reused inside `EXISTS` subqueries with a different SQL alias. No behaviour change yet — existing tests must pass byte-for-byte.

**Files:**

- Modify: `apps/cms/server/graphql/jsonbFilters.ts:170-344` (the `queryDynamicEntries` function and its inner per-field loop).

- [ ] **Step 1: Run the existing test suite to establish a baseline**

```bash
pnpm --filter cms test apps/cms/server/api/graphql/graphql.test.ts
```

Expected: all tests pass on `main`. Note the count.

- [ ] **Step 2: Extract `buildEntryConditions`**

Inside `apps/cms/server/graphql/jsonbFilters.ts`, lift the per-field condition loop into a new exported function:

```typescript
export const MAX_RELATION_FILTER_DEPTH = 5;

export interface ContentTypeForFilter {
  id: string;
  identifier: string;
  fields: FieldDef[];
}

export function buildEntryConditions(
  whereArgs: WhereArgs | null | undefined,
  contentType: ContentTypeForFilter,
  contentTypes: ContentTypeForFilter[],
  alias: { entry: string; version: string }, // e.g. { entry: 'e', version: 'v' }
  depth: number
): Prisma.Sql[] {
  if (depth > MAX_RELATION_FILTER_DEPTH) {
    throw createError({
      statusCode: 400,
      statusMessage: `relation filter nesting exceeds maximum depth (${MAX_RELATION_FILTER_DEPTH})`,
    });
  }

  const conditions: Prisma.Sql[] = [];
  if (!whereArgs) return conditions;

  const v = Prisma.raw(`"${alias.version}"`);
  // status / createdAt / updatedAt branches use `v` via Prisma.raw
  // ... all existing scalar / relation / multirelation branches reproduced here,
  //     with `v."data"` replaced by `${v}."data"` and date conditions taking the
  //     dynamic version alias instead of the hardcoded 'v'.
  return conditions;
}
```

`createError` is the H3 helper already used by the GraphQL API key guard — import via `import { createError } from 'h3'` or rely on Nitro auto-import (verify with the existing handlers).

`buildDateConditions` already accepts `tablePrefix?: string` — pass `alias.version` through. The existing call sites in `dynamicTypes.ts` (`buildDateConditions(..., 'v')` for `contentEntryList`) keep passing `'v'`.

- [ ] **Step 3: Reduce `queryDynamicEntries` to a thin wrapper**

```typescript
export async function queryDynamicEntries(
  contentTypeId: string,
  whereArgs: WhereArgs | null | undefined,
  fields: FieldDef[],
  contentTypes: ContentTypeForFilter[],
  limit: number,
  offset: number
): Promise<ContentEntryShape[]> {
  const contentType = contentTypes.find((ct) => ct.id === contentTypeId);
  if (!contentType) return [];

  const conditions: Prisma.Sql[] = [
    Prisma.sql`e."contentTypeId" = ${contentTypeId}`,
    ...buildEntryConditions(
      whereArgs,
      contentType,
      contentTypes,
      { entry: 'e', version: 'v' },
      0
    ),
  ];

  const whereClause = Prisma.join(conditions, ' AND ');
  return prisma.$queryRaw`
    SELECT e."id", e."contentTypeId", v."data", e."slug",
           v."status", v."publishedAt", v."createdAt", v."updatedAt"
    FROM "ContentEntry" e
    JOIN "ContentEntryVersion" v ON v."entryId" = e."id"
    WHERE v."status" = 'PUBLISHED' AND ${whereClause}
    ORDER BY v."createdAt" DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}
```

- [ ] **Step 4: Update `dynamicTypes.ts` callers to pass `contentTypes`**

`apps/cms/server/graphql/dynamicTypes.ts:417-432` — the per-type list resolver and the `contentEntryList` cross-type resolver both need the `contentTypes` array (already in scope) threaded into the call. Update the signature usage; no behaviour change.

- [ ] **Step 5: Run the full GraphQL suite to confirm zero regressions**

```bash
pnpm --filter cms test apps/cms/server/api/graphql/graphql.test.ts
```

Expected: same count and all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/cms/server/graphql/jsonbFilters.ts apps/cms/server/graphql/dynamicTypes.ts
git commit -m "refactor(graphql): extract recursive buildEntryConditions from queryDynamicEntries"
```

---

## Task 2: Generate per-relation filter input types

**Goal:** for each single-target RELATION / MULTIRELATION field, register a per-(content-type, field) filter input that includes the existing flat operators **plus** an `is` / `some` field referencing the target type's `Where`. Polymorphic fields keep the shared inputs from PR #140 unchanged.

**Files:**

- Modify: `apps/cms/server/graphql/dynamicTypes.ts:182-199` — split `WhereInput` registration into two passes.
- Test: `apps/cms/server/api/graphql/graphql.test.ts` — append a `describe('Nested relation filtering', ...)` block with introspection-only tests in this task; SQL-level tests follow in Tasks 3–4.

- [ ] **Step 1: Write the failing introspection tests**

Append at the end of the outer `describe('GraphQL API', ...)` block (after `describe('Relation filtering', ...)` from PR #140):

```typescript
describe('Nested relation filtering', () => {
  let teamTypeId: string;
  let playerTypeId: string;
  let articleTypeId: string;
  let tagTypeId: string;
  let multiTargetTypeId: string;
  let teamA: string;
  let teamB: string;
  let tagX: string;
  let tagY: string;
  let playerOnA: string;
  let playerOnB: string;
  let articleTaggedXY: string;
  let articleTaggedX: string;

  it('sets up nested filtering test data', async () => {
    // Create FilterTeam2 (slug + name), FilterTag2 (slug + name),
    // FilterPlayer2 (name + RELATION single-target → Team2),
    // FilterArticle2 (title + MULTIRELATION single-target → Tag2),
    // FilterMultiTarget (RELATION with TWO targetContentTypeIds — to verify
    //   no `is` is exposed on polymorphic fields).
    // Seed entries: 2 teams (with slugs "team-a" / "team-b"), 2 tags
    // ("rugby" / "football"), 2 players, 2 articles. Mirror the shape
    // used by the PR #140 fixtures so tests can assert via slug.
  });

  it('exposes per-relation filter input on single-target RELATION', async () => {
    const { data } = await gql<{
      __type: {
        inputFields: Array<{
          name: string;
          type: { name: string | null; ofType: { name: string | null } | null };
        }>;
      } | null;
    }>(`{
        __type(name: "FilterPlayer2Where") {
          inputFields { name type { name ofType { name } } }
        }
      }`);
    const teamField = data.__type!.inputFields.find((f) => f.name === 'team');
    expect(teamField!.type.name ?? teamField!.type.ofType?.name).toBe(
      'FilterPlayer2TeamRelationFilter'
    );
  });

  it('per-relation RELATION input includes is + flat operators', async () => {
    const { data } = await gql<{
      __type: {
        inputFields: Array<{ name: string; type: { name: string | null } }>;
      } | null;
    }>(`{
        __type(name: "FilterPlayer2TeamRelationFilter") {
          inputFields { name type { name } }
        }
      }`);
    const names = data.__type!.inputFields.map((f) => f.name).sort();
    expect(names).toEqual(['equals', 'in', 'is', 'isNull']);
    const isField = data.__type!.inputFields.find((f) => f.name === 'is');
    expect(isField!.type.name).toBe('FilterTeam2Where');
  });

  it('per-relation MULTIRELATION input includes some + flat operators', async () => {
    const { data } = await gql<{
      __type: {
        inputFields: Array<{ name: string; type: { name: string | null } }>;
      } | null;
    }>(`{
        __type(name: "FilterArticle2TagsMultirelationFilter") {
          inputFields { name type { name } }
        }
      }`);
    const names = data.__type!.inputFields.map((f) => f.name).sort();
    expect(names).toEqual([
      'contains',
      'containsAll',
      'containsAny',
      'isEmpty',
      'some',
    ]);
    const someField = data.__type!.inputFields.find((f) => f.name === 'some');
    expect(someField!.type.name).toBe('FilterTag2Where');
  });

  it('polymorphic RELATION still uses shared DynRelationFilter (no is)', async () => {
    const { data } = await gql<{
      __type: {
        inputFields: Array<{
          name: string;
          type: { name: string | null; ofType: { name: string | null } | null };
        }>;
      } | null;
    }>(`{
        __type(name: "FilterMultiTargetWhere") {
          inputFields { name type { name ofType { name } } }
        }
      }`);
    const ref = data.__type!.inputFields.find((f) => f.name === 'ref');
    expect(ref!.type.name ?? ref!.type.ofType?.name).toBe('DynRelationFilter');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter cms test apps/cms/server/api/graphql/graphql.test.ts -t "Nested relation filtering"
```

Expected: setup `it` passes (just creates fixtures); the introspection tests fail because per-relation filter inputs don't exist yet.

- [ ] **Step 3: Refactor `WhereInput` registration into two passes**

In `apps/cms/server/graphql/dynamicTypes.ts`, replace the `for (const ct of contentTypes)` loop's WhereInput section with a two-pass scheme:

```typescript
// PASS 1: register every WhereInput up-front so per-relation filters can
// forward-reference their target's Where via closure.
const whereInputRefs = new Map<string, InputRef>();
for (const ct of contentTypes) {
  whereInputRefs.set(
    ct.id,
    builder.inputRef<Record<string, unknown>>(`${ct.identifier}Where`)
  );
}

// PASS 2: implement each WhereInput, building per-relation filter inputs as
// we go. The lazy `fields:` callback resolves whereInputRefs entries that are
// guaranteed to exist by schema-build time.
for (const ct of contentTypes) {
  const filterableFields = ct.fields.filter(
    (f) => getFilterKeyForFieldType(f.type) !== null
  );

  // Build per-relation filter inputs for THIS content type.
  const perRelationFilters = new Map<string, InputRef>(); // fieldId -> ref
  for (const field of filterableFields) {
    if (field.type === 'RELATION' || field.type === 'MULTIRELATION') {
      const opts = field.options as { targetContentTypeIds?: string[] } | null;
      const targetIds = opts?.targetContentTypeIds ?? [];
      if (targetIds.length !== 1) continue; // polymorphic / unset → shared input
      const targetRef = whereInputRefs.get(targetIds[0]!);
      if (!targetRef) continue;

      const pascalField =
        field.identifier.charAt(0).toUpperCase() + field.identifier.slice(1);
      const inputName =
        field.type === 'RELATION'
          ? `${ct.identifier}${pascalField}RelationFilter`
          : `${ct.identifier}${pascalField}MultirelationFilter`;

      const ref = builder.inputType(inputName, {
        fields: (t) =>
          field.type === 'RELATION'
            ? {
                equals: t.id(),
                in: t.idList(),
                isNull: t.boolean(),
                is: t.field({ type: targetRef as never }),
              }
            : {
                contains: t.id(),
                containsAny: t.idList(),
                containsAll: t.idList(),
                isEmpty: t.boolean(),
                some: t.field({ type: targetRef as never }),
              },
      });
      perRelationFilters.set(field.id, ref);
    }
  }

  builder.inputType(whereInputRefs.get(ct.id)! as never, {
    fields: (t) => {
      const whereFields: Record<string, unknown> = {
        status: t.field({ type: dynFilters.DynContentStatusFilter }),
        createdAt: t.field({ type: dynFilters.DynDateTimeFilter }),
        updatedAt: t.field({ type: dynFilters.DynDateTimeFilter }),
      };
      for (const field of filterableFields) {
        const perRel = perRelationFilters.get(field.id);
        if (perRel) {
          whereFields[field.identifier] = t.field({ type: perRel as never });
          continue;
        }
        const filterKey = getFilterKeyForFieldType(field.type);
        if (filterKey) {
          whereFields[field.identifier] = t.field({
            type: dynFilters[filterKey],
          });
        }
      }
      return whereFields as never;
    },
  });
}
```

Pothos's `inputRef<T>(name)` lets you reserve a name, then implement it later via `builder.inputType(ref, { fields })`. Verify the exact API (Pothos `v4` may use `builder.inputRef(...)` + `.implement(...)` or `builder.inputType(ref, ...)`); adjust to whichever spelling the project's version expects. The existing `objectRef` pattern in `dynamicTypes.ts:201,310` is the precedent.

- [ ] **Step 4: Run the introspection tests to verify they pass**

```bash
pnpm --filter cms test apps/cms/server/api/graphql/graphql.test.ts -t "Nested relation filtering"
```

Expected: all 5 tests pass (setup + 4 introspection assertions). SQL-level `is` / `some` queries don't work yet — that's Tasks 3–4.

- [ ] **Step 5: Run the full GraphQL suite to confirm zero regressions**

```bash
pnpm --filter cms test apps/cms/server/api/graphql/graphql.test.ts
```

Expected: PR #140's `describe('Relation filtering', ...)` tests still pass — the per-type `Where` for those single-target RELATION fields now points at a per-relation filter input that still exposes `equals`/`in`/`isNull`, so the flat queries continue to work.

- [ ] **Step 6: Commit**

```bash
git add apps/cms/server/graphql/dynamicTypes.ts apps/cms/server/api/graphql/graphql.test.ts
git commit -m "feat(graphql): register per-relation filter input types for single-target RELATION/MULTIRELATION"
```

---

## Task 3: RELATION `is` SQL via EXISTS subquery

**Goal:** `where: { author: { is: { slug: { equals: "olly" } } } }` resolves to an `EXISTS` subquery against the target's `ContentEntry` + `ContentEntryVersion` (PUBLISHED-only).

**Files:**

- Modify: `apps/cms/server/graphql/jsonbFilters.ts` — RELATION branch inside `buildEntryConditions`.
- Test: `apps/cms/server/api/graphql/graphql.test.ts` — append within `describe('Nested relation filtering', ...)`.

- [ ] **Step 1: Write the failing tests**

```typescript
it('filters RELATION by is { equals } (1 level)', async () => {
  const { data } = await gql<{
    filterPlayer2List: Connection<{ id: string }>;
  }>(`{
        filterPlayer2List(first: 10, where: { team: { is: { slug: { equals: "team-a" } } } }) {
          edges { node { id } }
        }
      }`);
  expect(data.filterPlayer2List.edges.map((e) => e.node.id)).toEqual([
    playerOnA,
  ]);
});

it('filters RELATION by is { in: [slugs] } via name contains', async () => {
  const { data } = await gql<{
    filterPlayer2List: Connection<{ id: string }>;
  }>(`{
        filterPlayer2List(first: 10, where: { team: { is: { name: { contains: "Team" } } } }) {
          edges { node { id } }
        }
      }`);
  expect(data.filterPlayer2List.edges.map((e) => e.node.id).sort()).toEqual(
    [playerOnA, playerOnB].sort()
  );
});

it('combines is with flat equals (AND semantics)', async () => {
  // Player on Team A, also constrained by team.is.slug.equals("team-a") — passes.
  // Same player but team.is.slug.equals("team-b") — fails.
  const { data: pass } = await gql<{
    filterPlayer2List: Connection<{ id: string }>;
  }>(`{
        filterPlayer2List(first: 10, where: { team: { equals: "${teamA}", is: { slug: { equals: "team-a" } } } }) {
          edges { node { id } }
        }
      }`);
  expect(pass.filterPlayer2List.edges.map((e) => e.node.id)).toEqual([
    playerOnA,
  ]);

  const { data: fail } = await gql<{
    filterPlayer2List: Connection<{ id: string }>;
  }>(`{
        filterPlayer2List(first: 10, where: { team: { equals: "${teamA}", is: { slug: { equals: "team-b" } } } }) {
          edges { node { id } }
        }
      }`);
  expect(fail.filterPlayer2List.edges).toEqual([]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Expected: all three fail because `is` is silently ignored at SQL build time.

- [ ] **Step 3: Implement RELATION `is` SQL**

Inside `buildEntryConditions`, RELATION branch, after the existing `equals`/`in`/`isNull` blocks, add:

```typescript
if (filter.is && typeof filter.is === 'object') {
  const opts = field.options as { targetContentTypeIds?: string[] } | null;
  const targetIds = opts?.targetContentTypeIds ?? [];
  if (targetIds.length === 1) {
    const targetType = contentTypes.find((c) => c.id === targetIds[0]);
    if (targetType) {
      const childAlias = {
        entry: `e${depth + 1}`,
        version: `v${depth + 1}`,
      };
      const childConditions = buildEntryConditions(
        filter.is as WhereArgs,
        targetType,
        contentTypes,
        childAlias,
        depth + 1
      );
      const childWhere =
        childConditions.length > 0
          ? Prisma.join(childConditions, ' AND ')
          : Prisma.sql`TRUE`;
      const cAlias = Prisma.raw(`"${childAlias.entry}"`);
      const cVAlias = Prisma.raw(`"${childAlias.version}"`);
      conditions.push(
        Prisma.sql`EXISTS (
            SELECT 1 FROM "ContentEntry" ${cAlias}
            JOIN "ContentEntryVersion" ${cVAlias} ON ${cVAlias}."entryId" = ${cAlias}."id"
            WHERE ${cAlias}."id" = (${Prisma.raw(`"${alias.version}"`)}."data"->${ident}->>'entryId')
              AND ${cAlias}."contentTypeId" = ${targetType.id}
              AND ${cVAlias}."status" = 'PUBLISHED'
              AND ${childWhere}
          )`
      );
    }
  }
}
```

The `entryId` extracted from JSONB is a text string; it's compared against `ContentEntry.id` which is UUID — Postgres will implicit-cast. If that fails on the project's Postgres locale, wrap with `::uuid`.

- [ ] **Step 4: Run the tests to verify they pass**

Expected: all three pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/graphql/jsonbFilters.ts apps/cms/server/api/graphql/graphql.test.ts
git commit -m "feat(graphql): nested RELATION filtering via { is: TargetWhere }"
```

---

## Task 4: MULTIRELATION `some` SQL via EXISTS subquery

**Goal:** `where: { tags: { some: { name: { equals: "rugby" } } } }` matches articles where at least one tag in the array satisfies the nested where.

**Files:**

- Modify: `apps/cms/server/graphql/jsonbFilters.ts` — MULTIRELATION branch inside `buildEntryConditions`.
- Test: `apps/cms/server/api/graphql/graphql.test.ts` — append within `describe('Nested relation filtering', ...)`.

- [ ] **Step 1: Write the failing tests**

```typescript
it('filters MULTIRELATION by some { equals } (at-least-one match)', async () => {
  const { data } = await gql<{
    filterArticle2List: Connection<{ id: string }>;
  }>(`{
        filterArticle2List(first: 10, where: { tags: { some: { name: { equals: "rugby" } } } }) {
          edges { node { id } }
        }
      }`);
  // articles tagged with "rugby" (X) — both XY and X
  expect(data.filterArticle2List.edges.map((e) => e.node.id).sort()).toEqual(
    [articleTaggedX, articleTaggedXY].sort()
  );
});

it('filters MULTIRELATION by some — no match', async () => {
  const { data } = await gql<{
    filterArticle2List: Connection<{ id: string }>;
  }>(`{
        filterArticle2List(first: 10, where: { tags: { some: { name: { equals: "nonexistent" } } } }) {
          edges { node { id } }
        }
      }`);
  expect(data.filterArticle2List.edges).toEqual([]);
});

it('combines some with containsAny (AND semantics)', async () => {
  // articleTaggedXY has tags X and Y; containsAny=[tagY] passes AND some.name=rugby (X) passes.
  // articleTaggedX has only X; containsAny=[tagY] fails.
  const { data } = await gql<{
    filterArticle2List: Connection<{ id: string }>;
  }>(`{
        filterArticle2List(first: 10, where: { tags: { containsAny: ["${tagY}"], some: { name: { equals: "rugby" } } } }) {
          edges { node { id } }
        }
      }`);
  expect(data.filterArticle2List.edges.map((e) => e.node.id)).toEqual([
    articleTaggedXY,
  ]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

- [ ] **Step 3: Implement MULTIRELATION `some` SQL**

Inside `buildEntryConditions`, MULTIRELATION branch, after the existing `contains`/`containsAny`/`containsAll`/`isEmpty` blocks, add:

```typescript
if (filter.some && typeof filter.some === 'object') {
  const opts = field.options as { targetContentTypeIds?: string[] } | null;
  const targetIds = opts?.targetContentTypeIds ?? [];
  if (targetIds.length === 1) {
    const targetType = contentTypes.find((c) => c.id === targetIds[0]);
    if (targetType) {
      const childAlias = {
        entry: `e${depth + 1}`,
        version: `v${depth + 1}`,
      };
      const childConditions = buildEntryConditions(
        filter.some as WhereArgs,
        targetType,
        contentTypes,
        childAlias,
        depth + 1
      );
      const childWhere =
        childConditions.length > 0
          ? Prisma.join(childConditions, ' AND ')
          : Prisma.sql`TRUE`;
      const cAlias = Prisma.raw(`"${childAlias.entry}"`);
      const cVAlias = Prisma.raw(`"${childAlias.version}"`);
      const parentV = Prisma.raw(`"${alias.version}"`);
      conditions.push(
        Prisma.sql`(jsonb_typeof(${parentV}."data"->${ident}) = 'array' AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(${parentV}."data"->${ident}) AS ref
            JOIN "ContentEntry" ${cAlias} ON ${cAlias}."id" = (ref->>'entryId')
            JOIN "ContentEntryVersion" ${cVAlias} ON ${cVAlias}."entryId" = ${cAlias}."id"
            WHERE ${cAlias}."contentTypeId" = ${targetType.id}
              AND ${cVAlias}."status" = 'PUBLISHED'
              AND ${childWhere}
          ))`
      );
    }
  }
}
```

The outer `jsonb_typeof = 'array'` guard avoids `jsonb_array_elements` errors on scalar-null data — same pattern as PR #140's `isEmpty`.

- [ ] **Step 4: Run the tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/graphql/jsonbFilters.ts apps/cms/server/api/graphql/graphql.test.ts
git commit -m "feat(graphql): nested MULTIRELATION filtering via { some: TargetWhere }"
```

---

## Task 5: Depth cap enforcement + deep-nesting test

**Goal:** confirm the `MAX_RELATION_FILTER_DEPTH` guard fires at depth 6 with a 400 response, and that depth ≤5 passes. Also verify a 3-level happy path.

**Files:**

- Test: `apps/cms/server/api/graphql/graphql.test.ts` — append within `describe('Nested relation filtering', ...)`.

- [ ] **Step 1: Write the tests**

The 3-level happy path needs a chain. Reuse the existing fixtures by creating a self-referencing relation: add a field `parentTeam: RELATION → FilterTeam2` to `FilterTeam2` in the setup `it`, then nest `team.is.parentTeam.is.parentTeam.is.slug` (3 levels deep, all single-target self-ref).

For the depth-cap test, build a 6-level nested filter literal and assert the response carries the 400 / `errors[0].message` matching `relation filter nesting exceeds maximum depth`.

```typescript
it('allows nesting up to MAX_RELATION_FILTER_DEPTH', async () => {
  // 5-level chain: team.is.parentTeam.is.parentTeam.is.parentTeam.is.parentTeam.is.slug
  // (depths 1..5). Should resolve without error even if it returns no rows.
  const query = `{
      filterPlayer2List(first: 10, where: {
        team: { is: { parentTeam: { is: { parentTeam: { is: { parentTeam: { is: { parentTeam: { is: { slug: { equals: "team-a" } } } } } } } } } } }
      }) { edges { node { id } } }
    }`;
  const res = await gql<{ filterPlayer2List: Connection<{ id: string }> }>(
    query
  );
  expect(res.errors).toBeUndefined();
  expect(Array.isArray(res.data.filterPlayer2List.edges)).toBe(true);
});

it('rejects nesting beyond MAX_RELATION_FILTER_DEPTH', async () => {
  // 6-level chain — depth 6 exceeds the cap.
  const query = `{
      filterPlayer2List(first: 10, where: {
        team: { is: { parentTeam: { is: { parentTeam: { is: { parentTeam: { is: { parentTeam: { is: { parentTeam: { is: { slug: { equals: "team-a" } } } } } } } } } } } } }
      }) { edges { node { id } } }
    }`;
  const res = await gql<{ filterPlayer2List: Connection<{ id: string }> }>(
    query
  );
  expect(res.errors?.[0]?.message).toMatch(
    /relation filter nesting exceeds maximum depth/
  );
});
```

The setup `it` from Task 2 needs amending to add the self-referencing `parentTeam` field to `FilterTeam2`. Wire it via `POST /api/content-types/[id]/fields` after `FilterTeam2` exists.

- [ ] **Step 2: Run the tests**

Expected: depth-5 passes, depth-6 fails with the exact error message thrown by `buildEntryConditions`.

- [ ] **Step 3: Verify error surfacing in GraphQL response**

GraphQL Yoga wraps thrown errors into `errors[]`. The H3 `createError({ statusCode: 400, ... })` should produce a GraphQL error with the statusMessage as the message. If the test fails because the error is being masked (production-mode masking of internal errors), confirm `setup({ dev: true })` is in use (per CLAUDE.md testing notes) and that the error class is whitelisted by Yoga's `maskedErrors` handling. If masking is still in effect, throw `new GraphQLError(...)` directly instead of `createError`.

- [ ] **Step 4: Commit**

```bash
git add apps/cms/server/graphql/jsonbFilters.ts apps/cms/server/api/graphql/graphql.test.ts
git commit -m "feat(graphql): enforce MAX_RELATION_FILTER_DEPTH on nested relation filters"
```

---

## Task 6: Cleanup test fixtures + final integration sweep

**Files:**

- Modify: `apps/cms/server/api/graphql/graphql.test.ts` — append a cleanup `it` to the `describe('Nested relation filtering', ...)` block.

- [ ] **Step 1: Add cleanup `it`**

Mirror PR #140's cleanup pattern: delete every entry id, then every content type id (in dependency order so referenced types delete cleanly). Wrap each call with `.catch(() => {})` so a partial setup failure doesn't mask the real error in earlier tests.

- [ ] **Step 2: Run the full GraphQL test file**

```bash
pnpm --filter cms test apps/cms/server/api/graphql/graphql.test.ts
```

Expected: every test passes; no fixture residue.

- [ ] **Step 3: Run the full integration suite**

```bash
pnpm --filter cms test:integration
```

Expected: clean.

- [ ] **Step 4: Run typecheck and lint**

```bash
pnpm --filter cms typecheck
pnpm --filter cms lint
```

Expected: both clean. If lint surfaces unused-variable warnings on new test fixtures, prefix names with `_` (project convention: `varsIgnorePattern: '^_'`).

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/api/graphql/graphql.test.ts
git commit -m "test(graphql): clean up nested-relation-filtering fixtures"
```

---

## Task 7: Document the new filters in CLAUDE.md

**Files:**

- Modify: `CLAUDE.md` — the bullet describing GraphQL "Where filtering" (currently updated by PR #140).

- [ ] **Step 1: Find the existing entry**

```bash
grep -n "Where filtering" CLAUDE.md
```

- [ ] **Step 2: Replace it**

Append to the existing bullet (added by PR #140):

```
Single-target RELATION fields additionally accept `is: <TargetWhere>`, and single-target MULTIRELATION fields additionally accept `some: <TargetWhere>`, for nested traversal (e.g. `where: { author: { is: { slug: { equals: "olly" } } } }`). Polymorphic (multi-target) relations stay on the shared flat inputs — no nested filtering. Nesting is capped at 5 levels via `MAX_RELATION_FILTER_DEPTH`; exceeding the cap returns a 400 GraphQL error.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document GraphQL nested relation filters"
```

---

## Final checklist

- [ ] `pnpm --filter cms test:integration` passes.
- [ ] `pnpm --filter cms typecheck` clean.
- [ ] `pnpm --filter cms lint` clean.
- [ ] Manual smoke: hit GraphiQL in dev (`pnpm dev` → `/api/graphql`) and run `articleList(where: { author: { is: { slug: { equals: "..." } } } })` against seeded rugby data — confirm round-trip works end-to-end.
- [ ] CLAUDE.md updated.
- [ ] All commits pushed.
