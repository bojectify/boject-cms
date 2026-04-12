# Dynamic Content Types

## Overview

Replace the hardcoded, rugby-specific content models with a dynamic content type system. Users define arbitrary content types and their fields through the CMS, then create/edit/delete entries against those types. This brings boject-cms closer to a general-purpose headless CMS (like Strapi or Directus).

## Approach

**JSONB hybrid** — Content type definitions and field schemas are stored in the database. Entry field values are stored in a JSONB column. This avoids runtime Prisma migrations and keeps the system fully dynamic.

**Coexistence with existing models** — The existing rugby models (Team, Club, Player, Fixture, etc.) remain unchanged. Dynamic content types live alongside them. Migration of existing models into the dynamic system is a separate future project.

**Scope boundaries:**

- Launch with scalar field types only (text, textarea, number, boolean, datetime, select). Relations and rich text are follow-up phases.
- REST API only. GraphQL exposure of dynamic types is deferred.
- Basic admin UI for content type management. Polish comes later.

## Data Model

### ContentType

| Column        | Type     | Constraints |
| ------------- | -------- | ----------- |
| `id`          | UUID     | PK          |
| `name`        | String   | Unique      |
| `description` | String   | Optional    |
| `createdAt`   | DateTime | Auto        |
| `updatedAt`   | DateTime | Auto        |

### ContentTypeField

| Column          | Type     | Constraints                                                                                       |
| --------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `id`            | UUID     | PK                                                                                                |
| `contentTypeId` | UUID     | FK → ContentType, cascade delete                                                                  |
| `name`          | String   | Machine name (lowercase alphanumeric + underscores, no leading digit)                             |
| `label`         | String   | Display label                                                                                     |
| `type`          | Enum     | `ENTRY_TITLE`, `SLUG`, `TEXT`, `TEXTAREA`, `NUMBER`, `BOOLEAN`, `DATETIME`, `SELECT`              |
| `required`      | Boolean  | Default false                                                                                     |
| `order`         | Int      | Field ordering in editor. Auto-set to max + 1 on creation; reorder endpoint for manual adjustment |
| `options`       | Json     | Optional, type-specific config (e.g. select choices, placeholder, min/max)                        |
| `createdAt`     | DateTime | Auto                                                                                              |
| `updatedAt`     | DateTime | Auto                                                                                              |

**Constraints:**

- Unique on `(contentTypeId, name)`
- Exactly one `ENTRY_TITLE` field per content type (enforced at API layer)
- At most one `SLUG` field per content type (enforced at API layer)

### ContentEntry

| Column          | Type          | Constraints                                                |
| --------------- | ------------- | ---------------------------------------------------------- |
| `id`            | UUID          | PK                                                         |
| `contentTypeId` | UUID          | FK → ContentType                                           |
| `data`          | Json          | Field values keyed by field `name`                         |
| `slug`          | String        | Nullable. Unique on `(contentTypeId, slug)`                |
| `status`        | ContentStatus | Reuses existing enum (DRAFT, PUBLISHED, CHANGED, ARCHIVED) |
| `publishedAt`   | DateTime      | Optional                                                   |
| `createdBy`     | String        | Optional                                                   |
| `updatedBy`     | String        | Optional                                                   |
| `createdAt`     | DateTime      | Auto                                                       |
| `updatedAt`     | DateTime      | Auto                                                       |

**Slug handling:** The slug is stored both in the `data` JSONB (for consistency with other fields) and in the dedicated `slug` column (for the unique constraint). The API keeps them in sync on create/update.

### FieldType Enum

```
ENTRY_TITLE  — Required, exactly one per content type. Renders as text input. Value used as display name in listings.
SLUG         — Optional, at most one per content type. Renders in publishing section. Unique per content type.
TEXT         — Single-line text input.
TEXTAREA    — Multi-line text input.
NUMBER      — Numeric input.
BOOLEAN     — Toggle/checkbox.
DATETIME    — Date/time picker.
SELECT      — Dropdown. Choices defined in field `options`.
```

### Content Entry Metadata

Every entry has these system-managed fields (not user-defined):

- `status` (ContentStatus enum)
- `publishedAt` (set on first publish, via existing `applyContentMetadata` logic)
- `createdBy`, `updatedBy`
- `createdAt`, `updatedAt`

`entryTitle` and `slug` are user-defined field types, not automatic metadata.

## REST API

### Content Type Management

