# boject-cms

A TypeScript CMS for a rugby club, built with Nuxt 4 and Prisma v7 on PostgreSQL. Includes hardcoded domain models for rugby content and a dynamic content type system for user-defined types with custom fields.

## Tech Stack

- **Nuxt 4** — Full-stack Vue framework with Nitro server engine
- **Nuxt UI** — Component library (Tailwind CSS v4 + Reka UI primitives)
- **Prisma v7** — ORM with `@prisma/adapter-pg` driver adapter
- **PostgreSQL 17** — Database (local via Docker)
- **GraphQL Yoga** — GraphQL server at `/api/graphql`
- **Pothos** — Code-first GraphQL schema builder with Prisma plugin
- **Tiptap** — Rich text editor (`@tiptap/vue-3`) with custom CmsEmbed extension
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

# Create a .env file
echo 'DATABASE_URL=postgresql://boject:boject@localhost:5432/boject' > .env

# Run database migrations
pnpm prisma:migrate

# Seed the database with test data
pnpm prisma:seed

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
| `pnpm prisma:seed`      | Seed database with test data                  |
| `pnpm lint`             | Lint with ESLint                              |
| `pnpm lint:fix`         | Lint and auto-fix                             |
| `pnpm format`           | Check formatting with Prettier                |
| `pnpm format:fix`       | Format all files                              |
| `pnpm test`             | Run tests once                                |
| `pnpm typecheck`        | Run TypeScript type checker                   |
| `pnpm apikey:create`    | Create a new API key                          |
| `pnpm apikey:list`      | List all API keys                             |
| `pnpm apikey:revoke`    | Revoke an API key by prefix                   |
| `pnpm content:export`   | Export dynamic content types/entries as JSON  |
| `pnpm content:import`   | Import a dynamic content bundle               |
| `pnpm content:validate` | Validate a bundle's shape without touching DB |

## Project Structure

```
prisma/
  schema/                      # Multi-file Prisma schema
    base.prisma                # Generators, datasource, enums
    team.prisma                # Team, TeamsOnCompetitions
    club.prisma                # Club
    competition.prisma         # Competition
    season.prisma              # Season
    fixture.prisma             # Fixture, Score
    player.prisma              # Player, Position, PlayerTeamHistory
    image.prisma               # Image
    auth.prisma                # User, ApiKey
    author.prisma              # Author, AuthorSocialLink
    tag.prisma                 # Tag
    article.prisma             # Article
    link.prisma                # Link
    navigation.prisma          # Navigation
    navigationItem.prisma      # NavigationItem
    contentType.prisma         # ContentType, ContentTypeField, FieldType enum
    contentEntry.prisma        # ContentEntry
  seed.ts                      # Seed script
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
    images/                    # Image upload + transform endpoints + tests
    content.get.ts             # Unified content listing (UNION ALL across static + dynamic)
    content-types/             # Dynamic content type CRUD + field management
    content-entries/           # Dynamic content entry CRUD
    {model}.get.ts             # Per-model listing routes (Prisma direct)
    {model}/[id].get.ts        # Per-model single-item routes
    {model}/[id].put.ts        # Per-model update routes
  graphql/
    builder.ts                 # Pothos SchemaBuilder singleton (JSON + DateTime scalars)
    schema.ts                  # Schema assembly
    filters.ts                 # Prisma-style where filter inputs
    query/index.ts             # Root Query field definitions
    types/                     # Per-model Pothos type definitions
  utils/
    prisma.ts                  # Singleton PrismaClient (auto-imported)
    imageProcessing.ts         # Sharp-based image processing (upload + transform)
    rateLimit.ts               # In-memory sliding window rate limiter
  middleware/
    auth.ts                    # Global server auth middleware
components/
  ContentTable.vue             # Reusable content listing table
  ContentEditor.vue            # Generic content editing form
  RichTextEditor.vue           # Tiptap rich text editor with toolbar
  CmsEmbedNode.vue             # Vue NodeView for CmsEmbed nodes
  CmsEmbedModal.vue            # Modal for selecting content to embed
composables/
  useContentTable.ts           # Shared formatDate + statusColor helpers
  useContentEditor.ts          # Content editing lifecycle management
  useContentEntryEditor.ts     # Dynamic entry editing lifecycle
extensions/
  cmsEmbed.ts                  # Custom Tiptap ProseMirror node for content embeds
scripts/
  content-bundle/              # CLI to export/import dynamic content bundles
    types.ts                   # Shared Bundle, BundleField, BundleEntry types
    validate.ts                # Bundle shape validation (no DB)
    portable.ts                # Portable reference rewriting helpers
    export.ts                  # exportBundle(prisma, { mode, portable })
    import.ts                  # importBundle(prisma, bundle, { mode, author })
    index.ts                   # CLI entry (export/import/validate subcommands)
    fixtures/                  # Known-good bundles for tests and starters
  manage-api-keys.ts           # CLI for API key create/list/revoke
types/
  contentEditor.ts             # FieldConfig discriminated union (auto-imported)
pages/
  login.vue                    # Login page
  index.vue                    # All content (paginated, sorted by updatedAt)
  {model}/index.vue            # Per-model listing pages
  {model}/[id].vue             # Per-model edit pages
  content-types/               # Dynamic content type management + entry editing
storage/                     # Gitignored, local image file storage (dev)
generated/                   # Gitignored, auto-generated
  prisma/                    # Prisma client
  pothos-types.ts            # Pothos-Prisma type bridge
```

