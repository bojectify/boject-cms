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
cp apps/cms/.env.example apps/cms/.env

# Run database migrations
pnpm prisma:migrate

# Seed the database with admin user + test API key
pnpm prisma:seed

# Optionally apply the base starter bundle (8 content types + a SiteSettings entry)
pnpm content:import ./starters/base.boject.json

# Start the dev server
pnpm dev
```

All commands run from the repo root — the workspace forwards them to `apps/cms/` via `pnpm --filter cms`. You shouldn't need to `cd` into `apps/cms/` during normal development.

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
| `pnpm test`             | Run all tests once (workspace-wide)           |
| `pnpm test:integration` | Run CMS integration tests only                |
| `pnpm test:unit`        | Run unit tests across all packages            |
| `pnpm test:storybook`   | Run Storybook interaction tests (browser)     |
| `pnpm typecheck`        | Run TypeScript type checker                   |
| `pnpm apikey:create`    | Create a new API key                          |
| `pnpm apikey:list`      | List all API keys                             |
| `pnpm apikey:revoke`    | Revoke an API key by prefix                   |
| `pnpm content:export`   | Export dynamic content types/entries as JSON  |
| `pnpm content:import`   | Import a content bundle                       |
| `pnpm content:validate` | Validate a bundle's shape without touching DB |
| `pnpm starters:build`   | Build overlay-based starter bundles           |
| `pnpm starters:check`   | Verify committed starter outputs are current  |

For end-user CLI commands run from inside a scaffolded project (schema pull / apply / check / drift detection, image upgrades), see [`@boject/cli`](packages/boject-cli/README.md).

## Project Structure

```
apps/
  cms/                         # The Nuxt app (everything Nuxt-specific lives here)
    prisma/                    # Prisma schema + migrations + seed
      schema/                  # Multi-file Prisma schema
        base.prisma, auth.prisma, contentType.prisma, contentEntry.prisma
      seed.ts
      migrations/
    server/                    # API routes, middleware, utils, graphql
      api/                     # REST endpoints
      middleware/              # auth + csrf
      graphql/                 # GraphQL Yoga + Pothos schema
      utils/                   # prisma singleton, validation, image processing, etc.
    components/                # Vue components (ContentEditor, EntrySidebar, etc.)
    composables/               # useContentEntryEditor, useAuthedFetch, etc.
    layouts/                   # default (dashboard) + auth
    middleware/                # client route middleware (auth + entry redirect)
    pages/                     # login, index, content-types/**, entries/[...stack]
    types/                     # FieldConfig + BasicComponentProps
    utils/                     # mapFieldToConfig, paneStack, parseUniqueConflict, etc.
    scripts/                   # CLI tools: content-bundle, build-starters, manage-api-keys
    assets/css/main.css        # Tailwind + Nuxt UI
    app.vue                    # Root Vue component
    auth.d.ts                  # nuxt-auth-utils session type augmentation
    nuxt.config.ts             # Nuxt config (modules, runtimeConfig, nitro, aliases)
    prisma.config.ts           # Prisma CLI config (schema dir, migrations path)
    tsconfig.json              # extends auto-generated .nuxt/tsconfig.json
    vitest.config.ts           # Two projects: integration + unit
    vitest.globalSetup.ts      # Resets + seeds boject_test before integration tests
    eslint.config.mjs          # Nuxt-derived flat config
    package.json               # Nuxt app deps + scripts (name: "cms")
packages/                      # Empty; reserved for create-boject-cms + boject-cli
starters/                      # Shared starter bundles (data, consumed by apps + future packages)
  base.boject.json, sport.boject.json, rugby.boject.json
  README.md
  src/                         # Overlay sources authored directly (sport/rugby derive via build)
