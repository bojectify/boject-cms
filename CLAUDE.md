# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

boject-cms is a TypeScript CMS backend for a rugby club, built on Prisma v7 with PostgreSQL. Early-stage project — no application framework, build pipeline, or test framework configured yet.

## Commands

```bash
pnpm install                  # Install dependencies
pnpm prisma:generate          # Generate Prisma client (required after schema changes)
pnpm prisma:migrate           # Run database migrations
pnpm prisma:start:local       # Start local Prisma dev server
pnpm prisma:start:remote      # Start remote Prisma dev server
pnpm prettier --write .       # Format all files
```

Note: `prisma migrate dev` requires an interactive terminal. When running from a non-interactive context, use `prisma migrate diff` to generate the SQL and `prisma migrate deploy` to apply it.

## Architecture

- **ESM-only** — `"type": "module"` in package.json. All imports use ESM syntax, no CommonJS.
- **Prisma v7 with driver adapters** — Uses `@prisma/adapter-pg` (PrismaPg) instead of the traditional Rust engine binary. The adapter is mandatory; `PrismaClient` is instantiated with `{ adapter }` in `lib/prisma.ts`.
- **Generated client** — Output to `generated/prisma/` (not the default `node_modules` location). This directory is gitignored and must be regenerated after every schema change via `pnpm prisma:generate`.
- **Config** — `prisma.config.ts` configures datasource, schema path, and migrations path. Database URL comes from `DATABASE_URL` env var loaded via `dotenv`.
- **Prisma MCP server** — Local MCP server configured for Claude Code, providing direct access to migrate-status, migrate-dev, migrate-reset, and Prisma Studio.

## Database Schema

Defined in `prisma/schema.prisma`. All models use UUID primary keys, `createdAt`/`updatedAt` timestamps, and `@unique` constraints on name fields where duplicates don't make sense.

### Domain Models

- **Team** — Internal club squads (e.g. 1st XV, Veterans, Juniors). Linked to competitions and fixtures.
- **Club** — External opponent clubs with a name and optional crest (one-to-one Image relation).
- **Competition** — Leagues/cups, linked to a Season and to Teams via a many-to-many join table (`TeamsOnCompetitions`).
- **Season** — Has name, startDate, endDate. Competitions belong to a season.
- **Fixture** — A match. Links to a Team (which squad is playing), an optional Club (opponent), an optional Competition, and has `isHome` boolean. Scores are tracked via the Score model.
- **Score** — Individual scoring events (TRY, CONVERSION, PENALTY, DROP_GOAL enum). Links to a Fixture and optionally to a Player, with an optional `minute` field. Final score is calculated from these records.
- **Player** — Has firstName, lastName, optional bio, optional position. Images via headshot (one-to-one), actionShot (one-to-one), and a general images list. Team membership tracked via PlayerTeamHistory.
- **PlayerTeamHistory** — Join table tracking which Team a Player belongs to over time. `endDate` is nullable (null = currently on that team). A player can have multiple open records.
- **Position** — Rugby positions (e.g. Fly-half, Hooker). Unique name.
- **Image** — Reusable image model with url, alt, width, height. Used for player headshots, action shots, general player images, and club crests.

## Key Files

- `lib/prisma.ts` — Singleton PrismaClient instance (import `prisma` from here)
- `prisma/schema.prisma` — Database schema
- `prisma.config.ts` — Prisma configuration (datasource, paths)
- `generated/prisma/client.ts` — Server-side entry (PrismaClient + model types)
- `generated/prisma/browser.ts` — Browser-safe entry (types only)

## Code Style

Prettier configured: single quotes, trailing commas (es5), semicolons, 2-space indent, 80 char width.
