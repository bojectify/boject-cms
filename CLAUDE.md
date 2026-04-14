# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

boject-cms is a TypeScript CMS for a rugby club, built with Nuxt 4 (Vue) and Prisma v7 on PostgreSQL.

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
pnpm prisma:seed              # Seed database with test data (uses DATABASE_URL — typically dev db)
pnpm prisma:seed:test         # Seed the `boject_test` database (hardcoded URL — mirrors prisma:studio:test)
pnpm lint                     # Lint with ESLint
pnpm lint:fix                 # Lint and auto-fix
pnpm format                   # Check formatting with Prettier
pnpm format:fix               # Format all files with Prettier
pnpm test:watch               # Run tests in watch mode
pnpm test:run                 # Run tests once (CI)
pnpm typecheck                # Run TypeScript type checker (nuxi typecheck)
pnpm apikey:create <name>     # Create a new API key (prints raw key once)
pnpm apikey:list              # List all API keys (prefix, name, status, last used)
pnpm apikey:revoke <prefix>   # Revoke an API key by its prefix
pnpm content:export [--schema|--entries|--all] [--portable] [--out <path>]   # Export dynamic content types and/or entries as a JSON bundle
pnpm content:import <path> [--schema|--entries|--all] [--author <string>]     # Import a JSON bundle into the CMS
pnpm content:validate <path>                                                  # Validate a JSON bundle's shape without touching the DB
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
- **Dashboard layout** — `layouts/default.vue` uses `UDashboardGroup`, `UDashboardSidebar`, and `UDashboardPanel` to provide a sidebar navigation across all CMS pages. The sidebar contains a `UNavigationMenu` (vertical orientation) with links to All Content (index) and all per-model listing pages, followed by a separator and a second `UNavigationMenu` with dynamically rendered links for "Content Types" management and per-type entry listings (fetched from `/api/content-types`). Active page is highlighted automatically via `to` prop matching. The panel has a `UDashboardNavbar` in its `#header` slot with a `UDashboardSidebarCollapse` toggle (mobile) on the left and a user `UDropdownMenu` (triggered by `UAvatar` showing initials) on the right. The dropdown shows the user's full name and a logout action. Page content renders in the panel's `#body` slot for scrollability.
- **ContentTable component** — Reusable table wrapper (`components/ContentTable.vue`) around UTable. Provides standard columns (entryTitle, createdAt, updatedAt, status) with built-in date formatting and status badges. Pages pass `title`, `data`, `loading`, and optional extra `columns` which are inserted after entryTitle. Extra scoped slots are forwarded to UTable. Uses `useContentTable` composable for shared `formatDate` and `statusColor` logic. Optional pagination props (`page`, `total`, `itemsPerPage`) render a `UPagination` below the table when `total` is provided; pages bind via `v-model:page`. Optional `rowLink` prop `(row) => string` renders entryTitle as a NuxtLink to the edit page.
- **ContentEditor component** — Generic form component (`components/ContentEditor.vue`) for editing any content model. Accepts a `fields: FieldConfig[]` array (discriminated union on `type`: text, textarea, number, boolean, datetime, select, relation, richtext, multirelation) and a reactive `state` object. Renders the appropriate Nuxt UI input per field type. Includes a fixed "Publishing" section with status dropdown and slug field. Uses UForm with custom `validate` prop for required-field validation. Relation and multirelation fields fetch options from an `optionsEndpoint` on mount. Provides an `#after-fields` slot before the Publishing section for custom per-model content (e.g. author social links).
- **useContentEditor composable** — `composables/useContentEditor.ts` manages content editing lifecycle: fetches item via `useFetch`, populates reactive `formState`, provides `save()` (PUT via `$fetch`), `generateSlug()` helper, and loading/error state. Used by all per-model edit pages.
- **Content field types** — `types/contentEditor.ts` defines the `FieldConfig` discriminated union used by `ContentEditor`. Auto-imported by Nuxt. Includes `RichtextFieldConfig` (renders Tiptap editor) and `MultirelationFieldConfig` (renders multi-select for many-to-many relations).
- **Tiptap rich text editor** — `components/RichTextEditor.vue` provides a full-featured rich text editor using `@tiptap/vue-3`. Extensions: StarterKit (excluding codeBlock), Table/TableRow/TableCell/TableHeader, Link, Image, CodeBlockLowlight (with lowlight syntax highlighting), and a custom CmsEmbed node. Toolbar with formatting buttons. Emits v-model JSON (ProseMirror document). Editor instance is destroyed on `onBeforeUnmount`.
- **FieldModal component** — `components/FieldModal.vue` provides a modal dialog for adding and editing content type fields. Props: `open`, `mode` ('add'|'edit'), `field` (existing field data or null), `fieldTypeOptions`, `entryCount`. Emits: `close`, `save`, `delete`. Exposes a `#type-options` scoped slot (`{ type, options, updateOptions }`) for type-specific configuration UI (e.g. SELECT choices). In add mode: name, identifier (auto-generated), type dropdown, required toggle. In edit mode: name and required editable, identifier and type read-only, info bar with identifier and entry count, danger zone for deletion (hidden for ENTRY_TITLE fields).
- **RelationField component** — `components/RelationField.vue` renders a single RELATION field in the entry editor. Shows an empty "Add entry" card or a filled card with entry title, content type initial, and remove button. Emits: `add`, `edit`, `remove`.
- **MultiRelationField component** — `components/MultiRelationField.vue` renders a MULTIRELATION field with draggable entry cards and an "Add entry" button. Uses vuedraggable for reordering. Emits: `add`, `edit(index)`, `remove(index)`, `reorder(items)`.
- **EntryPickerModal component** — `components/EntryPickerModal.vue` modal for searching and selecting existing entries from allowed target content types. Type filter tabs, search input, scrollable entry list. "Create new..." button with type popover for multiple targets. Emits: `select`, `create(contentTypeId)`, `close`.
- **EntryEditorPane component** — `components/EntryEditorPane.vue` sliding full-screen pane for creating or editing a related entry. Contentful-inspired stacked pane pattern with parent page sliver visible on the left. Uses `ContentEditor` and `useContentEntryEditor` internally. CSS transition slide-in from right. Emits: `close`, `saved`.
- **useRelationResolver composable** — `composables/useRelationResolver.ts` resolves `{ contentTypeId, entryId }` relation references into display data (entry title, content type name). Caches results to avoid re-fetching.
- **CmsEmbed** — Custom Tiptap ProseMirror node (`extensions/cmsEmbed.ts`) for embedding references to other content models inline. Attributes: `embedType` (team/club/competition/season), `embedId` (UUID). Rendered via `VueNodeViewRenderer` → `components/CmsEmbedNode.vue` (fetches and displays item). Inserted via `components/CmsEmbedModal.vue` (type selector + options dropdown).
- **Path aliases** — `nuxt.config.ts` defines `#prisma` → `generated/prisma/client` and `#generated` → `generated/`. These are resolved by both Nuxt (app + Nitro server) and TypeScript (via auto-generated `.nuxt/tsconfig.json`). Use `import type { Prisma } from '#prisma'` instead of relative paths. Standalone scripts (`scripts/`, `prisma/seed.ts`) that run via `tsx` outside Nuxt still use relative paths.
- **REST API filtering** — All per-model list endpoints support optional query param filters alongside pagination (`page`, `perPage`). The `where` clause is passed to both `findMany` and `count` so totals reflect filtered results. Filters by endpoint: fixtures (`teamId`, `opponentId`, `competitionId`, `seasonId`, `isHome`, `status`), players (`positionId`, `status`), competitions (`seasonId`, `status`), teams/clubs/seasons/images (`status`), authors (`status`), tags (`status`), articles (`status`, `authorId`, `tagId`), links (`status`), navigations (`status`). The content endpoint supports `contentType` (filters which UNION subqueries to include; static types by table name, dynamic types by `identifier`) and `status` (adds WHERE clause). All status values are validated against a `VALID_STATUSES` set; invalid values are silently ignored (no filter applied).
- **CSRF protection** — `server/middleware/csrf.ts` rejects non-GET/HEAD `/api/*` requests whose `Origin`/`Referer` does not match the request `Host`, unless the request carries a `Bearer` API key (API keys are ambient-credential-free). Session cookie is `SameSite=Strict, HttpOnly, Secure` (secure only in production) via `runtimeConfig.session.cookie` in `nuxt.config.ts`. A production boot-time check throws if `NUXT_SESSION_PASSWORD` is unset.
- **Mutation rate limiting** — `server/utils/rateLimitEndpoint.ts` applies a per-IP, per-endpoint sliding window (30 req/60s) to mutating navigation endpoints via `enforceMutationRateLimit(event, '<id>')`. Uses the existing `rateLimit()` sliding-window helper.
- **Shared validation** — `server/utils/validation.ts` exports `isUuid`, `assertUuid`, `assertNonNegativeInt`, `assertStringLength`, `toPascalCase`, `toCamelCase`, `assertIdentifier` (PascalCase), and `assertFieldIdentifier` (camelCase) for consistent 400 errors on bad input.
- **Prisma error translation** — `server/utils/prismaErrors.ts` exports `translatePrismaError` and `withPrismaErrors(fn, opts)` which translate P2002 → 409, P2003 → 400, P2025 → 404 with configurable messages.
- **Navigation-item scoping** — all mutating nav-item endpoints (POST, PUT `[id]`, DELETE `[id]`, PUT `reorder`) require a `navigationId` and verify that every item (and `parentId`, where relevant) belongs to that navigation. `reorder` additionally caps the batch at 500 items and validates each element's shape.
- **Authentication** — `nuxt-auth-utils` module provides encrypted cookie sessions. Login page at `/login` (uses `layouts/auth.vue`). Global server middleware (`server/middleware/auth.ts`) protects all `/api/*` routes — accepts either a valid session cookie (CMS users) or an API key in `Authorization: Bearer` header (external consumers). Skips `/api/auth/**`, `/api/_auth/**`, `/api/graphql` (has its own API key gate), and `/api/images/:id/transform` (public image serving). Global client middleware (`middleware/auth.global.ts`) redirects unauthenticated users to `/login` and authenticated users away from `/login` to `/`. Password hashing uses scrypt via `hashPassword()` / `verifyPassword()` (auto-imported in server routes). `NUXT_SESSION_PASSWORD` env var required in production (auto-generated in dev). Default admin credentials: `admin@example.com` / `password` (seeded via `prisma/seed.ts`). The seed and integration tests both read `INTEGRATION_TEST_USERNAME` / `INTEGRATION_TEST_PASSWORD` env vars, falling back to the defaults when unset — set these in CI or sensitive environments to override. Shared helper at `server/test/credentials.ts`. The logged-in user's name and logout action are in the header navbar dropdown.
- **Image upload & transform** — File upload via `POST /api/images/upload` (multipart form, session auth required, 5MB limit, accepts JPEG/PNG/WebP/GIF/AVIF). Originals are auto-oriented (EXIF stripped) and downscaled if >4000px wide via Sharp. Stored in Nitro's unstorage (`images:originals` mount, filesystem in dev). On-the-fly transformation via `GET /api/images/:id/transform` (publicly accessible, no auth) with query params: `w` (width), `h` (height), `f` (format: jpeg/png/webp/avif), `q` (quality 1-100), `fit` (cover/contain/fill/inside/outside). Transformed variants are cached in `images:transforms` storage. Responses include `Cache-Control: public, max-age=31536000, immutable`. Rate limited to 100 requests/60s per IP. The `storage/` directory is gitignored. Production storage can be swapped to S3/R2 via `nitro.storage` config.
- **Content bundle CLI** — `scripts/content-bundle/` is a standalone CLI module for exporting/importing dynamic content types and entries as JSON bundles. Functions are exported from `export.ts`, `import.ts`, `validate.ts`, with shared types in `types.ts` and the CLI entry at `index.ts`. Fixture bundles live under `fixtures/` for tests. Portable mode (`--portable`) rewrites UUID references to `identifier`/`slug` keys for cross-instance migration; import does the reverse lookup in a transactional two-pass resolve.
- **Prisma MCP server** — Local MCP server configured for Claude Code, providing direct access to migrate-status, migrate-dev, migrate-reset, and Prisma Studio.
- **Nuxt UI MCP server** — Remote MCP server at `https://ui.nuxt.com/mcp` for component docs, examples, and metadata.

