# Onboarding C1 — Local Dev Registries

## Overview

Stand up local Docker and npm registries so the scaffolder (C2) and `boject-cli` (C4) can be exercised end-to-end without publishing to public registries. This is the foundation of the maintainer dev loop defined in the parent spec.

Parent spec: [`2026-04-18-onboarding-cli-design.md`](./2026-04-18-onboarding-cli-design.md) — see **Maintainer Dev Workflow** section.

End state after this plan: `pnpm dev:registries:up && pnpm dev:publish:image` produces a pullable `localhost:5000/boject/cms:dev` image. Nothing consumes it yet; C3 wires in the scaffolder, C4 wires in upgrade.

## Scope

**In:**

- `docker-compose.dev.yml` at repo root running two services: `registry:2` on `:5000`, `verdaccio/verdaccio` on `:4873`.
- Committed Verdaccio config (`docker/verdaccio/config.yaml`) allowing anonymous publish scoped to `@boject/*` and `create-boject-cms`.
- Root `package.json` scripts: `dev:registries:up`, `dev:registries:down`, `dev:publish:image`.
- README section covering the one-time Docker daemon config and the macOS port-5000 conflict note.

**Out (deferred to later C-plans):**

- Publishing CLI packages to Verdaccio (C3 — there are no CLI packages yet).
- `dev:scaffold`, `dev:verify`, `dev:publish` (C3).
- Image tag variants beyond `:dev` (release pipeline, Plan D).
- Automated tests — C1 is verified manually.

## Design Decisions

### Registry choice: `registry:2` over alternatives

`registry:2` is the canonical Docker-supplied local registry image. Zero-config for the HTTP case. Data persists in a named volume (`registry-data`). The only friction point is HTTP — see below.

### HTTP insecure-registry over TLS

Docker by default refuses to push to HTTP registries. Two choices considered:

- **Ship a committed self-signed TLS cert** — users still need to trust it per-machine (`~/.docker/certs.d/localhost:5000/ca.crt`) and restart Docker. Same friction, less-standard path.
- **Document the `"insecure-registries"` daemon config** — same friction, canonical path. Every "local Docker registry" tutorial on the internet lands on this snippet.

Picking the documented path. First-time setup: add `"insecure-registries": ["localhost:5000"]` to `~/.docker/daemon.json` and restart Docker Desktop. Once per machine, forever.

### Verdaccio: anonymous publish

Verdaccio supports full htpasswd auth, but the registry only listens on `localhost:4873` inside a maintainer's dev environment. Anonymous publish is configured and scoped narrowly:

```yaml
packages:
  '@boject/*':
    access: $all
    publish: $anonymous
    unpublish: $anonymous
  'create-boject-cms':
    access: $all
    publish: $anonymous
    unpublish: $anonymous
  '**':
    access: $all
    proxy: npmjs
```

Unscoped packages other than `create-boject-cms` fall through to the npmjs proxy. No chance of a typo publishing an unrelated package to the local registry.

### Volume persistence

Both registries persist data across `up`/`down` cycles via named Docker volumes (`registry-data`, `verdaccio-storage`). Rationale: maintainers iterate publish-and-test many times per session; wiping on every restart is painful. `docker compose -f docker-compose.dev.yml down -v` nukes both volumes when a clean slate is needed — documented in the README.

### macOS port 5000 conflict

macOS Monterey and later bind port 5000 to AirPlay Receiver by default. Symptom: `docker compose up` succeeds but pushes fail with no obvious error. README notes this explicitly with the fix (System Settings → General → AirDrop & Handoff → disable AirPlay Receiver). No code change — port 5000 is the canonical registry port and using anything else invites confusion.

## Files Added

| File                               | Purpose                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `docker-compose.dev.yml`           | Registry + Verdaccio services, named volumes, port bindings.                             |
| `docker/verdaccio/config.yaml`     | Verdaccio config (anonymous publish for `@boject/*` + `create-boject-cms`, npmjs proxy). |
| Root `package.json` (scripts only) | `dev:registries:up`, `dev:registries:down`, `dev:publish:image`.                         |
| `README.md` (new section)          | One-time Docker daemon setup, macOS port note, quick-start snippet.                      |

## Verification

Manual smoke after `pnpm dev:registries:up`:

1. `curl http://localhost:5000/v2/` returns `{}` (registry is up).
2. `curl http://localhost:4873/-/ping` returns a JSON response (Verdaccio is up).
3. `pnpm dev:publish:image` succeeds and prints the pushed digest.
4. `docker rmi localhost:5000/boject/cms:dev && docker pull localhost:5000/boject/cms:dev` succeeds (round-trip).
5. `pnpm dev:registries:down && pnpm dev:registries:up` — image is still present (volume persisted).

No automated tests in this plan. C3 and C4 add E2E coverage over these registries.

## Out of Scope

- Anything consuming Verdaccio — C3 adds the first publisher/consumer.
- CI integration of the dev loop — Plan C5.
- TLS, auth, multi-user isolation — this is a local-only dev tool.
