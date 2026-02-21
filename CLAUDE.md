# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

boject-cms is a TypeScript CMS for a rugby club, built with Nuxt 3 (Vue) and Prisma v7 on PostgreSQL.

## Commands

```bash
docker compose up -d          # Start local PostgreSQL (required before dev/migrate)
docker compose down           # Stop local PostgreSQL (data persists in pgdata volume)
pnpm install                  # Install dependencies (runs nuxt prepare + prisma generate via postinstall)
pnpm dev                      # Start Nuxt development server (http://localhost:3000)
pnpm build                    # Build for production (outputs to .output/)
pnpm preview                  # Preview production build locally
pnpm prisma:generate          # Regenerate Prisma client + Pothos types (required after schema changes)
pnpm prisma:migrate           # Run database migrations
pnpm prisma:seed              # Seed database with test data
pnpm lint                     # Lint with ESLint
pnpm lint:fix                 # Lint and auto-fix
pnpm prettier --write .       # Format all files
```

Note: `prisma migrate dev` requires an interactive terminal. When running from a non-interactive context, use `prisma migrate diff` to generate the SQL and `prisma migrate deploy` to apply it.

## Architecture

- **Nuxt 3** — Full-stack Vue framework. Pages in `pages/`, API routes in `server/api/`, server utilities in `server/utils/`. Nitro is the server engine.
- **ESM-only** — `"type": "module"` in package.json. All imports use ESM syntax, no CommonJS.
- **Prisma v7 with driver adapters** — Uses `@prisma/adapter-pg` (PrismaPg) instead of the traditional Rust engine binary. The adapter is mandatory.
- **Prisma singleton** — `server/utils/prisma.ts` exports a singleton `prisma` instance using the `globalThis` guard pattern to prevent connection pool exhaustion during Nuxt HMR. It is auto-imported into all server routes — no import needed.
- **Generated client** — Output to `generated/prisma/` (not the default `node_modules` location). This directory is gitignored and must be regenerated after every schema change via `pnpm prisma:generate`.
- **Local PostgreSQL** — `docker-compose.yml` runs Postgres 17 on port 5432 (user: `boject`, password: `boject`, db: `boject`). Data persists in a Docker volume (`pgdata`). `DATABASE_URL` in `.env` should be `postgresql://boject:boject@localhost:5432/boject`.
- **Environment variables** — `.env` is loaded automatically by Nuxt in development. `prisma.config.ts` retains its own `import 'dotenv/config'` for CLI-only use (migrations, generation). `DATABASE_URL` is accessed via `process.env` in server code.
- **Prisma MCP server** — Local MCP server configured for Claude Code, providing direct access to migrate-status, migrate-dev, migrate-reset, and Prisma Studio.

## Database Schema

Defined in `prisma/schema.prisma`. All models use UUID primary keys, `createdAt`/`updatedAt` timestamps, and `@unique` constraints on name fields where duplicates don't make sense.

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
- **Schema builder** — `server/graphql/builder.ts` exports the singleton `SchemaBuilder` with PrismaPlugin.
- **Type definitions** — One file per Prisma model in `server/graphql/types/`. Each file calls `builder.prismaObject(...)` as a side effect.
- **Root queries** — All root Query fields in `server/graphql/query/index.ts`. List + single-item lookups for all models except TeamsOnCompetitions (accessible only as nested data via `team.competitions` or `competition.teams`).
- **Where filtering** — `server/graphql/filters.ts` defines Prisma-style where inputs via `@pothos/plugin-prisma-utils`. All list queries accept an optional `where` arg (e.g. `clubs(where: { name: { contains: "RFC" } })`).
- **Schema assembly** — `server/graphql/schema.ts` imports all type/query files for side effects, then exports `builder.toSchema()`.
- **Generated types** — `generated/pothos-types.ts` is produced by `prisma generate` alongside the Prisma client. Gitignored, never edit manually.
- **DateTime scalar** — Registered in the builder. Serialises as ISO-8601 strings, parses string input to `Date`.

## Key Files

- `nuxt.config.ts` — Nuxt configuration (runtimeConfig, nitro options)
- `server/utils/prisma.ts` — Singleton PrismaClient instance (auto-imported into all server routes)
- `server/api/graphql.ts` — GraphQL Yoga ↔ H3 bridge
- `server/graphql/builder.ts` — Pothos SchemaBuilder singleton with PrismaPlugin
- `server/graphql/schema.ts` — Assembles all type registrations and exports the GraphQL schema
- `server/graphql/types/` — Per-model Pothos type definitions
- `server/graphql/filters.ts` — Prisma-style where filter input types
- `server/graphql/query/index.ts` — Root Query field definitions
- `prisma/seed.ts` — Database seed script (positions, teams, clubs, seasons, competitions, players, fixtures, scores)
- `docker-compose.yml` — Local PostgreSQL 17 container
- `server/api/` — Nitro API route handlers
- `pages/` — Nuxt page components
- `prisma/schema.prisma` — Database schema
- `prisma.config.ts` — Prisma CLI configuration (datasource, paths; dotenv-loaded for CLI use)
- `generated/prisma/client.ts` — Server-side entry (PrismaClient + model types; gitignored, regenerated)
- `generated/pothos-types.ts` — Pothos-Prisma type bridge (gitignored, regenerated)

## Code Style

Prettier configured: single quotes, trailing commas (es5), semicolons, 2-space indent, 80 char width.
