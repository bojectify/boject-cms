# Postgres init scripts

Files in this directory are mounted into the `db` service at
`/docker-entrypoint-initdb.d`. Postgres runs them in lexical order **only on
first init** — that is, only when the `pgdata` volume is empty. They are
ignored on every subsequent container start, so editing or adding files here
will not affect an already-initialised volume.

To pick up changes on an existing dev volume, either nuke the volume
(`docker compose down -v` — destructive) or run the equivalent SQL by hand,
for example:

```bash
docker compose exec db psql -U boject -c "CREATE DATABASE boject_perf;"
```

Current scripts:

- `00-init-test-db.sql` — creates `boject_test` for vitest.
- `10-create-perf-db.sql` — creates `boject_perf` for the load-testing
  workspace (`pnpm --filter @boject/perf ...`).
