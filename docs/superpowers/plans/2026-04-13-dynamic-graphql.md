# Dynamic Content Type GraphQL API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose dynamic content types as strongly-typed GraphQL types with Relay pagination, JSONB filtering, and automatic schema rebuild on content type mutations.

**Architecture:** Fresh Pothos `SchemaBuilder` per rebuild. Static types refactored from side-effect imports to callable registration functions. Dynamic types registered programmatically from DB content type definitions. Schema cached and invalidated on content type mutations. Yoga resolves schema per-request via async factory.

**Tech Stack:** Pothos SchemaBuilder, @pothos/plugin-relay, @pothos/plugin-prisma, GraphQL Yoga, Prisma raw SQL for JSONB filtering

**Spec:** `docs/superpowers/specs/2026-04-13-dynamic-graphql-design.md`

---

### Task 1: Refactor builder.ts to factory function

**Files:**

- Modify: `server/graphql/builder.ts`

- [ ] **Step 1: Convert singleton to factory**

Replace the entire file. The builder is no longer a singleton — `createBuilder()` creates a fresh instance. Scalars are registered inside the factory. Export the builder type for use in registration functions.

```typescript
import SchemaBuilder from '@pothos/core';
import PrismaPlugin from '@pothos/plugin-prisma';
import PrismaUtilsPlugin from '@pothos/plugin-prisma-utils';
import RelayPlugin from '@pothos/plugin-relay';
import type PrismaTypes from '#generated/pothos-types';
import { getDatamodel } from '#generated/pothos-types';
import { prisma } from '../utils/prisma';

export type Builder = InstanceType<typeof SchemaBuilder<BuilderTypes>>;

type BuilderTypes = {
  PrismaTypes: PrismaTypes;
  Scalars: {
    DateTime: { Input: Date | string; Output: Date | string };
    JSON: {
      Input: unknown;
      Output: unknown;
    };
  };
};

export function createBuilder(): Builder {
  const builder = new SchemaBuilder<BuilderTypes>({
    plugins: [PrismaPlugin, PrismaUtilsPlugin, RelayPlugin],
    prisma: {
      client: prisma,
      dmmf: getDatamodel(),
    },
    relay: {},
  });

  builder.scalarType('DateTime', {
    serialize: (value) =>
      value instanceof Date ? value.toISOString() : String(value),
    parseValue: (value) => new Date(String(value)),
  });

  builder.scalarType('JSON', {
    serialize: (value) => value,
    parseValue: (value) => value,
  });

  return builder;
}
```

- [ ] **Step 2: Commit**

```bash
git add server/graphql/builder.ts
git commit -m "refactor: convert GraphQL builder from singleton to factory function"
```

---

### Task 2: Refactor static type and filter registration to callable functions

Every file in `server/graphql/types/`, plus `server/graphql/filters.ts` and `server/graphql/query/index.ts`, needs to be converted from side-effect registration to an exported function that takes `builder` (and dependencies) as args.

**Files:**

- Modify: `server/graphql/types/contentStatus.ts`
- Modify: `server/graphql/types/contentFields.ts`
- Modify: `server/graphql/types/score.ts`
- Modify: `server/graphql/types/image.ts`
- Modify: `server/graphql/types/position.ts`
- Modify: `server/graphql/types/season.ts`
- Modify: `server/graphql/types/team.ts`
- Modify: `server/graphql/types/club.ts`
- Modify: `server/graphql/types/competition.ts`
- Modify: `server/graphql/types/playerTeamHistory.ts`
- Modify: `server/graphql/types/teamsOnCompetitions.ts`
- Modify: `server/graphql/types/player.ts`
- Modify: `server/graphql/types/fixture.ts`
- Modify: `server/graphql/types/author.ts`
- Modify: `server/graphql/types/tagGroup.ts`
- Modify: `server/graphql/types/tag.ts`
- Modify: `server/graphql/types/article.ts`
- Modify: `server/graphql/types/link.ts`
- Modify: `server/graphql/types/navigationItem.ts`
- Modify: `server/graphql/types/navigation.ts`
- Modify: `server/graphql/filters.ts`
- Modify: `server/graphql/query/index.ts`

**Pattern:** Each file changes from:

```typescript
import { builder } from '../builder';
// ... side-effect registration ...
export const _registered = true;
```

To:

```typescript
import type { Builder } from '../builder';
export function registerXxxType(builder: Builder, deps: { ... }) {
  // ... same registration code, using builder param ...
  return ref; // if other files need a reference
}
```

- [ ] **Step 1: Refactor contentStatus.ts**

```typescript
import type { Builder } from '../builder';

export function registerContentStatusEnum(builder: Builder) {
  return builder.enumType('ContentStatus', {
    values: ['DRAFT', 'PUBLISHED', 'CHANGED', 'ARCHIVED'] as const,
  });
}

export type ContentStatusEnumRef = ReturnType<typeof registerContentStatusEnum>;
```

- [ ] **Step 2: Refactor contentFields.ts**

```typescript
import type { ContentStatusEnumRef } from './contentStatus';

export const contentMetadataFields = (
  t: any,
  ContentStatusEnum: ContentStatusEnumRef
) => ({
  entryTitle: t.exposeString('entryTitle'),
  status: t.expose('status', { type: ContentStatusEnum }),
  publishedAt: t.expose('publishedAt', { type: 'DateTime', nullable: true }),
  createdBy: t.exposeString('createdBy', { nullable: true }),
  updatedBy: t.exposeString('updatedBy', { nullable: true }),
});
```

- [ ] **Step 3: Refactor score.ts**

```typescript
import type { Builder } from '../builder';

export function registerScoreTypes(builder: Builder) {
  const ScoreTypeEnum = builder.enumType('ScoreType', {
    values: ['TRY', 'CONVERSION', 'PENALTY', 'DROP_GOAL'] as const,
  });

  builder.prismaObject('Score', {
    fields: (t) => ({
      id: t.exposeID('id'),
      type: t.expose('type', { type: ScoreTypeEnum }),
      minute: t.exposeInt('minute', { nullable: true }),
      createdAt: t.expose('createdAt', { type: 'DateTime' }),
      updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
      fixture: t.relation('fixture'),
      player: t.relation('player', { nullable: true }),
    }),
  });

  return { ScoreTypeEnum };
}
```

- [ ] **Step 4: Refactor filters.ts**

The function takes the enum refs it needs and returns all Where refs. The full code follows the same structure as the current file but wraps it in a function, receiving `builder`, `ContentStatusEnum`, and `ScoreTypeEnum` as params. It returns an object with all exported Where refs.

