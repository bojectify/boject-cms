# Contributing to boject-cms

Thanks for your interest in improving boject-cms! This guide takes you from a
fresh clone to a green test run and your first pull request.

boject-cms is **source-available** software under the
[Business Source License 1.1](LICENSE) — it is _not_ OSI-approved "open source".
You're welcome to read, modify, and contribute to the code; contributions are
accepted under the terms below. In short: you may use boject-cms for any purpose,
including production, **except** offering it to third parties as a hosted,
managed, or embedded product that competes with boject. Each released version
converts to Apache-2.0 four years after its release. Full terms in
[`LICENSE`](LICENSE).

## Code of Conduct

This project adheres to the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating, you're expected to uphold it. Report unacceptable behaviour to
[conduct@boject.com](mailto:conduct@boject.com).

## Reporting security issues

**Do not open a public issue for security vulnerabilities.** Report them
privately — see [`SECURITY.md`](SECURITY.md) for the disclosure process (GitHub
private vulnerability reporting, or [security@boject.com](mailto:security@boject.com)).

## Contributor License Agreement

Because boject-cms is source-available with a potential commercial-licensing
path, contributors must grant Boject Ltd the rights to use and relicense their
contributions. **Before an external pull request can be merged, you must sign our
[Contributor License Agreement](CLA.md).** A DCO sign-off alone is not sufficient
— it certifies provenance but doesn't grant relicensing rights.

Signing is automated. When you open your first pull request, the CLA Assistant
bot comments with a link to the [CLA](CLA.md) and asks you to sign. Reply to that
comment with exactly:

> I have read the CLA Document and I hereby sign the CLA

You only sign once — it covers all your future contributions. Maintainers and
bots are exempt.

## Ways to contribute

- **Report a bug** or **request a feature** — open an issue using the
  [issue templates](.github/ISSUE_TEMPLATE). For security issues, use the private
  path above instead.
