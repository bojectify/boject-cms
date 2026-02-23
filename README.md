# boject-cms

A TypeScript CMS for a rugby club, built with Nuxt 4 and Prisma v7 on PostgreSQL.

## Tech Stack

- **Nuxt 4** — Full-stack Vue framework with Nitro server engine
- **Nuxt UI** — Component library (Tailwind CSS v4 + Reka UI primitives)
- **Prisma v7** — ORM with `@prisma/adapter-pg` driver adapter
- **PostgreSQL 17** — Database (local via Docker)
- **GraphQL Yoga** — GraphQL server at `/api/graphql`
- **Pothos** — Code-first GraphQL schema builder with Prisma plugin
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

# Create a .env file
echo 'DATABASE_URL=postgresql://boject:boject@localhost:5432/boject' > .env

# Run database migrations
pnpm prisma:migrate

# Seed the database with test data
pnpm prisma:seed

# Start the dev server
pnpm dev
```

The app runs at http://localhost:3000. The GraphQL playground (GraphiQL) is available at http://localhost:3000/api/graphql in development.

## Scripts

| Script                 | Description                                  |
| ---------------------- | -------------------------------------------- |
| `pnpm dev`             | Start Nuxt development server                |
| `pnpm build`           | Build for production (outputs to `.output/`) |
| `pnpm preview`         | Preview production build locally             |
| `pnpm db:up`           | Start local PostgreSQL container             |
| `pnpm prisma:generate` | Regenerate Prisma client + Pothos types      |
| `pnpm prisma:migrate`  | Run database migrations                      |
| `pnpm prisma:seed`     | Seed database with test data                 |
| `pnpm lint`            | Lint with ESLint                             |
| `pnpm lint:fix`        | Lint and auto-fix                            |
| `pnpm format`          | Check formatting with Prettier               |
| `pnpm format:fix`      | Format all files                             |
| `pnpm test`            | Run tests in watch mode                      |
| `pnpm test:run`        | Run tests once (CI)                          |
| `pnpm typecheck`       | Run TypeScript type checker                  |

## Project Structure

```
prisma/
  schema.prisma              # Database schema
  seed.ts                    # Seed script
  migrations/                # Migration files
app.vue                        # Root component (UApp + NuxtLayout wrapper)
layouts/
  default.vue                  # Dashboard layout with sidebar navigation
assets/css/main.css            # Tailwind CSS + Nuxt UI imports
server/
  api/
    graphql/                   # GraphQL Yoga endpoint + tests
    content.get.ts             # Paginated content route (raw SQL UNION ALL, all models)
    {model}.get.ts             # Per-model listing routes (Prisma direct)
  graphql/
    builder.ts                 # Pothos SchemaBuilder singleton
    schema.ts                  # Schema assembly
    filters.ts                 # Prisma-style where filter inputs
    query/index.ts             # Root Query field definitions
    types/                     # Per-model Pothos type definitions
      contentStatus.ts         # ContentStatus enum
      contentFields.ts         # Shared metadata field helper
  utils/
    prisma.ts                  # Singleton PrismaClient (auto-imported)
components/
  ContentTable.vue             # Reusable content listing table
composables/
  useContentTable.ts           # Shared formatDate + statusColor helpers
pages/
  index.vue                    # All content (paginated, sorted by updatedAt)
  teams.vue                    # Teams listing
  fixtures.vue                 # Fixtures listing
  players.vue                  # Players listing
  clubs.vue                    # Clubs listing
  competitions.vue             # Competitions listing
  seasons.vue                  # Seasons listing
  images.vue                   # Images listing
generated/                   # Gitignored, auto-generated
  prisma/                    # Prisma client
  pothos-types.ts            # Pothos-Prisma type bridge
