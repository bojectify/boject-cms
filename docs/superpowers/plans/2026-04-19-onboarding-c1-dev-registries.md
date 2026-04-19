# Onboarding C1 — Local Dev Registries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `registry:2` (Docker images) and `verdaccio` (npm packages) as local dev registries, published via `pnpm dev:registries:up`, and add `pnpm dev:publish:image` that pushes the CMS image to the local Docker registry.

**Architecture:** A second compose file (`docker-compose.dev.yml`) at repo root runs both registries with named volumes for persistence. Verdaccio is configured via a committed config file (`docker/verdaccio/config.yaml`) allowing anonymous publish for `@boject/*` and `create-boject-cms`, with everything else proxied to npmjs. Three new root `package.json` scripts (`dev:registries:up`, `dev:registries:down`, `dev:publish:image`) drive the loop. README documents the one-time `insecure-registries` Docker daemon setup and the macOS port-5000 AirPlay conflict.

**Tech Stack:** Docker Compose v2, `registry:2` image, `verdaccio/verdaccio` image, pnpm workspace scripts.

**Spec:** [`docs/superpowers/specs/2026-04-19-onboarding-c1-dev-registries-design.md`](../specs/2026-04-19-onboarding-c1-dev-registries-design.md)

---

## File Structure

| File                                  | Responsibility                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docker-compose.dev.yml` (new)        | Defines `registry` and `verdaccio` services, named volumes (`registry-data`, `verdaccio-storage`), port bindings (5000 and 4873), bind-mount for Verdaccio config. |
| `docker/verdaccio/config.yaml` (new)  | Verdaccio config: listen on all interfaces inside the container, anonymous publish scoped to `@boject/*` and `create-boject-cms`, proxy everything else to npmjs.  |
| `package.json` (modify, scripts only) | Add `dev:registries:up`, `dev:registries:down`, `dev:publish:image`.                                                                                               |
| `README.md` (modify)                  | Add "Local dev registries (maintainers)" section with one-time Docker daemon setup, macOS port note, and quick-start snippet.                                      |

No source code; no tests. Verification is manual per task.

---

## Task 1: Verdaccio config file

**Files:**

- Create: `docker/verdaccio/config.yaml`

- [ ] **Step 1: Create the Verdaccio config**

Write `docker/verdaccio/config.yaml`:

```yaml
storage: /verdaccio/storage/data
plugins: /verdaccio/plugins

web:
  enable: true
  title: boject-cms dev registry

auth:
  htpasswd:
    file: /verdaccio/storage/htpasswd
    algorithm: bcrypt

uplinks:
  npmjs:
    url: https://registry.npmjs.org/

packages:
  '@boject/*':
    access: $all
    publish: $anonymous
    unpublish: $anonymous
  'create-boject-cms':
    access: $all
    publish: $anonymous
    unpublish: $anonymous
  '@*/*':
    access: $all
    proxy: npmjs
  '**':
    access: $all
    proxy: npmjs

server:
  keepAliveTimeout: 60

middlewares:
  audit:
    enabled: true

log:
  type: stdout
  format: pretty
  level: warn

listen: 0.0.0.0:4873
```

- [ ] **Step 2: Commit**

```bash
git add docker/verdaccio/config.yaml
git commit -m "feat(c1): add verdaccio config for dev registry"
```

---

## Task 2: Dev compose file + registry up/down scripts

**Files:**

- Create: `docker-compose.dev.yml`
- Modify: `package.json` (add two scripts)

- [ ] **Step 1: Create `docker-compose.dev.yml`**

Write at repo root:

```yaml
services:
  registry:
    image: registry:2
    restart: unless-stopped
    ports:
      - '5000:5000'
    volumes:
      - registry-data:/var/lib/registry

  verdaccio:
    image: verdaccio/verdaccio:5
    restart: unless-stopped
    ports:
      - '4873:4873'
    volumes:
      - verdaccio-storage:/verdaccio/storage
      - ./docker/verdaccio/config.yaml:/verdaccio/conf/config.yaml:ro

volumes:
  registry-data:
  verdaccio-storage:
```

- [ ] **Step 2: Add up/down scripts to root `package.json`**

Insert after the existing `db:down` entry in the `scripts` block:

```json
"dev:registries:up": "docker compose -f docker-compose.dev.yml up -d",
"dev:registries:down": "docker compose -f docker-compose.dev.yml down",
```

Resulting script order: `dev`, `build`, `preview`, `db:up`, `db:down`, `dev:registries:up`, `dev:registries:down`, `lint`, ...

- [ ] **Step 3: Verify both services start**

Run:

```bash
pnpm dev:registries:up
```

Expected: both containers start (look for "Started" lines, or confirm with `docker compose -f docker-compose.dev.yml ps`).

Then:

```bash
curl -s http://localhost:5000/v2/
curl -s http://localhost:4873/-/ping
```

Expected:

- Registry returns `{}` (empty object).
- Verdaccio returns a JSON timestamp response (e.g. `"2026-04-19..."`), not an error.

If Verdaccio returns `Connection refused`, check `docker compose -f docker-compose.dev.yml logs verdaccio` — the `listen: 0.0.0.0:4873` line in the config is required for the port to be reachable from outside the container.

If the registry `curl` hangs on macOS, check System Settings → General → AirDrop & Handoff and disable AirPlay Receiver (it binds port 5000).

- [ ] **Step 4: Verify persistence**

```bash
pnpm dev:registries:down
pnpm dev:registries:up
docker volume ls | grep -E 'registry-data|verdaccio-storage'
```

Expected: both named volumes exist (Docker prefixes them with the compose project name, e.g. `boject-cms_registry-data`).

- [ ] **Step 5: Commit**

```bash
git add docker-compose.dev.yml package.json
git commit -m "feat(c1): add dev registries compose file + up/down scripts"
```

---

## Task 3: Image publish script

**Files:**

- Modify: `package.json` (add one script)

**Prerequisite:** One-time Docker daemon setup on the developer's machine. Add to `~/.docker/daemon.json`:

```json
{
  "insecure-registries": ["localhost:5000"]
}
```

Then restart Docker Desktop. Without this, `docker push localhost:5000/...` fails with a TLS error.

- [ ] **Step 1: Add `dev:publish:image` to root `package.json`**

Insert after `dev:registries:down`:

```json
"dev:publish:image": "docker build -f apps/cms/Dockerfile -t localhost:5000/boject/cms:dev . && docker push localhost:5000/boject/cms:dev",
```

- [ ] **Step 2: Run the script**

With `pnpm dev:registries:up` already running:

```bash
pnpm dev:publish:image
```

Expected: build succeeds (reuses Plan B's Dockerfile), then `docker push` prints layer digests and a final `digest: sha256:...` line.

- [ ] **Step 3: Verify a round-trip pull**

```bash
docker rmi localhost:5000/boject/cms:dev
docker pull localhost:5000/boject/cms:dev
```

Expected: `rmi` removes the local tag, `pull` re-downloads the image from the local registry and prints `Status: Downloaded newer image for localhost:5000/boject/cms:dev`.

- [ ] **Step 4: Verify persistence across restart**

```bash
pnpm dev:registries:down
pnpm dev:registries:up
docker rmi localhost:5000/boject/cms:dev 2>/dev/null || true
docker pull localhost:5000/boject/cms:dev
```

Expected: the pull still succeeds because the registry's named volume persisted.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "feat(c1): add dev:publish:image script"
```

---

## Task 4: README documentation

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Add "Local dev registries (maintainers)" section**

Insert after the existing "Docker image" section (currently the last `##` heading, around line 279–316). New section text:

````markdown
## Local dev registries (maintainers)

Maintainers who are iterating on the onboarding CLI flow (`create-boject-cms`, `boject-cli`) publish to local Docker and npm registries instead of the public ones. Two sidecar services live in `docker-compose.dev.yml`:

| Service   | Port | Purpose                                 |
| --------- | ---- | --------------------------------------- |
| registry  | 5000 | Local Docker registry for the CMS image |
| verdaccio | 4873 | Local npm registry for the CLI packages |

### One-time setup

Add `localhost:5000` to Docker's insecure-registries list (the local registry speaks plain HTTP). Edit `~/.docker/daemon.json`:

```json
{
  "insecure-registries": ["localhost:5000"]
}
```

Restart Docker Desktop. This is a one-time step per machine.

**macOS port 5000 note:** macOS binds port 5000 to AirPlay Receiver by default. If `curl http://localhost:5000/v2/` hangs or `docker push` fails, disable it in System Settings → General → AirDrop & Handoff → AirPlay Receiver.

### Commands

```bash
pnpm dev:registries:up        # Start both registries in the background
pnpm dev:registries:down      # Stop them (volumes persist)
pnpm dev:publish:image        # Build apps/cms and push to localhost:5000/boject/cms:dev
```

Data persists across `up`/`down` cycles via named Docker volumes. To start completely clean:

```bash
docker compose -f docker-compose.dev.yml down -v
```

### Verifying the registries are up

```bash
curl http://localhost:5000/v2/        # → {}
curl http://localhost:4873/-/ping     # → JSON timestamp
```
````

- [ ] **Step 2: Verify README renders**

Check the new section visually (open `README.md` in a preview) and confirm:

- The table formats correctly.
- The code fences are balanced.
- The section sits below "Docker image" and reads as a maintainer-only extension.

- [ ] **Step 3: Final end-to-end smoke**

Fresh shell, from a clean state:

```bash
pnpm dev:registries:down 2>/dev/null || true
docker volume rm boject-cms_registry-data boject-cms_verdaccio-storage 2>/dev/null || true
pnpm dev:registries:up
curl -s http://localhost:5000/v2/
curl -s http://localhost:4873/-/ping
pnpm dev:publish:image
docker rmi localhost:5000/boject/cms:dev
docker pull localhost:5000/boject/cms:dev
pnpm dev:registries:down
```

Expected: every command succeeds; the pull at the end re-downloads the image from the local registry.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(c1): document local dev registries setup"
```

---

## Out of Scope (addressed in later plans)

- C2 — `create-boject-cms` scaffolder package.
- C3 — `dev:publish` (publishes CLI to Verdaccio), `dev:scaffold`, `dev:verify`.
- C4 — `boject-cli` with `upgrade` command.
- C5 — CI integration of the dev loop.