```typescript
import type { Builder } from './builder';
import type { ContentStatusEnumRef } from './types/contentStatus';

export function registerStaticFilters(
  builder: Builder,
  ContentStatusEnum: ContentStatusEnumRef,
  ScoreTypeEnum: ReturnType<
    typeof import('./types/score').registerScoreTypes
  >['ScoreTypeEnum']
) {
  const StringFilter = builder.prismaFilter('String', {
    ops: ['contains', 'equals', 'startsWith', 'endsWith', 'not'],
  });
  const IntFilter = builder.prismaFilter('Int', {
    ops: ['equals', 'gt', 'gte', 'lt', 'lte', 'not'],
  });
  const BooleanFilter = builder.prismaFilter('Boolean', {
    ops: ['equals', 'not'],
  });
  const DateTimeFilter = builder.prismaFilter('DateTime', {
    ops: ['equals', 'gt', 'gte', 'lt', 'lte', 'not'],
  });
  const ContentStatusFilter = builder.prismaFilter(ContentStatusEnum, {
    ops: ['equals', 'not'],
  });
  const ScoreTypeFilter = builder.prismaFilter(ScoreTypeEnum, {
    ops: ['equals', 'not'],
  });

  // ... all Where definitions (same code as current, using local refs) ...
  // Return all the Where refs in an object:

  const TeamWhere = builder.prismaWhere('Team', {
    fields: {
      entryTitle: StringFilter,
      name: StringFilter,
      slug: StringFilter,
      status: ContentStatusFilter,
    },
  });
  // ... (same for all other Where types) ...

  return {
    StringFilter,
    IntFilter,
    BooleanFilter,
    DateTimeFilter,
    ContentStatusFilter,
    ScoreTypeFilter,
    TeamWhere,
    ClubWhere,
    CompetitionWhere,
    SeasonWhere,
    PositionWhere,
    ImageWhere,
    PlayerWhere,
    FixtureWhere,
    PlayerTeamHistoryWhere,
    ScoreWhere,
    AuthorWhere,
    TagGroupWhere,
    TagWhere,
    ArticleWhere,
    LinkWhere,
    NavigationWhere,
  };
}

export type StaticFilterRefs = ReturnType<typeof registerStaticFilters>;
```

Copy the full body of the current `filters.ts` into the function, replacing all top-level `const` declarations. Every reference to `builder` uses the parameter.

- [ ] **Step 5: Refactor all type files**

Each type file follows the pattern. Every file:

1. Remove `import { builder } from '../builder'`
2. Add `import type { Builder } from '../builder'`
3. Wrap in `export function register___Type(builder: Builder, deps: { ... }) { ... }`
4. Add filter refs to `deps` if the type uses them
5. Pass `ContentStatusEnum` to `contentMetadataFields(t, deps.ContentStatusEnum)` where used
6. Remove `export const _registered = true`
7. Return any refs other files need

Example for `team.ts`:

```typescript
import type { Builder } from '../builder';
import type { ContentStatusEnumRef } from './contentStatus';
import type { StaticFilterRefs } from '../filters';
import { contentMetadataFields } from './contentFields';

export function registerTeamType(
  builder: Builder,
  filters: StaticFilterRefs,
  ContentStatusEnum: ContentStatusEnumRef
) {
  builder.prismaObject('Team', {
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      slug: t.exposeString('slug'),
      ...contentMetadataFields(t, ContentStatusEnum),
      createdAt: t.expose('createdAt', { type: 'DateTime' }),
      updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
      competitions: t.relatedConnection('competitions', {
        cursor: 'teamId_competitionId',
      }),
      playerHistory: t.relatedConnection('playerHistory', {
        cursor: 'id',
        args: { where: t.arg({ type: filters.PlayerTeamHistoryWhere }) },
        query: (args) => ({ where: args.where ?? undefined }),
      }),
      fixtures: t.relatedConnection('fixtures', {
        cursor: 'id',
        args: { where: t.arg({ type: filters.FixtureWhere }) },
        query: (args) => ({ where: args.where ?? undefined }),
      }),
    }),
  });
}
```

Apply this same pattern to all remaining type files:

- `image.ts` — no filter deps, receives `ContentStatusEnum`
- `position.ts` — receives `filters.PlayerWhere`
- `season.ts` — receives `filters.CompetitionWhere`, `filters.FixtureWhere`, `ContentStatusEnum`
- `club.ts` — receives `filters.FixtureWhere`, `ContentStatusEnum`
- `competition.ts` — receives `filters.FixtureWhere`, `ContentStatusEnum`
- `playerTeamHistory.ts` — no deps
- `teamsOnCompetitions.ts` — no deps
- `player.ts` — receives `filters.PlayerTeamHistoryWhere`, `filters.ScoreWhere`, `ContentStatusEnum`
- `fixture.ts` — receives `filters.ScoreWhere`, `ContentStatusEnum`
- `author.ts` — receives `filters.ArticleWhere`, `ContentStatusEnum`, returns nothing special
- `tagGroup.ts` — receives `filters.TagWhere`, `ContentStatusEnum`
- `tag.ts` — receives `filters.ArticleWhere`, `ContentStatusEnum`
- `article.ts` — receives `filters.TagWhere`, `ContentStatusEnum`, **returns `ArticleRef`**
- `link.ts` — receives `ContentStatusEnum` and `ArticleRef` from article.ts
- `navigationItem.ts` — no deps
- `navigation.ts` — receives `ContentStatusEnum`

- [ ] **Step 6: Refactor query/index.ts**

```typescript
import type { Builder } from '../builder';
import type { StaticFilterRefs } from '../filters';
import { prisma } from '../../utils/prisma';

export function registerStaticQueries(
  builder: Builder,
  filters: StaticFilterRefs
) {
  builder.queryType({
    fields: (t) => ({
      // ... same fields as current, using filters.XxxWhere ...
      images: t.prismaConnection({
        type: 'Image',
        cursor: 'id',
        args: { where: t.arg({ type: filters.ImageWhere }) },
        resolve: (query, _root, args) =>
          prisma.image.findMany({ ...query, where: args.where ?? undefined }),
      }),
      image: t.prismaField({
        type: 'Image',
        nullable: true,
        args: { id: t.arg.string({ required: true }) },
        resolve: (query, _root, args) =>
          prisma.image.findUnique({ ...query, where: { id: args.id } }),
      }),
      // ... all other static queries (same code, using filters param) ...
    }),
  });
}
```

- [ ] **Step 7: Commit**

```bash
git add server/graphql/types/ server/graphql/filters.ts server/graphql/query/index.ts
git commit -m "refactor: convert static GraphQL types/filters/queries to callable registration functions"
```

---

### Task 3: Create buildSchema.ts orchestrator and update schema.ts

**Files:**

- Create: `server/graphql/buildSchema.ts`
- Modify: `server/graphql/schema.ts`

- [ ] **Step 1: Create buildSchema.ts**

This is the orchestrator that creates a fresh builder and calls all registration functions in dependency order.

```typescript
import type { GraphQLSchema } from 'graphql';
import { createBuilder } from './builder';
import { registerContentStatusEnum } from './types/contentStatus';
import { registerScoreTypes } from './types/score';
import { registerStaticFilters } from './filters';
import { registerImageType } from './types/image';
import { registerPositionType } from './types/position';
import { registerSeasonType } from './types/season';
import { registerTeamType } from './types/team';
import { registerClubType } from './types/club';
import { registerCompetitionType } from './types/competition';
import { registerPlayerTeamHistoryType } from './types/playerTeamHistory';
import { registerTeamsOnCompetitionsType } from './types/teamsOnCompetitions';
import { registerPlayerType } from './types/player';
import { registerFixtureType } from './types/fixture';
import { registerAuthorType } from './types/author';
import { registerTagGroupType } from './types/tagGroup';
import { registerTagType } from './types/tag';
import { registerArticleType } from './types/article';
import { registerLinkType } from './types/link';
import { registerNavigationItemType } from './types/navigationItem';
import { registerNavigationType } from './types/navigation';
import { registerStaticQueries } from './query/index';

export async function buildSchema(): Promise<GraphQLSchema> {
  const builder = createBuilder();

  // 1. Shared enums
  const ContentStatusEnum = registerContentStatusEnum(builder);
  const { ScoreTypeEnum } = registerScoreTypes(builder);

  // 2. Static filters
  const filters = registerStaticFilters(
    builder,
    ContentStatusEnum,
    ScoreTypeEnum
  );

  // 3. Static types (dependency order matters for ArticleRef)
  registerImageType(builder, ContentStatusEnum);
  registerPositionType(builder, filters);
  registerSeasonType(builder, filters, ContentStatusEnum);
  registerTeamType(builder, filters, ContentStatusEnum);
  registerClubType(builder, filters, ContentStatusEnum);
  registerCompetitionType(builder, filters, ContentStatusEnum);
  registerPlayerTeamHistoryType(builder);
  registerTeamsOnCompetitionsType(builder);
  registerPlayerType(builder, filters, ContentStatusEnum);
  registerFixtureType(builder, filters, ContentStatusEnum);
  registerAuthorType(builder, filters, ContentStatusEnum);
  registerTagGroupType(builder, filters, ContentStatusEnum);
  registerTagType(builder, filters, ContentStatusEnum);
  const ArticleRef = registerArticleType(builder, filters, ContentStatusEnum);
  registerLinkType(builder, ContentStatusEnum, ArticleRef);
  registerNavigationItemType(builder);
  registerNavigationType(builder, ContentStatusEnum);

  // 4. Static queries
  registerStaticQueries(builder, filters);

  // 5. Dynamic types (Task 6 adds this)
  // const contentTypes = await prisma.contentType.findMany({ include: { fields: { orderBy: { order: 'asc' } } } });
  // registerDynamicTypes(builder, contentTypes, ContentStatusEnum);

  return builder.toSchema();
}
```

