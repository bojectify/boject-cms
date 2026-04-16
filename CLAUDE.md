# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

boject-cms is a general-purpose TypeScript headless CMS built with Nuxt 4 (Vue) and Prisma v7 on PostgreSQL. Content is modelled entirely through user-defined ContentTypes — there are no hardcoded domain models.

## Commands

```bash
docker compose up -d          # Start local PostgreSQL (required before dev/migrate)
docker compose down           # Stop local PostgreSQL (data persists in pgdata volume)
pnpm install                  # Install dependencies (runs nuxt prepare + prisma generate via postinstall)
pnpm dev                      # Start Nuxt development server (http://localhost:4000)
pnpm build                    # Build for production (outputs to .output/)
pnpm preview                  # Preview production build locally
pnpm db:up                    # Start local PostgreSQL container (alias for docker compose up -d)
pnpm prisma:generate          # Regenerate Prisma client + Pothos types (required after schema changes)
pnpm prisma:migrate           # Run database migrations
pnpm prisma:seed              # Seed database with admin user + test API key
pnpm prisma:seed:test         # Seed the `boject_test` database (hardcoded URL — mirrors prisma:studio:test)
pnpm lint                     # Lint with ESLint
pnpm lint:fix                 # Lint and auto-fix
pnpm format                   # Check formatting with Prettier
pnpm format:fix               # Format all files with Prettier
pnpm test                     # Run all tests once (alias: pnpm test:run)
pnpm test:integration         # Run integration tests only (server/api + server/middleware)
pnpm test:unit                # Run unit tests only (scripts, starters, server/utils)
pnpm typecheck                # Run TypeScript type checker (nuxi typecheck)
pnpm apikey:create <name>     # Create a new API key (prints raw key once)
pnpm apikey:list              # List all API keys (prefix, name, status, last used)
pnpm apikey:revoke <prefix>   # Revoke an API key by its prefix
pnpm content:export [--schema|--entries|--all] [--portable] [--out <path>]   # Export dynamic content types and/or entries as a JSON bundle
pnpm content:import <path> [--schema|--entries|--all] [--author <string>]     # Import a JSON bundle into the CMS
pnpm content:validate <path>                                                  # Validate a JSON bundle's shape without touching the DB
pnpm starters:build           # Build sport.boject.json / rugby.boject.json from overlays in starters/src/
pnpm starters:check           # Verify committed starter outputs are up to date (CI)
```

Note: `prisma migrate dev` requires an interactive terminal. When running from a non-interactive context, use `prisma migrate diff` to generate the SQL and `prisma migrate deploy` to apply it.

## Architecture

