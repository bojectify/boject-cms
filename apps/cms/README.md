# boject-cms (Nuxt app)

The CMS application — a general-purpose TypeScript headless CMS built with Nuxt 4 and Prisma v7 on PostgreSQL. Content is modelled entirely through user-defined ContentTypes — there are no hardcoded domain models.

For workspace-level setup (prerequisites, containerised dev environment, host shims, lefthook), see the [repo root README](../../README.md).

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
- **Starters** — [`starters/base.boject.json`](../../starters/base.boject.json) defines the 8 content types every content-driven site needs (Image, Tag, Author, Article, Page, SiteSettings, Navigation, NavigationItem) plus one SiteSettings seed entry. `sport.boject.json` and `rugby.boject.json` are built from overlay sources in [`starters/src/`](../../starters/src/) via `pnpm starters:build`.

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

| Model                   | Description                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **User**                | CMS admin accounts (email, scrypt-hashed password, firstName, lastName)                                           |
| **ApiKey**              | Hashed API keys for GraphQL + REST (keyPrefix, keyHash, revokedAt, lastUsedAt)                                    |
| **ContentType**         | User-defined content type with unique name, PascalCase identifier, and ordered field definitions                  |
| **ContentTypeField**    | Field definition (name, camelCase identifier, FieldType, required, `unique`, order, options JSON)                 |
| **ContentEntry**        | Envelope for an entry — `contentTypeId`, `slug`, `entryTitle` (synced from the active version), timestamps        |
| **ContentEntryVersion** | Versioned content body — `data` JSONB, `status`, `publishedAt`, `createdBy`, `updatedBy`                          |
| **Webhook**             | Outbound HTTP subscription (`url`, plaintext `secret`, `enabled`, `contentTypeIds`, `events`)                     |
| **WebhookDelivery**     | One queued/delivered attempt-chain (`payload` JSONB, `status`, `attempts`, `nextAttemptAt`, retry/error metadata) |

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
2. **Pull** the live schema into the project: `boject schema pull` (from [`@boject/cli`](../../packages/boject-cli/README.md)).
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

Three Vitest projects: **integration** (server API + middleware, starts a Nuxt dev server, requires seeded database), **unit** (scripts, starters, server utils, no database needed), and **storybook** (component interaction tests in a real browser).