- [ ] **Step 2: Update schema.ts with caching and invalidation**

Replace the entire file:

```typescript
import type { GraphQLSchema } from 'graphql';
import { buildSchema } from './buildSchema';

let cachedSchema: GraphQLSchema | null = null;
let buildPromise: Promise<GraphQLSchema> | null = null;

export async function getSchema(): Promise<GraphQLSchema> {
  if (cachedSchema) return cachedSchema;

  // Prevent concurrent builds
  if (!buildPromise) {
    buildPromise = buildSchema().then((schema) => {
      cachedSchema = schema;
      buildPromise = null;
      return schema;
    });
  }

  return buildPromise;
}

export function invalidateSchema(): void {
  cachedSchema = null;
  buildPromise = null;
}
```

- [ ] **Step 3: Commit**

```bash
git add server/graphql/buildSchema.ts server/graphql/schema.ts
git commit -m "refactor: add schema build orchestrator with caching and invalidation"
```

---

### Task 4: Update Yoga endpoint for async schema

**Files:**

- Modify: `server/api/graphql/graphql.ts`

- [ ] **Step 1: Change Yoga to use async schema factory**

```typescript
import { createYoga } from 'graphql-yoga';
import { defineEventHandler } from 'h3';
import { maxDepthPlugin } from '@escape.tech/graphql-armor-max-depth';
import { getSchema } from '../../graphql/schema';

const yoga = createYoga({
  schema: () => getSchema(),
  graphqlEndpoint: '/api/graphql',
  graphiql: process.env.NODE_ENV !== 'production',
  plugins: [maxDepthPlugin({ n: 15 })],
});

export default defineEventHandler(async (event) => {
  const { req, res } = event.node;

  if (req.method === 'GET' && process.env.NODE_ENV !== 'production') {
    return yoga(req, res);
  }

  const result = await validateApiKey(event);
  if (!result.valid) {
    setResponseStatus(event, 401);
    return { error: result.message };
  }

  return yoga(req, res);
});
```

The key change: `schema: getSchema()` (one-time call) → `schema: () => getSchema()` (called per-request, returns cached schema or triggers rebuild).

- [ ] **Step 2: Commit**

```bash
git add server/api/graphql/graphql.ts
git commit -m "refactor: use async schema factory in GraphQL Yoga endpoint"
```

---

### Task 5: Verify all existing tests pass

- [ ] **Step 1: Run the full test suite**

```bash
pnpm test:run
```

Expected: All existing tests pass (30+ GraphQL tests, fixtures, lists, content, auth, images, authors, tags, articles, links, navigations, content types, content entries). The refactoring should be purely structural — no behavior change.

- [ ] **Step 2: If any test fails, fix the registration issue before proceeding**

Common issues:

- Missing dependency passed to a registration function
- Filter ref used before it's created
- Import path typo

---

### Task 6: ContentEntry interface and scalar dynamic types

**Files:**

- Create: `server/graphql/dynamicTypes.ts`
- Modify: `server/graphql/buildSchema.ts` (uncomment dynamic registration)
- Modify: `server/api/graphql/graphql.test.ts` (add tests)

- [ ] **Step 1: Write tests for dynamic type queries**

Add a new `describe` block to `server/api/graphql/graphql.test.ts`. These tests use the seeded `BlogPost` content type which has scalar fields only.

```typescript
describe('Dynamic content type queries', () => {
  it('queries a dynamic type list with typed fields', async () => {
    const { data } = await gql<{
      blogPostList: Connection<{
        id: string;
        contentType: string;
        status: string;
        title: string;
        slug: string;
        summary: string | null;
        publishDate: string | null;
        featured: boolean | null;
        category: string | null;
      }>;
    }>(`{
      blogPostList(first: 10) {
        edges {
          node {
            id contentType status title slug summary
            publishDate featured category
          }
          cursor
        }
        pageInfo { hasNextPage endCursor }
      }
    }`);
    expect(data.blogPostList.edges.length).toBe(2);
    const node = data.blogPostList.edges[0]!.node;
    expect(node.contentType).toBe('BlogPost');
    expect(node.title).toBeTruthy();
    expect(node.status).toBe('PUBLISHED');
  });

  it('fetches a single dynamic entry by ID', async () => {
    const { data: list } = await gql<{
      blogPostList: Connection<{ id: string }>;
    }>('{ blogPostList(first: 1) { edges { node { id } } } }');
    const id = list.blogPostList.edges[0]!.node.id;

    const { data } = await gql<{
      blogPost: { id: string; title: string; contentType: string } | null;
    }>(`{ blogPost(id: "${id}") { id title contentType } }`);
    expect(data.blogPost).not.toBeNull();
    expect(data.blogPost!.id).toBe(id);
    expect(data.blogPost!.contentType).toBe('BlogPost');
  });

  it('fetches a single dynamic entry by slug', async () => {
    const { data } = await gql<{
      blogPostBySlug: { id: string; title: string; slug: string } | null;
    }>('{ blogPostBySlug(slug: "welcome-to-the-club") { id title slug } }');
    expect(data.blogPostBySlug).not.toBeNull();
    expect(data.blogPostBySlug!.slug).toBe('welcome-to-the-club');
    expect(data.blogPostBySlug!.title).toBe('Welcome to the Club');
  });

  it('returns null for non-existent ID on dynamic type', async () => {
    const { data } = await gql<{ blogPost: null }>(
      '{ blogPost(id: "00000000-0000-0000-0000-000000000000") { id } }'
    );
    expect(data.blogPost).toBeNull();
  });

  it('returns null for non-existent slug on dynamic type', async () => {
    const { data } = await gql<{ blogPostBySlug: null }>(
      '{ blogPostBySlug(slug: "does-not-exist") { id } }'
    );
    expect(data.blogPostBySlug).toBeNull();
  });

  it('paginates dynamic type list with first/after', async () => {
    const { data: page1 } = await gql<{
      blogPostList: Connection<{ id: string; title: string }>;
    }>(`{
      blogPostList(first: 1) {
        edges { node { id title } cursor }
        pageInfo { hasNextPage endCursor }
      }
    }`);
    expect(page1.blogPostList.edges.length).toBe(1);
    expect(page1.blogPostList.pageInfo.hasNextPage).toBe(true);

    const cursor = page1.blogPostList.pageInfo.endCursor!;
    const { data: page2 } = await gql<{
      blogPostList: Connection<{ id: string; title: string }>;
    }>(`{
      blogPostList(first: 1, after: "${cursor}") {
        edges { node { id title } cursor }
        pageInfo { hasNextPage endCursor }
      }
    }`);
    expect(page2.blogPostList.edges.length).toBe(1);
    expect(page2.blogPostList.edges[0]!.node.id).not.toBe(
      page1.blogPostList.edges[0]!.node.id
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test:run -- server/api/graphql/graphql.test.ts
```

