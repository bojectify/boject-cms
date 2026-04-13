# Dynamic Content Type GraphQL API

## Overview

Expose dynamic content types as strongly-typed GraphQL types. Each content type defined in the CMS produces a dedicated GraphQL type with typed fields, Relay cursor pagination, and filtering. The schema rebuilds automatically when content types are mutated.

This system will replace the existing static Pothos types once all hardcoded models (Team, Club, Player, etc.) are migrated into dynamic content types.

## Approach

**Fresh Pothos builder per rebuild.** On startup and after any content type schema change, a new `SchemaBuilder` instance is created, all types (static and dynamic) are registered on it, and `builder.toSchema()` produces the GraphQL schema. This avoids stale-state issues with re-registering types on the same builder. GraphQL Yoga resolves the schema per-request via an async factory function.

**Coexistence with static types.** Existing Pothos type definitions are refactored from side-effect imports into callable registration functions. These are called during each schema rebuild. Once static models are migrated to dynamic content types and removed, these registration functions are deleted.

## ContentEntry Interface

Every dynamic type implements this interface. Contains system-managed fields only — slug is a user-defined field type, not system metadata.

```graphql
interface ContentEntry {
  id: ID!
  contentType: String!
  status: ContentStatus!
  publishedAt: DateTime
  createdAt: DateTime!
  updatedAt: DateTime!
}
```

`contentType` is the content type's `identifier` (PascalCase, e.g. `"BlogPost"`). Lets consumers distinguish types in polymorphic contexts without relying on `__typename`.

A cross-type root query uses the interface:

```graphql
contentEntryList(
  first: Int, after: String, last: Int, before: String,
  where: ContentEntryWhere
): ContentEntryConnection!
```

## Dynamic Type Generation

For each content type, the schema builder generates a GraphQL object type named after the `identifier`, implementing `ContentEntry`.

### Field Type Mapping

| FieldType     | GraphQL Scalar       | Nullability                         |
| ------------- | -------------------- | ----------------------------------- |
| ENTRY_TITLE   | `String`             | Always `!` (required by definition) |
| SLUG          | `String`             | Based on `required` flag            |
| TEXT          | `String`             | Based on `required`                 |
| TEXTAREA      | `String`             | Based on `required`                 |
| NUMBER        | `Float`              | Based on `required`                 |
| BOOLEAN       | `Boolean`            | Based on `required`                 |
| DATETIME      | `DateTime`           | Based on `required`                 |
| SELECT        | `String`             | Based on `required`                 |
| RICHTEXT      | `JSON`               | Based on `required`                 |
| RELATION      | Target type or union | Based on `required`                 |
| MULTIRELATION | Connection           | Always nullable (empty connection)  |

### Example

Content type `BlogPost` with fields: `title` (ENTRY_TITLE), `slug` (SLUG), `body` (RICHTEXT), `publishDate` (DATETIME), `category` (SELECT), `featured` (BOOLEAN):

```graphql
type BlogPost implements ContentEntry {
  id: ID!
  contentType: String!
  status: ContentStatus!
  publishedAt: DateTime
  createdAt: DateTime!
  updatedAt: DateTime!

  title: String!
  slug: String
  body: JSON
  publishDate: DateTime
  category: String
  featured: Boolean
}
```

### Resolvers

Each user-defined field resolver reads `entry.data[fieldIdentifier]` from the JSONB column. System fields (id, status, publishedAt, createdAt, updatedAt) read from the `ContentEntry` row columns. `contentType` resolves by looking up the content type's `identifier` from `contentTypeId`.

## Relations & Unions

### RELATION (single reference)

Stored as `{ contentTypeId, entryId }` in JSONB. The field's `options.targetContentTypeIds` defines allowed target types.

**Single target type:** The GraphQL field type is the target type directly.

```graphql
type BlogPost implements ContentEntry {
  author: Author
}
```

**Multiple target types:** A union type is generated.

```graphql
union BlogPostRelatedContentUnion = NewsItem | Event

type BlogPost implements ContentEntry {
  relatedContent: BlogPostRelatedContentUnion
}
```

Union naming: `${ParentType}${FieldIdentifierPascalCase}Union`.

**Resolver:** Fetches the referenced `ContentEntry` by `entryId`, resolves to the correct type via `contentTypeId` → content type `identifier` mapping.

### MULTIRELATION (ordered array)

Stored as `[{ contentTypeId, entryId }, ...]` in JSONB. Rendered as a Relay connection.