```bash
pnpm test                    # Run all tests once
pnpm test:integration        # Integration tests only
pnpm test:unit               # Unit tests only
pnpm test:storybook          # Storybook interaction tests (browser)
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

**Storybook tests:**

Component stories double as interaction tests, executed in Chromium via `@storybook/addon-vitest` + `@vitest/browser-playwright`. Setup is Storybook 10 with `@storybook/vue3-vite` directly (not `@nuxtjs/storybook` — Nuxt 4 peer incompatibility). Three-layer mocking convention: **MSW** for network, **module aliases / auto-import shim dirs** for Nuxt-injected imports, **decorators** for `provide`/`inject`. See [`apps/cms/.storybook/README.md`](.storybook/README.md) for details.

Run Storybook itself for authoring:

```bash
pnpm storybook   # http://localhost:6006
```

**Requirements:** Docker PostgreSQL must be running for integration tests (auto-reset and seed the `boject_test` database via `apps/cms/vitest.globalSetup.ts`). Storybook tests additionally need the Playwright Chromium binary installed in the dev container — see step 8 of the [containerised dev setup](../../README.md#one-time-setup).

## Performance

Load-test harness, committed reports, and operator recommendations live under [`perf/`](../../perf/README.md). Latest operator-facing summary is mirrored into [`docs/performance/`](../../docs/performance/).

```bash
pnpm perf:dev      # CMS dev server pointed at boject_perf
pnpm perf:sweep    # full sweep (~25 min) → perf/reports/<date>-<sha>/
```

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

## Backup & disaster recovery

A boject-cms deployment has two independent stores. Back them up together and restore them together.

1. **PostgreSQL** — every content type, entry, version, user, API key, webhook, and delivery record, with all timestamps and authorship preserved. The only state that lives outside Postgres is the session cookie, which is encrypted and held client-side — there is nothing server-side to back up.
2. **The asset store** — original uploaded image bytes. Where it lives depends on `STORAGE_DRIVER` (see [Environment Variables](#environment-variables)).

> **Content bundles are not a backup format.** `pnpm content:export` (and `boject entries export`) produce _portable_ bundles for seeding and cross-instance migration — they deliberately drop UUIDs, system timestamps, authorship, users, and API keys. For disaster recovery use `pg_dump`, which captures every table automatically and stays correct as the schema evolves.

### Back up PostgreSQL

Local docker-compose database (service `db`, user/db `boject`):

```bash
docker compose exec -T db pg_dump -U boject -Fc boject > boject-$(date +%F).dump
```

Any reachable Postgres (managed / production), straight from `DATABASE_URL`:

```bash
pg_dump -Fc "$DATABASE_URL" > boject-$(date +%F).dump
```

`-Fc` writes the compressed custom format that `pg_restore` reads. Put this on a schedule (cron, or your managed provider's automated snapshots) and ship the dump off-host.

### Back up the asset store

| `STORAGE_DRIVER`  | What to back up                                                                                        | How                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `local` (default) | The `STORAGE_LOCAL_BASE` directory (container: the volume mounted at `/app/storage`; dev: `./storage`) | Snapshot the Docker volume, or `tar`/`rsync` the directory off-host             |
| `s3` / `r2`       | The configured bucket                                                                                  | Bucket versioning + replication, or `aws s3 sync s3://<bucket> ./assets-backup` |

Only `images/originals/` is source-of-truth. `images/transforms/` is a regenerable cache that `GET /api/files/:storageKey/transform` rebuilds on demand, so it is safe to exclude from backups.

### Restore

1. Provision a fresh, empty Postgres and point `DATABASE_URL` at it.
2. Restore the dump:
   ```bash
   pg_restore --no-owner -d "$DATABASE_URL" boject-2026-01-01.dump
   ```
   A full dump recreates the schema and the Prisma migration history, so the restored database is already at the right migration state — the entrypoint's `prisma migrate deploy` is a no-op on next boot. Always restore into a **virgin** database (or pass `--clean --if-exists`) to avoid colliding with an existing schema.
3. Restore the asset store to the same `STORAGE_DRIVER` location (volume restore, or `aws s3 sync` back into the bucket).
4. Start the CMS. Because the dump preserves every UUID, existing API keys, persisted GraphQL queries, and asset URLs keep resolving unchanged.

Postgres major-version upgrades and host migrations use this same `pg_dump` / `pg_restore` path — it is the canonical tool for both.

## CMS scripts

These scripts are forwarded from the workspace root to `apps/cms/` via `pnpm --filter cms`.

| Script                     | Description                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `pnpm dev`                 | Start Nuxt development server                                                                                      |
| `pnpm build`               | Build for production (outputs to `.output/`)                                                                       |
| `pnpm preview`             | Preview production build locally                                                                                   |
| `pnpm prisma:generate`     | Regenerate Prisma client + Pothos types                                                                            |
| `pnpm prisma:migrate`      | Run database migrations                                                                                            |
| `pnpm dev:bootstrap-admin` | Bootstrap a single admin user in the dev DB (no API keys; requires `BOJECT_ADMIN_EMAIL` + `BOJECT_ADMIN_PASSWORD`) |
| `pnpm prisma:seed:test`    | Seed the `boject_test` DB (admin + integration test API key)                                                       |
| `pnpm prisma:seed:perf`    | Seed the `boject_perf` DB (admin + perf load-test API key)                                                         |
| `pnpm test:integration`    | Run CMS integration tests only                                                                                     |
| `pnpm test:storybook`      | Run Storybook interaction tests (browser)                                                                          |
| `pnpm typecheck`           | Run TypeScript type checker                                                                                        |
| `pnpm apikey:create`       | Create a new API key                                                                                               |
| `pnpm apikey:list`         | List all API keys                                                                                                  |
| `pnpm apikey:revoke`       | Revoke an API key by prefix                                                                                        |
| `pnpm content:export`      | Export dynamic content types/entries as JSON                                                                       |
| `pnpm content:import`      | Import a content bundle                                                                                            |
| `pnpm content:validate`    | Validate a bundle's shape without touching DB                                                                      |
| `pnpm starters:build`      | Build overlay-based starter bundles                                                                                |
| `pnpm starters:check`      | Verify committed starter outputs are current                                                                       |