Expected: New tests fail (blogPostList query not found in schema).

- [ ] **Step 3: Create dynamicTypes.ts with scalar field registration**

```typescript
import type { Builder } from './builder';
import type { ContentStatusEnumRef } from './types/contentStatus';
import { resolveOffsetConnection } from '@pothos/plugin-relay';
import { prisma } from '../utils/prisma';

interface ContentTypeWithFields {
  id: string;
  name: string;
  identifier: string;
  fields: Array<{
    id: string;
    identifier: string;
    name: string;
    type: string;
    required: boolean;
    options: unknown;
    order: number;
  }>;
}

const FIELD_TYPE_TO_SCALAR: Record<string, string | null> = {
  ENTRY_TITLE: 'String',
  SLUG: 'String',
  TEXT: 'String',
  TEXTAREA: 'String',
  NUMBER: 'Float',
  BOOLEAN: 'Boolean',
  DATETIME: 'DateTime',
  SELECT: 'String',
  RICHTEXT: 'JSON',
};

function toCamelCase(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

export function registerDynamicTypes(
  builder: Builder,
  contentTypes: ContentTypeWithFields[],
  ContentStatusEnum: ContentStatusEnumRef
) {
  // Build a map of contentTypeId → identifier for resolvers
  const typeIdToIdentifier = new Map<string, string>();
  for (const ct of contentTypes) {
    typeIdToIdentifier.set(ct.id, ct.identifier);
  }

  // Register the ContentEntry interface
  const ContentEntryInterface = builder.interfaceType('ContentEntry', {
    fields: (t) => ({
      id: t.id(),
      contentType: t.string(),
      status: t.field({ type: ContentStatusEnum }),
      publishedAt: t.field({ type: 'DateTime', nullable: true }),
      createdAt: t.field({ type: 'DateTime' }),
      updatedAt: t.field({ type: 'DateTime' }),
    }),
    resolveType: (entry: any) => {
      return typeIdToIdentifier.get(entry.contentTypeId) ?? 'ContentEntry';
    },
  });

  // Track object refs for relation resolution (Task 8)
  const typeRefs = new Map<string, any>();

  for (const ct of contentTypes) {
    const scalarFields = ct.fields.filter(
      (f) => FIELD_TYPE_TO_SCALAR[f.type] !== undefined
    );

    // Register the object type
    const ref = builder.objectType(ct.identifier, {
      interfaces: [ContentEntryInterface],
      fields: (t) => {
        const fields: Record<string, any> = {
          // Interface fields
          id: t.id({ resolve: (entry: any) => entry.id }),
          contentType: t.string({
            resolve: () => ct.identifier,
          }),
          status: t.field({
            type: ContentStatusEnum,
            resolve: (entry: any) => entry.status,
          }),
          publishedAt: t.field({
            type: 'DateTime',
            nullable: true,
            resolve: (entry: any) => entry.publishedAt,
          }),
          createdAt: t.field({
            type: 'DateTime',
            resolve: (entry: any) => entry.createdAt,
          }),
          updatedAt: t.field({
            type: 'DateTime',
            resolve: (entry: any) => entry.updatedAt,
          }),
        };

        // User-defined scalar fields
        for (const field of scalarFields) {
          const scalarType = FIELD_TYPE_TO_SCALAR[field.type]!;
          const isRequired = field.required || field.type === 'ENTRY_TITLE';

          fields[field.identifier] = t.field({
            type: scalarType,
            nullable: !isRequired,
            resolve: (entry: any) => {
              const data =
                typeof entry.data === 'string'
                  ? JSON.parse(entry.data)
                  : entry.data;
              return data?.[field.identifier] ?? null;
            },
          });
        }

        return fields;
      },
    });

    typeRefs.set(ct.id, ref);

    // Register per-type list query
    const camelName = toCamelCase(ct.identifier);

    builder.queryField(`${camelName}List`, (t) =>
      t.connection({
        type: ref,
        resolve: (_root, args) =>
          resolveOffsetConnection({ args }, async ({ limit, offset }) => {
            return prisma.contentEntry.findMany({
              where: { contentTypeId: ct.id },
              take: limit,
              skip: offset,
              orderBy: { createdAt: 'desc' },
            });
          }),
      })
    );

    // Register single by ID query
    builder.queryField(camelName, (t) =>
      t.field({
        type: ref,
        nullable: true,
        args: { id: t.arg.id({ required: true }) },
        resolve: async (_root, args) => {
          return prisma.contentEntry.findFirst({
            where: { id: String(args.id), contentTypeId: ct.id },
          });
        },
      })
    );

    // Register single by slug query (only if type has a SLUG field)
    const hasSlug = ct.fields.some((f) => f.type === 'SLUG');
    if (hasSlug) {
      builder.queryField(`${camelName}BySlug`, (t) =>
        t.field({
          type: ref,
          nullable: true,
          args: { slug: t.arg.string({ required: true }) },
          resolve: async (_root, args) => {
            return prisma.contentEntry.findFirst({
              where: { contentTypeId: ct.id, slug: args.slug },
            });
          },
        })
      );
    }
  }

  return { typeRefs, ContentEntryInterface, typeIdToIdentifier };
}
```

- [ ] **Step 4: Uncomment dynamic registration in buildSchema.ts**

Add the import and call:

```typescript
import { registerDynamicTypes } from './dynamicTypes';
import { prisma } from '../utils/prisma';
```

At the end of `buildSchema()`, before `return builder.toSchema()`:

```typescript
// 5. Dynamic types
const contentTypes = await prisma.contentType.findMany({
  include: { fields: { orderBy: { order: 'asc' } } },
});
registerDynamicTypes(builder, contentTypes, ContentStatusEnum);

return builder.toSchema();
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm test:run -- server/api/graphql/graphql.test.ts
```

Expected: All new dynamic type tests pass. All existing static tests still pass.

- [ ] **Step 6: Commit**

```bash
git add server/graphql/dynamicTypes.ts server/graphql/buildSchema.ts server/api/graphql/graphql.test.ts
git commit -m "feat: register dynamic content types as strongly-typed GraphQL types"
```

---

### Task 7: JSONB filtering for dynamic types

**Files:**

- Create: `server/graphql/jsonbFilters.ts`
- Modify: `server/graphql/dynamicTypes.ts` (add where args to list queries)
- Modify: `server/api/graphql/graphql.test.ts` (add filter tests)

- [ ] **Step 1: Write filter tests**