## Architecture

```
External clients → GraphQL Yoga → Pothos → Prisma → PostgreSQL
CMS pages → Nuxt server routes → Prisma → PostgreSQL
```

- **Nuxt 4** serves pages and API routes. Nitro is the server engine. A default layout (`layouts/default.vue`) provides a dashboard shell with sidebar navigation and a header navbar (user avatar/dropdown menu) across all CMS pages using Nuxt UI's dashboard components.
- **GraphQL Yoga** handles external client requests at `POST /api/graphql`.
- **CMS pages** use dedicated Nuxt server API routes that query Prisma directly (not via GraphQL).
- **Pothos** builds the GraphQL schema from Prisma model definitions, with auto-generated types.
- **Prisma v7** uses the `@prisma/adapter-pg` driver adapter (not the traditional Rust engine). A singleton client in `server/utils/prisma.ts` is auto-imported into all server routes.
- **Generated types** live in `generated/` (gitignored). Run `pnpm prisma:generate` after any schema change.
- **Image upload & transform** — `POST /api/images/upload` accepts multipart file uploads (5MB limit, JPEG/PNG/WebP/GIF/AVIF). Originals are processed via Sharp (auto-orient, max 4000px). `GET /api/images/:id/transform` serves images with on-the-fly resize/format conversion (publicly accessible, cached, rate limited). Stored in `storage/` (gitignored, filesystem in dev, swappable to S3/R2 in production via Nitro storage config).
- **Content bundle CLI** — `scripts/content-bundle/` exports and imports dynamic content types and entries as JSON bundles. Portable mode (`--portable`) rewrites UUID references to `identifier`/`slug` keys for cross-instance migration; import does the reverse lookup in a transactional two-pass resolve. Functions are importable so a future scaffolder (e.g. `create-boject-cms`) can invoke them directly.

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
| `authors` / `author(id)`           | `first`, `after`, `last`, `before`, `where` | AuthorConnection / Author           |
| `tags` / `tag(id)`                 | `first`, `after`, `last`, `before`, `where` | TagConnection / Tag                 |
| `articles` / `article(id)`         | `first`, `after`, `last`, `before`, `where` | ArticleConnection / Article         |

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
- **JSON** — Pass-through scalar for Article body (Tiptap ProseMirror JSON).

## Database

PostgreSQL 17 runs locally via Docker Compose (port 5432, user/password/db: `boject`).

### Domain Models