docs/                          # Specs + plans
docker-compose.yml             # Local Postgres 17 for dev
lefthook.yml                   # Pre-commit + pre-push hooks
pnpm-workspace.yaml            # Declares apps/* and packages/*
package.json                   # Slim workspace root (forwards scripts to cms via pnpm --filter)
```

## Architecture

```
External clients → GraphQL Yoga → dynamic schema → Prisma → PostgreSQL
CMS pages → Nuxt server routes → Prisma → PostgreSQL
```

- **Nuxt 4** serves pages and API routes. Nitro is the server engine. A default layout (`apps/cms/layouts/default.vue`) provides a dashboard shell with sidebar navigation and a header navbar (user avatar/dropdown menu) using Nuxt UI's dashboard components.
- **GraphQL Yoga** handles external client requests at `POST /api/graphql`. The schema is built dynamically at startup from `ContentType` rows via `apps/cms/server/graphql/buildSchema.ts`, then cached; `invalidateSchema()` is called after every ContentType mutation so the next request rebuilds.
- **CMS pages** use dedicated Nuxt server API routes that query Prisma directly.
- **Prisma v7** uses the `@prisma/adapter-pg` driver adapter (not the traditional Rust engine). A singleton client in `apps/cms/server/utils/prisma.ts` is auto-imported into all server routes.
- **Generated types** live in `apps/cms/generated/` (gitignored). Run `pnpm prisma:generate` after any schema change.
- **Primitive file pipeline** — `POST /api/files/upload` accepts multipart uploads (5MB limit, JPEG/PNG/WebP/GIF/AVIF), processes originals via Sharp (auto-orient, max 4000px), writes them to `useStorage('images:originals')`, and returns `{ storageKey, mimeType, width, height, fileSize, originalName }` without creating a DB row. `GET /api/files/:storageKey/transform` serves variants with on-the-fly resize/format conversion (publicly accessible, cached, rate limited). Used by the `IMAGE` field type on dynamic content types. Production storage can be swapped to S3/R2 via Nitro storage config.
- **Content bundle CLI** — `apps/cms/scripts/content-bundle/` exports and imports dynamic content types and entries as JSON bundles. Portable mode (`--portable`) rewrites UUID references to `identifier`/`slug` keys for cross-instance migration; import does the reverse lookup in a transactional two-pass resolve. Functions are importable so a future scaffolder (e.g. `create-boject-cms`) can invoke them directly.
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
- **JSON** — Pass-through scalar (used for the `json` field of the `RichText` object type and for any other JSON-typed fields).

### RICHTEXT fields

RICHTEXT fields resolve to a shared `RichText` object type, not a raw JSON scalar:

```graphql
type RichText {
  json: JSON!
  references: [ContentEntry!]!
}
```

`references` is the deduplicated set of `ContentEntry` instances the body links to via `cmsEmbed` nodes (inline embeds) and `cmsLink` marks (entry-targeted hyperlinks). Because every dynamic content type implements the shared `ContentEntry` interface, you spread per-type fragments and traverse relations directly:

```graphql
{
  articleBySlug(slug: "hello-world") {
    body {
      json
      references {
        __typename
        id
        ... on Page {
          slug
        }
        ... on Fixture {
          slug
          team {
            slug
          }
        }
      }
    }
  }
}
```

A single batched query returns the body plus everything it references — no N+1.

### Authentication

In production, all `/api/graphql` requests require an `Authorization: Bearer boject_...` header with a valid API key carrying the `content:read` scope. In development, requests with no Authorization header pass through (so GraphiQL can introspect freely); a request that presents a Bearer header always validates.

Key creation, listing, revocation, and the full scope catalogue are documented in [API key management](#api-key-management) below.

### Query complexity

The CMS rejects runaway GraphQL queries before they reach resolvers. Each query gets a per-field weighted score; if the total exceeds `BOJECT_GRAPHQL_COMPLEXITY_MAX_COST` (default `1000`), the response includes a GraphQL error with `extensions.code: "QUERY_TOO_COMPLEX"`.

**Recalibrating for your hardware.** Run `boject perf scenario graphql-flat --database-url <perf_db>` and inspect the "GraphQL complexity cap" section in the rendered `summary.md`. Pass `--current-max-cost <n>` to compare the suggestion against your existing cap:

- **Green-light:** your hardware sustained the current cap — you could raise it for more headroom.
- **Warning:** your hardware did not sustain the current cap — scale up before lowering, because lowering is a breaking change to clients.

**Log-only safe rollout.** Before changing the cap, set `BOJECT_GRAPHQL_COMPLEXITY_LOG_ONLY=true` and restart the CMS. Over-cap queries are still served but get logged with their score and the active cap, so you can identify which clients would break before any of them do. Switch back to enforcement once you've fixed the clients or accepted the risk.

## API key management

The CMS supports API keys with scoped access for external consumers (GraphQL clients, schema-management CLIs, etc.).

### Scopes

| Scope          | Grants                      |
| -------------- | --------------------------- |
| `content:read` | Read content via GraphQL.   |
| `schema:read`  | Export the schema bundle.   |
| `schema:write` | Apply schema changes.       |
| `apikey:read`  | List API keys.              |
| `apikey:write` | Create and revoke API keys. |

### Bootstrap (first key)

Until the admin UI lands (tracked in #166), mint your first API key by exec'ing into the CMS container:

```bash
docker compose exec cms tsx scripts/manage-api-keys/index.ts create "first-key" --scopes apikey:write
```

The raw key is printed once — save it. Set it as `BOJECT_API_KEY` on the machine you'll run the CLI from.

### Day-to-day (`@boject/cli`)

Once you have a key with `apikey:write`, use the CLI:

```bash
boject apikey create --name "CI runner" --scopes content:read
boject apikey list
boject apikey list --json | jq '.items[] | select(.revokedAt == null)'
boject apikey revoke boject_a1b2
```

The CLI reads `.boject.config.json` for the CMS URL and `BOJECT_API_KEY` from env (same as `boject schema *`).

### The (i) constraint

Minting a key with the `apikey:write` scope requires session authentication — i.e. the CMS UI or the bootstrap script above. API-key callers cannot self-replicate the most privileged scope. This caps the blast radius if a CLI key ever leaks.

### Recovery / break-glass

If you lose access to all `apikey:write` keys (every admin user is locked out, sessions invalidated, no CLI key on hand), use the bootstrap script to mint a fresh one:

```bash
docker compose exec cms tsx scripts/manage-api-keys/index.ts create "recovery" --scopes apikey:write
```

Keep this option in your runbook even after the admin UI lands.

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

## Schema-as-Code

Content type schema can be authored as a committed JSON bundle (`content-types/schema.boject.json`) and applied by the container on every boot. The intended loop:

1. **Edit** content types in the CMS UI in development.
2. **Pull** the live schema into the project: `boject schema pull` (from [`@boject/cli`](packages/boject-cli/README.md)).
3. **Review** with `git diff content-types/schema.boject.json` and commit.
4. **Deploy.** The container's entrypoint runs the applier on boot — no manual step.

CI catches drift between the committed file and the dev CMS:

```bash
boject schema check    # exits 0 if in sync, 1 with a drift report otherwise
```

Two HTTP endpoints back the CLI:

- `GET /api/schema/export` — returns the current schema as a portable bundle. Session OR API key with `schema:read`.
- `POST /api/schema/apply` — wraps the applier; honours `BOJECT_SCHEMA_READONLY`. Session OR API key with `schema:write`. Body: `{ bundle, allowDestructive?, dryRun? }`.

Destructive changes (removing types or fields) are blocked by default. Set `BOJECT_ALLOW_DESTRUCTIVE_SCHEMA=true` to allow them.

The applier is also available as a script: `pnpm content:import path/to/schema.boject.json --schema --apply`.

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

**Requirement:** Docker PostgreSQL must be running (integration tests auto-reset and seed the `boject_test` database via `apps/cms/vitest.globalSetup.ts`).

## Performance

Load-test harness, committed reports, and operator recommendations live under [`perf/`](perf/README.md). Latest operator-facing summary is mirrored into [`docs/performance/`](docs/performance/).

```bash
pnpm perf:dev      # CMS dev server pointed at boject_perf
pnpm perf:sweep    # full sweep (~25 min) → perf/reports/<date>-<sha>/
```

## Linting & Formatting

- **ESLint** — Via `@nuxt/eslint` module. Config in `apps/cms/eslint.config.mjs`.
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

| Variable                             | Description                                                                                  | Default                                            |
| ------------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `DATABASE_URL`                       | PostgreSQL connection string                                                                 | `postgresql://boject:boject@localhost:5432/boject` |
| `NUXT_SESSION_PASSWORD`              | Session encryption key (required in prod)                                                    | Auto-generated in dev                              |
| `BOJECT_SCHEMA_DIR`                  | Directory of `*.boject.json` files applied on every container boot.                          | unset (skips the step)                             |
| `BOJECT_SCHEMA_READONLY`             | Set to `true` to disable schema-editing endpoints + UI affordances.                          | unset                                              |
| `BOJECT_ALLOW_DESTRUCTIVE_SCHEMA`    | Set to `true` to let the entrypoint applier remove content types / fields on bundle changes. | unset                                              |
| `BOJECT_API_KEY`                     | Used by [`@boject/cli`](packages/boject-cli/README.md). Not consumed by the running CMS.     | unset                                              |
| `BOJECT_GRAPHQL_COMPLEXITY_MAX_COST` | Per-query complexity cap on `/api/graphql`. See [Query complexity](#query-complexity).       | `1000`                                             |
| `BOJECT_GRAPHQL_COMPLEXITY_LOG_ONLY` | Set to `true` to log over-cap queries without rejecting (safe rollout).                      | unset                                              |
| `GRAPHQL_RATE_LIMIT_RPS`             | Per-API-key sliding-window rate cap on `/api/graphql`.                                       | `1000`                                             |

Create a `.env` file in the project root. Nuxt loads it automatically in development.

## Docker image

The CMS ships as a self-contained Docker image that runs migrations, seeds an admin, and optionally imports a starter bundle on first boot.

**Build** (from the repo root — the Docker context is the whole monorepo so pnpm can resolve the workspace):

```bash
docker build -f apps/cms/Dockerfile -t boject/cms:dev .
```

**Run** (requires a reachable Postgres):

```bash
ADMIN_PW=$(openssl rand -base64 16)
echo "Admin password (save this — there is no in-app rotation yet): $ADMIN_PW"
docker run --rm -p 4000:3000 \
  -e DATABASE_URL=postgresql://boject:boject@host.docker.internal:5432/boject \
  -e NUXT_SESSION_PASSWORD="$(openssl rand -base64 32)" \
  -e BOJECT_ADMIN_EMAIL=admin@local \
  -e BOJECT_ADMIN_PASSWORD="$ADMIN_PW" \
  -v boject_storage:/app/storage \
  boject/cms:dev
```

The server starts on port 3000 inside the container (mapped to 4000 above). Log in at `http://localhost:4000/login` with the credentials you set.

`BOJECT_ADMIN_PASSWORD` is validated at first-boot: must be ≥12 characters, not on a weak-password blocklist (`password`, `admin`, `changeme`, …), and not match the email local-part. Weak values cause the container to exit non-zero. The seeded password is the credential indefinitely — there is no in-app password change yet (tracked in [#130](https://github.com/bojectify/boject-cms/issues/130)).

**Import a starter bundle on first boot:**

```bash
docker run ... \
  -e BOJECT_INITIAL_STARTER=/starters/base.boject.json \
  -v "$(pwd)/starters:/starters:ro" \
  boject/cms:dev
```

**Smoke test the image** end-to-end against an ephemeral postgres:

```bash
apps/cms/docker/smoke-test.sh
```

## Local dev registries (maintainers)

Maintainers who are iterating on the onboarding CLI flow (`create-boject-cms`, `boject-cli`) publish to local Docker and npm registries instead of the public ones. Two sidecar services live in `docker-compose.dev.yml`:

| Service   | Host port | Purpose                                 |
| --------- | --------- | --------------------------------------- |
| registry  | 5555      | Local Docker registry for the CMS image |
| verdaccio | 4873      | Local npm registry for the CLI packages |

The registry uses host port `5555` instead of the conventional `5000` because macOS Monterey+ binds port 5000 to AirPlay Receiver by default.

### One-time setup

Add `localhost:5555` to Docker's insecure-registries list (the local registry speaks plain HTTP). Open Docker Desktop → Settings → Docker Engine and merge this key into the JSON:

```json
{
  "insecure-registries": ["localhost:5555"]
}
```

Click **Apply & Restart**. This is a one-time step per machine.

### Commands

```bash
pnpm dev:registries:up             # Start both registries in the background
pnpm dev:registries:down           # Stop them (volumes persist)
pnpm dev:publish:image             # Build apps/cms and push to localhost:5555/boject/cms:0.0.1-rc.1
pnpm dev:publish:image:as <ver>    # Build + push the image with an arbitrary tag (for upgrade testing)
pnpm dev:publish                   # Push the image AND publish create-boject-cms + @boject/cli to verdaccio, all at 0.0.1-rc.1
pnpm dev:scaffold <dir>            # Scaffold a project using the verdaccio-published scaffolder and local image
pnpm dev:verify <dir> [--upgrade]  # Boot, assert health + admin login, optionally exercise boject upgrade, tear down
```

A typical end-to-end loop:

```bash
pnpm dev:registries:up
pnpm dev:publish
pnpm dev:scaffold /tmp/try
pnpm dev:verify /tmp/try --upgrade
```

`dev:scaffold` accepts an optional `--starter <base|sport|rugby|none>` flag (default `base`). `dev:verify --upgrade` additionally builds + pushes `localhost:5555/boject/cms:0.0.1-rc.2`, runs `boject upgrade` inside the scaffolded project, asserts the compose file was rewritten, and re-polls health.

All dev artifacts share one version: the CMS image, `create-boject-cms`, and `@boject/cli` are all published at `0.0.1-rc.1`. Plan D will introduce coordinated version bumps.

Data persists across `up`/`down` cycles via named Docker volumes. To start completely clean:

```bash
docker compose -f docker-compose.dev.yml down -v
```

### Verifying the registries are up

```bash
curl http://localhost:5555/v2/        # → {}
curl http://localhost:4873/-/ping     # → {}
```

Both registries answer with an empty JSON object on success — that's the ping protocol in both cases.