```typescript
describe('Dynamic type filtering', () => {
  it('filters by status', async () => {
    const { data } = await gql<{
      blogPostList: Connection<{ id: string; status: string }>;
    }>(`{
      blogPostList(first: 10, where: { status: { equals: PUBLISHED } }) {
        edges { node { id status } }
      }
    }`);
    expect(data.blogPostList.edges.length).toBe(2);
    data.blogPostList.edges.forEach((edge) => {
      expect(edge.node.status).toBe('PUBLISHED');
    });
  });

  it('filters by string field equals', async () => {
    const { data } = await gql<{
      blogPostList: Connection<{ id: string; category: string | null }>;
    }>(`{
      blogPostList(first: 10, where: { category: { equals: "community" } }) {
        edges { node { id category } }
      }
    }`);
    expect(data.blogPostList.edges.length).toBe(1);
    expect(data.blogPostList.edges[0]!.node.category).toBe('community');
  });

  it('filters by string field contains', async () => {
    const { data } = await gql<{
      blogPostList: Connection<{ id: string; title: string }>;
    }>(`{
      blogPostList(first: 10, where: { title: { contains: "welcome" } }) {
        edges { node { id title } }
      }
    }`);
    expect(data.blogPostList.edges.length).toBe(1);
    expect(data.blogPostList.edges[0]!.node.title).toContain('Welcome');
  });

  it('filters by boolean field equals', async () => {
    const { data } = await gql<{
      blogPostList: Connection<{ id: string; featured: boolean | null }>;
    }>(`{
      blogPostList(first: 10, where: { featured: { equals: true } }) {
        edges { node { id featured } }
      }
    }`);
    expect(data.blogPostList.edges.length).toBe(1);
    expect(data.blogPostList.edges[0]!.node.featured).toBe(true);
  });

  it('filters by datetime field range', async () => {
    const { data } = await gql<{
      blogPostList: Connection<{
        id: string;
        publishDate: string | null;
      }>;
    }>(`{
      blogPostList(first: 10, where: { publishDate: { gte: "2026-01-20T00:00:00.000Z" } }) {
        edges { node { id publishDate } }
      }
    }`);
    expect(data.blogPostList.edges.length).toBe(1);
    expect(
      new Date(data.blogPostList.edges[0]!.node.publishDate!).getTime()
    ).toBeGreaterThanOrEqual(new Date('2026-01-20').getTime());
  });

  it('returns empty connection for no filter matches', async () => {
    const { data } = await gql<{
      blogPostList: Connection<{ id: string }>;
    }>(`{
      blogPostList(first: 10, where: { title: { equals: "Nonexistent" } }) {
        edges { node { id } }
      }
    }`);
    expect(data.blogPostList.edges).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test:run -- server/api/graphql/graphql.test.ts
```

Expected: Filter tests fail (where arg not accepted on blogPostList).

- [ ] **Step 3: Create jsonbFilters.ts**

This file handles:

1. Registering shared filter input types (for dynamic type where inputs)
2. Building Prisma-compatible `where` conditions for system fields
3. Building raw SQL `WHERE` clauses for JSONB field conditions
4. A combined query function that uses Prisma for system-only or raw SQL when JSONB filters present

```typescript
import type { Builder } from './builder';
import type { ContentStatusEnumRef } from './types/contentStatus';
import { Prisma } from '#prisma';
import { prisma } from '../utils/prisma';

export function registerDynamicFilterInputs(
  builder: Builder,
  ContentStatusEnum: ContentStatusEnumRef
) {
  const DynStringFilter = builder.inputType('DynStringFilter', {
    fields: (t) => ({
      equals: t.string(),
      contains: t.string(),
    }),
  });

  const DynFloatFilter = builder.inputType('DynFloatFilter', {
    fields: (t) => ({
      equals: t.float(),
      gt: t.float(),
      gte: t.float(),
      lt: t.float(),
      lte: t.float(),
    }),
  });

  const DynBooleanFilter = builder.inputType('DynBooleanFilter', {
    fields: (t) => ({
      equals: t.boolean(),
    }),
  });

  const DynDateTimeFilter = builder.inputType('DynDateTimeFilter', {
    fields: (t) => ({
      equals: t.field({ type: 'DateTime' }),
      gt: t.field({ type: 'DateTime' }),
      gte: t.field({ type: 'DateTime' }),
      lt: t.field({ type: 'DateTime' }),
      lte: t.field({ type: 'DateTime' }),
    }),
  });

  const DynContentStatusFilter = builder.inputType('DynContentStatusFilter', {
    fields: (t) => ({
      equals: t.field({ type: ContentStatusEnum }),
    }),
  });

  return {
    DynStringFilter,
    DynFloatFilter,
    DynBooleanFilter,
    DynDateTimeFilter,
    DynContentStatusFilter,
  };
}

export type DynFilterRefs = ReturnType<typeof registerDynamicFilterInputs>;

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
  RELATION: null,
  MULTIRELATION: null,
};

export function getFilterKeyForFieldType(
  fieldType: string
): keyof DynFilterRefs | null {
  return FIELD_TYPE_TO_FILTER_KEY[fieldType] ?? null;
}

interface JsonbCondition {
  sql: Prisma.Sql;
}

interface WhereArgs {
  status?: { equals?: string } | null;
  createdAt?: Record<string, unknown> | null;
  updatedAt?: Record<string, unknown> | null;
  [key: string]: unknown;
}

interface FieldDef {
  identifier: string;
  type: string;
}

function buildDateConditions(
  identifier: string,
  filter: Record<string, unknown>,
  isJsonb: boolean
): JsonbCondition[] {
  const conditions: JsonbCondition[] = [];
  const ops = ['equals', 'gt', 'gte', 'lt', 'lte'] as const;
  const sqlOps: Record<string, string> = {
    equals: '=',
    gt: '>',
    gte: '>=',
    lt: '<',
    lte: '<=',
  };

  for (const op of ops) {
    if (filter[op] != null) {
      const value =
        filter[op] instanceof Date
          ? (filter[op] as Date).toISOString()
          : String(filter[op]);
      if (isJsonb) {
        conditions.push({
          sql: Prisma.sql`(data->>${Prisma.raw(`'${identifier}'`)})::timestamptz ${Prisma.raw(sqlOps[op]!)} ${value}::timestamptz`,
        });
      } else {
        conditions.push({
          sql: Prisma.sql`${Prisma.raw(`"${identifier}"`)} ${Prisma.raw(sqlOps[op]!)} ${value}::timestamptz`,
        });
      }
    }
  }
  return conditions;
}

export async function queryDynamicEntries(
  contentTypeId: string,
  whereArgs: WhereArgs | null | undefined,
  fields: FieldDef[],
  limit: number,
  offset: number
): Promise<any[]> {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`"contentTypeId" = ${contentTypeId}`,
  ];

  if (whereArgs) {
    // System field: status
    if (whereArgs.status?.equals) {
      conditions.push(Prisma.sql`"status" = ${whereArgs.status.equals}`);
    }

    // System fields: createdAt, updatedAt
    for (const sysField of ['createdAt', 'updatedAt'] as const) {
      if (whereArgs[sysField] && typeof whereArgs[sysField] === 'object') {
        const dateConditions = buildDateConditions(
          sysField,
          whereArgs[sysField] as Record<string, unknown>,
          false
        );
        conditions.push(...dateConditions.map((c) => c.sql));
      }
    }

    // JSONB field filters
    for (const field of fields) {
      const filterValue = whereArgs[field.identifier];
      if (!filterValue || typeof filterValue !== 'object') continue;
      const filter = filterValue as Record<string, unknown>;

      if (
        field.type === 'ENTRY_TITLE' ||
        field.type === 'SLUG' ||
        field.type === 'TEXT' ||
        field.type === 'TEXTAREA' ||
        field.type === 'SELECT'
      ) {
        if (filter.equals != null) {
          conditions.push(
            Prisma.sql`data->>${Prisma.raw(`'${field.identifier}'`)} = ${String(filter.equals)}`
          );
        }
        if (filter.contains != null) {
          conditions.push(
            Prisma.sql`data->>${Prisma.raw(`'${field.identifier}'`)} ILIKE ${'%' + String(filter.contains) + '%'}`
          );
        }
      } else if (field.type === 'NUMBER') {
        const numOps = ['equals', 'gt', 'gte', 'lt', 'lte'] as const;
        const sqlOps: Record<string, string> = {
          equals: '=',
          gt: '>',
          gte: '>=',
          lt: '<',
          lte: '<=',
        };
        for (const op of numOps) {
          if (filter[op] != null) {
            conditions.push(
              Prisma.sql`(data->>${Prisma.raw(`'${field.identifier}'`)})::float ${Prisma.raw(sqlOps[op]!)} ${Number(filter[op])}`
            );
          }
        }
      } else if (field.type === 'BOOLEAN') {
        if (filter.equals != null) {
          conditions.push(
            Prisma.sql`(data->>${Prisma.raw(`'${field.identifier}'`)})::boolean = ${Boolean(filter.equals)}`
          );
        }
      } else if (field.type === 'DATETIME') {
        const dateConditions = buildDateConditions(
          field.identifier,
          filter,
          true
        );
        conditions.push(...dateConditions.map((c) => c.sql));
      }
    }
  }

  const whereClause = Prisma.join(conditions, Prisma.sql` AND `);

  return prisma.$queryRaw`
    SELECT * FROM "ContentEntry"
    WHERE ${whereClause}
    ORDER BY "createdAt" DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}