**Single target:**

```graphql
type BlogPost implements ContentEntry {
  tags(first: Int, after: String, last: Int, before: String): TagConnection!
}
```

**Multiple targets:**

```graphql
type BlogPost implements ContentEntry {
  relatedItems(
    first: Int
    after: String
    last: Int
    before: String
  ): BlogPostRelatedItemsUnionConnection!
}
```

**Resolver:** Fetches all referenced entries by ID, applies cursor pagination in-memory (the JSONB array is the source of truth for ordering). For union connections, each edge's node resolves to the correct type via `resolveType`.

Pagination is in-memory over the fetched entries. Acceptable for typical relation cardinalities (tens of items). Very large multirelation sets are not an expected use case.

## Filtering

### Per-Type Where Inputs

Auto-generated from field definitions. Only scalar fields get filters; RICHTEXT, RELATION, and MULTIRELATION are excluded.

Example for `BlogPost`:

```graphql
input BlogPostWhere {
  status: ContentStatusFilter
  createdAt: DateTimeFilter
  updatedAt: DateTimeFilter

  title: StringFilter
  slug: StringFilter
  publishDate: DateTimeFilter
  category: StringFilter
  featured: BooleanFilter
}
```

### Filter Inputs

Reused across all types:

| Filter                | Operations                         |
| --------------------- | ---------------------------------- |
| `StringFilter`        | `equals`, `contains`               |
| `FloatFilter`         | `equals`, `gt`, `gte`, `lt`, `lte` |
| `BooleanFilter`       | `equals`                           |
| `DateTimeFilter`      | `equals`, `gt`, `gte`, `lt`, `lte` |
| `ContentStatusFilter` | `equals`                           |

Intentionally minimal. Additional operations (`startsWith`, `endsWith`, `not`, `in`) can be added later.

### SQL Translation

System field filters use normal Prisma `where` clauses on `ContentEntry` columns. User-defined field filters translate to Postgres JSONB operators:

- String equals: `data->>'fieldName' = $1`
- String contains: `data->>'fieldName' ILIKE '%' || $1 || '%'`
- Number comparisons: `(data->>'fieldName')::float > $1`
- DateTime comparisons: `(data->>'fieldName')::timestamptz > $1`
- Boolean: `(data->>'fieldName')::boolean = $1`

### Relation Filtering

Deferred from this build. `has`/`hasAny` filters for RELATION/MULTIRELATION fields (JSONB path queries for nested objects) will be added as a fast follow.

### ContentEntryWhere

For the cross-type `contentEntryList` query, filtering is limited to interface fields:

```graphql
input ContentEntryWhere {
  status: ContentStatusFilter
  contentType: StringFilter
  createdAt: DateTimeFilter
  updatedAt: DateTimeFilter
}
```

## Root Queries

Per-type queries generated for each content type:

```graphql
type Query {
  blogPostList(
    first: Int
    after: String
    last: Int
    before: String
    where: BlogPostWhere
  ): BlogPostConnection!

  blogPost(id: ID!): BlogPost

  blogPostBySlug(slug: String!): BlogPost

  contentEntryList(
    first: Int
    after: String
    last: Int
    before: String
    where: ContentEntryWhere
  ): ContentEntryConnection!
}
```

### Naming Convention

Derived from the content type's `identifier` (PascalCase):

- **List:** `${camelCase(identifier)}List` → e.g. `blogPostList`
- **Single by ID:** `${camelCase(identifier)}` → e.g. `blogPost`
- **Single by slug:** `${camelCase(identifier)}BySlug` → e.g. `blogPostBySlug` (only if the type has a SLUG field)

### Resolver Implementations

- `blogPostList` — `prisma.contentEntry.findMany({ where: { contentTypeId, ...jsonbFilters } })` with Relay cursor pagination. Results typed as `BlogPost`.
- `blogPost(id)` — `prisma.contentEntry.findFirst({ where: { id, contentTypeId } })`. Scoped to content type so an ID from a different type returns null.
- `blogPostBySlug(slug)` — `prisma.contentEntry.findFirst({ where: { contentTypeId, slug } })`. Only registered when the content type has a SLUG field.
- `contentEntryList` — `prisma.contentEntry.findMany({ where: ...systemFilters })` across all types. Each result resolves to its specific type via `resolveType` on the interface.

## Schema Build Pipeline

Located in `server/graphql/buildSchema.ts`:

1. Fetch all `ContentType` records with their `ContentTypeField[]` from the DB
2. Create a fresh `SchemaBuilder` instance (same plugin/scalar config as current `builder.ts`)
3. Register scalars (`DateTime`, `JSON`)
4. Register shared enums (`ContentStatus`, `ScoreType`)
5. Register `ContentEntry` interface
6. Register static Prisma types via callable registration functions (temporary)
7. For each content type:
   a. Register object type implementing `ContentEntry`
   b. Register where input type
   c. Register union types for multi-target relation fields
   d. Register root query fields (`list`, `byId`, `bySlug`)
8. Register `contentEntryList` cross-type query
9. Register static root queries via callable registration functions (temporary)
10. Return `builder.toSchema()`

## Caching & Invalidation

`server/graphql/schema.ts`:

```typescript
let cachedSchema: GraphQLSchema | null = null;

async function getSchema(): Promise<GraphQLSchema> {
  if (!cachedSchema) {
    cachedSchema = await buildDynamicSchema();
  }
  return cachedSchema;
}

function invalidateSchema(): void {
  cachedSchema = null;
}
```

GraphQL Yoga uses an async schema factory:

```typescript
const yoga = createYoga({
  schema: async ({ request }) => getSchema(),
});
```

### Invalidation Triggers

`invalidateSchema()` is called at the end of these endpoints:

- `POST /api/content-types` — create type
- `PUT /api/content-types/[id]` — update type (identifier/name change)
- `DELETE /api/content-types/[id]` — delete type
- `POST /api/content-types/[id]/fields` — add field
- `PUT /api/content-types/[id]/fields/[fieldId]` — update field
- `DELETE /api/content-types/[id]/fields/[fieldId]` — delete field

`PUT /api/content-types/[id]/fields/reorder` does not change the schema (field order is a CMS UI concern) and does not trigger invalidation.

## Refactoring Existing Code

### Static Type Registration

Current pattern (side-effect imports):

```typescript
// server/graphql/types/team.ts
builder.prismaObject('Team', { ... });
export const _registered = true;
```

New pattern (callable functions):

```typescript
// server/graphql/types/team.ts
export function registerTeamType(builder: SchemaBuilder) {
  builder.prismaObject('Team', { ... });
}
```

`schema.ts` calls all registration functions during each rebuild (step 6). The `_registered` sentinel pattern and `void [...]` array in `schema.ts` are removed.

### Builder Module

`server/graphql/builder.ts` changes from exporting a singleton to exporting a factory:

```typescript
export function createBuilder(): SchemaBuilder {
  return new SchemaBuilder({ ... });
}
```

The plugin config, scalar registrations, and type parameters stay the same.

## Testing

Integration tests in `server/api/graphql/graphql.test.ts`:

1. **Dynamic type queries** — Create a content type via REST, query via GraphQL. Verify type appears with correct fields.
2. **Field type mapping** — Content type with one of each field type. Query and verify correct GraphQL scalars and nullability.
3. **Single by ID and by slug** — Standard lookups, null for wrong type/missing.
4. **Relay pagination** — `first`/`after` on `${identifier}List`, verify connection shape (edges, pageInfo).
5. **Filtering** — Where inputs on scalar fields: string equals, datetime range, boolean equals, status filter.
6. **Relations** — RELATION field resolves to the correct target type.
7. **Union relations** — Multi-target relation returns union, `... on X` fragments work.
8. **MULTIRELATION connections** — Returns Relay connection, pagination works.
9. **Cross-type query** — `contentEntryList` returns entries from multiple types, `contentType` filter works, inline fragments resolve.
10. **Schema rebuild** — Create a content type, query it, add a field via REST, query the new field without server restart.
11. **Schema invalidation** — Delete a content type, verify its queries return errors / are absent.

Existing static GraphQL tests continue to pass throughout (static registration functions are called on each rebuild).

## Out of Scope

- **Relation filtering** — `has`/`hasAny` on RELATION/MULTIRELATION fields. Fast follow.
- **Advanced string filters** — `startsWith`, `endsWith`, `not`, `in`. Add per demand.
- **Mutations** — GraphQL mutations for creating/updating entries. REST API handles this.
- **Subscriptions** — Real-time schema change notifications.
- **Static model migration** — Converting hardcoded models to dynamic content types. Separate project.
- **JSONB indexing** — GIN indexes on `data` column for filter performance. Add when needed based on query patterns.
