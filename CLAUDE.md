# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

boject-cms is a TypeScript CMS for a rugby club, built with Nuxt 4 (Vue) and Prisma v7 on PostgreSQL.

## Commands

```bash
docker compose up -d          # Start local PostgreSQL (required before dev/migrate)
docker compose down           # Stop local PostgreSQL (data persists in pgdata volume)
pnpm install                  # Install dependencies (runs nuxt prepare + prisma generate via postinstall)
pnpm dev                      # Start Nuxt development server (http://localhost:3000)
pnpm build                    # Build for production (outputs to .output/)
pnpm preview                  # Preview production build locally
pnpm db:up                    # Start local PostgreSQL container (alias for docker compose up -d)
pnpm prisma:generate          # Regenerate Prisma client + Pothos types (required after schema changes)
pnpm prisma:migrate           # Run database migrations
pnpm prisma:seed              # Seed database with test data
pnpm lint                     # Lint with ESLint
pnpm lint:fix                 # Lint and auto-fix
pnpm format                   # Check formatting with Prettier
pnpm format:fix               # Format all files with Prettier
pnpm test                     # Run tests in watch mode
pnpm test:run                 # Run tests once (CI)
pnpm typecheck                # Run TypeScript type checker (nuxi typecheck)
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
- **Dashboard layout** — `layouts/default.vue` uses `UDashboardGroup`, `UDashboardSidebar`, and `UDashboardPanel` to provide a sidebar navigation across all CMS pages. The sidebar contains a `UNavigationMenu` (vertical orientation) with links to All Content (index) and all per-model listing pages. Active page is highlighted automatically via `to` prop matching. Page content renders in the panel's `#body` slot for scrollability.
- **ContentTable component** — Reusable table wrapper (`components/ContentTable.vue`) around UTable. Provides standard columns (entryTitle, createdAt, updatedAt, status) with built-in date formatting and status badges. Pages pass `title`, `data`, `loading`, and optional extra `columns` which are inserted after entryTitle. Extra scoped slots are forwarded to UTable. Uses `useContentTable` composable for shared `formatDate` and `statusColor` logic.
- **Prisma MCP server** — Local MCP server configured for Claude Code, providing direct access to migrate-status, migrate-dev, migrate-reset, and Prisma Studio.
- **Nuxt UI MCP server** — Remote MCP server at `https://ui.nuxt.com/mcp` for component docs, examples, and metadata.

## Database Schema

Defined in `prisma/schema.prisma`. All models use UUID primary keys, `createdAt`/`updatedAt` timestamps, and `@unique` constraints on name fields where duplicates don't make sense.

### Content Metadata

Content models (Team, Club, Competition, Season, Player, Fixture, Image) have publishing metadata:

- `entryTitle` — Display name for the entry in the CMS (e.g. the model's `name`, or `firstName lastName` for players)
- `status` — `ContentStatus` enum (`DRAFT`, `PUBLISHED`, `CHANGED`, `ARCHIVED`), defaults to `DRAFT`
- `publishedAt` — Nullable `DateTime`, set when first published
- `createdBy` / `updatedBy` — Nullable `String` fields for user tracking (will become relations when auth is added)

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
- **Image** — Reusable image model with url, alt, width, height. Used for player headshots, action shots, general player images, and club crests.

## GraphQL

Served at `/api/graphql` via GraphQL Yoga + Pothos schema builder.

- **Endpoint** — `POST /api/graphql` for queries/mutations. `GET /api/graphql` serves GraphiQL playground in development.
- **Schema builder** — `server/graphql/builder.ts` exports the singleton `SchemaBuilder` with PrismaPlugin and PrismaUtilsPlugin.
- **Type definitions** — One file per Prisma model in `server/graphql/types/`. Each file calls `builder.prismaObject(...)` as a side effect. Content metadata fields are shared via `contentMetadataFields()` helper in `server/graphql/types/contentFields.ts`.
- **Enums** — `ScoreTypeEnum` in `server/graphql/types/score.ts`, `ContentStatusEnum` in `server/graphql/types/contentStatus.ts`.
- **Root queries** — All root Query fields in `server/graphql/query/index.ts`. List + single-item lookups for all models except TeamsOnCompetitions (accessible only as nested data via `team.competitions` or `competition.teams`).
- **Where filtering** — `server/graphql/filters.ts` defines Prisma-style where inputs via `@pothos/plugin-prisma-utils`. All root list queries and one-to-many relation fields accept an optional `where` arg (e.g. `clubs(where: { name: { contains: "RFC" } })` or `team.fixtures(where: { isHome: { equals: true } })`). Relations use `t.relation()` with `args` and `query` callback to pass filters to Prisma. Scalar filters use `builder.prismaFilter()`, model where inputs use `builder.prismaWhere()`. To-one relation filters (e.g. filtering fixtures by season) use manual `builder.inputType()` wrappers with `is`/`isNot` fields since `builder.prismaObjectFilter()` is not available in the current Pothos version. `FixtureWhere` includes relation filters for `team`, `opponent`, `competition`, and `season`.
- **Schema assembly** — `server/graphql/schema.ts` imports all type/query files for side effects, then exports `builder.toSchema()`.
- **Generated types** — `generated/pothos-types.ts` is produced by `prisma generate` alongside the Prisma client. Gitignored, never edit manually.
- **DateTime scalar** — Registered in the builder. Serialises as ISO-8601 strings, parses string input to `Date`.

## Key Files

- `nuxt.config.ts` — Nuxt configuration (modules, runtimeConfig, nitro options, CSS)
- `app.vue` — Root component wrapping `<NuxtLayout>` + `<NuxtPage />` in `<UApp>`
- `layouts/default.vue` — Dashboard layout with sidebar navigation (UDashboardGroup + UDashboardSidebar + UDashboardPanel)
- `assets/css/main.css` — Tailwind CSS + Nuxt UI imports
- `server/utils/prisma.ts` — Singleton PrismaClient instance (auto-imported into all server routes)
- `server/api/graphql/graphql.ts` — GraphQL Yoga ↔ H3 bridge (explicitly imports `defineEventHandler` from `h3`)
- `components/ContentTable.vue` — Reusable content listing table (UTable wrapper with standard columns + slot forwarding)
- `composables/useContentTable.ts` — Shared `formatDate` and `statusColor` helpers
- `server/api/content.get.ts` — Aggregated content API route (queries all 7 content models, tags with `contentType`, sorts by `updatedAt` desc, returns top 40)
- `server/api/{model}.get.ts` — Per-model API routes (teams, fixtures, players, clubs, competitions, seasons, images) querying Prisma directly
- `server/graphql/builder.ts` — Pothos SchemaBuilder singleton with PrismaPlugin
- `server/graphql/schema.ts` — Assembles all type registrations and exports the GraphQL schema
- `server/graphql/types/` — Per-model Pothos type definitions
- `server/graphql/types/contentFields.ts` — Shared content metadata field helper
- `server/graphql/types/contentStatus.ts` — ContentStatus GraphQL enum
- `server/graphql/filters.ts` — Prisma-style where filter input types
- `server/graphql/query/index.ts` — Root Query field definitions
- `prisma/seed.ts` — Database seed script (positions, teams, clubs, seasons, competitions, players, fixtures, scores)
- `docker-compose.yml` — Local PostgreSQL 17 container
- `server/api/` — Nitro API route handlers (CMS pages use Prisma directly, not GraphQL)
- `pages/` — Nuxt page components
- `prisma/schema.prisma` — Database schema
- `prisma.config.ts` — Prisma CLI configuration (datasource, paths; dotenv-loaded for CLI use)
- `generated/prisma/client.ts` — Server-side entry (PrismaClient + model types; gitignored, regenerated)
- `generated/pothos-types.ts` — Pothos-Prisma type bridge (gitignored, regenerated)
- `eslint.config.mjs` — ESLint flat config (extends Nuxt-generated config, loads `@typescript-eslint` plugin)
- `lefthook.yml` — Pre-commit hook configuration
- `vitest.config.ts` — Vitest configuration
- `server/api/graphql/graphql.test.ts` — GraphQL API integration tests

## Linting & Formatting

- **ESLint** — Via `@nuxt/eslint` module (registered in `nuxt.config.ts`). Includes Vue, TypeScript, and Nuxt-specific rules. Config in `eslint.config.mjs`. Custom config covers `**/*.ts` files with `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin`. A separate block sets `parserOptions.parser` to `@typescript-eslint/parser` for `**/*.vue` files (the Nuxt-generated config uses `vue-eslint-parser` but doesn't configure a TypeScript sub-parser). Underscore-prefixed variables are allowed as unused (`varsIgnorePattern: '^_'`).
- **Prettier** — Single quotes, trailing commas (es5), semicolons, 2-space indent, 80 char width. Config in `.prettierrc.yml`.
- **eslint-config-prettier** — Disables ESLint rules that conflict with Prettier.
- **Lefthook** — Pre-commit hooks run ESLint and Prettier in parallel on staged files. Config in `lefthook.yml`.

## Testing

- **Vitest** — Test runner, configured via `vitest.config.ts` using `@nuxt/test-utils/config`.
- **@nuxt/test-utils** — Starts a Nuxt dev server for integration tests. Tests must use `setup({ dev: true })` (production mode masks GraphQL errors).
- **Test location** — Colocated with source files (e.g. `server/api/graphql/graphql.test.ts`).
- **GraphQL tests** — 19 integration tests covering list queries, single-item lookups, relation resolution, and where filtering.