| Method   | Path                      | Purpose                                      |
| -------- | ------------------------- | -------------------------------------------- |
| `GET`    | `/api/content-types`      | List all content types                       |
| `POST`   | `/api/content-types`      | Create content type with fields              |
| `GET`    | `/api/content-types/[id]` | Get content type with fields                 |
| `PUT`    | `/api/content-types/[id]` | Update content type (name, description)      |
| `DELETE` | `/api/content-types/[id]` | Delete content type (fails if entries exist) |

### Content Type Field Management

| Method   | Path                                       | Purpose      |
| -------- | ------------------------------------------ | ------------ |
| `POST`   | `/api/content-types/[id]/fields`           | Add field    |
| `PUT`    | `/api/content-types/[id]/fields/[fieldId]` | Update field |
| `DELETE` | `/api/content-types/[id]/fields/[fieldId]` | Remove field |
| `PUT`    | `/api/content-types/[id]/fields/reorder`   | Bulk reorder |

### Content Entries

| Method   | Path                        | Purpose                                                                       |
| -------- | --------------------------- | ----------------------------------------------------------------------------- |
| `GET`    | `/api/content-entries`      | List entries (requires `contentTypeId`, supports `status`, `page`, `perPage`) |
| `POST`   | `/api/content-entries`      | Create entry                                                                  |
| `GET`    | `/api/content-entries/[id]` | Get single entry                                                              |
| `PUT`    | `/api/content-entries/[id]` | Update entry                                                                  |
| `DELETE` | `/api/content-entries/[id]` | Delete entry                                                                  |

### Key Behaviors

- Entry create/update validates `data` against the content type's field definitions
- The existing `/api/content.get.ts` UNION ALL query is extended to include dynamic entries
- `applyContentMetadata` is reused for status/publishedAt on entries

## Validation

### Content Type Constraints

- `name` unique across content types
- Must have exactly one `ENTRY_TITLE` field
- At most one `SLUG` field
- Field `name` unique within content type
- Field `name` must be valid machine name: `/^[a-z][a-z0-9_]*$/`
- Cannot delete content type that has entries

### Content Entry Constraints

- `data` validated against field definitions:
  - Required fields must be present and non-empty
  - TEXT, TEXTAREA, ENTRY_TITLE, SLUG values must be strings
  - NUMBER values must be numbers
  - BOOLEAN values must be booleans
  - DATETIME values must be valid ISO-8601 strings
  - SELECT values must be in the field's allowed choices
- Slug uniqueness enforced per content type via `(contentTypeId, slug)` unique index
- Slug synced to both `data` and the `slug` column

### Field Modification Safety

- Changing a field's `type` is blocked if entries exist
- Changing `required` false→true is allowed (no retroactive validation)
- Deleting a field does not remove data from existing entries

## CMS UI

### Sidebar Navigation

- "Content Types" link → `/content-types`
- Dynamically rendered link per content type → `/content-types/[id]/entries`

### Pages

**`/content-types`** — List page. Table: name, field count, entry count, updatedAt. "New Content Type" button.

**`/content-types/new`** — Create form. Name, description, field builder (add fields with name, label, type, required toggle, type-specific options). Must include an `ENTRY_TITLE` field before saving. Reorder via drag or up/down.

**`/content-types/[id]`** — Edit content type definition. Same field builder. Warns when removing a field that has data in existing entries.

**`/content-types/[id]/entries`** — Entry listing. Reuses `ContentTable` with columns derived from the entry title field, status, dates. Pagination.

**`/content-types/[id]/entries/new`** — Create entry. `ContentEditor` with `fields` mapped from `ContentTypeField[]` → `FieldConfig[]`.

**`/content-types/[id]/entries/[entryId]`** — Edit entry. Same as create, populated. Uses adapted `useContentEditor`.

### ContentEditor Integration

`ContentTypeField` → `FieldConfig` mapping:

- `ENTRY_TITLE` → `text` field config
- `SLUG` → `text` field config (rendered in publishing section)
- `TEXT` → `text`
- `TEXTAREA` → `textarea`
- `NUMBER` → `number`
- `BOOLEAN` → `boolean`
- `DATETIME` → `datetime`
- `SELECT` → `select` (with choices from field `options`)

## Future Phases (Out of Scope)

- **Relations** — `relation` and `multirelation` field types pointing at dynamic or static content types. The data model supports these at the enum level, but the UI for adding/configuring relational fields during content type creation is deferred
- **Rich text** — `richtext` field type with Tiptap editor
- **GraphQL** — Expose dynamic content types via the GraphQL API
- **Migrate existing models** — Convert rugby models into dynamic content types
- **Content type versioning** — Track schema changes over time
- **Field-level permissions** — Control who can edit specific fields