| Model                 | Description                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Team**              | Internal club squads (e.g. 1st XV, Veterans, Colts)                                                          |
| **Club**              | External opponent clubs with optional crest image                                                            |
| **Competition**       | Leagues and cups, linked to a season and teams                                                               |
| **Season**            | Has name, start/end dates. Competitions and fixtures belong to a season                                      |
| **Fixture**           | A match with team, opponent, competition, season, home/away, kickoff, venue                                  |
| **Score**             | Scoring events (TRY, CONVERSION, PENALTY, DROP_GOAL) with optional player and minute                         |
| **Player**            | Has name, position, bio, headshot, action shot, team history                                                 |
| **PlayerTeamHistory** | Tracks which team a player belongs to over time                                                              |
| **Position**          | Rugby positions (e.g. Fly-half, Hooker)                                                                      |
| **Image**             | Reusable image with url, alt, dimensions, optional file storage (upload + transform)                         |
| **Author**            | Article authors with name, slug, bio, headshot image, and social links                                       |
| **AuthorSocialLink**  | Social media links for authors (platform + URL)                                                              |
| **Tag**               | Content tags with name and slug. Many-to-many with articles                                                  |
| **Article**           | Blog/news articles with title, slug, summary, rich text body (Tiptap JSON), author, featured image, and tags |
| **Link**              | Reusable content link with label, optional URL or article reference, and openInNewTab                        |
| **Navigation**        | Container for a navigation tree with ordered, two-level nested items pointing to Links                       |
| **ContentType**       | User-defined content type with name, PascalCase identifier, and field definitions                            |
| **ContentEntry**      | Instance of a dynamic content type, with JSONB data validated against field definitions                      |

All models use UUID primary keys and `createdAt`/`updatedAt` timestamps. Static content models (Team, Club, Competition, Season, Player, Fixture, Image, Author, Tag, Article, Link, Navigation) have `entryTitle` (CMS display name), `status` (`DRAFT`/`PUBLISHED`/`CHANGED`/`ARCHIVED`), `publishedAt`, `createdBy`, and `updatedBy` metadata fields. Dynamic content entries have the same status/publishedAt fields but derive their entry title from the ENTRY_TITLE field in their content type definition.

### Migrations

```bash
pnpm prisma:migrate           # Apply migrations (interactive)
prisma migrate deploy          # Apply migrations (non-interactive / CI)
```

## Testing

Integration tests using Vitest + `@nuxt/test-utils`. Tests start a Nuxt dev server and run against the seeded database.

```bash
pnpm test                    # Single run
pnpm test:integration        # Integration tests only
```

- **GraphQL** (30 tests) — list queries, single-item lookups, relation resolution, where filtering, Relay cursor pagination, API key authentication, author/tag/article queries.
- **Fixtures REST API** (16 tests) — default listing, pagination, relation filters (teamId, opponentId, competitionId, seasonId), boolean/enum filters (isHome, status), combined filters.
- **List endpoints** (29 tests) — query param filters on teams, clubs, seasons, images (status), players (positionId, status), competitions (seasonId, status).
- **Content** (14 tests) — contentType filter (including Author, Tag, Article), status filter, combined filters, invalid value handling.
- **Auth** (7 tests) — login validation, credential checking, session handling, middleware behaviour.
- **Image upload & transform** (12 tests) — upload validation (missing file, wrong mime type, file too large), successful upload, transform validation (invalid params), format conversion, public access, rate limiting.
- **Authors** (11 tests) — listing, pagination, status filter, single-item lookup, update, slug uniqueness, 404 handling.
- **Tags** (9 tests) — listing, pagination, status filter, single-item lookup, update, slug uniqueness, 404 handling.
- **Articles** (13 tests) — listing with relations, pagination, filters (status, authorId, tagId), single-item lookup, update with tags, slug uniqueness, 404 handling.
- **Content types** (24 tests) — CRUD, field management (add/update/delete/reorder), identifier validation, uniqueness constraints.
- **Content entries** (16 tests) — CRUD, data validation against field definitions, slug uniqueness, status transitions, `entryTitle` populate + uniqueness.
- **Content bundle** (22 tests) — bundle shape validation (6), portable reference walkers (7), export (4), import (4), fixture shape regression (3), export → import round-trip (1), plus two end-to-end subsets.

Total: 369 tests across 29 files.

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

| Variable                | Description                               | Default                                            |
| ----------------------- | ----------------------------------------- | -------------------------------------------------- |
| `DATABASE_URL`          | PostgreSQL connection string              | `postgresql://boject:boject@localhost:5432/boject` |
| `NUXT_SESSION_PASSWORD` | Session encryption key (required in prod) | Auto-generated in dev                              |

Create a `.env` file in the project root. Nuxt loads it automatically in development.