- **Submit a pull request** — see
  [Submitting a pull request](#submitting-a-pull-request). For anything
  non-trivial, open an issue first so we can agree on the approach before you
  invest time.

---

## Prerequisites

- Node.js (LTS) on the host (used by editor tooling; runtime is containerised)
- [pnpm](https://pnpm.io/) on the host (used only to install the host shim — see below)
- [Docker](https://www.docker.com/) — [OrbStack](https://orbstack.dev/) recommended on macOS
- [lefthook](https://github.com/evilmartians/lefthook) on the host (install via `brew install lefthook`)

## Containerised dev environment

Every `pnpm` and `pnpx` invocation runs inside a Docker container that has no access to your host's `~/.ssh`, `~/.aws`, `~/.npmrc`, or other secrets. This caps the blast radius of any compromised npm dependency. The routing is transparent — you type the same commands you always did, and a host shim relays them into the container.

### One-time setup

1. **Install OrbStack** (much faster than Docker Desktop for this workflow):

   ```sh
   brew install orbstack
   open -a OrbStack
   ```

   Verify: `docker version` should mention "orbstack".

2. **Install lefthook on host** (git hooks fire on host but dispatch jobs into the container — host needs its own lefthook binary, separate from the npm package):

   ```sh
   brew install lefthook
   lefthook install
   ```

3. **Install the host shims**:

   ```sh
   mkdir -p ~/.local/bin
   cp scripts/host-shims/pnpm scripts/host-shims/pnpx ~/.local/bin/
   chmod +x ~/.local/bin/pnpm ~/.local/bin/pnpx
   ```

4. **Add `~/.local/bin` to PATH in `~/.zshenv`** (sourced by all shells, including non-interactive ones like lefthook):

   ```sh
   export PATH="$HOME/.local/bin:$PATH"
   ```

5. **Fix PATH order in `~/.zshrc`** — the standard pnpm setup block prepends `$PNPM_HOME` to PATH _after_ everything else, which would shadow the shim. Either delete the pnpm block (you don't need it any more — the shim handles pnpm) or move your `~/.local/bin` export to _after_ the `# pnpm end` marker so the shim wins PATH lookup.

6. **Add the `dev` alias to `~/.zshrc`**:

   ```sh
   alias dev='docker compose exec dev'
   ```

7. **Restart your shell**, then verify:

   ```sh
   which pnpm     # must print ~/.local/bin/pnpm (NOT ~/Library/pnpm/pnpm)
   pnpm --version # should print 11.x (takes ~1s; that's the container round-trip)
   ```

8. **Build and start the stack**:

   ```sh
   docker compose up -d
   pnpm install
   pnpm --filter cms exec msw init public --no-save
   pnpm --filter cms exec playwright install chromium chromium-headless-shell
   pnpm prisma:migrate
   BOJECT_ADMIN_EMAIL=admin@example.com \
     BOJECT_ADMIN_PASSWORD='choose-a-strong-dev-password' \
     pnpm dev:bootstrap-admin
   ```

   The Playwright browsers are cached in a docker named volume
   (`playwright-cache`) so this `playwright install` only runs once per
   machine — subsequent container rebuilds reuse the cached binaries.

9. **Smoke test**:

   ```sh
   pnpm dev
   ```

   Open http://localhost:4000.

### Daily use

You type `pnpm dev`, `pnpm test`, `pnpx whatever` exactly as you would without containers. The shim handles routing.

- `dev` (the alias) opens a bash shell inside the container.
- `dev <cmd>` runs a one-shot command inside the container.
- `git`, `gh`, your editor, and your browser stay on the host.

### Editor IntelliSense

For VS Code, Cursor, JetBrains Gateway, or Codespaces: open the repo and choose "Reopen in Container". The editor's TypeScript / ESLint / Vue language servers attach into the same container, so IntelliSense sees the same `node_modules` as your terminal commands.

For Vim / Neovim / Emacs users: the host editor will not be able to see `node_modules` correctly because the LSP runs on host. Workarounds: use `pnpm typecheck` and `pnpm lint` from the terminal for verification, or run your LSP inside the container via your editor's remote-development plugin if available.

### Threat model

Short version: the container has no host secrets mounted, `.git` is mounted read-only so a compromised dep cannot rewrite history or stage commits, ports are bound to `127.0.0.1` only.

Reading `.git` is allowed so VS Code's Source Control / blame / diff / GitLens all work inside the container. The blast-radius assumption is that this repo is publicly available on GitHub — any dep that can read history could just clone it from there anyway. The write-blocking guarantee (no `git commit --amend`, no `update-ref`, no `git push` even if you had credentials) is unchanged from the prior anonymous-volume overlay.

Residual risk: a compromised dep can still read/write the bind-mounted working tree (everything except `.git/`). Mitigation is commit-and-push frequently so uncommitted changes are the only at-risk surface.

### Native setup (no container)

The container is an **opt-in** supply-chain hardening measure, not a hard requirement. Nothing in the repo enforces it — no CI gate, no commit hook checks for it. You can run the entire toolchain natively on the host instead: `pnpm install`, `pnpm dev`, `pnpm test`, `pnpm lint`, and `pnpm typecheck` all behave identically and produce the same valid commits and PRs. The only thing you give up is the host-secret isolation described above, and only for your own machine — it has no effect on the repo or on other maintainers.

**Trade-off:** running natively means npm dependency code (install scripts, test dependencies) executes with normal access to your host environment (`~/.ssh`, `~/.aws`, `~/.npmrc`, etc.). If that's acceptable on your machine, native is simpler — there's no container round-trip on every command.

**Pick one lane — don't mix native and container installs.** `node_modules` lives in the bind-mounted working tree; it is _not_ isolated in a separate volume, so the host and the `dev` container share the same directory. pnpm's symlinks point at whichever store ran the install (the container's `/pnpm-store` vs. your host store), and native modules are compiled per-platform (linux vs. macOS arm64). Installing through one and running through the other will fail to resolve. If you previously installed via the container, delete `node_modules` (root + each workspace) and reinstall natively — and vice versa.

**Setup:**

1. Install Node.js 24 and pnpm 11 natively to match the container (pnpm's `packageManager` field pins the exact version). **Do not** install the host shims (One-time setup step 3); if you already did, remove `~/.local/bin` from the front of your PATH or delete `~/.local/bin/pnpm` and `~/.local/bin/pnpx`. `which pnpm` should resolve to your real pnpm, not the shim.

2. Install lefthook on the host as usual (`brew install lefthook && lefthook install`). The git hooks just call `pnpm lint` / `pnpm typecheck` / `pnpm test`, which resolve to native pnpm when the shim isn't on PATH — no container involved.

3. Start only PostgreSQL — you don't need the `dev` service:

   ```sh
   docker compose up -d db
   ```

   (Or run your own Postgres 17 and point `DATABASE_URL` at it.)

4. Install and bootstrap on the host:

   ```sh
   pnpm install
   cp apps/cms/.env.example apps/cms/.env
   pnpm --filter cms exec msw init public --no-save
   pnpm --filter cms exec playwright install chromium chromium-headless-shell
   pnpm prisma:migrate
   BOJECT_ADMIN_EMAIL=admin@example.com \
     BOJECT_ADMIN_PASSWORD='choose-a-strong-dev-password' \
     pnpm dev:bootstrap-admin
   pnpm dev
   ```

Everything else in this guide applies unchanged — just ignore the host-shim and `dev`-alias instructions.

## First run

```bash
# Start local services (Postgres + Meilisearch + Redis)
docker compose up -d

# Install dependencies (auto-runs nuxt prepare + prisma generate)
pnpm install

# Copy the .env template
cp apps/cms/.env.example apps/cms/.env

# Run database migrations
pnpm prisma:migrate

# Bootstrap a dev admin user (no API keys — those belong in test/perf DBs)
BOJECT_ADMIN_EMAIL=admin@example.com \
  BOJECT_ADMIN_PASSWORD='choose-a-strong-dev-password' \
  pnpm dev:bootstrap-admin

# Optionally apply the web-base starter bundle (Image, SiteSettings, Navigation, NavigationItem, Link + a SiteSettings entry)
pnpm content:import ./starters/web-base.boject.json

# Start the dev server
pnpm dev
```

All commands run from the repo root — the workspace forwards them to `apps/cms/` via `pnpm --filter cms`. You shouldn't need to `cd` into `apps/cms/` during normal development.

The app runs at http://localhost:4000. The GraphQL playground (GraphiQL) is available at http://localhost:4000/api/graphql in development.

For everything CMS-specific (architecture, GraphQL surface, API keys, schema-as-code, testing, Docker image, backup & disaster recovery, env vars), see [`apps/cms/README.md`](apps/cms/README.md).

## Running the tests

The test suite is the quality gate — there's no GitHub Actions equivalent that
runs it for you locally, so run it before you push. The integration and
Storybook projects need the docker-compose services (Postgres + Meilisearch +
Redis) up and the Playwright browsers installed, both of which the setup above
already covers.

```bash
docker compose up -d          # Postgres + Meilisearch + Redis must be running
pnpm test                     # everything: cms + packages + perf
```

The integration suite migrates and seeds its own isolated `boject_test`
database (and per-worker clones) — it never touches your dev `boject` DB. If
Meilisearch or Redis is down, the search- and cache-backed tests fail; bring the
full stack up with `docker compose up -d` first.

Narrower runs while iterating:

```bash
pnpm test:unit                # hermetic unit tests, no DB needed
pnpm test:integration         # CMS server/api + server/middleware (needs services)
pnpm --filter cms test:storybook   # Storybook interaction tests (Chromium)
pnpm --filter @boject/cli test:integration   # CLI SQL-writer tests (real Postgres)
```

`lefthook` runs `pnpm lint`, `pnpm format`, and `pnpm typecheck` on staged files
pre-commit, and the full `pnpm test` suite plus `pnpm --filter cms test:storybook`
pre-push (skip the storybook job with `SKIP_STORYBOOK_TEST=1` if needed).

## Workspace scripts

Workspace-wide scripts run from the repo root. CMS-specific scripts (`prisma:*`, `apikey:*`, `content:*`, `starters:*`) are documented in [`apps/cms/README.md`](apps/cms/README.md#cms-scripts).

| Script            | Description                                 |
| ----------------- | ------------------------------------------- |
| `pnpm dev`        | Start the CMS dev server (forwarded to cms) |
| `pnpm db:up`      | Start local PostgreSQL container            |
| `pnpm lint`       | Lint with ESLint                            |
| `pnpm lint:fix`   | Lint and auto-fix                           |
| `pnpm format`     | Check formatting with Prettier              |
| `pnpm format:fix` | Format all files                            |
| `pnpm test`       | Run all tests once (workspace-wide)         |
| `pnpm test:unit`  | Run unit tests across all packages          |
| `pnpm typecheck`  | Run TypeScript type checker                 |

For end-user CLI commands run from inside a scaffolded project (schema pull / apply / check / drift detection, image upgrades), see [`@boject/cli`](packages/boject-cli/README.md).

## Linting & formatting

- **ESLint** — Via `@nuxt/eslint` module. Config in `apps/cms/eslint.config.mjs`.
- **Prettier** — Single quotes, trailing commas, semicolons, 2-space indent. Config in `.prettierrc.yml`.
- **eslint-config-prettier** — Disables ESLint rules that conflict with Prettier.
- **Lefthook** — Pre-commit hooks run ESLint, Prettier, and per-package `typecheck` jobs (cms, create-boject-cms, boject-cli, root scripts) in parallel on staged files. Pre-push runs the full `pnpm test` suite plus `pnpm --filter cms test:storybook`; the storybook-test job can be skipped via `SKIP_STORYBOOK_TEST=1`.

```bash
pnpm lint          # Check
pnpm lint:fix      # Auto-fix
pnpm format        # Check formatting
pnpm format:fix    # Auto-fix formatting
```

## Coding conventions

- **Branch names** include the issue number: `<type>/<issue#>-<slug>`, e.g.
  `feat/221-search-meilisearch-infra` or `docs/339-community-health`.
- **Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org/):
  `type(scope): subject`, e.g. `fix(#336): non-silent apply-schema`. Reference the
  issue in the scope or body.
- **Tests stay green.** Add or update tests alongside behaviour changes; a bug
  fix should come with a test that fails before it and passes after.
- **Follow the code around you.** Match the existing naming, structure, and
  patterns of the file you're editing. `CLAUDE.md` and the per-app `CLAUDE.md`
  files document the architecture and conventions in depth.

## Submitting a pull request

1. Fork (or branch, if you have write access) and make your change on a
   `<type>/<issue#>-<slug>` branch.
2. Make sure `pnpm test`, `pnpm lint`, and `pnpm typecheck` pass.
3. Open a PR against `main`. The [pull request template](.github/pull_request_template.md)
   asks you to link the issue, note the type of change, and list the **manual
   verification** you did beyond the automated tests.
4. CI (`.github/workflows/ci.yml`) must be green, and you'll be asked to sign the
   [CLA](#contributor-license-agreement) before an external PR can merge.
5. A maintainer will review. Address feedback by pushing follow-up commits to the
   same branch.

---

## Maintainer guide

The rest of this document is for maintainers publishing releases and iterating on
the onboarding flow.

### Local dev registries

Maintainers who are iterating on the onboarding CLI flow (`create-boject-cms`, `boject-cli`) publish to local Docker and npm registries instead of the public ones. Two sidecar services live in `docker-compose.dev.yml`:

| Service   | Host port | Purpose                                 |
| --------- | --------- | --------------------------------------- |
| registry  | 5555      | Local Docker registry for the CMS image |
| verdaccio | 4873      | Local npm registry for the CLI packages |

The registry uses host port `5555` instead of the conventional `5000` because macOS Monterey+ binds port 5000 to AirPlay Receiver by default.

#### One-time setup

Add `localhost:5555` to Docker's insecure-registries list (the local registry speaks plain HTTP). Open Docker Desktop → Settings → Docker Engine and merge this key into the JSON:

```json
{
  "insecure-registries": ["localhost:5555"]
}
```

Click **Apply & Restart**. This is a one-time step per machine.

#### Commands

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

Data persists across `up`/`down` cycles via named Docker volumes. To start completely clean:

```bash
docker compose -f docker-compose.dev.yml down -v
```

Verify the registries are up:

```bash
curl http://localhost:5555/v2/        # → {}
curl http://localhost:4873/-/ping     # → {}
```

Both registries answer with an empty JSON object on success — that's the ping protocol in both cases.

### CMS image (GHCR)

The CMS image is published to `ghcr.io/bojectify/boject-cms` as a multi-arch (`linux/amd64` +
`linux/arm64`) manifest on every `v*` git tag, by `.github/workflows/publish-cms-image.yml`.

**Tags**

| Tag                              | When                                   | Notes                                                   |
| -------------------------------- | -------------------------------------- | ------------------------------------------------------- |
| `X.Y.Z` (e.g. `1.4.2`)           | every stable release                   | the semver tag `boject upgrade` selects                 |
| `X.Y.Z-rc.N` (e.g. `0.0.1-rc.1`) | every prerelease                       | selected only among prereleases                         |
| `X.Y`, `X`, `latest`             | stable releases only                   | moving pointers; not moved by prereleases               |
| `rc`                             | prereleases only                       | floating pointer to the newest prerelease               |
| `dev`                            | manual `workflow_dispatch` pushes only | maintainer test builds; not part of the release channel |

`boject upgrade` reads the registry's tag list and picks the highest **valid-semver** tag, so
the moving pointers (`latest` / `X.Y` / `X` / `rc`) are convenience only.

**Pre-1.0 caveat:** until the first stable release exists, no `latest` tag is published (the first
releases are `-rc` prereleases, and `latest` follows stable). New projects scaffolded with
`create-boject-cms` pin `ghcr.io/bojectify/boject-cms:latest`; before a stable exists, either pin an
explicit `-rc` tag or manually point `latest` at the current rc
(`docker buildx imagetools create -t ghcr.io/bojectify/boject-cms:latest ghcr.io/bojectify/boject-cms:<rc-tag>`).

**One-time setup (maintainer):** after the first push, set the `ghcr.io/bojectify/boject-cms` package to
**public** and link it to the repository in the GHCR package settings, so anonymous
`boject upgrade` can enumerate tags.

### Releasing

All three artifacts (the `ghcr.io/bojectify/boject-cms` image, `@boject/cli`,
`create-boject-cms`) ship together at **one unified version** on a `vX.Y.Z` tag.

> Run these on the **host**, not via `pnpm` — the dev-container shim mounts
> `.git` read-only, so git writes must happen on the host.

1. `bash scripts/release-prepare.sh <X.Y.Z | X.Y.Z-rc.N>` — bumps all 4
   `package.json` + both `version.ts` on a `release/*` branch and opens a PR.
2. Review + merge the PR (its required `ci` check is the test gate).
3. `bash scripts/release-tag.sh` — tags `vX.Y.Z` on the merged commit and
   creates the GitHub Release (auto-generated notes). The tag triggers the
   publish workflows, which stamp the per-version BSL `LICENSE` and publish.

The first public release is `v0.0.1-rc.1`.