```

- [ ] **Step 4: Update dynamicTypes.ts to register where inputs and wire filtering**

Add imports:

```typescript
import {
  registerDynamicFilterInputs,
  getFilterKeyForFieldType,
  queryDynamicEntries,
  type DynFilterRefs,
} from './jsonbFilters';
```

Add a `dynFilters` parameter to `registerDynamicTypes` and register per-type where inputs. Update the list query resolve function to use `queryDynamicEntries`:

In `registerDynamicTypes`, after creating `ContentEntryInterface`, register dynamic filter inputs:

```typescript
const dynFilters = registerDynamicFilterInputs(builder, ContentStatusEnum);
```

For each content type, register a where input type:

```typescript
// Build where input type
const filterableFields = ct.fields.filter(
  (f) => getFilterKeyForFieldType(f.type) !== null
);

const WhereInput = builder.inputType(`${ct.identifier}Where`, {
  fields: (t) => {
    const whereFields: Record<string, any> = {
      status: t.field({ type: dynFilters.DynContentStatusFilter }),
      createdAt: t.field({ type: dynFilters.DynDateTimeFilter }),
      updatedAt: t.field({ type: dynFilters.DynDateTimeFilter }),
    };
    for (const field of filterableFields) {
      const filterKey = getFilterKeyForFieldType(field.type);
      if (filterKey) {
        whereFields[field.identifier] = t.field({
          type: dynFilters[filterKey],
        });
      }
    }
    return whereFields;
  },
});
```

Update the list query to accept `where`:

```typescript
builder.queryField(`${camelName}List`, (t) =>
  t.connection({
    type: ref,
    args: { where: t.arg({ type: WhereInput }) },
    resolve: (_root, args) =>
      resolveOffsetConnection({ args }, async ({ limit, offset }) => {
        return queryDynamicEntries(
          ct.id,
          args.where as any,
          ct.fields,
          limit,
          offset
        );
      }),
  })
);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm test:run -- server/api/graphql/graphql.test.ts
```

Expected: All filter tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/graphql/jsonbFilters.ts server/graphql/dynamicTypes.ts server/api/graphql/graphql.test.ts
git commit -m "feat: add JSONB filtering for dynamic GraphQL types"
```

---

### Task 8: Relation and union resolution

**Files:**

- Modify: `server/graphql/dynamicTypes.ts` (add RELATION/MULTIRELATION fields)
- Modify: `server/api/graphql/graphql.test.ts` (add relation tests)

- [ ] **Step 1: Write relation tests**

These tests create content types with relation fields via REST API during the test, then query them via GraphQL.

