# boject-cms

A general-purpose TypeScript headless CMS built with Nuxt 4 and Prisma v7 on PostgreSQL. Content is modelled entirely through user-defined ContentTypes — there are no hardcoded domain models.

## Tech Stack

- **Nuxt 4** — Full-stack Vue framework with Nitro server engine
- **Nuxt UI** — Component library (Tailwind CSS v4 + Reka UI primitives)
- **Prisma v7** — ORM with `@prisma/adapter-pg` driver adapter
- **PostgreSQL 17** — Database (local via Docker)
- **GraphQL Yoga** — GraphQL server at `/api/graphql`
- **Pothos** — Code-first GraphQL schema builder with Prisma plugin
- **Tiptap** — Rich text editor (`@tiptap/vue-3`)
- **Sharp** — Image processing for upload and on-the-fly transforms
- **Vue 3** — Frontend framework
- **TypeScript** — ESM-only (`"type": "module"`)

## Prerequisites

- Node.js (LTS)
- [pnpm](https://pnpm.io/)
- [Docker](https://www.docker.com/)

## Getting Started

```bash
# Start local PostgreSQL
docker compose up -d

# Install dependencies (auto-runs nuxt prepare + prisma generate)
pnpm install

# Copy the .env template
cp .env.example .env

# Run database migrations
pnpm prisma:migrate

# Seed the database with admin user + test API key
pnpm prisma:seed

# Optionally apply the base starter bundle (8 content types + a SiteSettings entry)
pnpm content:import ./starters/base.boject.json

# Start the dev server
pnpm dev
```

The app runs at http://localhost:4000. The GraphQL playground (GraphiQL) is available at http://localhost:4000/api/graphql in development.

## Scripts

| Script                  | Description                                   |
| ----------------------- | --------------------------------------------- |
| `pnpm dev`              | Start Nuxt development server                 |
| `pnpm build`            | Build for production (outputs to `.output/`)  |
| `pnpm preview`          | Preview production build locally              |
| `pnpm db:up`            | Start local PostgreSQL container              |
| `pnpm prisma:generate`  | Regenerate Prisma client + Pothos types       |
| `pnpm prisma:migrate`   | Run database migrations                       |
| `pnpm prisma:seed`      | Seed admin user + test API key                |
| `pnpm lint`             | Lint with ESLint                              |
| `pnpm lint:fix`         | Lint and auto-fix                             |
| `pnpm format`           | Check formatting with Prettier                |
| `pnpm format:fix`       | Format all files                              |
| `pnpm test`             | Run all tests once                            |
| `pnpm test:integration` | Run integration tests only                    |
| `pnpm test:unit`        | Run unit tests only                           |
| `pnpm typecheck`        | Run TypeScript type checker                   |
| `pnpm apikey:create`    | Create a new API key                          |
| `pnpm apikey:list`      | List all API keys                             |
| `pnpm apikey:revoke`    | Revoke an API key by prefix                   |
| `pnpm content:export`   | Export dynamic content types/entries as JSON  |
| `pnpm content:import`   | Import a content bundle                       |
| `pnpm content:validate` | Validate a bundle's shape without touching DB |
| `pnpm starters:build`   | Build overlay-based starter bundles           |
| `pnpm starters:check`   | Verify committed starter outputs are current  |

## Project Structure

```
prisma/
  schema/                      # Multi-file Prisma schema
    base.prisma                # Generators, datasource, ContentStatus + FieldType enums
    auth.prisma                # User, ApiKey
    contentType.prisma         # ContentType, ContentTypeField
    contentEntry.prisma        # ContentEntry, ContentEntryVersion
  seed.ts                      # Seed script (admin user + test API key)
  migrations/                  # Migration files
app.vue                        # Root component (UApp + NuxtLayout wrapper)
layouts/
  default.vue                  # Dashboard layout (sidebar nav + header navbar)
  auth.vue                     # Centered layout for login page
assets/css/main.css            # Tailwind CSS + Nuxt UI imports
server/
  api/
    auth/                      # Login/logout endpoints + tests
    graphql/                   # GraphQL Yoga endpoint + tests
    files/                     # Primitive file upload + transform endpoints
    content.get.ts             # Unified content listing (ContentEntry join ContentType)
    content-types/             # Dynamic content type CRUD + field management
    content-entries/           # Dynamic content entry CRUD
    health.get.ts              # Database health check
  graphql/
    builder.ts                 # Pothos SchemaBuilder singleton (JSON + DateTime scalars)
    buildSchema.ts             # Loads ContentType rows, registers dynamic types
    schema.ts                  # Caches built schema; exposes invalidateSchema()
    dynamicTypes.ts            # registerDynamicTypes(builder, contentTypes)
    jsonbFilters.ts            # Prisma-style where inputs for dynamic ContentTypes
    types/contentStatus.ts     # ContentStatus enum
  utils/
    prisma.ts                  # Singleton PrismaClient (auto-imported)
    imageProcessing.ts         # Sharp-based image processing
    rateLimit.ts               # In-memory sliding window rate limiter
  middleware/
    auth.ts                    # Global server auth middleware (session or API key)
    csrf.ts                    # CSRF origin/referer enforcement
components/                    # Each component lives in its own kebab-case folder
  content-table/               # ContentTable.vue + contentTable.config.ts + contentTable.types.ts
  content-editor/              # Generic content editing form (exposes validate())
  entry-sidebar/               # Save/Publish/Discard + Publishing + Information
  rich-text-editor/            # Tiptap editor with toolbar
  image-field/                 # IMAGE field upload/preview
  field-modal/                 # Modal for adding/editing content type fields
  relation-field/              # Single-relation entry card
  multi-relation-field/        # Multi-relation draggable list
  entry-picker-modal/          # Entry picker with type tabs + search
  entry-editor-pane/           # Sliding pane for editing related entries
composables/
  useContentTable.ts           # Shared formatDate + statusColor helpers
  useContentEntryEditor.ts     # Entry editing lifecycle
  useAuthedFetch.ts            # useFetch wrapper that forwards cookies during SSR
  useRelationResolver.ts       # Resolves relation refs via useRequestFetch
scripts/
  content-bundle/              # CLI to export/import content bundles
  build-starters/              # CLI to build overlay-based starter bundles
  manage-api-keys/             # CLI for API key create/list/revoke
starters/
  base.boject.json             # v1 base starter bundle
  sport.boject.json            # built-from-overlay sport bundle
  rugby.boject.json            # built-from-overlay rugby bundle
  src/*.overlay.json           # overlay sources
types/
  contentEditor.ts             # FieldConfig discriminated union (auto-imported)
  basicComponentProps.ts       # Shared BasicComponentProps (testId, etc.)
utils/
  mapFieldToConfig.ts          # ContentTypeField -> FieldConfig mapping
  paneStack.ts                 # Pane-stack URL encode/decode for /entries/[...stack]
  parseUniqueConflict.ts       # Client helper parsing UNIQUE_CONFLICT 409 responses
  test-config/                 # Shared testIds / testIdModifier helpers
pages/
  login.vue                    # Login page
  index.vue                    # All content (paginated, sorted by updatedAt)
  content-types/               # Content type list/create/edit + per-type entry listing
  entries/[...stack].vue       # Entry create/edit (pane-stack catch-all)
middleware/
  auth.global.ts               # Redirects to /login when unauthenticated
  entry-redirect.global.ts     # Rewrites legacy /content-types/:id/entries/* URLs
storage/                       # Gitignored, local file storage (dev)
generated/                     # Gitignored, auto-generated
  prisma/                      # Prisma client
  pothos-types.ts              # Pothos-Prisma type bridge
```

## Architecture

```
External clients → GraphQL Yoga → dynamic schema → Prisma → PostgreSQL
CMS pages → Nuxt server routes → Prisma → PostgreSQL
```

- **Nuxt 4** serves pages and API routes. Nitro is the server engine. A default layout (`layouts/default.vue`) provides a dashboard shell with sidebar navigation and a header navbar (user avatar/dropdown menu) using Nuxt UI's dashboard components.
- **GraphQL Yoga** handles external client requests at `POST /api/graphql`. The schema is built dynamically at startup from `ContentType` rows via `server/graphql/buildSchema.ts`, then cached; `invalidateSchema()` is called after every ContentType mutation so the next request rebuilds.
- **CMS pages** use dedicated Nuxt server API routes that query Prisma directly.
- **Prisma v7** uses the `@prisma/adapter-pg` driver adapter (not the traditional Rust engine). A singleton client in `server/utils/prisma.ts` is auto-imported into all server routes.
- **Generated types** live in `generated/` (gitignored). Run `pnpm prisma:generate` after any schema change.
- **Primitive file pipeline** — `POST /api/files/upload` accepts multipart uploads (5MB limit, JPEG/PNG/WebP/GIF/AVIF), processes originals via Sharp (auto-orient, max 4000px), writes them to `useStorage('images:originals')`, and returns `{ storageKey, mimeType, width, height, fileSize, originalName }` without creating a DB row. `GET /api/files/:storageKey/transform` serves variants with on-the-fly resize/format conversion (publicly accessible, cached, rate limited). Used by the `IMAGE` field type on dynamic content types. Production storage can be swapped to S3/R2 via Nitro storage config.
- **Content bundle CLI** — `scripts/content-bundle/` exports and imports dynamic content types and entries as JSON bundles. Portable mode (`--portable`) rewrites UUID references to `identifier`/`slug` keys for cross-instance migration; import does the reverse lookup in a transactional two-pass resolve. Functions are importable so a future scaffolder (e.g. `create-boject-cms`) can invoke them directly.
- **Starters** — `starters/base.boject.json` defines the 8 content types every content-driven site needs (Image, Tag, Author, Article, Page, SiteSettings, Navigation, NavigationItem) plus one SiteSettings seed entry. `sport.boject.json` and `rugby.boject.json` are built from overlay sources in `starters/src/` via `pnpm starters:build`.

## GraphQL API

**Endpoint:** `POST /api/graphql`

The schema is generated from your `ContentType` rows. Each ContentType produces:

- an object type with one field per `ContentTypeField` (typed by `FieldType`)
- a list connection query (`{camelName}List`, e.g. `blogPostList(first, after, where)`)
- a single-item query (`{camelName}`, e.g. `blogPost(id)`)
- a slug lookup query if the type has a SLUG field (`{camelName}BySlug`, e.g. `blogPostBySlug(slug)`)

A cross-type `contentEntryList` query is also available for querying entries across all types, filterable by `status`, `contentType`, `createdAt`, and `updatedAt`.

All list queries return [Relay-style cursor connections](https://relay.dev/graphql/connections.htm) with `edges`, `node`, `cursor`, and `pageInfo`, and accept `first`/`after`/`last`/`before` alongside an optional `where` filter.

```graphql
{
  blogPostList(first: 10, where: { status: { equals: PUBLISHED } }) {
    edges {
      node {
        id
        entryTitle
        slug
      }
      cursor
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

### Filter Operations

| Type          | Operations                         |
| ------------- | ---------------------------------- |
| String        | `equals`, `contains`               |
| Float         | `equals`, `gt`, `gte`, `lt`, `lte` |
| Boolean       | `equals`                           |
| DateTime      | `equals`, `gt`, `gte`, `lt`, `lte` |
| ContentStatus | `equals`                           |

### Custom Scalars

- **DateTime** — Serialises as ISO-8601 strings, parses string input to `Date`.
- **JSON** — Pass-through scalar for RICHTEXT fields (Tiptap ProseMirror JSON).

### Authentication

In production, all `/api/graphql` requests require an `Authorization: Bearer boject_...` header with a valid API key. In development, all requests are unauthenticated so the GraphiQL playground can introspect and query freely. Manage keys via:

```bash
pnpm apikey:create "My integration"   # prints the raw key once
pnpm apikey:list
pnpm apikey:revoke <prefix>
```

## Database

PostgreSQL 17 runs locally via Docker Compose (port 5432, user/password/db: `boject`).

### Models

| Model                   | Description                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| **User**                | CMS admin accounts (email, scrypt-hashed password, firstName, lastName)                                    |
| **ApiKey**              | Hashed API keys for GraphQL + REST (keyPrefix, keyHash, revokedAt, lastUsedAt)                             |
| **ContentType**         | User-defined content type with unique name, PascalCase identifier, and ordered field definitions           |
| **ContentTypeField**    | Field definition (name, camelCase identifier, FieldType, required, `unique`, order, options JSON)          |
| **ContentEntry**        | Envelope for an entry — `contentTypeId`, `slug`, `entryTitle` (synced from the active version), timestamps |
| **ContentEntryVersion** | Versioned content body — `data` JSONB, `status`, `publishedAt`, `createdBy`, `updatedBy`                   |

All models use UUID primary keys and `createdAt`/`updatedAt` timestamps. Entries use a two-table versioning model: `ContentEntry` is an identity envelope (unique `(contentTypeId, slug)` and `(contentTypeId, entryTitle)`), and `ContentEntryVersion` holds the per-version content. Each entry keeps at most one draft (`DRAFT` or `CHANGED`) and one `PUBLISHED` version at a time, enforced by a partial unique index; `ARCHIVED` versions are unlimited.

User-configurable uniqueness: `ContentTypeField.unique` is auto-enabled for `ENTRY_TITLE` / `SLUG` and opt-in for `TEXT` / `NUMBER`. Enforcement is a runtime cross-version JSONB check; conflicts return `409` with `{ error: 'UNIQUE_CONFLICT', conflicts }`.

### Migrations

```bash
pnpm prisma:migrate           # Apply migrations (interactive)
pnpx prisma migrate deploy    # Apply migrations (non-interactive / CI)
```

## Testing

Two Vitest projects: **integration** (server API + middleware, starts a Nuxt dev server, requires seeded database) and **unit** (scripts, starters, server utils, no database needed).

```bash
pnpm test                    # Run all tests once
pnpm test:integration        # Integration tests only
pnpm test:unit               # Unit tests only
```

**Integration tests:**

- **GraphQL** — dynamic-type list queries, single-item lookups, where filtering, Relay cursor pagination, dev-mode unauthenticated access.
- **Content** — `/api/content` contentType-identifier filter, status filter, combined filters, invalid-value handling.
- **Auth** — login validation, credential checking, session handling, middleware behaviour.
- **Files** — primitive upload (auth, mime/size validation, successful upload), transform endpoint (resize, format conversion, public access, rate limiting).
- **Content types** — CRUD, field management (add/update/delete/reorder), identifier validation, uniqueness constraints.
- **Content entries** — CRUD, data validation against field definitions, slug uniqueness, status transitions, `entryTitle` populate + uniqueness, IMAGE field end-to-end.
- **CSRF** — origin/referer enforcement and Bearer-key bypass.

**Unit tests:**

- **Content bundle** — shape validation, portable reference walkers, export, import, fixture regression, export → import round-trip.
- **Starters** — shape regression + overlay-drift check against committed outputs.
- **Server utils** — Prisma error translation, entry data validation, input validation helpers.

**Requirement:** Docker PostgreSQL must be running (integration tests auto-reset and seed the `boject_test` database via `vitest.globalSetup.ts`).

## Linting & Formatting

- **ESLint** — Via `@nuxt/eslint` module. Config in `eslint.config.mjs`.
- **Prettier** — Single quotes, trailing commas, semicolons, 2-space indent. Config in `.prettierrc.yml`.
- **eslint-config-prettier** — Disables ESLint rules that conflict with Prettier.
- **Lefthook** — Pre-commit hooks run ESLint and Prettier in parallel on staged files.

```bash
pnpm lint          # Check
pnpm lint:fix      # Auto-fix
pnpm format        # Check formatting
pnpm format:fix    # Auto-fix formatting
```

## Environment Variables

| Variable                | Description                               | Default                                            |
| ----------------------- | ----------------------------------------- | -------------------------------------------------- |
| `DATABASE_URL`          | PostgreSQL connection string              | `postgresql://boject:boject@localhost:5432/boject` |
| `NUXT_SESSION_PASSWORD` | Session encryption key (required in prod) | Auto-generated in dev                              |

Create a `.env` file in the project root. Nuxt loads it automatically in development.