For workspace-wide scripts (`db:up`, `lint`, `format`, `test`), see the [repo root README](../../README.md#workspace-scripts).

## Search

Full-text search is backed by [Meilisearch](https://www.meilisearch.com/), run as a sidecar container alongside Postgres (`docker compose up -d` starts both). The CMS connects via the `meili` client singleton (`server/utils/meili.ts`); on boot it idempotently creates a single global `entries` index (`server/utils/searchIndex.ts`). The ⌘K command palette and the list-view results are powered by `GET /api/search` (and the `searchEntries` GraphQL field).

### How it works

- **One global index, scoped per query.** Every entry across every content type lives in the same `entries` index; a search scopes to one type with a `contentType` filter rather than a per-type index. The index holds one document per indexable version (DRAFT / CHANGED / PUBLISHED, keyed `${entryId}__${status}`); ARCHIVED versions are never indexed. API-key and GraphQL reads are forced to PUBLISHED.
- **Sync transport — internal webhooks.** The index is kept in step with Postgres over the existing `WebhookDelivery` queue: a system-managed **internal** webhook ("Search index sync", `kind = INTERNAL`, seeded once at boot) subscribes to the entry-lifecycle and `CONTENT_TYPE_SCHEMA_CHANGED` events. The webhook worker's internal branch calls `syncToSearchIndex(...)` in-process — no HTTP, no SSRF surface — reusing the same retry / dead-letter machinery as external webhooks. Publish, unpublish, archive, draft save/discard, and schema changes all reconcile the index automatically.
- **The index is derived state.** It is fully rebuildable from Postgres and is therefore **not** a backup target — there are still only [two stores to back up](#backup--disaster-recovery) (Postgres + the asset store). If the index is lost, drifts, or you adopt search on an existing database, rebuild it (below).
- **Graceful degradation.** Search is non-essential. If Meilisearch is unreachable, `GET /api/search` returns `503 SEARCH_UNAVAILABLE` (never a 500), list views fall back to their type / status / archive filters, and `/api/health` reports `search: "unavailable"` — but the HTTP status stays 200 (Postgres is the only liveness-critical dependency).

### Operator setup

- **Dev:** nothing to configure — the `meilisearch` service in `docker-compose.yml` runs in development mode (no master key), reachable at `http://localhost:7700`. Check reachability with `curl http://localhost:7700/health`.
- **Production:** set `MEILI_MASTER_KEY` to a strong secret on **both** the Meilisearch container and the CMS (the CMS fails fast at boot if it is unset). Point `MEILI_URL` at your engine if it is not co-located on `localhost:7700`. The per-caller `/api/search` rate cap is `BOJECT_SEARCH_RATE_LIMIT_RPM` (default 120).

### Reindexing — `pnpm search:reindex`

Rebuilds the `entries` index from current Postgres state. This is both the first-time adoption path (existing database, empty index) and the disaster-recovery path (after a Postgres restore, or if the index drifts).

```bash
pnpm search:reindex                          # upsert every indexable version (safe while live)
pnpm search:reindex --content-type Article   # scope to one content type
pnpm search:reindex --dry-run                # count what would be written, write nothing
pnpm search:reindex --rebuild                # clear the index first, then upsert (one-time re-key migration)
```

Upsert-only by default, so it is safe to run against a live deployment (search stays up) and is idempotent. Run it after first adopting search, after restoring Postgres from a backup, or any time the index and the database have drifted.

### Snapshots & recovery

Because the index is rebuildable from Postgres, an index backup is optional — `pnpm search:reindex` is the authoritative recovery path. If you nonetheless want point-in-time index snapshots (e.g. to skip a full reindex after engine loss on a very large corpus), use Meilisearch's built-in snapshots and restore them into a fresh engine (see the [Meilisearch docs](https://www.meilisearch.com/docs)).

### Scaling to a separate host

For V1 the engine is co-located on the docker-compose network. To scale, run Meilisearch on its own host (or a managed Meilisearch) and point `MEILI_URL` / `MEILI_MASTER_KEY` at it — no CMS code change. Engine sizing, persistence, and replication are Meilisearch's own concern (see the [Meilisearch docs](https://www.meilisearch.com/docs)).

### Swapping the search engine (Algolia / Typesense / …)

The sync transport is just a webhook subscription, so you can replace the bundled Meilisearch integration without forking the CMS:

1. **Disable** the system internal "Search index sync" webhook — toggle `Enabled` off on its `/webhooks/<id>` page (internal rows are read-only except that toggle, and the boot seeder will not re-enable an operator-disabled row).
2. **Register your own** (external) webhook subscribed to the same events — `ENTRY_PUBLISHED`, `ENTRY_UNPUBLISHED`, `ENTRY_DELETED`, `CONTENT_TYPE_SCHEMA_CHANGED` — with the same `contentTypeIds` scope, pointing at a service that writes to your engine. (Draft indexing is an internal-only nicety; external subscribers index the published lifecycle, which is all API-key / GraphQL readers ever see.)
3. **Point your read path** at your engine — the bundled `/api/search` + `searchEntries` are Meilisearch-specific.

## Environment Variables

| Variable                             | Description                                                                                                     | Default                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `DATABASE_URL`                       | PostgreSQL connection string                                                                                    | `postgresql://boject:boject@localhost:5432/boject` |
| `NUXT_SESSION_PASSWORD`              | Session encryption key (required in prod)                                                                       | Auto-generated in dev                              |
| `MEILI_URL`                          | Meilisearch connection URL for the search sidecar.                                                              | `http://localhost:7700`                            |
| `MEILI_MASTER_KEY`                   | Meilisearch API key. Required in production (CMS refuses to boot without it); dev sidecar runs unauthenticated. | unset (dev) / required (prod)                      |
| `BOJECT_SEARCH_RATE_LIMIT_RPM`       | Per-caller (API key / IP) rate cap on `GET /api/search`, in requests per minute.                                | `120`                                              |
| `BOJECT_SCHEMA_DIR`                  | Directory of `*.boject.json` files applied on every container boot.                                             | unset (skips the step)                             |
| `BOJECT_SCHEMA_READONLY`             | Set to `true` to disable schema-editing endpoints + UI affordances.                                             | unset                                              |
| `BOJECT_ALLOW_DESTRUCTIVE_SCHEMA`    | Set to `true` to let the entrypoint applier remove content types / fields on bundle changes.                    | unset                                              |
| `BOJECT_API_KEY`                     | Used by [`@boject/cli`](../../packages/boject-cli/README.md). Not consumed by the running CMS.                  | unset                                              |
| `BOJECT_GRAPHQL_COMPLEXITY_MAX_COST` | Per-query complexity cap on `/api/graphql`. See [Query complexity](#query-complexity).                          | `1000`                                             |
| `BOJECT_GRAPHQL_COMPLEXITY_LOG_ONLY` | Set to `true` to log over-cap queries without rejecting (safe rollout).                                         | unset                                              |
| `GRAPHQL_RATE_LIMIT_RPS`             | Per-API-key sliding-window rate cap on `/api/graphql`.                                                          | `1000`                                             |

Create a `.env` file in the project root. Nuxt loads it automatically in development.