```typescript
describe('Dynamic type relations', () => {
  let tagTypeId: string;
  let postTypeId: string;
  let tagEntryId: string;
  let postEntryId: string;

  // Create test content types with relation fields
  it('sets up relation test data', async () => {
    // Create a "TestTag" content type
    const tagType = await $fetch('/api/content-types', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      body: {
        name: 'Test Tag',
        identifier: 'TestTag',
        fields: [
          {
            identifier: 'name',
            name: 'Name',
            type: 'ENTRY_TITLE',
            required: true,
          },
          { identifier: 'slug', name: 'Slug', type: 'SLUG' },
        ],
      },
    });
    tagTypeId = (tagType as any).id;

    // Create a "TestPost" content type with RELATION and MULTIRELATION fields
    const postType = await $fetch('/api/content-types', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      body: {
        name: 'Test Post',
        identifier: 'TestPost',
        fields: [
          {
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
          },
          {
            identifier: 'mainTag',
            name: 'Main Tag',
            type: 'RELATION',
            options: { targetContentTypeIds: [tagTypeId] },
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
    postTypeId = (postType as any).id;

    // Create tag entries
    const tag1 = await $fetch('/api/content-entries', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      body: {
        contentTypeId: tagTypeId,
        data: { name: 'GraphQL', slug: 'graphql' },
        status: 'PUBLISHED',
      },
    });
    tagEntryId = (tag1 as any).id;

    const tag2 = await $fetch('/api/content-entries', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      body: {
        contentTypeId: tagTypeId,
        data: { name: 'TypeScript', slug: 'typescript' },
        status: 'PUBLISHED',
      },
    });

    // Create post entry with relations
    const post = await $fetch('/api/content-entries', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      body: {
        contentTypeId: postTypeId,
        data: {
          title: 'Relation Test Post',
          mainTag: { contentTypeId: tagTypeId, entryId: tagEntryId },
          tags: [
            { contentTypeId: tagTypeId, entryId: tagEntryId },
            { contentTypeId: tagTypeId, entryId: (tag2 as any).id },
          ],
        },
        status: 'PUBLISHED',
      },
    });
    postEntryId = (post as any).id;
  });

  it('resolves RELATION field to target type', async () => {
    const { data } = await gql<{
      testPost: {
        id: string;
        title: string;
        mainTag: { id: string; name: string; contentType: string } | null;
      } | null;
    }>(`{
      testPost(id: "${postEntryId}") {
        id title
        mainTag { ... on TestTag { id name contentType } }
      }
    }`);
    expect(data.testPost).not.toBeNull();
    expect(data.testPost!.mainTag).not.toBeNull();
    expect(data.testPost!.mainTag!.name).toBe('GraphQL');
    expect(data.testPost!.mainTag!.contentType).toBe('TestTag');
  });

  it('resolves MULTIRELATION field as connection', async () => {
    const { data } = await gql<{
      testPost: {
        id: string;
        tags: Connection<{ id: string; name: string }>;
      } | null;
    }>(`{
      testPost(id: "${postEntryId}") {
        id
        tags(first: 10) {
          edges { node { ... on TestTag { id name } } }
        }
      }
    }`);
    expect(data.testPost).not.toBeNull();
    expect(data.testPost!.tags.edges.length).toBe(2);
    const names = data.testPost!.tags.edges.map((e) => e.node.name);
    expect(names).toContain('GraphQL');
    expect(names).toContain('TypeScript');
  });

  // Cleanup
  it('cleans up relation test data', async () => {
    // Delete entries first
    await $fetch(`/api/content-entries/${postEntryId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
    const tagEntries = await $fetch<any>(
      `/api/content-entries?contentTypeId=${tagTypeId}`,
      {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      }
    );
    for (const entry of tagEntries.items) {
      await $fetch(`/api/content-entries/${entry.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });
    }
    // Delete types
    await $fetch(`/api/content-types/${postTypeId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
    await $fetch(`/api/content-types/${tagTypeId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test:run -- server/api/graphql/graphql.test.ts
```

Expected: Relation tests fail (RELATION/MULTIRELATION fields not in schema).

- [ ] **Step 3: Add RELATION field resolution to dynamicTypes.ts**

In the object type `fields` builder, after the scalar field loop, add:

```typescript
// RELATION fields
const relationFields = ct.fields.filter((f) => f.type === 'RELATION');
for (const field of relationFields) {
  const opts = field.options as {
    targetContentTypeIds?: string[];
  } | null;
  const targetIds = opts?.targetContentTypeIds ?? [];

  if (targetIds.length === 1) {
    // Single target: use the type directly
    const targetRef = typeRefs.get(targetIds[0]!);
    if (!targetRef) continue;
    fields[field.identifier] = t.field({
      type: targetRef,
      nullable: !field.required,
      resolve: async (entry: any) => {
        const data =
          typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data;
        const ref = data?.[field.identifier];
        if (!ref?.entryId) return null;
        return prisma.contentEntry.findUnique({
          where: { id: ref.entryId },
        });
      },
    });
  } else if (targetIds.length > 1) {
    // Multiple targets: create a union
    const targetRefs = targetIds.map((id) => typeRefs.get(id)).filter(Boolean);
    if (targetRefs.length === 0) continue;

    const pascalField =
      field.identifier.charAt(0).toUpperCase() + field.identifier.slice(1);
    const unionRef = builder.unionType(`${ct.identifier}${pascalField}Union`, {
      types: targetRefs,
      resolveType: (value: any) => {
        return typeIdToIdentifier.get(value.contentTypeId) ?? targetRefs[0];
      },
    });

    fields[field.identifier] = t.field({
      type: unionRef,
      nullable: !field.required,
      resolve: async (entry: any) => {
        const data =
          typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data;
        const ref = data?.[field.identifier];
        if (!ref?.entryId) return null;
        return prisma.contentEntry.findUnique({
          where: { id: ref.entryId },
        });
      },
    });
  }
}

// MULTIRELATION fields
const multiRelationFields = ct.fields.filter((f) => f.type === 'MULTIRELATION');
for (const field of multiRelationFields) {
  const opts = field.options as {
    targetContentTypeIds?: string[];
  } | null;
  const targetIds = opts?.targetContentTypeIds ?? [];

  let nodeType: any;
  if (targetIds.length === 1) {
    nodeType = typeRefs.get(targetIds[0]!);
  } else if (targetIds.length > 1) {
    const targetRefs = targetIds.map((id) => typeRefs.get(id)).filter(Boolean);
    if (targetRefs.length === 0) continue;
    const pascalField =
      field.identifier.charAt(0).toUpperCase() + field.identifier.slice(1);
    nodeType = builder.unionType(`${ct.identifier}${pascalField}Union`, {
      types: targetRefs,
      resolveType: (value: any) => {
        return typeIdToIdentifier.get(value.contentTypeId) ?? targetRefs[0];
      },
    });
  }
  if (!nodeType) continue;

  fields[field.identifier] = t.connection({
    type: nodeType,
    resolve: (entry: any, args: any) =>
      resolveOffsetConnection({ args }, async ({ limit, offset }) => {
        const data =
          typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data;
        const refs = data?.[field.identifier];
        if (!Array.isArray(refs) || refs.length === 0) return [];

        const entryIds = refs
          .slice(offset, offset + limit)
          .map((r: any) => r.entryId)
          .filter(Boolean);
        if (entryIds.length === 0) return [];

        const entries = await prisma.contentEntry.findMany({
          where: { id: { in: entryIds } },
        });

        // Preserve JSONB array ordering
        const byId = new Map(entries.map((e) => [e.id, e]));
        return entryIds.map((id: string) => byId.get(id)).filter(Boolean);
      }),
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test:run -- server/api/graphql/graphql.test.ts
```

Expected: Relation tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/graphql/dynamicTypes.ts server/api/graphql/graphql.test.ts
git commit -m "feat: add RELATION and MULTIRELATION resolution for dynamic GraphQL types"
```

---

### Task 9: Cross-type contentEntryList query

**Files:**

- Modify: `server/graphql/dynamicTypes.ts` (add contentEntryList query)
- Modify: `server/graphql/jsonbFilters.ts` (add ContentEntryWhere input)
- Modify: `server/api/graphql/graphql.test.ts` (add cross-type tests)

- [ ] **Step 1: Write cross-type query tests**

```typescript
describe('Cross-type contentEntryList query', () => {
  it('returns entries from all dynamic types', async () => {
    const { data } = await gql<{
      contentEntryList: Connection<{
        id: string;
        contentType: string;
        status: string;
      }>;
    }>(`{
      contentEntryList(first: 50) {
        edges {
          node {
            id contentType status
            ... on BlogPost { title slug }
          }
        }
      }
    }`);
    expect(data.contentEntryList.edges.length).toBeGreaterThanOrEqual(2);
    const types = new Set(
      data.contentEntryList.edges.map((e) => e.node.contentType)
    );
    expect(types.has('BlogPost')).toBe(true);
  });

  it('filters contentEntryList by contentType', async () => {
    const { data } = await gql<{
      contentEntryList: Connection<{
        id: string;
        contentType: string;
      }>;
    }>(`{
      contentEntryList(first: 50, where: { contentType: { equals: "BlogPost" } }) {
        edges { node { id contentType } }
      }
    }`);
    data.contentEntryList.edges.forEach((edge) => {
      expect(edge.node.contentType).toBe('BlogPost');
    });
  });

  it('filters contentEntryList by status', async () => {
    const { data } = await gql<{
      contentEntryList: Connection<{
        id: string;
        status: string;
      }>;
    }>(`{
      contentEntryList(first: 50, where: { status: { equals: PUBLISHED } }) {
        edges { node { id status } }
      }
    }`);
    data.contentEntryList.edges.forEach((edge) => {
      expect(edge.node.status).toBe('PUBLISHED');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test:run -- server/api/graphql/graphql.test.ts
```

- [ ] **Step 3: Add ContentEntryWhere input and contentEntryList query**

In `jsonbFilters.ts`, add a function to register the cross-type where input:

```typescript
export function registerContentEntryWhere(
  builder: Builder,
  ContentStatusEnum: ContentStatusEnumRef,
  dynFilters: DynFilterRefs
) {
  return builder.inputType('ContentEntryWhere', {
    fields: (t) => ({
      status: t.field({ type: dynFilters.DynContentStatusFilter }),
      contentType: t.field({ type: dynFilters.DynStringFilter }),
      createdAt: t.field({ type: dynFilters.DynDateTimeFilter }),
      updatedAt: t.field({ type: dynFilters.DynDateTimeFilter }),
    }),
  });
}
```

In `dynamicTypes.ts`, after registering all per-type queries, register the cross-type query:

```typescript
// Cross-type query: contentEntryList
const ContentEntryWhere = registerContentEntryWhere(
  builder,
  ContentStatusEnum,
  dynFilters
);

builder.queryField('contentEntryList', (t) =>
  t.connection({
    type: ContentEntryInterface,
    args: { where: t.arg({ type: ContentEntryWhere }) },
    resolve: (_root, args) =>
      resolveOffsetConnection({ args }, async ({ limit, offset }) => {
        const conditions: Prisma.Sql[] = [];
        const whereArgs = args.where as any;

        if (whereArgs?.status?.equals) {
          conditions.push(Prisma.sql`"status" = ${whereArgs.status.equals}`);
        }
        if (whereArgs?.contentType?.equals) {
          // Look up contentTypeId from identifier
          const ct = contentTypes.find(
            (c) => c.identifier === whereArgs.contentType.equals
          );
          if (ct) {
            conditions.push(Prisma.sql`"contentTypeId" = ${ct.id}`);
          } else {
            return []; // Unknown type, return empty
          }
        }
        if (whereArgs?.contentType?.contains) {
          const matchingIds = contentTypes
            .filter((c) =>
              c.identifier
                .toLowerCase()
                .includes(String(whereArgs.contentType.contains).toLowerCase())
            )
            .map((c) => c.id);
          if (matchingIds.length === 0) return [];
          conditions.push(
            Prisma.sql`"contentTypeId" IN (${Prisma.join(matchingIds)})`
          );
        }

        // Date filters for createdAt/updatedAt
        for (const sysField of ['createdAt', 'updatedAt'] as const) {
          if (whereArgs?.[sysField]) {
            const dateConditions = buildDateConditions(
              sysField,
              whereArgs[sysField],
              false
            );
            conditions.push(...dateConditions.map((c) => c.sql));
          }
        }

        const whereClause =
          conditions.length > 0
            ? Prisma.join(conditions, Prisma.sql` AND `)
            : Prisma.sql`1=1`;

        return prisma.$queryRaw`
            SELECT * FROM "ContentEntry"
            WHERE ${whereClause}
            ORDER BY "createdAt" DESC
            LIMIT ${limit} OFFSET ${offset}
          `;
      }),
  })
);
```

Note: `buildDateConditions` needs to be exported from `jsonbFilters.ts`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test:run -- server/api/graphql/graphql.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add server/graphql/dynamicTypes.ts server/graphql/jsonbFilters.ts server/api/graphql/graphql.test.ts
git commit -m "feat: add cross-type contentEntryList GraphQL query"
```

---

### Task 10: Schema invalidation on content type mutations

**Files:**

- Modify: `server/api/content-types/index.post.ts`
- Modify: `server/api/content-types/[id].put.ts`
- Modify: `server/api/content-types/[id].delete.ts`
- Modify: `server/api/content-types/[id]/fields/index.post.ts`
- Modify: `server/api/content-types/[id]/fields/[fieldId].put.ts`
- Modify: `server/api/content-types/[id]/fields/[fieldId].delete.ts`
- Modify: `server/api/graphql/graphql.test.ts` (add schema rebuild tests)

- [ ] **Step 1: Write schema rebuild tests**

```typescript
describe('Schema rebuild on content type changes', () => {
  it('rebuilds schema when a new content type is created', async () => {
    // Create a new content type
    const created = await $fetch<any>('/api/content-types', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      body: {
        name: 'Schema Test Type',
        identifier: 'SchemaTestType',
        fields: [
          {
            identifier: 'label',
            name: 'Label',
            type: 'ENTRY_TITLE',
            required: true,
          },
        ],
      },
    });

    // Query the new type via GraphQL — should work immediately
    const { data, errors } = await gql<{
      schemaTestTypeList: Connection<{ id: string }>;
    }>('{ schemaTestTypeList(first: 1) { edges { node { id } } } }');
    expect(errors).toBeUndefined();
    expect(data.schemaTestTypeList.edges).toEqual([]);

    // Cleanup
    await $fetch(`/api/content-types/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
  });

  it('rebuilds schema when a field is added', async () => {
    // Create type
    const created = await $fetch<any>('/api/content-types', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      body: {
        name: 'Field Add Test',
        identifier: 'FieldAddTest',
        fields: [
          {
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
          },
        ],
      },
    });

    // Add a new field
    await $fetch(`/api/content-types/${created.id}/fields`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      body: { identifier: 'description', name: 'Description', type: 'TEXT' },
    });

    // Create an entry with the new field
    const entry = await $fetch<any>('/api/content-entries', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      body: {
        contentTypeId: created.id,
        data: { title: 'Test', description: 'A description' },
        status: 'DRAFT',
      },
    });

    // Query should include the new field
    const { data } = await gql<{
      fieldAddTest: {
        title: string;
        description: string | null;
      } | null;
    }>(`{ fieldAddTest(id: "${entry.id}") { title description } }`);
    expect(data.fieldAddTest).not.toBeNull();
    expect(data.fieldAddTest!.description).toBe('A description');

    // Cleanup
    await $fetch(`/api/content-entries/${entry.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
    await $fetch(`/api/content-types/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
  });

  it('rebuilds schema when a content type is deleted', async () => {
    const created = await $fetch<any>('/api/content-types', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      body: {
        name: 'Delete Test',
        identifier: 'DeleteTest',
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

    // Verify it exists in the schema
    const { data: before } = await gql<{
      deleteTestList: Connection<{ id: string }>;
    }>('{ deleteTestList(first: 1) { edges { node { id } } } }');
    expect(before.deleteTestList).toBeDefined();

    // Delete the type
    await $fetch(`/api/content-types/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });

    // Query should now fail
    const result = await gql<any>(
      '{ deleteTestList(first: 1) { edges { node { id } } } }'
    );
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test:run -- server/api/graphql/graphql.test.ts
```

Expected: Schema rebuild tests fail (schema not rebuilt on mutations).

- [ ] **Step 3: Add invalidateSchema calls to all 6 endpoints**

In each file, add the import and call after the successful DB operation:

```typescript
import { invalidateSchema } from '../../graphql/schema';
```

For `server/api/content-types/index.post.ts`, add before the `return`:

```typescript
invalidateSchema();
setResponseStatus(event, 201);
return created;
```

For `server/api/content-types/[id].put.ts`, add before the `return`:

```typescript
  const updated = await withPrismaErrors(...);
  invalidateSchema();
  return updated;
```

For `server/api/content-types/[id].delete.ts`, add before the `return`:

```typescript
  await withPrismaErrors(...);
  invalidateSchema();
  return { success: true };
```

For `server/api/content-types/[id]/fields/index.post.ts`:

```typescript
import { invalidateSchema } from '../../../../graphql/schema';
// ... after the create:
invalidateSchema();
setResponseStatus(event, 201);
return created;
```

For `server/api/content-types/[id]/fields/[fieldId].put.ts`:

```typescript
import { invalidateSchema } from '../../../../graphql/schema';
// ... after the update:
  const updated = await withPrismaErrors(...);
  invalidateSchema();
  return updated;
```

For `server/api/content-types/[id]/fields/[fieldId].delete.ts`:

```typescript
import { invalidateSchema } from '../../../../graphql/schema';
// ... after the delete:
  await withPrismaErrors(...);
  invalidateSchema();
  return { success: true };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test:run -- server/api/graphql/graphql.test.ts
```

Expected: All schema rebuild tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/api/content-types/ server/api/graphql/graphql.test.ts
git commit -m "feat: invalidate GraphQL schema on content type mutations"
```

---

### Task 11: Final verification

- [ ] **Step 1: Run the full test suite**

```bash
pnpm test:run
```

Expected: ALL tests pass — both existing static GraphQL tests and new dynamic type tests.

- [ ] **Step 2: Run lint and typecheck**

```bash
pnpm lint && pnpm typecheck
```

Fix any issues.

- [ ] **Step 3: Manual smoke test with GraphiQL**

Start the dev server and open `http://localhost:4000/api/graphql` in a browser. Verify:

- `blogPostList` query works and returns typed fields
- `blogPost(id: "...")` works
- `blogPostBySlug(slug: "...")` works
- `contentEntryList` returns entries with inline fragments
- Static queries (teams, clubs, etc.) still work
- Schema explorer shows `BlogPost` type with correct field types

```bash
pnpm dev
```

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A && git commit -m "fix: address lint/type issues from dynamic GraphQL implementation"
```
