# Articles, Authors & Tags — Design Spec

## Overview

Add three new content models (Article, Author, Tag) plus a lightweight child table (AuthorSocialLink) to the CMS. Articles support rich text editing via Tiptap with custom embed blocks for referencing other CMS content inline.

## Data Model

### Author (`prisma/schema/author.prisma`)

Content model with publishing metadata.

| Field                 | Type               | Constraints                          |
| --------------------- | ------------------ | ------------------------------------ |
| id                    | String (UUID)      | @id @default(uuid())                 |
| name                  | String             | @unique                              |
| slug                  | String             | @unique                              |
| bio                   | String?            | Optional                             |
| headshot / headshotId | Image?             | Optional relation, onDelete: SetNull |
| socialLinks           | AuthorSocialLink[] | One-to-many                          |
| articles              | Article[]          | One-to-many                          |
| entryTitle            | String             | @default("")                         |
| status                | ContentStatus      | @default(DRAFT)                      |
| publishedAt           | DateTime?          | Set on first publish                 |
| createdBy / updatedBy | String?            | User tracking                        |
| createdAt / updatedAt | DateTime           | Timestamps                           |

### AuthorSocialLink (in `prisma/schema/author.prisma`)

Lightweight child table, not a content model.

| Field             | Type          | Constraints                          |
| ----------------- | ------------- | ------------------------------------ |
| id                | String (UUID) | @id @default(uuid())                 |
| platform          | String        | e.g. "twitter", "instagram"          |
| url               | String        |                                      |
| author / authorId | Author        | Required relation, onDelete: Cascade |

### Tag (`prisma/schema/tag.prisma`)

Content model with publishing metadata. Flat structure (no hierarchy or categories).

| Field                 | Type          | Constraints          |
| --------------------- | ------------- | -------------------- |
| id                    | String (UUID) | @id @default(uuid()) |
| name                  | String        | @unique              |
| slug                  | String        | @unique              |
| articles              | Article[]     | Many-to-many         |
| entryTitle            | String        | @default("")         |
| status                | ContentStatus | @default(DRAFT)      |
| publishedAt           | DateTime?     | Set on first publish |
| createdBy / updatedBy | String?       | User tracking        |
| createdAt / updatedAt | DateTime      | Timestamps           |

### Article (`prisma/schema/article.prisma`)

Content model with publishing metadata.

| Field                           | Type          | Constraints                                        |
| ------------------------------- | ------------- | -------------------------------------------------- |
| id                              | String (UUID) | @id @default(uuid())                               |
| title                           | String        | @unique                                            |
| slug                            | String        | @unique                                            |
| summary                         | String?       | Plain text excerpt                                 |
| body                            | Json?         | Tiptap/ProseMirror JSON document                   |
| author / authorId               | Author?       | Optional relation, onDelete: SetNull               |
| featuredImage / featuredImageId | Image?        | Optional relation, onDelete: SetNull               |
| tags                            | Tag[]         | Many-to-many (implicit join table `_ArticleToTag`) |
| entryTitle                      | String        | @default("") — auto-set to `title` on save         |
| status                          | ContentStatus | @default(DRAFT)                                    |
| publishedAt                     | DateTime?     | Set on first publish                               |
| createdBy / updatedBy           | String?       | User tracking                                      |
| createdAt / updatedAt           | DateTime      | Timestamps                                         |

## Rich Text Editor

### Library

Tiptap (`@tiptap/vue-3`) with ProseMirror under the hood. Chosen for Vue 3 first-class support, native JSON document storage, large extension ecosystem, and well-documented custom node API.

### Storage

ProseMirror JSON document stored in the Article `body` field (PostgreSQL `jsonb` column). Example:

```json
{
  "type": "doc",
  "content": [
    {
      "type": "heading",
      "attrs": { "level": 2 },
      "content": [{ "type": "text", "text": "Match Report" }]
    },
    {
      "type": "paragraph",
      "content": [{ "type": "text", "text": "Some body text..." }]
    },
    {
      "type": "cmsEmbed",
      "attrs": { "embedType": "fixture", "embedId": "uuid-here" }
    }
  ]
}
```

### Extensions

| Extension         | Package                                     | Purpose                                                                               |
| ----------------- | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| StarterKit        | `@tiptap/starter-kit`                       | Paragraphs, headings, bold, italic, lists, blockquotes, code blocks, horizontal rules |
| Table             | `@tiptap/extension-table` + row/cell/header | Tables with header rows/columns                                                       |
| Link              | `@tiptap/extension-link`                    | Inline links                                                                          |
| Image             | `@tiptap/extension-image`                   | Inline images (src → `/api/images/:id/transform`)                                     |
| CodeBlockLowlight | `@tiptap/extension-code-block-lowlight`     | Syntax-highlighted code blocks                                                        |
| CmsEmbed          | Custom extension                            | Embed cards for fixtures, players, teams, etc.                                        |

### CmsEmbed Custom Node

- Block-level node with attrs: `embedType` (string) and `embedId` (UUID)
- Rendered in the editor via a Vue `NodeViewRenderer` component that fetches and displays a read-only card
- Inserted via toolbar button — opens a modal to pick model type, then search/select the record. Slash commands deferred to future work.
- At render time, consumers resolve the embed by type + ID

### Editor Component

`components/RichTextEditor.vue` wraps `EditorContent` from `@tiptap/vue-3`. Takes `modelValue` (JSON) and emits `update:modelValue`.

## New ContentEditor Field Types

Two new types added to the `FieldConfig` discriminated union in `types/contentEditor.ts`:

- **`richtext`** — renders the RichTextEditor component, binds to a JSON value
- **`multirelation`** — like `relation` but allows selecting multiple values. Fetches options from an endpoint, binds to an array of IDs (field key should be the ID array name, e.g. `tagIds`). Used for tag assignment on articles.

## REST API

### Article Endpoints

| Route                | Method | Filters                       | Notes                                                                                      |
| -------------------- | ------ | ----------------------------- | ------------------------------------------------------------------------------------------ |
| `/api/articles`      | GET    | `status`, `authorId`, `tagId` | Paginated list. `tagId` filter uses `tags: { some: { id: tagId } }` (many-to-many pattern) |
| `/api/articles/[id]` | GET    | —                             | Includes author, featuredImage, tags                                                       |
| `/api/articles/[id]` | PUT    | —                             | Allow-list: title, summary, body, authorId, featuredImageId, tagIds                        |

Tag assignment uses Prisma's `set` operation: `tags: { set: tagIds.map(id => ({ id })) }`.

### Author Endpoints

| Route                  | Method | Filters  | Notes                                                |
| ---------------------- | ------ | -------- | ---------------------------------------------------- |
| `/api/authors`         | GET    | `status` | Paginated list                                       |
| `/api/authors/[id]`    | GET    | —        | Includes socialLinks, headshot                       |
| `/api/authors/[id]`    | PUT    | —        | Allow-list: name, bio, headshotId, socialLinks array |
| `/api/authors/options` | GET    | —        | `{ label, value }[]` for dropdowns                   |

Social links use delete-and-recreate on each save: `deleteMany` + `createMany`.

### Tag Endpoints

| Route               | Method | Filters  | Notes                              |
| ------------------- | ------ | -------- | ---------------------------------- |
| `/api/tags`         | GET    | `status` | Paginated list                     |
| `/api/tags/[id]`    | GET    | —        | Single item                        |
| `/api/tags/[id]`    | PUT    | —        | Allow-list: name                   |
| `/api/tags/options` | GET    | —        | `{ label, value }[]` for dropdowns |

### Images Options Endpoint

Create `server/api/images/options.get.ts` — returns `{ label, value }[]` for image relation dropdowns (used by Article featuredImage and Author headshot fields). This endpoint does not currently exist.