- **Nuxt 4** — Full-stack Vue framework. Pages in `pages/`, API routes in `server/api/`, server utilities in `server/utils/`. Nitro is the server engine.
- **ESM-only** — `"type": "module"` in package.json. All imports use ESM syntax, no CommonJS.
- **Prisma v7 with driver adapters** — Uses `@prisma/adapter-pg` (PrismaPg) instead of the traditional Rust engine binary. The adapter is mandatory.
- **Prisma singleton** — `server/utils/prisma.ts` exports a singleton `prisma` instance using the `globalThis` guard pattern to prevent connection pool exhaustion during Nuxt HMR. It is auto-imported into all server routes — no import needed.
- **Generated client** — Output to `generated/prisma/` (not the default `node_modules` location). This directory is gitignored and must be regenerated after every schema change via `pnpm prisma:generate`.
- **Local PostgreSQL** — `docker-compose.yml` runs Postgres 17 on port 5432 (user: `boject`, password: `boject`, db: `boject`). Data persists in a Docker volume (`pgdata`). `DATABASE_URL` in `.env` should be `postgresql://boject:boject@localhost:5432/boject`.
- **Environment variables** — `.env` is loaded automatically by Nuxt in development. `prisma.config.ts` retains its own `import 'dotenv/config'` for CLI-only use (migrations, generation). `DATABASE_URL` is accessed via `process.env` in server code.
- **Nuxt UI** — Component library (Tailwind CSS v4 + Reka UI primitives). Registered as a Nuxt module. CSS imported via `assets/css/main.css`. `app.vue` wraps pages in `<UApp>` with `<NuxtLayout>` (required for toasts, tooltips, overlays).
- **Dashboard layout** — `layouts/default.vue` uses `UDashboardGroup`, `UDashboardSidebar`, and `UDashboardPanel` to provide a sidebar navigation across all CMS pages. The sidebar contains a `UNavigationMenu` (vertical orientation) with links to All Content (index), followed by a separator and a dynamic Content Types section fetched from `/api/content-types`. Active page is highlighted automatically via `to` prop matching. The panel has a `UDashboardNavbar` in its `#header` slot with a `UDashboardSidebarCollapse` toggle (mobile) on the left and a user `UDropdownMenu` (triggered by `UAvatar` showing initials) on the right. The dropdown shows the user's full name and a logout action. Page content renders in the panel's `#body` slot for scrollability.
- **ContentTable component** — Reusable table wrapper (`components/ContentTable.vue`) around UTable. Provides standard columns (entryTitle, createdAt, updatedAt, status) with built-in date formatting and status badges. Pages pass `title`, `data`, `loading`, and optional extra `columns` which are inserted after entryTitle. Extra scoped slots are forwarded to UTable. Uses `useContentTable` composable for shared `formatDate` and `statusColor` logic. Optional pagination props (`page`, `total`, `itemsPerPage`) render a `UPagination` below the table when `total` is provided; pages bind via `v-model:page`. Optional `rowLink` prop `(row) => string` renders entryTitle as a NuxtLink to the edit page.
- **ContentEditor component** — Generic form component (`components/ContentEditor.vue`) for editing any content model. Accepts a `fields: FieldConfig[]` array (discriminated union on `type`: text, textarea, number, boolean, datetime, select, relation, richtext, multirelation) and a reactive `state` object. Renders the appropriate Nuxt UI input per field type. Includes a fixed "Publishing" section with status dropdown and slug field. Uses UForm with custom `validate` prop for required-field validation. Relation and multirelation fields fetch options from an `optionsEndpoint` on mount. Provides an `#after-fields` slot before the Publishing section for custom per-model content.
- **useAuthedFetch composable** — `composables/useAuthedFetch.ts` is a thin wrapper around `useFetch` that calls `useRequestHeaders(['cookie'])` and forwards the cookie header into every server-side fetch. **Required for any authenticated `/api/*` call in setup** — plain `useFetch` during SSR does NOT inherit the browser's session cookie, so the auth middleware returns 401 and the page renders empty before hydration overwrites it. Signature mirrors `useFetch` exactly. For imperative `$fetch` calls during SSR-sensitive render paths (e.g. `useRelationResolver`), use Nuxt's built-in `useRequestFetch()` instead — it returns a request-aware `$fetch` with the same cookie-forwarding behaviour. For `$fetch` inside client-only event handlers (save buttons, modal opens, upload handlers), keep plain `$fetch` — the browser attaches the cookie automatically.
- **Content field types** — `types/contentEditor.ts` defines the `FieldConfig` discriminated union used by `ContentEditor`. Auto-imported by Nuxt. Includes `RichtextFieldConfig` (renders Tiptap editor) and `MultirelationFieldConfig` (renders multi-select for many-to-many relations).
- **Tiptap rich text editor** — `components/RichTextEditor.vue` provides a full-featured rich text editor using `@tiptap/vue-3`. Extensions: StarterKit (excluding codeBlock), Table/TableRow/TableCell/TableHeader, Link, Image, CodeBlockLowlight (with lowlight syntax highlighting). Toolbar with formatting buttons. Emits v-model JSON (ProseMirror document). Editor instance is destroyed on `onBeforeUnmount`.
- **FieldModal component** — `components/FieldModal.vue` provides a modal dialog for adding and editing content type fields. Props: `open`, `mode` ('add'|'edit'), `field` (existing field data or null), `fieldTypeOptions`, `entryCount`. Emits: `close`, `save`, `delete`. Exposes a `#type-options` scoped slot (`{ type, options, updateOptions }`) for type-specific configuration UI (e.g. SELECT choices). In add mode: name, identifier (auto-generated), type dropdown, required toggle. In edit mode: name and required editable, identifier and type read-only, info bar with identifier and entry count, danger zone for deletion (hidden for ENTRY_TITLE fields).
- **RelationField component** — `components/RelationField.vue` renders a single RELATION field in the entry editor. Shows an empty "Add entry" card or a filled card with entry title, content type initial, and remove button. Emits: `add`, `edit`, `remove`.
- **MultiRelationField component** — `components/MultiRelationField.vue` renders a MULTIRELATION field with draggable entry cards and an "Add entry" button. Uses vuedraggable for reordering. Emits: `add`, `edit(index)`, `remove(index)`, `reorder(items)`.
- **EntryPickerModal component** — `components/EntryPickerModal.vue` modal for searching and selecting existing entries from allowed target content types. Type filter tabs, search input, scrollable entry list. "Create new..." button with type popover for multiple targets. Emits: `select`, `create(contentTypeId)`, `close`.
- **EntryEditorPane component** — `components/EntryEditorPane.vue` sliding full-screen pane for creating or editing a related entry. Contentful-inspired stacked pane pattern with parent page sliver visible on the left. Uses `ContentEditor` and `useContentEntryEditor` internally. CSS transition slide-in from right. Emits: `close`, `saved`.
- **useRelationResolver composable** — `composables/useRelationResolver.ts` resolves `{ contentTypeId, entryId }` relation references into display data (entry title, content type name). Uses `useRequestFetch()` so server-side calls forward cookies. Caches results to avoid re-fetching.
- **Path aliases** — `nuxt.config.ts` defines `#prisma` → `generated/prisma/client` and `#generated` → `generated/`. These are resolved by both Nuxt (app + Nitro server) and TypeScript (via auto-generated `.nuxt/tsconfig.json`). Use `import type { Prisma } from '#prisma'` instead of relative paths. Standalone scripts (`scripts/`, `prisma/seed.ts`) that run via `tsx` outside Nuxt still use relative paths.
- **REST API filtering** — `/api/content-entries` and `/api/content` support filters on `contentTypeId` / `contentType` (identifier), `status`, `page`, `perPage`. Status values are validated against a `VALID_STATUSES` set; invalid values are silently ignored (no filter applied). `/api/content` returns `{ items: [{ id, entryTitle, status, contentType, contentTypeId, createdAt, updatedAt }], total }` where `contentType` is the ContentType display name.
- **CSRF protection** — `server/middleware/csrf.ts` rejects non-GET/HEAD `/api/*` requests whose `Origin`/`Referer` does not match the request `Host`, unless the request carries a `Bearer` API key (API keys are ambient-credential-free). Session cookie is `SameSite=Strict, HttpOnly, Secure` (secure only in production) via `runtimeConfig.session.cookie` in `nuxt.config.ts`. A production boot-time check throws if `NUXT_SESSION_PASSWORD` is unset.
- **Mutation rate limiting** — `server/utils/rateLimitEndpoint.ts` applies a per-IP, per-endpoint sliding window (30 req/60s) to mutating content-type and content-entry endpoints via `enforceMutationRateLimit(event, '<id>')`. Uses the existing `rateLimit()` sliding-window helper.
- **Shared validation** — `server/utils/validation.ts` exports `isUuid`, `assertUuid`, `assertNonNegativeInt`, `assertStringLength`, `toPascalCase`, `toCamelCase`, `assertIdentifier` (PascalCase), and `assertFieldIdentifier` (camelCase) for consistent 400 errors on bad input.
- **Prisma error translation** — `server/utils/prismaErrors.ts` exports `translatePrismaError` and `withPrismaErrors(fn, opts)` which translate P2002 → 409, P2003 → 400, P2025 → 404 with configurable messages.
- **Authentication** — `nuxt-auth-utils` module provides encrypted cookie sessions. Login page at `/login` (uses `layouts/auth.vue`). Global server middleware (`server/middleware/auth.ts`) protects all `/api/*` routes — accepts either a valid session cookie (CMS users) or an API key in `Authorization: Bearer` header (external consumers). Skips `/api/auth/**`, `/api/_auth/**`, `/api/graphql` (has its own API key gate), and `/api/files/:storageKey/transform` (public file serving). Global client middleware (`middleware/auth.global.ts`) redirects unauthenticated users to `/login` and authenticated users away from `/login` to `/`. Password hashing uses scrypt via `hashPassword()` / `verifyPassword()` (auto-imported in server routes). `NUXT_SESSION_PASSWORD` env var required in production (auto-generated in dev). Default admin credentials: `admin@example.com` / `password` (seeded via `prisma/seed.ts`). The seed and integration tests both read `INTEGRATION_TEST_USERNAME` / `INTEGRATION_TEST_PASSWORD` env vars, falling back to the defaults when unset — set these in CI or sensitive environments to override. Shared helper at `server/test/credentials.ts`. The logged-in user's name and logout action are in the header navbar dropdown.
- **Primitive file pipeline** — `POST /api/files/upload` (session auth required, rate limited) accepts multipart image uploads, processes originals via Sharp (auto-orient + max-dimension clamp), writes to `useStorage('images:originals')`, and returns `{ storageKey, mimeType, width, height, fileSize, originalName }`. Does not create a DB row. `GET /api/files/:storageKey/transform` (public, rate limited 100/60s per IP, cached in `useStorage('images:transforms')`) serves transformed variants keyed directly by storage key — no DB lookup. The `storage/` directory is gitignored. Production storage can be swapped to S3/R2 via `nitro.storage` config.
- **Content bundle CLI** — `scripts/content-bundle/` is a standalone CLI module for exporting/importing dynamic content types and entries as JSON bundles. Functions are exported from `export.ts`, `import.ts`, `validate.ts`, with shared types in `types.ts` and the CLI entry at `index.ts`. Fixture bundles live under `fixtures/` for tests. Portable mode (`--portable`) rewrites UUID references to `identifier`/`slug` keys for cross-instance migration; import does the reverse lookup in a transactional two-pass resolve.
- **Starter bundles** — `starters/` at the repo root holds production-ready JSON bundles applied via `pnpm content:import`. `starters/base.boject.json` defines the 8 content types every content-driven website needs (Image, Tag, Author, Article, Page, SiteSettings, Navigation, NavigationItem) plus one SiteSettings seed entry. Distinct from `scripts/content-bundle/fixtures/`, which holds test-only bundles. See `starters/README.md` for usage and conventions.
- **Starter overlays** — `starters/base.boject.json` is authored directly. `sport.boject.json` and `rugby.boject.json` are built from `starters/src/*.overlay.json` via `pnpm starters:build`. Each overlay declares an `extends` parent and a list of content-type changes with `mode: "create"` (append a new type) or `mode: "patch"` (add/replace fields on a parent type; new ENTRY_TITLE/SLUG fields are rejected). The build script resolves the `extends` chain (topo-sorted, cycles error out), runs `validateBundle` on every output, and writes deterministic Prettier-formatted JSON so `pnpm starters:check` can diff against committed outputs in CI (the diff ignores `exportedAt`). Build outputs are committed.
- **Prisma MCP server** — Local MCP server configured for Claude Code, providing direct access to migrate-status, migrate-dev, migrate-reset, and Prisma Studio.
- **Nuxt UI MCP server** — Remote MCP server at `https://ui.nuxt.com/mcp` for component docs, examples, and metadata.