## Database Schema

Defined across multiple `.prisma` files in `prisma/schema/` (multi-file schema). `prisma.config.ts` points to the directory. Files: `base.prisma` (generators, datasource, enums), `team.prisma`, `club.prisma`, `competition.prisma`, `season.prisma`, `fixture.prisma`, `player.prisma`, `image.prisma`, `auth.prisma`, `author.prisma`, `tag.prisma`, `article.prisma`, `link.prisma`, `navigation.prisma`, `navigationItem.prisma`, `contentType.prisma`, `contentEntry.prisma`. All models use UUID primary keys, `createdAt`/`updatedAt` timestamps, and `@unique` constraints on name fields where duplicates don't make sense.

### Content Metadata

Content models (Team, Club, Competition, Season, Player, Fixture, Image, Author, Tag, Article, Link, Navigation) have publishing metadata:

- `entryTitle` — Display name for the entry in the CMS (e.g. the model's `name`, or `firstName lastName` for players)
- `status` — `ContentStatus` enum (`DRAFT`, `PUBLISHED`, `CHANGED`, `ARCHIVED`), defaults to `DRAFT`
- `publishedAt` — Nullable `DateTime`, set when first published
- `createdBy` / `updatedBy` — Nullable `String` fields for user tracking (will become relations when auth is added)

### Users & API Keys

- **User** — CMS admin accounts. Fields: `email` (unique), `password` (scrypt hash), `firstName`, `lastName`. No signup flow — users are seeded or created manually.
- **ApiKey** — Stores hashed API keys for GraphQL endpoint and REST API authentication. Fields: `name` (human label), `keyHash` (SHA-256 hash, unique), `keyPrefix` (first 11 chars for identification), `revokedAt` (nullable, soft-revoke), `lastUsedAt` (nullable, updated on use). Not a content model — no publishing metadata.

### Domain Models

- **Team** — Internal club squads (e.g. 1st XV, Veterans, Juniors). Linked to competitions and fixtures.
- **Club** — External opponent clubs with a name and optional crest (one-to-one Image relation).
- **Competition** — Leagues/cups, linked to a Season and to Teams via a many-to-many join table (`TeamsOnCompetitions`).
- **Season** — Has name, startDate, endDate. Competitions and fixtures belong to a season.
- **Fixture** — A match. Links to a Team (which squad is playing), an optional Club (opponent), an optional Competition, an optional Season, and has `isHome` boolean. Scores are tracked via the Score model.
- **Score** — Individual scoring events (TRY, CONVERSION, PENALTY, DROP_GOAL enum). Links to a Fixture and optionally to a Player, with an optional `minute` field. Final score is calculated from these records.
- **Player** — Has firstName, lastName, optional bio, optional position. Images via headshot (one-to-one), actionShot (one-to-one), and a general images list. Team membership tracked via PlayerTeamHistory.
- **PlayerTeamHistory** — Join table tracking which Team a Player belongs to over time. `endDate` is nullable (null = currently on that team). A player can have multiple open records.
- **Position** — Rugby positions (e.g. Fly-half, Hooker). Unique name.
- **Image** — Reusable image model with url, alt, width, height, plus optional storage fields (`storagePath`, `mimeType`, `fileSize`, `originalName`) for uploaded files. Used for player headshots, action shots, general player images, club crests, author headshots, and article featured images.
- **Author** — Article authors with name (unique), slug (unique), optional bio, and optional headshot (one-to-one Image relation via named relation "AuthorHeadshot"). Has many AuthorSocialLinks and many Articles.
- **AuthorSocialLink** — Social media links for authors. Fields: `platform` (String), `url` (String). Belongs to an Author with cascade delete. Managed via delete-and-recreate strategy in a `$transaction` on author update.
- **Tag** — Content tags with name (unique) and slug (unique). Many-to-many relation with Articles via Prisma implicit join table `_ArticleToTag`.
- **Article** — Blog/news articles with title (unique), slug (unique), optional summary, optional body (`Json?` — Tiptap ProseMirror JSON), optional Author relation, optional featuredImage (one-to-one Image relation via named relation "ArticleFeaturedImage"), and many-to-many Tags.
- **Link** — Reusable content link with `label`, optional `url` (free-form), optional `article` relation (internal content reference), and `openInNewTab`. Used standalone for embedding in rich text and as the target of NavigationItems. Either `url` or `articleId` must be provided (enforced at the API layer, not the DB). No slug.
- **Navigation** — Container for a navigation tree, with a unique `name` (e.g. "Main Navigation") and a list of `NavigationItem`s. No slug.
- **NavigationItem** — Structural join between Navigation and Link with `order`, optional `parentId` self-relation, and cascade delete from both Navigation and Link. Strictly two-level nesting (parent or child, no grandchildren); enforced at the API layer in POST/PUT handlers. Deleting a NavigationItem does not delete the Link.

### Dynamic Content Types

A JSONB-hybrid system for user-defined content types. Avoids runtime Prisma migrations. Coexists with the existing hardcoded rugby models.

- **ContentType** — User-defined content type. Fields: `name` (unique display name, e.g. "Blog Post"), `identifier` (unique PascalCase API name, e.g. `BlogPost`), optional `description`. Has many `ContentTypeField`s and many `ContentEntry`s. Schema in `prisma/schema/contentType.prisma`.
- **ContentTypeField** — Field definition within a content type. Fields: `identifier` (unique camelCase within content type, e.g. `publishDate`), `name` (display name, e.g. "Publish Date"), `type` (`FieldType` enum), `required`, `order`, optional `options` (Json, e.g. select choices). Unique constraint on `(contentTypeId, identifier)`. The `identifier` is the key used in the JSONB `data` column of ContentEntry.
- **FieldType enum** — `ENTRY_TITLE` (required, exactly one per type, used as display name in listings), `SLUG` (optional, at most one per type, unique per content type), `TEXT`, `TEXTAREA`, `NUMBER`, `BOOLEAN`, `DATETIME`, `SELECT`, `RICHTEXT` (renders Tiptap editor, stores ProseMirror JSON), `RELATION` (polymorphic single reference, stores `{ contentTypeId, entryId }` in JSONB, requires `options.targetContentTypeIds`), `MULTIRELATION` (polymorphic ordered array of references, stores `[{ contentTypeId, entryId }, ...]`, requires `options.targetContentTypeIds`).
- **ContentEntry** — Instance of a dynamic content type. Fields: `contentTypeId`, `data` (Json — field values keyed by field `identifier`), `entryTitle` (dedicated String column, mirrors the `slug` pattern — synced from the ENTRY_TITLE field's value in `data` via `extractEntryTitle()` on create and update), `slug` (nullable, stored both in `data` and dedicated column for unique constraint), `status` (ContentStatus enum), `publishedAt`, `createdBy`, `updatedBy`. Unique constraints on `(contentTypeId, slug)` and `(contentTypeId, entryTitle)`; duplicate titles within a content type are rejected with 409. Schema in `prisma/schema/contentEntry.prisma`.
- **Entry validation** — `server/utils/validateEntryData.ts` validates entry `data` against field definitions: enforces required fields, type-checks values per FieldType, validates SELECT against allowed choices. Also exports `extractSlug()` and `extractEntryTitle()` helpers.
- **Content type REST API** — `GET /api/content-types` (list), `POST /api/content-types` (create with fields), `GET /api/content-types/[id]` (detail), `PUT /api/content-types/[id]` (update name/identifier/description), `DELETE /api/content-types/[id]` (only if no entries). Field management: `POST /api/content-types/[id]/fields` (add), `PUT /api/content-types/[id]/fields/[fieldId]` (update name/required/options, blocks type change if entries exist), `DELETE /api/content-types/[id]/fields/[fieldId]` (blocks deleting only ENTRY_TITLE), `PUT /api/content-types/[id]/fields/reorder` (bulk reorder).
- **Content entry REST API** — `GET /api/content-entries` (requires `contentTypeId`, supports `status`/`page`/`perPage`), `POST /api/content-entries` (validates data against fields), `GET /api/content-entries/[id]` (includes contentType and fields), `PUT /api/content-entries/[id]` (re-validates data), `DELETE /api/content-entries/[id]`.
- **Unified content listing** — `server/api/content.get.ts` UNION ALL query includes dynamic entries. Dynamic types are looked up by `identifier` via the `contentType` query param. Entry title extracted from JSONB via SQL JOIN with ContentTypeField.
- **CMS UI** — Content type list (`pages/content-types/index.vue`), create (`pages/content-types/new.vue`), edit (`pages/content-types/[id].vue`). Entry list (`pages/content-types/[id]/entries/index.vue`), create (`pages/content-types/[id]/entries/new.vue`), edit (`pages/content-types/[id]/entries/[entryId].vue`). Field definitions are mapped to `FieldConfig[]` for the `ContentEditor` component. Slug fields are excluded from the main editor and rendered in the built-in publishing section.
- **Sidebar navigation** — `layouts/default.vue` dynamically fetches content types and renders navigation links for "Content Types" management and per-type entry listings.
- **useContentEntryEditor composable** — `composables/useContentEntryEditor.ts` manages entry editing lifecycle (fetch, save, slug generation) similar to `useContentEditor` but for dynamic entries.

## GraphQL

Served at `/api/graphql` via GraphQL Yoga + Pothos schema builder.

- **Authentication** — All `POST /api/graphql` requests require an `Authorization: Bearer boject_...` header with a valid API key. Keys are SHA-256 hashed and stored in the `ApiKey` database table. `GET` requests in development are unauthenticated (GraphiQL playground access). Key validation is handled by `server/utils/validateApiKey.ts` (auto-imported). Revoked keys (non-null `revokedAt`) are rejected. `lastUsedAt` is updated fire-and-forget on each valid request. Keys are managed via `scripts/manage-api-keys.ts` CLI (create/list/revoke). Integration tests use a deterministic test key seeded by `prisma/seed.ts`.
- **Endpoint** — `POST /api/graphql` for queries/mutations. `GET /api/graphql` serves GraphiQL playground in development.
- **Schema builder** — `server/graphql/builder.ts` exports the singleton `SchemaBuilder` with PrismaPlugin, PrismaUtilsPlugin, and RelayPlugin. Includes a custom `JSON` scalar for Article body (ProseMirror JSON).
- **Type definitions** — One file per Prisma model in `server/graphql/types/`. Each file calls `builder.prismaObject(...)` as a side effect. Content metadata fields are shared via `contentMetadataFields()` helper in `server/graphql/types/contentFields.ts`.
- **Enums** — `ScoreTypeEnum` in `server/graphql/types/score.ts`, `ContentStatusEnum` in `server/graphql/types/contentStatus.ts`.
- **Root queries** — All root Query fields in `server/graphql/query/index.ts`. List + single-item lookups for all models except TeamsOnCompetitions (accessible only as nested data via `team.competitions` or `competition.teams`).
- **Relay cursor pagination** — All root list queries use `t.prismaConnection()` and one-to-many relation fields use `t.relatedConnection()` via `@pothos/plugin-relay`. Responses use standard Relay connection shape (`edges { node { ... } cursor } pageInfo { hasNextPage endCursor ... }`). Clients can paginate with `first`/`after`/`last`/`before` args. One-to-one relations remain as `t.relation()`. All models use `cursor: 'id'` except `TeamsOnCompetitions` which uses the composite cursor `teamId_competitionId`.
- **Where filtering** — `server/graphql/filters.ts` defines Prisma-style where inputs via `@pothos/plugin-prisma-utils`. All root list queries and one-to-many relation fields accept an optional `where` arg alongside the Relay pagination args (e.g. `clubs(first: 10, where: { name: { contains: "RFC" } })` or `team.fixtures(where: { isHome: { equals: true } })`). One-to-many relations use `t.relatedConnection()` with `args` and `query` callback to pass filters to Prisma. Scalar filters use `builder.prismaFilter()`, model where inputs use `builder.prismaWhere()`. To-one relation filters (e.g. filtering fixtures by season) use manual `builder.inputType()` wrappers with `is`/`isNot` fields since `builder.prismaObjectFilter()` is not available in the current Pothos version. `FixtureWhere` includes relation filters for `team`, `opponent`, `competition`, and `season`. `ArticleWhere` includes relation filters for `author` (AuthorRelationFilter) and `tags` (TagListRelationFilter with `some`/`every`/`none` for many-to-many filtering).
- **Schema assembly** — `server/graphql/schema.ts` imports all type/query files for side effects, then exports `builder.toSchema()`.
- **Generated types** — `generated/pothos-types.ts` is produced by `prisma generate` alongside the Prisma client. Gitignored, never edit manually.
- **DateTime scalar** — Registered in the builder. Serialises as ISO-8601 strings, parses string input to `Date`.
- **LinkTarget union** — `server/graphql/types/link.ts` defines a `LinkTarget` GraphQL union exposing the internal content a Link points to. Currently includes `Article` only. Consumers query with inline fragments: `internalLink { __typename ... on Article { slug title author { name } } }`. The union uses `ArticleRef` (exported from `server/graphql/types/article.ts`) rather than a string identifier. When adding new target models, export their ref and add to both the `types` array and `resolveType`.

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
- `server/api/graphql/graphql.ts` — GraphQL Yoga ↔ H3 bridge with API key auth gate (explicitly imports `defineEventHandler` from `h3`)
- `server/utils/apiKey.ts` — `generateApiKey()` and `hashApiKey()` utilities (SHA-256, `boject_` prefix)
- `server/utils/validateApiKey.ts` — `validateApiKey()` extracts Bearer token, hashes, looks up in DB, rejects if missing/invalid/revoked
- `scripts/manage-api-keys.ts` — CLI for API key create/list/revoke (standalone Prisma, run via `tsx`)
- `components/ContentTable.vue` — Reusable content listing table (UTable wrapper with standard columns + slot forwarding)
- `composables/useContentTable.ts` — Shared `formatDate` and `statusColor` helpers
- `server/api/health.get.ts` — Health check endpoint (returns database connection status)
- `server/api/content.get.ts` — Paginated content API route (raw SQL `UNION ALL` across all static content models plus dynamic ContentEntry, sorted by `updatedAt` desc, accepts `page`/`perPage`/`contentType`/`status` query params, returns `{ items, total }`. Dynamic types are looked up by `identifier` via the `contentType` param.)
- `server/api/{model}.get.ts` — Per-model list API routes (teams, fixtures, players, clubs, competitions, seasons, images, authors, tags, articles) querying Prisma directly. All support query param filtering (see REST API filtering above).
- `server/api/{model}/[id].get.ts` — Per-model single-item GET routes (findUnique by UUID, returns 404 if not found)
- `server/api/{model}/[id].put.ts` — Per-model PUT routes for updating records (readBody, explicit field allow-list, `applyContentMetadata`, handles unique constraint → 409)
- `server/api/{teams,clubs,competitions,seasons,positions,authors,tags,images}/options.get.ts` — Lightweight endpoints returning `{ label, value }[]` for relation dropdowns
- `server/utils/contentUpdate.ts` — `applyContentMetadata()` helper copies entryTitle/slug/status from request body and auto-sets `publishedAt` on first publish
- `server/graphql/builder.ts` — Pothos SchemaBuilder singleton with PrismaPlugin, PrismaUtilsPlugin, and RelayPlugin
- `server/graphql/schema.ts` — Assembles all type registrations and exports the GraphQL schema
- `server/graphql/types/` — Per-model Pothos type definitions
- `server/graphql/types/contentFields.ts` — Shared content metadata field helper
- `server/graphql/types/contentStatus.ts` — ContentStatus GraphQL enum
- `server/graphql/filters.ts` — Prisma-style where filter input types
- `server/graphql/query/index.ts` — Root Query field definitions
- `server/api/authors/authors.test.ts` — Author REST API integration tests (11 tests)
- `server/api/tags/tags.test.ts` — Tag REST API integration tests (9 tests)
- `server/api/articles/articles.test.ts` — Article REST API integration tests (13 tests)
- `components/RichTextEditor.vue` — Tiptap rich text editor with toolbar and CmsEmbed support
- `components/FieldModal.vue` — Modal for adding/editing content type fields with type-options slot
- `components/RelationField.vue` — Single relation entry card (empty/filled states)
- `components/MultiRelationField.vue` — Multi relation draggable entry cards
- `components/EntryPickerModal.vue` — Entry picker modal with type tabs and search
- `components/EntryEditorPane.vue` — Sliding pane for editing related entries
- `composables/useRelationResolver.ts` — Resolves relation references to display data
- `components/CmsEmbedNode.vue` — Vue NodeView for rendering CmsEmbed nodes in the editor
- `components/CmsEmbedModal.vue` — Modal for selecting content to embed
- `extensions/cmsEmbed.ts` — Custom Tiptap ProseMirror node extension for content embeds
- `pages/articles/index.vue` — Article listing page with author/tags columns
- `pages/articles/[id].vue` — Article edit page with rich text editor and tag multi-select
- `pages/authors/index.vue` — Author listing page
- `pages/authors/[id].vue` — Author edit page with social links management via #after-fields slot
- `pages/tags/index.vue` — Tag listing page
- `pages/tags/[id].vue` — Tag edit page
- `pages/links/index.vue` — Link listing page
- `pages/links/[id].vue` — Link edit page (no slug field via `showSlug={false}`)
- `pages/navigations/index.vue` — Navigation listing page
- `pages/navigations/[id].vue` — Navigation edit page with nested item tree manager (add/remove/reorder items)
- `server/graphql/types/author.ts` — Author + AuthorSocialLink Pothos type definitions
- `server/graphql/types/tag.ts` — Tag Pothos type definition
- `server/graphql/types/article.ts` — Article Pothos type definition (body exposed as JSON scalar; exports `ArticleRef` for use in unions)
- `server/graphql/types/link.ts` — Link Pothos type definition with `internalLink` field resolving via `LinkTarget` union type
- `server/graphql/types/navigationItem.ts` — NavigationItem Pothos type definition
- `server/graphql/types/navigation.ts` — Navigation Pothos type definition (items connection filters to top-level items only)
- `server/api/links.get.ts` — Link list endpoint (status filter, pagination)
- `server/api/links/[id].get.ts` — Link single-item GET
- `server/api/links/[id].put.ts` — Link update
- `server/api/links/index.post.ts` — Link create (requires label and one of url/articleId)
- `server/api/links/options.get.ts` — Link options for dropdowns (`{ label, value }[]`)
- `server/api/navigations.get.ts` — Navigation list endpoint
- `server/api/navigations/[id].get.ts` — Navigation single-item GET (includes nested items with children and link → article)
- `server/api/navigations/[id].put.ts` — Navigation update (handles name uniqueness → 409)
- `server/api/navigation-items.get.ts` — List items for a navigation (requires `navigationId`)
- `server/api/navigation-items/index.post.ts` — Create navigation item (enforces two-level nesting)
- `server/api/navigation-items/[id].put.ts` — Update navigation item
- `server/api/navigation-items/[id].delete.ts` — Delete navigation item (link is preserved)
- `server/api/navigation-items/reorder.put.ts` — Bulk reorder items via Prisma `$transaction`
- `server/api/articles/options.get.ts` — Article options endpoint for relation dropdowns
- `server/api/content-types/options.get.ts` — Content type options for relation field target picker (`{ label, value }[]`)
- `prisma/seed.ts` — Database seed script (positions, teams, clubs, seasons, competitions, players, fixtures, scores, authors, tags, articles, links, navigations, navigation items, test API key, sample Blog Post content type with entries)
- `docker-compose.yml` — Local PostgreSQL 17 container
- `server/api/` — Nitro API route handlers (CMS pages use Prisma directly, not GraphQL)
- `pages/` — Nuxt page components
- `prisma/schema/` — Multi-file Prisma schema (base, team, club, competition, season, fixture, player, image, auth, author, tag, article, link, navigation, navigationItem)
- `prisma.config.ts` — Prisma CLI configuration (schema directory, datasource, migrations path; dotenv-loaded for CLI use)
- `generated/prisma/client.ts` — Server-side entry (PrismaClient + model types; gitignored, regenerated)
- `generated/pothos-types.ts` — Pothos-Prisma type bridge (gitignored, regenerated)
- `eslint.config.mjs` — ESLint flat config (extends Nuxt-generated config, loads `@typescript-eslint` plugin)
- `lefthook.yml` — Pre-commit (lint, format, typecheck) and pre-push (test) hook configuration
- `vitest.config.ts` — Vitest configuration (fileParallelism disabled to prevent port conflicts)
- `server/api/graphql/graphql.test.ts` — GraphQL API integration tests
- `server/api/fixtures/fixtures.test.ts` — Fixtures REST API integration tests
- `server/api/lists/lists.test.ts` — List endpoint filter integration tests (teams, clubs, players, competitions, seasons, images)
- `server/api/content/content.test.ts` — Content endpoint filter integration tests (contentType, status)
- `server/api/auth/auth.test.ts` — Auth endpoint and middleware integration tests
- `server/utils/imageProcessing.ts` — Sharp-based image processing: `processOriginal()` (auto-orient, max dimension), `transformImage()` (resize, format, quality), constants for allowed types/formats/sizes
- `server/utils/rateLimit.ts` — In-memory sliding window rate limiter per key, with lazy cleanup
- `server/utils/validation.ts` — Shared input validation helpers (`isUuid`, `assertUuid`, `assertStringLength`, `toPascalCase`, `toCamelCase`, `assertIdentifier`, `assertFieldIdentifier`)
- `server/utils/prismaErrors.ts` — Prisma error-code → HTTP error translation
- `server/utils/rateLimitEndpoint.ts` — Per-endpoint mutation rate limiter
- `server/middleware/csrf.ts` — CSRF origin/referer check for mutating `/api/*` routes
- `server/api/images/upload.post.ts` — Multipart image upload endpoint (session auth, 5MB limit, stores via unstorage)
- `server/api/images/[id]/transform.get.ts` — Public image transform endpoint (resize, format, cache)
- `server/api/images/images.test.ts` — Image upload and transform integration tests
- `prisma/schema/contentType.prisma` — ContentType, ContentTypeField models and FieldType enum
- `prisma/schema/contentEntry.prisma` — ContentEntry model
- `server/utils/validateEntryData.ts` — Entry data validation against field definitions (type checking, required enforcement, slug/title extraction)
- `server/api/content-types.get.ts` — Content type list endpoint (paginated, includes field/entry counts)
- `server/api/content-types/index.post.ts` — Content type create (with nested fields, validates ENTRY_TITLE/SLUG constraints, auto-generates identifier)
- `server/api/content-types/[id].get.ts` — Content type detail (includes ordered fields and entry count)
- `server/api/content-types/[id].put.ts` — Content type update (name, identifier, description)
- `server/api/content-types/[id].delete.ts` — Content type delete (blocks if entries exist)
- `server/api/content-types/[id]/fields/` — Field CRUD endpoints (add, update, delete, reorder)
- `server/api/content-entries.get.ts` — Entry list (requires contentTypeId, supports status filter)
- `server/api/content-entries/index.post.ts` — Entry create (validates data against field definitions)
- `server/api/content-entries/[id].get.ts` — Entry detail (includes contentType and fields)
- `server/api/content-entries/[id].put.ts` — Entry update (re-validates data)
- `server/api/content-entries/[id].delete.ts` — Entry delete
- `composables/useContentEntryEditor.ts` — Entry editing composable (fetch, save, slug generation)
- `pages/content-types/index.vue` — Content type listing page
- `pages/content-types/new.vue` — Content type creation with field builder
- `pages/content-types/[id].vue` — Content type edit with field management
- `pages/content-types/[id]/entries/index.vue` — Entry listing for a content type
- `pages/content-types/[id]/entries/new.vue` — Entry creation with dynamic field mapping
- `pages/content-types/[id]/entries/[entryId].vue` — Entry editing
- `server/api/content-types/content-types.test.ts` — Content type and field management integration tests (24 tests)
- `server/api/content-entries/content-entries.test.ts` — Content entry CRUD integration tests (13 tests)
- `scripts/content-bundle/types.ts` — Shared `Bundle`, `BundleField`, `BundleEntry`, `ValidationResult`, etc.
- `scripts/content-bundle/validate.ts` — Bundle shape validation (no DB access)
- `scripts/content-bundle/portable.ts` — Portable reference rewriting helpers (`encodeDataRefs`, `decodeDataRefs`, cmsEmbed walker for RICHTEXT)
- `scripts/content-bundle/export.ts` — `exportBundle(prisma, { mode, portable })` queries the DB and returns a `Bundle`
- `scripts/content-bundle/import.ts` — `importBundle(prisma, bundle, { mode, author })` runs a transactional two-pass import (create types + entries with null refs, then resolve refs)
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

- **Vitest** — Test runner, configured via `vitest.config.ts` using `@nuxt/test-utils/config`. `fileParallelism: false` prevents port conflicts between test files that each start a Nuxt dev server.
- **@nuxt/test-utils** — Starts a Nuxt dev server for integration tests. Tests must use `setup({ dev: true })` (production mode masks GraphQL errors).
- **Test location** — Colocated with source files (e.g. `server/api/graphql/graphql.test.ts`).
- **Test API key** — All REST and GraphQL tests authenticate with a deterministic test key (`boject_test_key_for_integration_tests_only`) seeded via `prisma/seed.ts`.
- **GraphQL tests** — 30 integration tests covering list queries, single-item lookups, relation resolution, where filtering, Relay cursor pagination, API key authentication, and author/tag/article queries.
- **Fixtures tests** — 16 integration tests covering default listing, pagination, relation filters (teamId, opponentId, competitionId, seasonId), boolean/enum filters (isHome, status), combined filters, and edge cases.
- **List endpoint tests** — 29 integration tests covering query param filters on teams, clubs, seasons, images (status), players (positionId, status), and competitions (seasonId, status). Includes combined filter and invalid value tests.
- **Content tests** — 16 integration tests covering contentType filter (including Author, Tag, Article, Link, Navigation), status filter, combined filters, and invalid value handling.
- **Auth tests** — Integration tests covering login validation, credential checking, session handling, and middleware behaviour.
- **Image tests** — Integration tests covering upload validation (missing file, wrong mime type, file too large), successful upload, transform validation (invalid params), format conversion, public access, and rate limiting.
- **Author tests** — 11 integration tests covering listing, pagination, status filter, single-item lookup (with social links and headshot), update (name, bio, social links, content metadata), slug uniqueness (409), and 404 handling.
- **Tag tests** — 9 integration tests covering listing, pagination, status filter, single-item lookup, update (name, content metadata), slug uniqueness (409), and 404 handling.
- **Article tests** — 13 integration tests covering listing with relations, pagination, status/authorId/tagId filters, single-item lookup (with author, tags, featuredImage), update (title, summary, body, authorId, featuredImageId, tags), slug uniqueness (409), and 404 handling.
- **Link tests** — Integration tests covering listing, status filter, pagination, single-item lookup, create (url, missing label, missing url+articleId), update, and options endpoint.
- **Navigation tests** — Integration tests covering listing, nested item fetching (with children ordered by `order`), 404 handling, and name updates.
- **NavigationItem tests** — Integration tests covering listing items by navigationId, 400 without navigationId, creating top-level and child items, rejecting beyond two levels, deleting items (link is preserved), and bulk reorder.
- **Content type tests** — 24 integration tests covering content type CRUD, field management (add, update, delete, reorder), identifier validation (PascalCase for types, camelCase for fields), uniqueness constraints, and ENTRY_TITLE/SLUG field rules.
- **Content entry tests** — 13 integration tests covering entry CRUD, data validation (required fields, type checking, select choices), slug uniqueness, status transitions, and publishedAt auto-setting.
