# create-boject-cms

[![npm](https://img.shields.io/npm/v/create-boject-cms)](https://www.npmjs.com/package/create-boject-cms)
[![License: BUSL-1.1](https://img.shields.io/badge/license-BUSL--1.1-blue.svg)](./LICENSE)

Scaffold a new [boject-cms](https://github.com/bojectify/boject-cms) project — a Docker Compose project pinned to a specific CMS image, with a starter content schema, scaffolded `.env`, and the `.boject.config.json` for the [@boject/cli](https://www.npmjs.com/package/@boject/cli) commands.

## Usage

```bash
pnpm create boject-cms my-site
# or
npx create-boject-cms my-site
```

You'll be prompted to pick a starter:

| Starter   | What it ships                                                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **base**  | 8 universal content types (Image, Tag, Author, Article, Page, SiteSettings, Navigation, NavigationItem) plus one SiteSettings seed entry. |
| **sport** | base + Team, Club, Competition, Season, Fixture, Player.                                                                                  |
| **rugby** | sport + Position + a patched Player.                                                                                                      |
| **none**  | No starter — empty `content-types/schema.boject.json`.                                                                                    |

Non-interactive use:

```bash
pnpm create boject-cms my-site --starter base
pnpm create boject-cms my-site --starter base --image ghcr.io/bojectify/boject-cms:1.4.2
pnpm create boject-cms my-site --starter base --port 4100   # host port (default 4000)
pnpm create boject-cms my-site --force            # scaffold into a non-empty directory
```

The CMS is published on host port **4000** by default. Pass `--port <n>` at
scaffold time (or edit `BOJECT_HOST_PORT` in the generated `.env` afterwards) to
run several projects on one machine, or to avoid a clash with another service.

## What gets scaffolded

```
my-site/
├── .boject.config.json        # @boject/cli config (cms.url + schema.path)
├── .env                       # secrets + runtime env vars
├── .gitignore
├── README.md                  # project-specific quickstart
├── content-types/
│   └── schema.boject.json     # the chosen starter's bundle (edit + commit)
├── docker-compose.yml         # cms + db services, image pinned to a specific tag
├── package.json               # one upgrade script
└── starters/
    └── <starter>.boject.json  # the starter bundle (mounted into the container)
```

## First boot

```bash
cd my-site
docker compose up -d
```

The container's entrypoint:

1. Waits for PostgreSQL.
2. Runs Prisma migrations.
3. Seeds an admin user from `BOJECT_ADMIN_EMAIL` + `BOJECT_ADMIN_PASSWORD` (only if the User table is empty).
4. Imports `BOJECT_INITIAL_STARTER` (`/starters/<starter>.boject.json`) into an empty CMS — schema + entries.
5. Runs the schema-as-code applier against `BOJECT_SCHEMA_DIR` (`/app/content-types`) — converges the schema on every boot.
6. Starts Nuxt.

Once the container is healthy, log in at http://localhost:4000/login. The admin email is `admin@local`; the password lives in `.env` under `BOJECT_ADMIN_PASSWORD`.

## Scaffolded `.env`

| Variable                                 | Purpose                                                                                                          |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                           | PostgreSQL connection string (points at the `db` service).                                                       |
| `MEILI_URL`                              | Meilisearch endpoint (points at the `meilisearch` service).                                                      |
| `MEILI_MASTER_KEY`                       | 32-byte random Meilisearch master key.                                                                           |
| `REDIS_URL`                              | Redis connection string (points at the `redis` service).                                                         |
| `NUXT_SESSION_PASSWORD`                  | 32-byte random session encryption key.                                                                           |
| `BOJECT_ADMIN_EMAIL`                     | Initial admin (`admin@local`).                                                                                   |
| `BOJECT_ADMIN_PASSWORD`                  | 16-byte random initial admin password.                                                                           |
| `STORAGE_DRIVER`                         | `local` (default), `s3`, or `r2`.                                                                                |
| `BOJECT_HOST_PORT`                       | Host port the CMS is published on (default 4000; Compose maps it to container port 3000).                        |
| `BOJECT_SCHEMA_DIR`                      | `/app/content-types` — the entrypoint applies any `*.boject.json` here on every boot.                            |
| `BOJECT_INITIAL_STARTER`                 | First-boot starter path (`/starters/<starter>.boject.json`).                                                     |
| `# BOJECT_SCHEMA_READONLY=true`          | Commented. Set on production / staging to disable schema editing in the UI.                                      |
| `# BOJECT_ALLOW_DESTRUCTIVE_SCHEMA=true` | Commented. Set on environments where the entrypoint applier should remove types/fields the bundle drops.         |
| `# BOJECT_API_KEY=`                      | Commented. Set when running the [`boject schema *`](https://www.npmjs.com/package/@boject/cli) commands locally. |

## Schema-as-code workflow

After scaffold, your content types live in `content-types/schema.boject.json`. The intended loop:

```bash
# 1. Edit content types in the CMS UI in development.

# 2. Pull the live schema into your project.
pnpm exec boject schema pull

# 3. Review the diff and commit.
git diff content-types/schema.boject.json
git commit -am "Add 'publishedOn' field to Article"

# 4. Deploy. The container's entrypoint applies the bundle on boot.
git push
```

The scaffolded `README.md` explains this for the project's developers; this file (the scaffolder's own README) covers the meta-tooling.

Destructive changes (removing types or fields) are blocked by default — set `BOJECT_ALLOW_DESTRUCTIVE_SCHEMA=true` in `.env` to allow the entrypoint applier to act on removals.

## Upgrading the CMS image

After scaffolding, the project's `package.json` exposes a single script:

```bash
pnpm upgrade
```

This runs `boject upgrade`, which finds the latest semver tag in the registry, rewrites `docker-compose.yml`, pulls the new image, restarts, and waits for the health endpoint.

```bash
pnpm exec boject upgrade --check       # exit 1 if upgrade available
pnpm exec boject upgrade --to 1.4.2    # specific version
```

## See also

- The CMS itself: [`boject-cms`](https://github.com/bojectify/boject-cms)
- The CLI: [`@boject/cli`](https://www.npmjs.com/package/@boject/cli)
- Starter bundles: [`starters/`](https://github.com/bojectify/boject-cms/tree/main/starters)

## License

Source-available under the [Business Source License 1.1](./LICENSE); each published version converts to Apache-2.0 four years after its release. See the [repository README](https://github.com/bojectify/boject-cms#license) for the plain-language summary.