```

## Architecture

```
External clients → GraphQL Yoga → Pothos → Prisma → PostgreSQL
CMS pages → Nuxt server routes → Prisma → PostgreSQL
```

- **Nuxt 4** serves pages and API routes. Nitro is the server engine. A default layout (`layouts/default.vue`) provides a dashboard shell with sidebar navigation across all CMS pages using Nuxt UI's `UDashboardGroup`, `UDashboardSidebar`, and `UDashboardPanel` components.
- **GraphQL Yoga** handles external client requests at `POST /api/graphql`.
- **CMS pages** use dedicated Nuxt server API routes that query Prisma directly (not via GraphQL).
- **Pothos** builds the GraphQL schema from Prisma model definitions, with auto-generated types.
- **Prisma v7** uses the `@prisma/adapter-pg` driver adapter (not the traditional Rust engine). A singleton client in `server/utils/prisma.ts` is auto-imported into all server routes.
- **Generated types** live in `generated/` (gitignored). Run `pnpm prisma:generate` after any schema change.

## GraphQL API

**Endpoint:** `POST /api/graphql`

### Queries

All list queries return [Relay-style cursor connections](https://relay.dev/graphql/connections.htm) with `edges`, `node`, `cursor`, and `pageInfo`. Single-item lookups return the model directly.

| Query                              | Args                                        | Returns                             |
| ---------------------------------- | ------------------------------------------- | ----------------------------------- |
| `teams` / `team(id)`               | `first`, `after`, `last`, `before`, `where` | TeamConnection / Team               |
| `clubs` / `club(id)`               | `first`, `after`, `last`, `before`, `where` | ClubConnection / Club               |
| `players` / `player(id)`           | `first`, `after`, `last`, `before`, `where` | PlayerConnection / Player           |
| `fixtures` / `fixture(id)`         | `first`, `after`, `last`, `before`, `where` | FixtureConnection / Fixture         |
| `scores` / `score(id)`             | `first`, `after`, `last`, `before`, `where` | ScoreConnection / Score             |
| `competitions` / `competition(id)` | `first`, `after`, `last`, `before`, `where` | CompetitionConnection / Competition |
| `seasons` / `season(id)`           | `first`, `after`, `last`, `before`, `where` | SeasonConnection / Season           |
| `positions` / `position(id)`       | `first`, `after`, `last`, `before`, `where` | PositionConnection / Position       |
| `images` / `image(id)`             | `first`, `after`, `last`, `before`, `where` | ImageConnection / Image             |

One-to-many relation fields (e.g. `team.fixtures`, `player.scores`) also use connections with the same pagination and filtering args. One-to-one relations (e.g. `fixture.season`, `player.position`) return the model directly.

### Pagination

```graphql
# First page
{
  teams(first: 10) {
    edges {
      node {
        id
        name
      }
      cursor
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}

# Next page (pass endCursor from previous response)
{
  teams(first: 10, after: "cursor-value") {
    edges {
      node {
        id
        name
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

### Where Filtering

All list queries accept an optional `where` argument with Prisma-style filters, combinable with pagination args:

```graphql
{
  clubs(where: { name: { contains: "RFC" } }) {
    edges {
      node {
        id
        name
      }
    }
  }

  fixtures(first: 10, where: { isHome: { equals: true } }) {
    edges {
      node {
        id
        name
        kickoff
        venue
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

**Available filter operations:**

| Type          | Operations                                            |
| ------------- | ----------------------------------------------------- |
| String        | `contains`, `equals`, `startsWith`, `endsWith`, `not` |
| Int           | `equals`, `gt`, `gte`, `lt`, `lte`, `not`             |
| Boolean       | `equals`, `not`                                       |
| DateTime      | `equals`, `gt`, `gte`, `lt`, `lte`, `not`             |
| ScoreType     | `equals`, `not`                                       |
| ContentStatus | `equals`, `not`                                       |

### Custom Scalars

- **DateTime** — Serialises as ISO-8601 strings, parses string input to `Date`.

## Database

PostgreSQL 17 runs locally via Docker Compose (port 5432, user/password/db: `boject`).

### Domain Models

| Model                 | Description                                                                          |
| --------------------- | ------------------------------------------------------------------------------------ |
| **Team**              | Internal club squads (e.g. 1st XV, Veterans, Colts)                                  |
| **Club**              | External opponent clubs with optional crest image                                    |
| **Competition**       | Leagues and cups, linked to a season and teams                                       |
| **Season**            | Has name, start/end dates. Competitions and fixtures belong to a season              |
| **Fixture**           | A match with team, opponent, competition, season, home/away, kickoff, venue          |
| **Score**             | Scoring events (TRY, CONVERSION, PENALTY, DROP_GOAL) with optional player and minute |
| **Player**            | Has name, position, bio, headshot, action shot, team history                         |
| **PlayerTeamHistory** | Tracks which team a player belongs to over time                                      |
| **Position**          | Rugby positions (e.g. Fly-half, Hooker)                                              |
| **Image**             | Reusable image with url, alt, width, height                                          |

All models use UUID primary keys and `createdAt`/`updatedAt` timestamps. Content models (Team, Club, Competition, Season, Player, Fixture, Image) also have `entryTitle` (CMS display name), `status` (`DRAFT`/`PUBLISHED`/`CHANGED`/`ARCHIVED`), `publishedAt`, `createdBy`, and `updatedBy` metadata fields.

### Migrations

```bash
pnpm prisma:migrate           # Apply migrations (interactive)
prisma migrate deploy          # Apply migrations (non-interactive / CI)
```

## Testing

21 integration tests using Vitest + `@nuxt/test-utils`. Tests start a Nuxt dev server and send real GraphQL queries against the seeded database.

```bash
pnpm test          # Watch mode
pnpm test:run      # Single run (CI)
```

Tests cover list queries, single-item lookups, relation resolution, where filtering, and Relay cursor pagination.

**Requirement:** Docker PostgreSQL must be running with seeded data.

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

| Variable       | Description                  | Default                                            |
| -------------- | ---------------------------- | -------------------------------------------------- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://boject:boject@localhost:5432/boject` |

Create a `.env` file in the project root. Nuxt loads it automatically in development.