### Content Endpoint

Add `'Article'`, `'Author'`, `'Tag'` to the `CONTENT_TABLES` array in `server/api/content.get.ts`.

## GraphQL

### Types

- **Article** — all scalar fields, `author` as `t.relation()`, `featuredImage` as `t.relation()`, `tags` as `t.relatedConnection()`
- **Author** — scalars, `headshot` as `t.relation()`, `socialLinks` as `t.relation()` (plain list, small bounded set per author), `articles` as `t.relatedConnection()`
- **Tag** — scalars, `articles` as `t.relatedConnection()`
- **AuthorSocialLink** — `id`, `platform`, `url`

### Where Filters

- `ArticleWhere` — filter by status, author (to-one relation filter with `is`/`isNot`), tags (many-to-many list relation filter with `some`/`every`/`none`)
- `AuthorWhere` — filter by status
- `TagWhere` — filter by status

### Root Queries

- `articles` / `article` (list with Relay pagination + single by ID)
- `authors` / `author`
- `tags` / `tag`

## CMS Pages

### Article

- **List** (`pages/articles/index.vue`) — ContentTable with extra columns: author name, tags (comma-separated)
- **Edit** (`pages/articles/[id].vue`) — Fields: title (text, required), summary (textarea), author (relation → `/api/authors/options`), featuredImage (relation → `/api/images/options`), tags (multirelation → `/api/tags/options`), body (richtext)

### Author

- **List** (`pages/authors/index.vue`) — Standard ContentTable
- **Edit** (`pages/authors/[id].vue`) — Fields: name (text, required), bio (textarea), headshot (relation → `/api/images/options`). Custom social links section below ContentEditor: repeatable rows with platform + URL inputs and add/remove buttons.

### Tag

- **List** (`pages/tags/index.vue`) — Standard ContentTable
- **Edit** (`pages/tags/[id].vue`) — Fields: name (text, required). Minimal — just name plus standard publishing section.

### Navigation

Add to `navItems` in `layouts/default.vue`:

- Articles (`i-lucide-newspaper`, `/articles`)
- Authors (`i-lucide-pen-tool`, `/authors`)
- Tags (`i-lucide-tag`, `/tags`)

## Testing

### New Test Files

- `server/api/articles/articles.test.ts` — list pagination, filters (status, authorId, tagId), combined filters, single item GET, PUT with tag assignment, PUT with body JSON
- `server/api/authors/authors.test.ts` — list pagination, status filter, single item GET, PUT with social links (empty array, replacement, full delete-and-recreate), options endpoint
- `server/api/tags/tags.test.ts` — list pagination, status filter, single item GET, PUT, options endpoint

### Seed Data

Add to `prisma/seed.ts`: a couple of authors (with social links), a handful of tags, and 2-3 articles linking them together.

### Existing Test Updates

- `server/api/graphql/graphql.test.ts` — article/author/tag queries, relation resolution, where filtering
- `server/api/content/content.test.ts` — verify Article, Author, Tag appear in content type filter

### No Tiptap Unit Tests

The editor is a configuration of well-tested library extensions. Custom CmsEmbed node rendering would require a DOM environment for limited value.

## Out of Scope

- **PATCH and DELETE endpoints** — no existing models have these. Will be added across all models in a separate piece of work.
- **POST (creation) endpoints** — no existing models have creation endpoints either. This is a codebase-wide gap. POST endpoints for all models (including Article, Author, Tag) will be added in a separate piece of work. Until then, records are created via seed script or direct database access.
- **Slash commands in Tiptap** — the CmsEmbed node uses a toolbar button for insertion. A slash command menu (`/embed`, `/image`, etc.) is deferred to future work.
- **Footnote extension** — deferred to future work. The initial Tiptap setup covers StarterKit, Table, Link, Image, CodeBlockLowlight, and CmsEmbed.