## Database Schema

Defined across four `.prisma` files in `prisma/schema/` (multi-file schema): `base.prisma` (generators, datasource, `ContentStatus` + `FieldType` enums), `auth.prisma` (User, ApiKey), `contentType.prisma` (ContentType, ContentTypeField), `contentEntry.prisma` (ContentEntry). `prisma.config.ts` points to the directory. Models use UUID primary keys, `createdAt`/`updatedAt` timestamps.

### Content Metadata

Dynamic content entries (`ContentEntry`) carry publishing metadata:

- `entryTitle` — display name for the entry in the CMS (synced from the ENTRY_TITLE field's value in `data`).
- `status` — `ContentStatus` enum (`DRAFT`, `PUBLISHED`, `CHANGED`, `ARCHIVED`), defaults to `DRAFT`.
- `publishedAt` — nullable `DateTime`, set when first published.
- `createdBy` / `updatedBy` — nullable `String` fields for user tracking (will become relations when that work lands).

### Users & API Keys

- **User** — CMS admin accounts. Fields: `email` (unique), `password` (scrypt hash), `firstName`, `lastName`. No signup flow — users are seeded or created manually.
- **ApiKey** — Stores hashed API keys for GraphQL endpoint and REST API authentication. Fields: `name` (human label), `keyHash` (SHA-256 hash, unique), `keyPrefix` (first 11 chars for identification), `revokedAt` (nullable, soft-revoke), `lastUsedAt` (nullable, updated on use). Not a content model — no publishing metadata.

### Dynamic Content Types

The sole content modelling layer — all content types and entries are user-defined. A JSONB-hybrid system that avoids runtime Prisma migrations.

- **ContentType** — User-defined content type. Fields: `name` (unique display name, e.g. "Blog Post"), `identifier` (unique PascalCase API name, e.g. `BlogPost`), optional `description`. Has many `ContentTypeField`s and many `ContentEntry`s. Schema in `prisma/schema/contentType.prisma`.
- **ContentTypeField** — Field definition within a content type. Fields: `identifier` (unique camelCase within content type, e.g. `publishDate`), `name` (display name, e.g. "Publish Date"), `type` (`FieldType` enum), `required`, `order`, optional `options` (Json, e.g. select choices). Unique constraint on `(contentTypeId, identifier)`. The `identifier` is the key used in the JSONB `data` column of ContentEntry.
- **FieldType enum** — `ENTRY_TITLE` (required, exactly one per type, used as display name in listings), `SLUG` (optional, at most one per type, unique per content type), `TEXT`, `TEXTAREA`, `NUMBER`, `BOOLEAN`, `DATETIME`, `SELECT`, `RICHTEXT` (renders Tiptap editor, stores ProseMirror JSON), `RELATION` (polymorphic single reference, stores `{ contentTypeId, entryId }` in JSONB, requires `options.targetContentTypeIds`), `MULTIRELATION` (polymorphic ordered array of references, stores `[{ contentTypeId, entryId }, ...]`, requires `options.targetContentTypeIds`), `IMAGE` (file reference with dimensions and focal point, shape-only validation, stores `{ storageKey, mimeType, width, height, fileSize, originalName, focalPointX, focalPointY }` in JSONB; the file itself lives in the `images:originals` unstorage bucket and is served/transformed via `/api/files/:storageKey/transform`).
- **ContentEntry** — Instance of a dynamic content type. Fields: `contentTypeId`, `data` (Json — field values keyed by field `identifier`), `entryTitle` (dedicated String column, mirrors the `slug` pattern — synced from the ENTRY_TITLE field's value in `data` via `extractEntryTitle()` on create and update), `slug` (nullable, stored both in `data` and dedicated column for unique constraint), `status` (ContentStatus enum), `publishedAt`, `createdBy`, `updatedBy`. Unique constraints on `(contentTypeId, slug)` and `(contentTypeId, entryTitle)`; duplicate titles within a content type are rejected with 409. Schema in `prisma/schema/contentEntry.prisma`.
- **Entry validation** — `server/utils/validateEntryData.ts` validates entry `data` against field definitions: enforces required fields, type-checks values per FieldType, validates SELECT against allowed choices. Also exports `extractSlug()` and `extractEntryTitle()` helpers.
- **Content type REST API** — `GET /api/content-types` (list), `POST /api/content-types` (create with fields), `GET /api/content-types/[id]` (detail), `PUT /api/content-types/[id]` (update name/identifier/description), `DELETE /api/content-types/[id]` (only if no entries). Field management: `POST /api/content-types/[id]/fields` (add), `PUT /api/content-types/[id]/fields/[fieldId]` (update name/required/options, blocks type change if entries exist), `DELETE /api/content-types/[id]/fields/[fieldId]` (blocks deleting only ENTRY_TITLE), `PUT /api/content-types/[id]/fields/reorder` (bulk reorder).
- **Content entry REST API** — `GET /api/content-entries` (requires `contentTypeId`, supports `status`/`page`/`perPage`), `POST /api/content-entries` (validates data against fields), `GET /api/content-entries/[id]` (includes contentType and fields), `PUT /api/content-entries/[id]` (re-validates data), `DELETE /api/content-entries/[id]`.
- **Unified content listing** — `server/api/content.get.ts` queries `ContentEntry` directly (no UNION), joining `ContentType` to surface the display name. Accepts `page`/`perPage`/`contentType` (identifier)/`status` query params; returns `{ items, total }` where each item has `contentType` (display name) and `contentTypeId`.
- **CMS UI** — Content type list (`pages/content-types/index.vue`), create (`pages/content-types/new.vue`), edit (`pages/content-types/[id].vue`). Entry list (`pages/content-types/[id]/entries/index.vue`), create (`pages/content-types/[id]/entries/new.vue`), edit (`pages/content-types/[id]/entries/[entryId].vue`). Field definitions are mapped to `FieldConfig[]` for the `ContentEditor` component. Slug fields are excluded from the main editor and rendered in the built-in publishing section.
- **Sidebar navigation** — `layouts/default.vue` dynamically fetches content types and renders navigation links for "Content Types" management and per-type entry listings.
- **useContentEntryEditor composable** — `composables/useContentEntryEditor.ts` manages entry editing lifecycle (fetch via `useAuthedFetch`, save, slug generation). Populates `formState` via an `immediate: true` watcher for SSR-friendly hydration.

## GraphQL

Served at `/api/graphql` via GraphQL Yoga + Pothos schema builder. The schema is built entirely from `ContentType` rows at startup — there are no hand-written model types.

- **Authentication** — In production, all `/api/graphql` requests require an `Authorization: Bearer boject_...` header with a valid API key. In development, all requests are unauthenticated so GraphiQL can introspect and query freely. Keys are SHA-256 hashed and stored in the `ApiKey` database table. Key validation is handled by `server/utils/validateApiKey.ts` (auto-imported). Revoked keys (non-null `revokedAt`) are rejected. `lastUsedAt` is updated fire-and-forget on each valid request. Keys are managed via `scripts/manage-api-keys.ts` CLI (create/list/revoke). Integration tests use a deterministic test key seeded by `prisma/seed.ts`.
- **Endpoint** — `POST /api/graphql` for queries/mutations. `GET /api/graphql` serves the GraphiQL playground in development.
- **Schema builder** — `server/graphql/builder.ts` exports a `createBuilder()` factory with PrismaPlugin, PrismaUtilsPlugin, and RelayPlugin. Includes custom `JSON` and `DateTime` scalars.
- **Dynamic type registration** — `server/graphql/dynamicTypes.ts` defines `registerDynamicTypes(builder, contentTypes, ContentStatusEnum)`, which walks each `ContentType` + `ContentTypeField` row and emits a Pothos object type implementing a shared `ContentEntry` interface, per-type `Where` filter input, list connection query (`{camelName}List`), single-item lookup (`{camelName}`), and optional slug lookup (`{camelName}BySlug`). Also registers a cross-type `contentEntryList` connection query. `server/graphql/types/` contains only `contentStatus.ts` (the shared `ContentStatus` GraphQL enum).
- **Relay offset pagination** — All generated list queries use `resolveOffsetConnection` with raw SQL via `prisma.$queryRaw`. Responses use standard Relay connection shape (`edges { node { ... } cursor } pageInfo { hasNextPage endCursor ... }`). Clients can paginate with `first`/`after`/`last`/`before` args.
- **Where filtering** — Handled by `server/graphql/jsonbFilters.ts`, which defines Prisma-style where inputs for each dynamic ContentType. Scalar filters (string `equals`/`contains`, float `equals`/`gt`/`gte`/`lt`/`lte`, boolean `equals`, datetime `equals`/`gt`/`gte`/`lt`/`lte`, contentStatus `equals`) are declared on the builder; dynamic-field filters are generated per ContentType based on its `ContentTypeField` definitions.
- **Schema assembly** — `server/graphql/buildSchema.ts` loads `ContentType` rows, registers dynamic types, and returns a `GraphQLSchema`. `server/graphql/schema.ts` caches the built schema; `invalidateSchema()` is called after every ContentType mutation to force a rebuild on the next request.
- **Generated types** — `generated/pothos-types.ts` is produced by `prisma generate` alongside the Prisma client. Gitignored, never edit manually.
- **DateTime scalar** — Registered in the builder. Serialises as ISO-8601 strings, parses string input to `Date`.

## Key Files

- `nuxt.config.ts` — Nuxt configuration (modules, runtimeConfig, nitro options, CSS, path aliases)
- `app.vue` — Root component wrapping `<NuxtLayout>` + `<NuxtPage />` in `<UApp>`
- `layouts/default.vue` — Dashboard layout with sidebar navigation and header navbar (user avatar/dropdown)
- `layouts/auth.vue` — Centered layout for login page (no sidebar)
- `pages/login.vue` — Login page with email/password form
- `auth.d.ts` — Session type augmentation (`UserSessionData` with id, email, firstName, lastName)
- `server/api/auth/login.post.ts` — Login endpoint (email/password → session cookie)
- `server/api/auth/logout.post.ts` — Logout endpoint (clears session)
- `server/middleware/auth.ts` — Global server middleware protecting `/api/*` routes (session or API key)
- `middleware/auth.global.ts` — Global client middleware redirecting to `/login` if unauthenticated, or to `/` if already authenticated
- `assets/css/main.css` — Tailwind CSS + Nuxt UI imports
- `server/utils/prisma.ts` — Singleton PrismaClient instance (auto-imported into all server routes)
- `server/api/graphql/graphql.ts` — GraphQL Yoga ↔ H3 bridge with API key auth gate
- `server/utils/apiKey.ts` — `generateApiKey()` and `hashApiKey()` utilities (SHA-256, `boject_` prefix)
- `server/utils/validateApiKey.ts` — `validateApiKey()` extracts Bearer token, hashes, looks up in DB, rejects if missing/invalid/revoked
- `scripts/manage-api-keys.ts` — CLI for API key create/list/revoke (standalone Prisma, run via `tsx`)
- `components/ContentTable.vue` — Reusable content listing table (UTable wrapper with standard columns + slot forwarding)
- `components/ContentEditor.vue` — Generic content editing form driven by `FieldConfig[]`
- `components/ImageField.vue` — IMAGE field editor component (upload + preview + remove)
- `components/FieldModal.vue` — Modal for adding/editing content type fields with type-options slot
- `components/RelationField.vue` — Single relation entry card (empty/filled states)
- `components/MultiRelationField.vue` — Multi relation draggable entry cards
- `components/EntryPickerModal.vue` — Entry picker modal with type tabs and search
- `components/EntryEditorPane.vue` — Sliding pane for editing related entries
- `components/RichTextEditor.vue` — Tiptap rich text editor with toolbar
- `composables/useContentTable.ts` — Shared `formatDate` and `statusColor` helpers
- `composables/useAuthedFetch.ts` — `useFetch` wrapper that forwards session cookies during SSR
- `composables/useContentEntryEditor.ts` — Entry editing composable (fetch, save, slug generation)
- `composables/useRelationResolver.ts` — Resolves relation references to display data
- `server/api/health.get.ts` — Health check endpoint (returns database connection status)
- `server/api/content.get.ts` — Paginated content listing (`ContentEntry` joined with `ContentType`, sorted by `updatedAt` desc)
- `server/api/content-types.get.ts` — Content type list endpoint (paginated, includes field/entry counts)
- `server/api/content-types/index.post.ts` — Content type create (with nested fields, validates ENTRY_TITLE/SLUG constraints, auto-generates identifier)
- `server/api/content-types/[id].get.ts` — Content type detail (includes ordered fields and entry count)
- `server/api/content-types/[id].put.ts` — Content type update (name, identifier, description)
- `server/api/content-types/[id].delete.ts` — Content type delete (blocks if entries exist)
- `server/api/content-types/[id]/fields/` — Field CRUD endpoints (add, update, delete, reorder)
- `server/api/content-types/options.get.ts` — Content type options for relation field target picker
- `server/api/content-entries.get.ts` — Entry list (requires contentTypeId, supports status filter)
- `server/api/content-entries/index.post.ts` — Entry create (validates data against field definitions)
- `server/api/content-entries/[id].get.ts` — Entry detail (includes contentType and fields)
- `server/api/content-entries/[id].put.ts` — Entry update (re-validates data)
- `server/api/content-entries/[id].delete.ts` — Entry delete
- `server/api/files/upload.post.ts` — Primitive file upload (no DB row)
- `server/api/files/[storageKey]/transform.get.ts` — Public transform by storage key
- `server/api/files/files.test.ts` — File upload + transform integration tests
- `server/graphql/builder.ts` — Pothos SchemaBuilder singleton with PrismaPlugin, PrismaUtilsPlugin, and RelayPlugin
- `server/graphql/buildSchema.ts` — Loads ContentType rows and registers dynamic types
- `server/graphql/schema.ts` — Caches the built schema; exposes `invalidateSchema()`
- `server/graphql/dynamicTypes.ts` — `registerDynamicTypes(builder, contentTypes)` — emits object types, connections, and lookups per ContentType
- `server/graphql/jsonbFilters.ts` — Prisma-style where filter inputs for dynamic ContentTypes
- `server/graphql/types/contentStatus.ts` — ContentStatus GraphQL enum
- `server/utils/imageProcessing.ts` — Sharp-based image processing: `processOriginal()` (auto-orient, max dimension), `transformImage()` (resize, format, quality), constants for allowed types/formats/sizes
- `server/utils/rateLimit.ts` — In-memory sliding window rate limiter per key, with lazy cleanup
- `server/utils/rateLimitEndpoint.ts` — Per-endpoint mutation rate limiter
- `server/utils/validation.ts` — Shared input validation helpers
- `server/utils/prismaErrors.ts` — Prisma error-code → HTTP error translation
- `server/utils/validateEntryData.ts` — Entry data validation against field definitions (type checking, required enforcement, slug/title extraction)
- `server/middleware/csrf.ts` — CSRF origin/referer check for mutating `/api/*` routes
- `prisma/schema/base.prisma` — generators, datasource, `ContentStatus` + `FieldType` enums
- `prisma/schema/auth.prisma` — User, ApiKey
- `prisma/schema/contentType.prisma` — ContentType, ContentTypeField
- `prisma/schema/contentEntry.prisma` — ContentEntry
- `prisma/seed.ts` — Database seed script (admin user + deterministic test API key)
- `prisma.config.ts` — Prisma CLI configuration (schema directory, datasource, migrations path; dotenv-loaded for CLI use)
- `generated/prisma/client.ts` — Server-side entry (PrismaClient + model types; gitignored, regenerated)
- `generated/pothos-types.ts` — Pothos-Prisma type bridge (gitignored, regenerated)
- `docker-compose.yml` — Local PostgreSQL 17 container
- `eslint.config.mjs` — ESLint flat config (extends Nuxt-generated config, loads `@typescript-eslint` plugin)
- `lefthook.yml` — Pre-commit (lint, format, typecheck) and pre-push (test) hook configuration
- `vitest.config.ts` — Vitest configuration (two projects: integration + unit; fileParallelism disabled)
- `vitest.globalSetup.ts` — Resets and seeds the `boject_test` database before integration tests run
- `pages/content-types/index.vue` — Content type listing page
- `pages/content-types/new.vue` — Content type creation with field builder
- `pages/content-types/[id].vue` — Content type edit with field management
- `pages/content-types/[id]/entries/index.vue` — Entry listing for a content type
- `pages/content-types/[id]/entries/new.vue` — Entry creation with dynamic field mapping
- `pages/content-types/[id]/entries/[entryId].vue` — Entry editing
- `types/contentEditor.ts` — `FieldConfig` discriminated union (auto-imported)
- `server/api/graphql/graphql.test.ts` — GraphQL API integration tests
- `server/api/content/content.test.ts` — Content endpoint filter integration tests
- `server/api/auth/auth.test.ts` — Auth endpoint and middleware integration tests
- `server/api/content-types/content-types.test.ts` — Content type and field management integration tests
- `server/api/content-entries/content-entries.test.ts` — Content entry CRUD integration tests
- `server/middleware/csrf.test.ts` — CSRF middleware integration tests
- `starters/base.boject.json` — v1 base starter bundle (8 content types + SiteSettings entry)
- `starters/sport.boject.json` — built-from-overlay sport starter (team, club, season, competition, fixture, player)
- `starters/rugby.boject.json` — built-from-overlay rugby starter (adds Position + patches Player)
- `starters/src/sport.overlay.json` — sport overlay source (delta on top of `base`)
- `starters/src/rugby.overlay.json` — rugby overlay source (delta on top of `sport`)
- `starters/README.md` — starter bundle documentation + usage conventions
- `starters/starters.test.ts` — shape regression test for every bundle under `starters/`
- `scripts/build-starters/types.ts` — `Overlay`, `OverlayContentType`, `OverlayField` types
- `scripts/build-starters/validate.ts` — overlay-specific shape validator
- `scripts/build-starters/merge.ts` — pure `mergeOverlay(parent, overlay)` function implementing create/patch semantics
- `scripts/build-starters/build.ts` — async `buildAll(root)` orchestrator
- `scripts/build-starters/index.ts` — `pnpm starters:build` / `pnpm starters:check` CLI entry
- `scripts/build-starters/drift.test.ts` — guards committed outputs match a fresh rebuild
- `scripts/content-bundle/types.ts` — Shared `Bundle`, `BundleField`, `BundleEntry`, `ValidationResult`, etc.
- `scripts/content-bundle/validate.ts` — Bundle shape validation (no DB access)
- `scripts/content-bundle/portable.ts` — Portable reference rewriting helpers
- `scripts/content-bundle/export.ts` — `exportBundle(prisma, { mode, portable })` queries the DB and returns a `Bundle`
- `scripts/content-bundle/import.ts` — `importBundle(prisma, bundle, { mode, author })` runs a transactional two-pass import
- `scripts/content-bundle/index.ts` — CLI wrapper dispatching `export`/`import`/`validate` subcommands
- `scripts/content-bundle/fixtures/minimal.boject.json` — Minimal valid bundle (Page content type, no entries)
- `scripts/content-bundle/fixtures/with-relations.boject.json` — Bundle with a RELATION field and cross-referenced entries
- `scripts/content-bundle/fixtures/with-richtext.boject.json` — Bundle with a RICHTEXT field and ProseMirror JSON

## Linting & Formatting

- **ESLint** — Via `@nuxt/eslint` module (registered in `nuxt.config.ts`). Includes Vue, TypeScript, and Nuxt-specific rules. Config in `eslint.config.mjs`. Custom config covers `**/*.ts` files with `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin`. A separate block sets `parserOptions.parser` to `@typescript-eslint/parser` for `**/*.vue` files (the Nuxt-generated config uses `vue-eslint-parser` but doesn't configure a TypeScript sub-parser). Underscore-prefixed variables are allowed as unused (`varsIgnorePattern: '^_'`). Destructured rest siblings are also ignored (`ignoreRestSiblings: true`).
- **Prettier** — Single quotes, trailing commas (es5), semicolons, 2-space indent, 80 char width. Config in `.prettierrc.yml`.
- **eslint-config-prettier** — Disables ESLint rules that conflict with Prettier.
- **Lefthook** — Pre-commit hooks run ESLint and Prettier in parallel on staged files. Config in `lefthook.yml`.

## Testing

- **Vitest** — Test runner, configured via `vitest.config.ts` with plain `defineConfig` (not `@nuxt/test-utils/config` due to Nuxt 4.3 incompatibility). Two test projects: `integration` (server/api + server/middleware tests, with `globalSetup` for DB reset/seed) and `unit` (scripts, starters, server/utils tests, no DB needed). `fileParallelism: false` prevents port conflicts between test files.
- **@nuxt/test-utils** — Starts a Nuxt dev server for integration tests. Tests must use `setup({ dev: true })` (production mode masks GraphQL errors).
- **Test location** — Colocated with source files (e.g. `server/api/graphql/graphql.test.ts`).
- **Test API key** — All REST and GraphQL integration tests authenticate with a deterministic test key (`boject_test_key_for_integration_tests_only`) seeded via `prisma/seed.ts`.
- **GraphQL tests** — Integration tests covering dynamic-type list queries, single-item lookups, where filtering, Relay cursor pagination, and dev-mode unauthenticated access.
- **Content tests** — Integration tests for `/api/content` covering `contentType` identifier filter, `status` filter, combined filters, and invalid value handling.
- **Auth tests** — Integration tests covering login validation, credential checking, session handling, and middleware behaviour.
- **File tests** — Integration tests covering primitive upload (auth, mime/size validation, successful upload returning `{ storageKey, ... }`), transform endpoint (resize, format conversion, public access, rate limiting).
- **Content type tests** — Integration tests covering content type CRUD, field management (add, update, delete, reorder), identifier validation (PascalCase for types, camelCase for fields), uniqueness constraints, and ENTRY_TITLE/SLUG field rules.
- **Content entry tests** — Integration tests covering entry CRUD, data validation (required fields, type checking, select choices), slug uniqueness, status transitions, `entryTitle` populate + uniqueness, and IMAGE field end-to-end coverage.
- **CSRF tests** — Integration tests covering origin/referer enforcement and the Bearer-key bypass.
