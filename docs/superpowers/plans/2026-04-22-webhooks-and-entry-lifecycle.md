# Webhooks + Entry Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship content-lifecycle webhooks (#52) bundled with the four new entry state transitions that close #102 — **Unpublish**, **Archive**, **Unarchive**, **Republish**. Webhooks deliver `ENTRY_PUBLISHED` / `ENTRY_UNPUBLISHED` / `ENTRY_DELETED` events to external HTTP consumers with HMAC-signed payloads, DB-backed queueing, exponential backoff retries, a management UI, and a 30-day delivery log; the new state transitions feed `ENTRY_UNPUBLISHED` and extra `ENTRY_PUBLISHED` events into that same pipe.

**Architecture:** Two new Prisma models (`Webhook`, `WebhookDelivery`) on the same Postgres. A thin `enqueueWebhookDeliveries(tx, …)` helper runs **inside** the triggering mutation's transaction, snapshotting the full flattened payload at enqueue time. A single in-process worker started by a Nitro plugin polls `WebhookDelivery` every second using `FOR UPDATE SKIP LOCKED`, POSTs to consumers with HMAC-SHA256 signatures, and applies a 1s → 10s → 1m → 10m → 1h → 6h backoff before dead-lettering. The four new lifecycle endpoints are thin wrappers around a pure `planTransition(entry, action)` state-machine helper that validates the transition and returns a mutation plan; each endpoint runs the plan in a Prisma transaction and calls `enqueueWebhookDeliveries` as appropriate. CMS-session-gated REST surface backs a dedicated `/webhooks` management UI plus an overflow menu + list-page filter chip on existing entry pages.

**Tech Stack:** Nuxt 4, Nitro, Prisma v7 (multi-file schema, driver adapter), `undici` (built-in Node fetch) for POSTs, existing `rateLimit` / `validation` / `prismaErrors` utilities, Nuxt UI + Reka primitives for the management pages. **Specs** (both are authoritative — this plan implements both):

- `docs/superpowers/specs/2026-04-20-webhooks-design.md` — webhooks
- `docs/superpowers/specs/2026-04-22-entry-lifecycle-design.md` — entry lifecycle

**Reference reading before starting:**

- Both specs listed above
- `apps/cms/CLAUDE.md` — repo conventions (path aliases, auto-imports, versioning, existing middleware)
- `apps/cms/server/api/content-entries/[id].put.ts` — publish flow we'll hook into
- `apps/cms/server/api/content-entries/[id].delete.ts` — delete flow we'll hook into
- `apps/cms/server/utils/resolveVersion.ts` — `flattenEntryWithVersion`, `getPublishedVersion`, `getDraftVersion`
- `apps/cms/components/entry-sidebar/EntrySidebar.vue` — where the overflow menu lands
- `apps/cms/components/entry-picker-modal/EntryPickerModal.vue` — needs an archived-exclusion filter

**UI design reference (Paper — file: Scratchpad, page: Page 1):**

The three management screens are designed in Paper as the authoritative visual spec. When building the Vue pages, use `mcp__paper__get_screenshot` and/or `mcp__paper__get_jsx` against these node IDs to pull the layout and styling:

- `FR-0` — **Webhooks — List** (1200×720). Table with Name / URL / Events / Status / Last delivery columns. "Last delivery" shows a state dot (green = success, amber = retrying, red = dead-lettered, grey = never delivered).
- `I0-0` — **Webhooks — New** (960×960). Stacked form: Name, URL (with helper text about SSRF rules), Content types multi-select chips, Events as option cards (selected card has `#2563eb` border + `#eff6ff` bg; `ENTRY_UNPUBLISHED` card is dimmed with a "Reserved" badge), Enabled toggle, Cancel + Create CTAs.
- `JQ-0` — **Webhooks — Detail** (1280×1400). Topbar breadcrumb, header with status pill + "Send test payload" / "Rotate secret" buttons, the one-time `SecretReveal` panel rendered above the config card after rotation, a two-column Configuration card, a Delivery log card with status-filter chips + expandable rows (Response, Attempt timeline, and a dark Payload block), and a red Danger Zone.

Design tokens inferred from the artboards (keep consistent in the Vue implementation):

- Typography: Inter; body 14 px; page H1 24 px/600; card H2 15 px/600; table header 12 px uppercase `#6b7280` with `0.04em` letter-spacing.
- Primary CTA: `bg #2563eb` / `text #ffffff`; secondary CTA: `border #d1d5db` / `text #374151`.
- Status pills (dot + label): success `bg #ecfdf5 text #047857 dot #10b981`; pending/retrying `bg #fffbeb text #b45309 dot #f59e0b`; dead-lettered/failed `bg #fef2f2 text #b91c1c dot #ef4444`; disabled `bg #f3f4f6 text #6b7280 dot #9ca3af`.
- Event badges: `bg #eef2ff text #4338ca`; "TEST" flag on delivery rows: `bg #dbeafe text #1d4ed8`.
- Card surfaces: `border #e5e7eb` `radius 8px`; inputs `border #d1d5db` `radius 6px` `height 38px`.
- Secret reveal banner: `border #fcd34d` on `bg #fffbeb` with warning triangle icon.
- Danger zone: `border #fecaca` on `bg #fef2f2`; destructive button `border #dc2626` on `bg #ffffff` with `text #b91c1c`.

These should map cleanly to Nuxt UI's `UBadge` colour tokens (`success` / `warning` / `error` / `neutral` / `info`), `UButton` variants, and `UCard`/`UTable` primitives. Use Tailwind utilities or `@apply` rather than inline hex values once translated into Vue. Tasks 23–27 assume these artboards as the source of truth; deviations from them should be justified in a commit message.

**Conventions this plan assumes:**

- All paths below are relative to the repo root unless stated; most live under `apps/cms/`.
- Each commit runs through lefthook (`lint`, `format`, `typecheck`, `test`). Do **not** pass `--no-verify`.
- Server utils, `prisma`, `createError`, `defineEventHandler`, `readBody`, `getRouterParam`, `getQuery`, `setResponseStatus` are all auto-imported by Nuxt/Nitro — do not add imports for them.
- Every integration test uses `setup({ dev: true })` from `@nuxt/test-utils/e2e`. Copy the `getSessionCookie()` helper from `apps/cms/server/api/content-entries/content-entries.test.ts`.
- Prisma: `prisma migrate dev` requires an interactive terminal; in this repo we create the migration SQL by hand and apply with `pnpx prisma migrate deploy` (see existing migrations under `apps/cms/prisma/migrations/` for format).

---

## File Structure

**New schema:**

- `apps/cms/prisma/schema/webhook.prisma` — `Webhook`, `WebhookDelivery`, `WebhookEvent`, `DeliveryStatus`
- `apps/cms/prisma/migrations/20260422120000_add_webhooks/migration.sql` — manually authored

**New utilities (each with colocated `.test.ts`):**

- `apps/cms/server/utils/signPayload.ts` — HMAC-SHA256 signer
- `apps/cms/server/utils/webhookUrl.ts` — SSRF URL validator
- `apps/cms/server/utils/webhookBackoff.ts` — backoff schedule lookup
- `apps/cms/server/utils/webhookPayload.ts` — pure payload-shape builders (one per event)
- `apps/cms/server/utils/webhooks.ts` — `enqueueWebhookDeliveries(tx, …)`, secret generation
- `apps/cms/server/utils/webhookWorker.ts` — `runWorkerTick(prisma, now, deps)` (pure, testable) + `startWorker` / `stopWorker`
- `apps/cms/server/utils/entryTransitions.ts` — pure `planTransition(entry, action)` state-machine helper (unpublish, archive, unarchive, republish)

**Event-source modifications:**

- `apps/cms/server/api/content-entries/[id].put.ts` — enqueue `ENTRY_PUBLISHED` inside `publishFlow` transaction
- `apps/cms/server/api/content-entries/[id].delete.ts` — capture published snapshot then enqueue `ENTRY_DELETED` in a transaction

**New lifecycle endpoints (all CMS-session-gated; each runs in a single Prisma transaction):**

- `apps/cms/server/api/content-entries/[id]/unpublish.post.ts` — demote PUBLISHED → DRAFT (or collapse CHANGED into DRAFT); fires `ENTRY_UNPUBLISHED`
- `apps/cms/server/api/content-entries/[id]/archive.post.ts` — PUBLISHED → ARCHIVED; 409 `DRAFT_PRESENT` if CHANGED exists; fires `ENTRY_UNPUBLISHED`
- `apps/cms/server/api/content-entries/[id]/unarchive.post.ts` — ARCHIVED → DRAFT; no webhook
- `apps/cms/server/api/content-entries/[id]/republish.post.ts` — no data change; fires `ENTRY_PUBLISHED`

**New REST endpoints (all CMS-session-gated; mutations go through `enforceMutationRateLimit` + existing CSRF middleware):**

- `apps/cms/server/api/webhooks.get.ts` — list
- `apps/cms/server/api/webhooks/index.post.ts` — create
- `apps/cms/server/api/webhooks/[id].get.ts` — detail (no secret)
- `apps/cms/server/api/webhooks/[id].put.ts` — update
- `apps/cms/server/api/webhooks/[id].delete.ts` — delete (cascade)
- `apps/cms/server/api/webhooks/[id]/rotate.post.ts` — rotate secret
- `apps/cms/server/api/webhooks/[id]/test.post.ts` — fire test delivery
- `apps/cms/server/api/webhooks/[id]/deliveries.get.ts` — paginated deliveries
- `apps/cms/server/api/webhooks/deliveries/[id]/retry.post.ts` — requeue a delivery
- `apps/cms/server/api/webhooks/webhooks.test.ts` — integration tests for the REST surface + event wiring

**New Nitro plugins:**

- `apps/cms/server/plugins/webhook-worker.ts` — starts `webhookWorker` on boot, drains on shutdown
- `apps/cms/server/tasks/webhooks-cleanup.ts` — Nitro scheduled task for 30-day retention

**Nitro / nuxt.config changes:**

- `apps/cms/nuxt.config.ts` — enable `nitro.experimental.tasks` + register `scheduledTasks`, add CSRF/auth skip for `/api/webhooks` mutations (spec says they are CSRF-protected, so **no** skip there)

**UI:**

- `apps/cms/pages/webhooks/index.vue` — list
- `apps/cms/pages/webhooks/new.vue` — create (with one-time secret reveal)
- `apps/cms/pages/webhooks/[id].vue` — edit + rotate + send-test + delivery log + retry
- `apps/cms/components/webhook-secret-reveal/WebhookSecretReveal.vue` — reusable "show secret once" panel
- `apps/cms/layouts/default.vue` — add Webhooks sidebar link
- `apps/cms/components/entry-sidebar/EntrySidebar.vue` — new "More actions" overflow menu (Unpublish / Republish / Archive / Unarchive / Delete)
- `apps/cms/components/entry-action-menu/EntryActionMenu.vue` — extracted overflow menu (one component, two consumers: the sidebar and potentially list-row actions later)
- `apps/cms/pages/content-types/[id]/entries/index.vue` — add archive filter chip above the table
- `apps/cms/pages/index.vue` (All Content list) — same archive filter chip
- `apps/cms/components/entry-picker-modal/EntryPickerModal.vue` — unchanged at component level; server query excludes archived
- `apps/cms/server/api/content-entries.get.ts` — new `archiveFilter=active|archived|all` query param; picker passes `active`

**Docs:**

- `apps/cms/CLAUDE.md` — new bullets under Architecture + Key Files

---

## Task Ordering Rationale

Build core infrastructure first (schema, pure utilities), then wire triggers, then the worker, then the REST surface, then the UI. This keeps every commit individually green against the test suite.

---

### Task 1: Prisma Schema + Migration

**Files:**

- Create: `apps/cms/prisma/schema/webhook.prisma`
- Create: `apps/cms/prisma/migrations/20260422120000_add_webhooks/migration.sql`

- [ ] **Step 1: Create `apps/cms/prisma/schema/webhook.prisma`**

```prisma
enum WebhookEvent {
  ENTRY_PUBLISHED
  ENTRY_UNPUBLISHED
  ENTRY_DELETED
}

enum DeliveryStatus {
  PENDING
  SUCCESS
  FAILED
  DEAD_LETTERED
}

model Webhook {
  id             String            @id @default(uuid())
  name           String
  url            String
  secret         String
  enabled        Boolean           @default(true)
  contentTypeIds String[]
  events         WebhookEvent[]
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt
  deliveries     WebhookDelivery[]
}

model WebhookDelivery {
  id               String         @id @default(uuid())
  webhook          Webhook        @relation(fields: [webhookId], references: [id], onDelete: Cascade)
  webhookId        String
  event            WebhookEvent
  contentTypeId    String
  entryId          String
  payload          Json
  status           DeliveryStatus @default(PENDING)
  attempts         Int            @default(0)
  nextAttemptAt    DateTime?
  lastResponseCode Int?
  lastResponseBody String?
  lastError        String?
  isTest           Boolean        @default(false)
  createdAt        DateTime       @default(now())
  completedAt      DateTime?

  @@index([status, nextAttemptAt])
  @@index([webhookId, createdAt])
}
```

- [ ] **Step 2: Regenerate the Prisma client to confirm the schema parses**

Run: `pnpm prisma:generate`
Expected: `✔ Generated Prisma Client` with no errors.

- [ ] **Step 3: Create the migration directory and SQL file**

Create `apps/cms/prisma/migrations/20260422120000_add_webhooks/migration.sql`:

```sql
CREATE TYPE "WebhookEvent" AS ENUM ('ENTRY_PUBLISHED', 'ENTRY_UNPUBLISHED', 'ENTRY_DELETED');
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'DEAD_LETTERED');

CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "contentTypeIds" TEXT[],
    "events" "WebhookEvent"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "event" "WebhookEvent" NOT NULL,
    "contentTypeId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastResponseCode" INTEGER,
    "lastResponseBody" TEXT,
    "lastError" TEXT,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");
CREATE INDEX "WebhookDelivery_webhookId_createdAt_idx" ON "WebhookDelivery"("webhookId", "createdAt");

ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Apply the migration**

Run: `pnpm --filter cms exec pnpx prisma migrate deploy`
Expected: `1 migration found` and `Applying migration 20260422120000_add_webhooks` success output.

- [ ] **Step 5: Sanity check — list `Webhook` table**

Run: `docker compose exec -T postgres psql -U boject -d boject -c '\d "Webhook"'`
Expected: columns `id, name, url, secret, enabled, contentTypeIds, events, createdAt, updatedAt`.

- [ ] **Step 6: Commit**

```bash
git add apps/cms/prisma/schema/webhook.prisma apps/cms/prisma/migrations/20260422120000_add_webhooks
git commit -m "feat(db): add Webhook + WebhookDelivery schema"
```

---

### Task 2: URL Validation Helper (SSRF guard)

**Files:**

- Create: `apps/cms/server/utils/webhookUrl.ts`
- Create: `apps/cms/server/utils/webhookUrl.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `apps/cms/server/utils/webhookUrl.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { assertWebhookUrl, isPrivateHost } from './webhookUrl';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ALLOW = process.env.WEBHOOK_ALLOW_PRIVATE_URLS;

beforeEach(() => {
  process.env.NODE_ENV = 'production';
  delete process.env.WEBHOOK_ALLOW_PRIVATE_URLS;
});

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_ALLOW !== undefined) {
    process.env.WEBHOOK_ALLOW_PRIVATE_URLS = ORIGINAL_ALLOW;
  } else {
    delete process.env.WEBHOOK_ALLOW_PRIVATE_URLS;
  }
});

describe('isPrivateHost', () => {
  it.each([
    ['localhost', true],
    ['127.0.0.1', true],
    ['10.0.0.5', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['192.168.1.1', true],
    ['169.254.169.254', true],
    ['203.0.113.5', false],
    ['example.com', false],
  ])('classifies %s as private=%s', (host, expected) => {
    expect(isPrivateHost(host)).toBe(expected);
  });
});

describe('assertWebhookUrl', () => {
  it('accepts a public https URL', () => {
    expect(() => assertWebhookUrl('https://example.com/hook')).not.toThrow();
  });

  it('accepts a public http URL', () => {
    expect(() => assertWebhookUrl('http://example.com/hook')).not.toThrow();
  });

  it('rejects non-http schemes', () => {
    expect(() => assertWebhookUrl('file:///etc/passwd')).toThrow(/http\(s\)/);
    expect(() => assertWebhookUrl('javascript:alert(1)')).toThrow(/http\(s\)/);
  });

  it('rejects garbage input', () => {
    expect(() => assertWebhookUrl('not a url')).toThrow(/valid URL/);
    expect(() => assertWebhookUrl('')).toThrow(/valid URL/);
  });

  it('rejects localhost in production', () => {
    expect(() => assertWebhookUrl('http://localhost:3000/x')).toThrow(
      /private/
    );
  });

  it('rejects RFC1918 ranges in production', () => {
    expect(() => assertWebhookUrl('http://10.0.0.1/x')).toThrow(/private/);
    expect(() => assertWebhookUrl('http://192.168.1.1/x')).toThrow(/private/);
  });

  it('allows localhost in development', () => {
    process.env.NODE_ENV = 'development';
    expect(() => assertWebhookUrl('http://localhost:3000/x')).not.toThrow();
  });

  it('allows private hosts when WEBHOOK_ALLOW_PRIVATE_URLS=true', () => {
    process.env.WEBHOOK_ALLOW_PRIVATE_URLS = 'true';
    expect(() => assertWebhookUrl('http://10.0.0.1/x')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter cms test:run -- server/utils/webhookUrl.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `apps/cms/server/utils/webhookUrl.ts`**

```typescript
import { isIP } from 'node:net';

const PRIVATE_V4_PREFIXES: Array<[number, number, number]> = [
  [10, 0, 0],
  [127, 0, 0],
  [169, 254, 0],
  [192, 168, 0],
];

function isPrivateV4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p))) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (PRIVATE_V4_PREFIXES.some(([p0]) => p0 === a)) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function isPrivateHost(host: string): boolean {
  const normalised = host.toLowerCase();
  if (normalised === 'localhost') return true;
  if (isIP(normalised) === 4) return isPrivateV4(normalised);
  if (isIP(normalised) === 6) {
    if (normalised === '::1') return true;
    if (normalised.startsWith('fc') || normalised.startsWith('fd')) return true;
    if (normalised.startsWith('fe80')) return true;
    return false;
  }
  return false;
}

export function assertWebhookUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'url must be a valid URL',
    });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw createError({
      statusCode: 400,
      statusMessage: 'url must use http(s)',
    });
  }

  const allowPrivate =
    process.env.NODE_ENV !== 'production' ||
    process.env.WEBHOOK_ALLOW_PRIVATE_URLS === 'true';
  if (!allowPrivate && isPrivateHost(url.hostname)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'url must not resolve to a private network host',
    });
  }
  return url;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter cms test:run -- server/utils/webhookUrl.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/utils/webhookUrl.ts apps/cms/server/utils/webhookUrl.test.ts
git commit -m "feat(webhooks): add URL validation helper with SSRF guard"
```

---

### Task 3: HMAC Signer

**Files:**

- Create: `apps/cms/server/utils/signPayload.ts`
- Create: `apps/cms/server/utils/signPayload.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `apps/cms/server/utils/signPayload.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { signPayload } from './signPayload';

describe('signPayload', () => {
  it('produces HMAC-SHA256 of "<timestamp>.<body>" as hex', () => {
    const secret = 'test-secret';
    const body = '{"hello":"world"}';
    const timestamp = 1700000000;
    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex');

    expect(signPayload(secret, timestamp, body)).toBe(expected);
  });

  it('is stable across calls with the same inputs', () => {
    const a = signPayload('s', 1, 'b');
    const b = signPayload('s', 1, 'b');
    expect(a).toBe(b);
  });

  it('changes if body changes', () => {
    const a = signPayload('s', 1, 'a');
    const b = signPayload('s', 1, 'b');
    expect(a).not.toBe(b);
  });

  it('changes if timestamp changes', () => {
    const a = signPayload('s', 1, 'body');
    const b = signPayload('s', 2, 'body');
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter cms test:run -- server/utils/signPayload.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `apps/cms/server/utils/signPayload.ts`**

```typescript
import { createHmac } from 'node:crypto';

/**
 * HMAC-SHA256 signature over `${timestamp}.${body}` using the webhook secret.
 * Returns lowercase hex. Callers emit as `X-Boject-Signature: sha256=<hex>`.
 */
export function signPayload(
  secret: string,
  timestampSeconds: number,
  body: string
): string {
  return createHmac('sha256', secret)
    .update(`${timestampSeconds}.${body}`)
    .digest('hex');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter cms test:run -- server/utils/signPayload.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/utils/signPayload.ts apps/cms/server/utils/signPayload.test.ts
git commit -m "feat(webhooks): add HMAC-SHA256 payload signer"
```

---

### Task 4: Backoff Schedule

**Files:**

- Create: `apps/cms/server/utils/webhookBackoff.ts`
- Create: `apps/cms/server/utils/webhookBackoff.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `apps/cms/server/utils/webhookBackoff.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { MAX_ATTEMPTS, backoffMs } from './webhookBackoff';

describe('webhookBackoff', () => {
  it('schedule is 1s, 10s, 1m, 10m, 1h, 6h', () => {
    expect(backoffMs(1)).toBe(1_000);
    expect(backoffMs(2)).toBe(10_000);
    expect(backoffMs(3)).toBe(60_000);
    expect(backoffMs(4)).toBe(600_000);
    expect(backoffMs(5)).toBe(3_600_000);
    expect(backoffMs(6)).toBe(21_600_000);
  });

  it('returns null when attempts exceed MAX_ATTEMPTS', () => {
    expect(backoffMs(MAX_ATTEMPTS + 1)).toBeNull();
  });

  it('MAX_ATTEMPTS is 6', () => {
    expect(MAX_ATTEMPTS).toBe(6);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter cms test:run -- server/utils/webhookBackoff.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `apps/cms/server/utils/webhookBackoff.ts`**

```typescript
export const MAX_ATTEMPTS = 6;

const SCHEDULE_MS = [
  1_000, // 1s
  10_000, // 10s
  60_000, // 1m
  600_000, // 10m
  3_600_000, // 1h
  21_600_000, // 6h
];

/**
 * Milliseconds to wait before attempt N (1-indexed). Returns null when
 * attempts has exceeded MAX_ATTEMPTS — caller should dead-letter.
 */
export function backoffMs(attempts: number): number | null {
  if (attempts < 1 || attempts > MAX_ATTEMPTS) return null;
  return SCHEDULE_MS[attempts - 1]!;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter cms test:run -- server/utils/webhookBackoff.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/utils/webhookBackoff.ts apps/cms/server/utils/webhookBackoff.test.ts
git commit -m "feat(webhooks): add retry backoff schedule"
```

---

### Task 5: Payload Builder

**Files:**

- Create: `apps/cms/server/utils/webhookPayload.ts`
- Create: `apps/cms/server/utils/webhookPayload.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `apps/cms/server/utils/webhookPayload.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildWebhookPayload } from './webhookPayload';

describe('buildWebhookPayload', () => {
  const timestamp = new Date('2026-04-22T12:00:00Z');
  const contentType = { id: 'ct-1', identifier: 'Article' };
  const entry = {
    id: 'e-1',
    entryTitle: 'Hello',
    slug: 'hello',
    status: 'PUBLISHED' as const,
    publishedAt: new Date('2026-04-22T11:00:00Z'),
    createdAt: new Date('2026-04-22T10:00:00Z'),
    updatedAt: new Date('2026-04-22T11:00:00Z'),
    data: { title: 'Hello', body: 'world' },
  };

  it('returns the documented shape for ENTRY_PUBLISHED', () => {
    const payload = buildWebhookPayload({
      event: 'ENTRY_PUBLISHED',
      deliveryId: 'd-1',
      timestamp,
      contentType,
      entry,
    });
    expect(payload).toEqual({
      event: 'ENTRY_PUBLISHED',
      deliveryId: 'd-1',
      timestamp: '2026-04-22T12:00:00.000Z',
      contentType,
      entry: {
        id: 'e-1',
        entryTitle: 'Hello',
        slug: 'hello',
        status: 'PUBLISHED',
        publishedAt: '2026-04-22T11:00:00.000Z',
        createdAt: '2026-04-22T10:00:00.000Z',
        updatedAt: '2026-04-22T11:00:00.000Z',
        data: { title: 'Hello', body: 'world' },
      },
    });
  });

  it('uses the same shape for ENTRY_DELETED with the last-known snapshot', () => {
    const payload = buildWebhookPayload({
      event: 'ENTRY_DELETED',
      deliveryId: 'd-2',
      timestamp,
      contentType,
      entry,
    });
    expect(payload.event).toBe('ENTRY_DELETED');
    expect(payload.entry.entryTitle).toBe('Hello');
  });

  it('serialises null slug without dropping the key', () => {
    const payload = buildWebhookPayload({
      event: 'ENTRY_PUBLISHED',
      deliveryId: 'd-3',
      timestamp,
      contentType,
      entry: { ...entry, slug: null },
    });
    expect(payload.entry.slug).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter cms test:run -- server/utils/webhookPayload.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `apps/cms/server/utils/webhookPayload.ts`**

```typescript
import type { WebhookEvent } from '#prisma';

export interface WebhookEntrySnapshot {
  id: string;
  entryTitle: string;
  slug: string | null;
  status: 'PUBLISHED';
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  data: unknown;
}

export interface WebhookPayloadInput {
  event: WebhookEvent;
  deliveryId: string;
  timestamp: Date;
  contentType: { id: string; identifier: string };
  entry: WebhookEntrySnapshot;
}

export interface WebhookPayload {
  event: WebhookEvent;
  deliveryId: string;
  timestamp: string;
  contentType: { id: string; identifier: string };
  entry: {
    id: string;
    entryTitle: string;
    slug: string | null;
    status: 'PUBLISHED';
    publishedAt: string | null;
    createdAt: string;
    updatedAt: string;
    data: unknown;
  };
}

export function buildWebhookPayload(
  input: WebhookPayloadInput
): WebhookPayload {
  return {
    event: input.event,
    deliveryId: input.deliveryId,
    timestamp: input.timestamp.toISOString(),
    contentType: input.contentType,
    entry: {
      id: input.entry.id,
      entryTitle: input.entry.entryTitle,
      slug: input.entry.slug,
      status: input.entry.status,
      publishedAt: input.entry.publishedAt?.toISOString() ?? null,
      createdAt: input.entry.createdAt.toISOString(),
      updatedAt: input.entry.updatedAt.toISOString(),
      data: input.entry.data,
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter cms test:run -- server/utils/webhookPayload.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/utils/webhookPayload.ts apps/cms/server/utils/webhookPayload.test.ts
git commit -m "feat(webhooks): add payload shape builder"
```

---

### Task 6: Enqueue Helper + Secret Generator

**Files:**

- Create: `apps/cms/server/utils/webhooks.ts`
- Create: `apps/cms/server/utils/webhooks.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `apps/cms/server/utils/webhooks.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateWebhookSecret } from './webhooks';

describe('generateWebhookSecret', () => {
  it('produces a base64 string of at least 32 bytes of entropy', () => {
    const secret = generateWebhookSecret();
    const raw = Buffer.from(secret, 'base64');
    expect(raw.byteLength).toBeGreaterThanOrEqual(32);
  });

  it('returns a different value each call', () => {
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
  });
});
```

The integration test for `enqueueWebhookDeliveries` lives in `server/api/webhooks/webhooks.test.ts` (Task 7/8) since it needs the DB. We intentionally don't unit-test it against a mock `tx` — the real filter semantics (`contentTypeIds` empty = all, `events` contains…) are a Prisma query.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter cms test:run -- server/utils/webhooks.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `apps/cms/server/utils/webhooks.ts`**

```typescript
import { randomBytes } from 'node:crypto';
import type { Prisma, WebhookEvent } from '#prisma';
import { buildWebhookPayload } from './webhookPayload';
import type { WebhookEntrySnapshot } from './webhookPayload';

export function generateWebhookSecret(): string {
  return randomBytes(32).toString('base64');
}

export interface EnqueueArgs {
  event: WebhookEvent;
  contentType: { id: string; identifier: string };
  entry: WebhookEntrySnapshot;
}

/**
 * Find every enabled webhook subscribed to this event/content-type and insert
 * one PENDING WebhookDelivery per match. MUST be called with a Prisma
 * transaction client so the enqueue is atomic with the source mutation.
 *
 * Returns the number of deliveries enqueued (useful for observability).
 */
export async function enqueueWebhookDeliveries(
  tx: Prisma.TransactionClient,
  args: EnqueueArgs
): Promise<number> {
  const webhooks = await tx.webhook.findMany({
    where: {
      enabled: true,
      events: { has: args.event },
    },
  });

  // `contentTypeIds: []` means "all content types". Prisma can't express
  // "array is empty OR contains X" cleanly, so filter in-process.
  const matching = webhooks.filter(
    (w) =>
      w.contentTypeIds.length === 0 ||
      w.contentTypeIds.includes(args.contentType.id)
  );
  if (matching.length === 0) return 0;

  const now = new Date();
  await Promise.all(
    matching.map(async (webhook) => {
      // Create a placeholder to get deliveryId, then serialise the payload with
      // that id inside it, then write the payload back. Two round-trips inside
      // the caller's transaction — negligible cost, and keeps deliveryId a
      // first-class field in the body.
      const placeholder = await tx.webhookDelivery.create({
        data: {
          webhookId: webhook.id,
          event: args.event,
          contentTypeId: args.contentType.id,
          entryId: args.entry.id,
          payload: {},
          status: 'PENDING',
          nextAttemptAt: now,
        },
      });
      const payload = buildWebhookPayload({
        event: args.event,
        deliveryId: placeholder.id,
        timestamp: now,
        contentType: args.contentType,
        entry: args.entry,
      });
      await tx.webhookDelivery.update({
        where: { id: placeholder.id },
        data: { payload: payload as unknown as Prisma.InputJsonValue },
      });
    })
  );

  return matching.length;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter cms test:run -- server/utils/webhooks.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/utils/webhooks.ts apps/cms/server/utils/webhooks.test.ts
git commit -m "feat(webhooks): add enqueue helper and secret generator"
```

---

### Task 7: Wire `ENTRY_PUBLISHED`

**Files:**

- Modify: `apps/cms/server/api/content-entries/[id].put.ts`
- Modify (add cases): `apps/cms/server/api/content-entries/content-entries.test.ts`

**Plan:** fold the enqueue call into `publishFlow`'s existing `prisma.$transaction`. The flatten logic already lives in the handler — we copy its shape into an in-transaction helper so we don't have to re-read the entry.

- [ ] **Step 1: Write failing integration tests**

Add to `apps/cms/server/api/content-entries/content-entries.test.ts`, inside the top-level `describe` (adjust the existing imports to include `TEST_API_KEY` — already present — and the session helper):

```typescript
describe('Webhook ENTRY_PUBLISHED wiring', () => {
  it('inserts a WebhookDelivery row when a matching webhook is enabled', async () => {
    // Seed a webhook that matches all content types, ENTRY_PUBLISHED only.
    const cookie = await getSessionCookie();
    const createdHook = await fetch('/api/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'Publish hook',
        url: 'https://example.com/hook',
        events: ['ENTRY_PUBLISHED'],
        contentTypeIds: [],
      }),
    });
    expect(createdHook.status).toBe(201);
    const hook = (await createdHook.json()) as { id: string };

    // Create + publish an entry of any content type.
    const ct = await ensureBlogContentType();
    const createRes = await fetch('/api/content-entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        contentTypeId: ct.id,
        data: { title: `Hook target ${Date.now()}` },
      }),
    });
    const created = (await createRes.json()) as { id: string };

    const publishRes = await fetch(`/api/content-entries/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        status: 'PUBLISHED',
        data: { title: `Hook target ${Date.now()}` },
      }),
    });
    expect(publishRes.status).toBe(200);

    // Delivery exists.
    const deliveriesRes = await fetch(`/api/webhooks/${hook.id}/deliveries`, {
      headers: { Cookie: cookie },
    });
    const { items } = (await deliveriesRes.json()) as {
      items: Array<{ event: string; entryId: string }>;
    };
    expect(
      items.some(
        (d) => d.event === 'ENTRY_PUBLISHED' && d.entryId === created.id
      )
    ).toBe(true);
  });

  it('does not enqueue when the webhook event filter excludes the event', async () => {
    const cookie = await getSessionCookie();
    const createdHook = await fetch('/api/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'Delete-only hook',
        url: 'https://example.com/hook',
        events: ['ENTRY_DELETED'],
        contentTypeIds: [],
      }),
    });
    const hook = (await createdHook.json()) as { id: string };

    const ct = await ensureBlogContentType();
    const created = await (
      await fetch('/api/content-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title: `Filter test ${Date.now()}` },
        }),
      })
    ).json();

    await fetch(`/api/content-entries/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'PUBLISHED', data: created.data }),
    });

    const { items } = await (
      await fetch(`/api/webhooks/${hook.id}/deliveries`, {
        headers: { Cookie: cookie },
      })
    ).json();
    expect(items.length).toBe(0);
  });

  it('does not enqueue when the webhook is disabled', async () => {
    const cookie = await getSessionCookie();
    const hook = await (
      await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name: 'Disabled hook',
          url: 'https://example.com/hook',
          events: ['ENTRY_PUBLISHED'],
          contentTypeIds: [],
          enabled: false,
        }),
      })
    ).json();

    const ct = await ensureBlogContentType();
    const created = await (
      await fetch('/api/content-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title: `Disabled test ${Date.now()}` },
        }),
      })
    ).json();

    await fetch(`/api/content-entries/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'PUBLISHED', data: created.data }),
    });

    const { items } = await (
      await fetch(`/api/webhooks/${hook.id}/deliveries`, {
        headers: { Cookie: cookie },
      })
    ).json();
    expect(items.length).toBe(0);
  });
});
```

Add the helper at the top of the file (above the first `describe`):

```typescript
async function ensureBlogContentType(): Promise<{ id: string }> {
  const existing = await prisma.contentType.findUnique({
    where: { identifier: 'WebhookBlog' },
  });
  if (existing) return existing;
  return prisma.contentType.create({
    data: {
      identifier: 'WebhookBlog',
      name: 'Webhook Blog',
      fields: {
        create: [
          {
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            order: 0,
            required: true,
            unique: true,
          },
        ],
      },
    },
  });
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter cms test:run -- server/api/content-entries/content-entries.test.ts`
Expected: the three new tests fail (no enqueue wired; also the `/api/webhooks` endpoints don't exist yet, so the test harness 404s on create). **This task therefore depends on Task 17 for the create endpoint** — if running tasks out of order, stub the create via `prisma.webhook.create(...)` direct DB insert as a workaround; otherwise wire these tests after Task 17 lands.

- [ ] **Step 3: Modify `apps/cms/server/api/content-entries/[id].put.ts`'s `publishFlow`**

Inside `publishFlow`, update the `prisma.$transaction(async (tx) => { … })` body to enqueue after Step 3 but before the transaction returns. Import `enqueueWebhookDeliveries` from `../../utils/webhooks` at the top of the file.

Replace the existing `publishFlow` with:

```typescript
async function publishFlow(
  entry: EntryWithVersionsAndType,
  validatedData: Record<string, unknown> | null
): Promise<void> {
  const publishedVersion = getPublishedVersion(entry.versions);
  const draftVersion = getDraftVersion(entry.versions);

  const dataToPublish =
    validatedData ??
    (draftVersion?.data as Record<string, unknown> | null) ??
    (publishedVersion?.data as Record<string, unknown> | null);
  if (!dataToPublish) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No data provided and no existing version to publish',
    });
  }

  const entryTitle = extractEntryTitle(dataToPublish, entry.contentType.fields);
  const slug = extractSlug(dataToPublish, entry.contentType.fields);
  const now = new Date();
  const publishedAt = publishedVersion?.publishedAt ?? now;

  await withPrismaErrors(
    () =>
      prisma.$transaction(async (tx) => {
        if (publishedVersion) {
          await tx.contentEntryVersion.delete({
            where: { id: publishedVersion.id },
          });
        }

        if (draftVersion) {
          await tx.contentEntryVersion.update({
            where: { id: draftVersion.id },
            data: {
              data: (validatedData ??
                draftVersion.data) as Prisma.InputJsonValue,
              entryTitle,
              status: 'PUBLISHED',
              publishedAt,
            },
          });
        } else {
          await tx.contentEntryVersion.create({
            data: {
              entryId: entry.id,
              data: dataToPublish as Prisma.InputJsonValue,
              entryTitle,
              status: 'PUBLISHED',
              publishedAt,
            },
          });
        }

        await tx.contentEntry.update({
          where: { id: entry.id },
          data: { slug, entryTitle },
        });

        // Re-read the canonical published version inside this transaction so
        // the snapshot matches what consumers would see via GraphQL/REST.
        const published = await tx.contentEntryVersion.findFirstOrThrow({
          where: { entryId: entry.id, status: 'PUBLISHED' },
        });
        const ct = await tx.contentType.findUniqueOrThrow({
          where: { id: entry.contentTypeId },
          select: { id: true, identifier: true },
        });
        await enqueueWebhookDeliveries(tx, {
          event: 'ENTRY_PUBLISHED',
          contentType: ct,
          entry: {
            id: entry.id,
            entryTitle,
            slug,
            status: 'PUBLISHED',
            publishedAt: published.publishedAt,
            createdAt: entry.createdAt,
            updatedAt: new Date(),
            data: published.data,
          },
        });
      }),
    {
      uniqueMessage:
        'An entry with this slug or title already exists for this content type',
    }
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter cms test:run -- server/api/content-entries/content-entries.test.ts`
Expected: the three new tests pass, along with all existing content-entry tests.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/api/content-entries/[id].put.ts apps/cms/server/api/content-entries/content-entries.test.ts
git commit -m "feat(webhooks): enqueue ENTRY_PUBLISHED on publish"
```

---

### Task 8: Wire `ENTRY_DELETED`

**Files:**

- Modify: `apps/cms/server/api/content-entries/[id].delete.ts`
- Modify (add cases): `apps/cms/server/api/content-entries/content-entries.test.ts`

Spec: enqueue only when a PUBLISHED version existed at delete time; snapshot it **before** deletion. Do everything in one transaction.

- [ ] **Step 1: Write failing integration tests**

Add to the same test file inside a new `describe('Webhook ENTRY_DELETED wiring', …)`:

```typescript
describe('Webhook ENTRY_DELETED wiring', () => {
  it('enqueues ENTRY_DELETED when a published entry is deleted', async () => {
    const cookie = await getSessionCookie();
    const hook = await (
      await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name: 'Delete hook',
          url: 'https://example.com/hook',
          events: ['ENTRY_DELETED'],
          contentTypeIds: [],
        }),
      })
    ).json();

    const ct = await ensureBlogContentType();
    const created = await (
      await fetch('/api/content-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title: `Delete target ${Date.now()}` },
        }),
      })
    ).json();

    await fetch(`/api/content-entries/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'PUBLISHED', data: created.data }),
    });

    const delRes = await fetch(`/api/content-entries/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(delRes.status).toBe(200);

    const { items } = await (
      await fetch(`/api/webhooks/${hook.id}/deliveries`, {
        headers: { Cookie: cookie },
      })
    ).json();
    expect(
      items.some(
        (d: { event: string; entryId: string }) =>
          d.event === 'ENTRY_DELETED' && d.entryId === created.id
      )
    ).toBe(true);
  });

  it('does not enqueue when deleting a draft-only entry', async () => {
    const cookie = await getSessionCookie();
    const hook = await (
      await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name: 'Delete draft hook',
          url: 'https://example.com/hook',
          events: ['ENTRY_DELETED'],
          contentTypeIds: [],
        }),
      })
    ).json();

    const ct = await ensureBlogContentType();
    const created = await (
      await fetch('/api/content-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title: `Draft only ${Date.now()}` },
        }),
      })
    ).json();

    await fetch(`/api/content-entries/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });

    const { items } = await (
      await fetch(`/api/webhooks/${hook.id}/deliveries`, {
        headers: { Cookie: cookie },
      })
    ).json();
    expect(items.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter cms test:run -- server/api/content-entries/content-entries.test.ts`
Expected: the new tests fail — no enqueue logic in delete handler.

- [ ] **Step 3: Replace `apps/cms/server/api/content-entries/[id].delete.ts`**

```typescript
import type { ContentEntryVersion } from '#prisma';
import { assertUuid } from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';
import { enqueueWebhookDeliveries } from '../../utils/webhooks';
import { getPublishedVersion } from '../../utils/resolveVersion';

export default defineEventHandler(async (event) => {
  enforceMutationRateLimit(event, 'content-entries.delete');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');

  const existing = await prisma.contentEntry.findUnique({
    where: { id },
    include: {
      versions: true,
      contentType: { select: { id: true, identifier: true } },
    },
  });
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content entry not found',
    });
  }

  const publishedVersion: ContentEntryVersion | null = getPublishedVersion(
    existing.versions
  );

  await withPrismaErrors(
    () =>
      prisma.$transaction(async (tx) => {
        if (publishedVersion) {
          await enqueueWebhookDeliveries(tx, {
            event: 'ENTRY_DELETED',
            contentType: existing.contentType,
            entry: {
              id: existing.id,
              entryTitle: existing.entryTitle,
              slug: existing.slug,
              status: 'PUBLISHED',
              publishedAt: publishedVersion.publishedAt,
              createdAt: existing.createdAt,
              updatedAt: existing.updatedAt,
              data: publishedVersion.data,
            },
          });
        }
        await tx.contentEntry.delete({ where: { id } });
      }),
    { notFoundMessage: 'Content entry not found' }
  );

  return { success: true };
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter cms test:run -- server/api/content-entries/content-entries.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/api/content-entries/[id].delete.ts apps/cms/server/api/content-entries/content-entries.test.ts
git commit -m "feat(webhooks): enqueue ENTRY_DELETED on delete of published entry"
```

---

### Task 9: `planTransition` State-Machine Helper

**Files:**

- Create: `apps/cms/server/utils/entryTransitions.ts`
- Create: `apps/cms/server/utils/entryTransitions.test.ts`

Pure, DB-free helper that encodes the entire state machine from `docs/superpowers/specs/2026-04-22-entry-lifecycle-design.md`. The four new endpoints are thin wrappers: load entry → call `planTransition` → execute the returned mutation plan inside a Prisma transaction → enqueue the webhook event (if any). Keeping the branch matrix here means unit tests cover every transition without spinning up the DB.

- [ ] **Step 1: Write failing unit tests**

Create `apps/cms/server/utils/entryTransitions.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { ContentEntryVersion } from '#prisma';
import { planTransition } from './entryTransitions';

type VersionFixture = Pick<
  ContentEntryVersion,
  'id' | 'status' | 'data' | 'entryTitle' | 'publishedAt'
>;

function v(
  id: string,
  status: VersionFixture['status'],
  extras: Partial<VersionFixture> = {}
): VersionFixture {
  return {
    id,
    status,
    data: { title: id },
    entryTitle: id,
    publishedAt:
      status === 'PUBLISHED' ? new Date('2026-04-22T10:00:00Z') : null,
    ...extras,
  };
}

describe('planTransition', () => {
  describe('unpublish', () => {
    it('demotes PUBLISHED to DRAFT when no CHANGED exists', () => {
      const plan = planTransition(
        { id: 'e1', versions: [v('pub', 'PUBLISHED')] },
        'unpublish'
      );
      expect(plan.kind).toBe('ok');
      if (plan.kind !== 'ok') return;
      expect(plan.mutations).toEqual([
        { kind: 'update-status', versionId: 'pub', status: 'DRAFT' },
      ]);
      expect(plan.webhookEvent).toBe('ENTRY_UNPUBLISHED');
      expect(plan.snapshot?.status).toBe('PUBLISHED');
      expect(plan.snapshot?.data).toEqual({ title: 'pub' });
    });

    it('drops PUBLISHED and flips CHANGED → DRAFT when CHANGED exists', () => {
      const plan = planTransition(
        {
          id: 'e1',
          versions: [v('pub', 'PUBLISHED'), v('ch', 'CHANGED')],
        },
        'unpublish'
      );
      expect(plan.kind).toBe('ok');
      if (plan.kind !== 'ok') return;
      expect(plan.mutations).toEqual([
        { kind: 'delete', versionId: 'pub' },
        { kind: 'update-status', versionId: 'ch', status: 'DRAFT' },
      ]);
      expect(plan.webhookEvent).toBe('ENTRY_UNPUBLISHED');
      expect(plan.snapshot?.data).toEqual({ title: 'pub' });
    });

    it('rejects when entry has no PUBLISHED version', () => {
      const plan = planTransition(
        { id: 'e1', versions: [v('dr', 'DRAFT')] },
        'unpublish'
      );
      expect(plan).toEqual({
        kind: 'error',
        error: 'WRONG_STATE',
        message: 'Entry is not published',
      });
    });
  });

  describe('archive', () => {
    it('flips PUBLISHED → ARCHIVED', () => {
      const plan = planTransition(
        { id: 'e1', versions: [v('pub', 'PUBLISHED')] },
        'archive'
      );
      expect(plan.kind).toBe('ok');
      if (plan.kind !== 'ok') return;
      expect(plan.mutations).toEqual([
        { kind: 'update-status', versionId: 'pub', status: 'ARCHIVED' },
      ]);
      expect(plan.webhookEvent).toBe('ENTRY_UNPUBLISHED');
    });

    it('blocks when CHANGED draft exists', () => {
      const plan = planTransition(
        {
          id: 'e1',
          versions: [v('pub', 'PUBLISHED'), v('ch', 'CHANGED')],
        },
        'archive'
      );
      expect(plan).toEqual({
        kind: 'error',
        error: 'DRAFT_PRESENT',
        message: 'Publish or discard your draft before archiving',
      });
    });

    it('rejects when no PUBLISHED version exists', () => {
      const plan = planTransition(
        { id: 'e1', versions: [v('dr', 'DRAFT')] },
        'archive'
      );
      expect(plan).toEqual({
        kind: 'error',
        error: 'WRONG_STATE',
        message: 'Only published entries can be archived',
      });
    });
  });

  describe('unarchive', () => {
    it('flips ARCHIVED → DRAFT with no webhook', () => {
      const plan = planTransition(
        { id: 'e1', versions: [v('arc', 'ARCHIVED')] },
        'unarchive'
      );
      expect(plan.kind).toBe('ok');
      if (plan.kind !== 'ok') return;
      expect(plan.mutations).toEqual([
        { kind: 'update-status', versionId: 'arc', status: 'DRAFT' },
      ]);
      expect(plan.webhookEvent).toBeNull();
      expect(plan.snapshot).toBeNull();
    });

    it('rejects when no ARCHIVED version exists', () => {
      const plan = planTransition(
        { id: 'e1', versions: [v('dr', 'DRAFT')] },
        'unarchive'
      );
      expect(plan.kind).toBe('error');
    });
  });

  describe('republish', () => {
    it('no mutations, refires ENTRY_PUBLISHED with current PUBLISHED snapshot', () => {
      const plan = planTransition(
        { id: 'e1', versions: [v('pub', 'PUBLISHED')] },
        'republish'
      );
      expect(plan.kind).toBe('ok');
      if (plan.kind !== 'ok') return;
      expect(plan.mutations).toEqual([]);
      expect(plan.webhookEvent).toBe('ENTRY_PUBLISHED');
      expect(plan.snapshot?.data).toEqual({ title: 'pub' });
    });

    it('is unaffected by a CHANGED draft (always targets PUBLISHED)', () => {
      const plan = planTransition(
        {
          id: 'e1',
          versions: [v('pub', 'PUBLISHED'), v('ch', 'CHANGED')],
        },
        'republish'
      );
      expect(plan.kind).toBe('ok');
      if (plan.kind !== 'ok') return;
      expect(plan.snapshot?.data).toEqual({ title: 'pub' });
    });

    it('rejects when no PUBLISHED version exists', () => {
      const plan = planTransition(
        { id: 'e1', versions: [v('dr', 'DRAFT')] },
        'republish'
      );
      expect(plan).toEqual({
        kind: 'error',
        error: 'NOT_PUBLISHED',
        message: 'Entry has no published version to republish',
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter cms test:run -- server/utils/entryTransitions.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `apps/cms/server/utils/entryTransitions.ts`**

```typescript
import type { ContentEntry, ContentEntryVersion, WebhookEvent } from '#prisma';
import type { WebhookEntrySnapshot } from './webhookPayload';
import { getPublishedVersion, getDraftVersion } from './resolveVersion';

export type TransitionAction =
  | 'unpublish'
  | 'archive'
  | 'unarchive'
  | 'republish';

export type VersionMutation =
  | {
      kind: 'update-status';
      versionId: string;
      status: ContentEntryVersion['status'];
    }
  | { kind: 'delete'; versionId: string };

export type TransitionError = 'WRONG_STATE' | 'DRAFT_PRESENT' | 'NOT_PUBLISHED';

export type TransitionPlan =
  | {
      kind: 'ok';
      mutations: VersionMutation[];
      webhookEvent: WebhookEvent | null;
      snapshot: WebhookEntrySnapshot | null;
    }
  | {
      kind: 'error';
      error: TransitionError;
      message: string;
    };

type EntryShape = Pick<ContentEntry, 'id'> & {
  versions: Array<
    Pick<
      ContentEntryVersion,
      'id' | 'status' | 'data' | 'entryTitle' | 'publishedAt'
    >
  >;
};

function snapshotFromPublished(
  entry: EntryShape,
  published: EntryShape['versions'][number]
): WebhookEntrySnapshot {
  return {
    id: entry.id,
    entryTitle: published.entryTitle,
    slug: null,
    status: 'PUBLISHED',
    publishedAt: published.publishedAt,
    createdAt: new Date(),
    updatedAt: new Date(),
    data: published.data,
  };
}

export function planTransition(
  entry: EntryShape,
  action: TransitionAction
): TransitionPlan {
  const published = getPublishedVersion(
    entry.versions as ContentEntryVersion[]
  );
  const draft = getDraftVersion(entry.versions as ContentEntryVersion[]);

  switch (action) {
    case 'unpublish': {
      if (!published) {
        return {
          kind: 'error',
          error: 'WRONG_STATE',
          message: 'Entry is not published',
        };
      }
      if (draft && draft.status === 'CHANGED') {
        return {
          kind: 'ok',
          mutations: [
            { kind: 'delete', versionId: published.id },
            { kind: 'update-status', versionId: draft.id, status: 'DRAFT' },
          ],
          webhookEvent: 'ENTRY_UNPUBLISHED',
          snapshot: snapshotFromPublished(entry, published),
        };
      }
      return {
        kind: 'ok',
        mutations: [
          { kind: 'update-status', versionId: published.id, status: 'DRAFT' },
        ],
        webhookEvent: 'ENTRY_UNPUBLISHED',
        snapshot: snapshotFromPublished(entry, published),
      };
    }
    case 'archive': {
      if (!published) {
        return {
          kind: 'error',
          error: 'WRONG_STATE',
          message: 'Only published entries can be archived',
        };
      }
      if (draft && draft.status === 'CHANGED') {
        return {
          kind: 'error',
          error: 'DRAFT_PRESENT',
          message: 'Publish or discard your draft before archiving',
        };
      }
      return {
        kind: 'ok',
        mutations: [
          {
            kind: 'update-status',
            versionId: published.id,
            status: 'ARCHIVED',
          },
        ],
        webhookEvent: 'ENTRY_UNPUBLISHED',
        snapshot: snapshotFromPublished(entry, published),
      };
    }
    case 'unarchive': {
      const archived = entry.versions.find((v) => v.status === 'ARCHIVED');
      if (!archived) {
        return {
          kind: 'error',
          error: 'WRONG_STATE',
          message: 'Entry is not archived',
        };
      }
      return {
        kind: 'ok',
        mutations: [
          { kind: 'update-status', versionId: archived.id, status: 'DRAFT' },
        ],
        webhookEvent: null,
        snapshot: null,
      };
    }
    case 'republish': {
      if (!published) {
        return {
          kind: 'error',
          error: 'NOT_PUBLISHED',
          message: 'Entry has no published version to republish',
        };
      }
      return {
        kind: 'ok',
        mutations: [],
        webhookEvent: 'ENTRY_PUBLISHED',
        snapshot: snapshotFromPublished(entry, published),
      };
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter cms test:run -- server/utils/entryTransitions.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/utils/entryTransitions.ts apps/cms/server/utils/entryTransitions.test.ts
git commit -m "feat(lifecycle): add planTransition state-machine helper"
```

---

### Task 10: `POST /unpublish` Endpoint

**Files:**

- Create: `apps/cms/server/api/content-entries/[id]/unpublish.post.ts`
- Modify: `apps/cms/server/api/content-entries/content-entries.test.ts`

Executes the mutation plan returned by `planTransition(..., 'unpublish')` in a single transaction, enqueues `ENTRY_UNPUBLISHED`, and returns the flattened entry in its new state. The snapshot sent to webhooks is the PUBLISHED version being demoted — captured before the mutation runs.

- [ ] **Step 1: Write failing integration tests**

Append inside the top-level `describe` of `content-entries.test.ts`:

```typescript
describe('POST /api/content-entries/[id]/unpublish', () => {
  it('demotes a PUBLISHED entry to DRAFT and enqueues ENTRY_UNPUBLISHED', async () => {
    const cookie = await getSessionCookie();
    const hook = (await (
      await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name: 'Unpub hook',
          url: 'https://example.com/hook',
          events: ['ENTRY_UNPUBLISHED'],
          contentTypeIds: [],
        }),
      })
    ).json()) as { id: string };

    const ct = await ensureBlogContentType();
    const created = (await (
      await fetch('/api/content-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title: `Unpub target ${Date.now()}` },
        }),
      })
    ).json()) as { id: string; data: { title: string } };

    await fetch(`/api/content-entries/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'PUBLISHED', data: created.data }),
    });

    const res = await fetch(`/api/content-entries/${created.id}/unpublish`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('DRAFT');

    const { items } = (await (
      await fetch(`/api/webhooks/${hook.id}/deliveries`, {
        headers: { Cookie: cookie },
      })
    ).json()) as {
      items: Array<{ event: string; entryId: string }>;
    };
    expect(
      items.some(
        (d) => d.event === 'ENTRY_UNPUBLISHED' && d.entryId === created.id
      )
    ).toBe(true);
  });

  it('collapses CHANGED into DRAFT when both PUBLISHED and CHANGED exist', async () => {
    const cookie = await getSessionCookie();
    const ct = await ensureBlogContentType();
    const created = (await (
      await fetch('/api/content-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title: `Unpub-C ${Date.now()}` },
        }),
      })
    ).json()) as { id: string; data: { title: string } };

    await fetch(`/api/content-entries/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'PUBLISHED', data: created.data }),
    });
    // Now save a CHANGED draft with different title text
    await fetch(`/api/content-entries/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        data: { title: `${created.data.title} — edited` },
      }),
    });

    const res = await fetch(`/api/content-entries/${created.id}/unpublish`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      data: { title: string };
    };
    expect(body.status).toBe('DRAFT');
    expect(body.data.title).toBe(`${created.data.title} — edited`);
  });

  it('returns 409 when entry has no PUBLISHED version', async () => {
    const cookie = await getSessionCookie();
    const ct = await ensureBlogContentType();
    const created = (await (
      await fetch('/api/content-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title: `Unpub-fail ${Date.now()}` },
        }),
      })
    ).json()) as { id: string };

    const res = await fetch(`/api/content-entries/${created.id}/unpublish`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(409);
  });

  it('rejects API-key callers', async () => {
    const res = await fetch(
      '/api/content-entries/00000000-0000-0000-0000-000000000000/unpublish',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      }
    );
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter cms test:run -- server/api/content-entries/content-entries.test.ts`
Expected: the new tests fail — endpoint missing.

- [ ] **Step 3: Create `apps/cms/server/api/content-entries/[id]/unpublish.post.ts`**

```typescript
import type { Prisma } from '#prisma';
import { assertUuid } from '../../../utils/validation';
import {
  isCmsRequest,
  flattenEntryWithVersion,
} from '../../../utils/resolveVersion';
import { enforceMutationRateLimit } from '../../../utils/rateLimitEndpoint';
import { planTransition } from '../../../utils/entryTransitions';
import { enqueueWebhookDeliveries } from '../../../utils/webhooks';
import { getDraftVersion } from '../../../utils/resolveVersion';

export default defineEventHandler(async (event) => {
  if (!isCmsRequest(event)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }
  enforceMutationRateLimit(event, 'content-entries.unpublish');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');

  const entry = await prisma.contentEntry.findUnique({
    where: { id },
    include: {
      versions: true,
      contentType: { select: { id: true, identifier: true } },
    },
  });
  if (!entry) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content entry not found',
    });
  }

  const plan = planTransition(entry, 'unpublish');
  if (plan.kind === 'error') {
    throw createError({
      statusCode: 409,
      statusMessage: plan.message,
      data: { error: plan.error },
    });
  }

  await prisma.$transaction(async (tx) => {
    for (const m of plan.mutations) {
      if (m.kind === 'delete') {
        await tx.contentEntryVersion.delete({ where: { id: m.versionId } });
      } else {
        await tx.contentEntryVersion.update({
          where: { id: m.versionId },
          data: { status: m.status, publishedAt: null },
        });
      }
    }
    if (plan.webhookEvent && plan.snapshot) {
      await enqueueWebhookDeliveries(tx, {
        event: plan.webhookEvent,
        contentType: entry.contentType,
        entry: plan.snapshot,
      });
    }
  });

  const refreshed = await prisma.contentEntry.findUniqueOrThrow({
    where: { id },
    include: { versions: true, contentType: true },
  });
  const draft = getDraftVersion(refreshed.versions);
  if (!draft) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Unpublish left entry with no draft',
    });
  }
  return flattenEntryWithVersion(refreshed, draft, {
    contentType: refreshed.contentType,
    hasPublishedVersion: false,
    publishedVersionPublishedAt: null,
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter cms test:run -- server/api/content-entries/content-entries.test.ts`
Expected: all unpublish tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/api/content-entries/[id]/unpublish.post.ts apps/cms/server/api/content-entries/content-entries.test.ts
git commit -m "feat(lifecycle): add POST /api/content-entries/[id]/unpublish"
```

---

### Task 11: `POST /archive` Endpoint

**Files:**

- Create: `apps/cms/server/api/content-entries/[id]/archive.post.ts`
- Modify: `apps/cms/server/api/content-entries/content-entries.test.ts`

Same shape as Task 10. The key differences: target status is `ARCHIVED`, and the endpoint returns 409 `DRAFT_PRESENT` when a CHANGED draft exists.

- [ ] **Step 1: Write failing integration tests**

Append:

```typescript
describe('POST /api/content-entries/[id]/archive', () => {
  it('flips PUBLISHED → ARCHIVED and enqueues ENTRY_UNPUBLISHED', async () => {
    const cookie = await getSessionCookie();
    const hook = (await (
      await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name: 'Arc hook',
          url: 'https://example.com/hook',
          events: ['ENTRY_UNPUBLISHED'],
          contentTypeIds: [],
        }),
      })
    ).json()) as { id: string };

    const ct = await ensureBlogContentType();
    const created = (await (
      await fetch('/api/content-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title: `Arc target ${Date.now()}` },
        }),
      })
    ).json()) as { id: string; data: { title: string } };
    await fetch(`/api/content-entries/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'PUBLISHED', data: created.data }),
    });

    const res = await fetch(`/api/content-entries/${created.id}/archive`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ARCHIVED');

    const { items } = (await (
      await fetch(`/api/webhooks/${hook.id}/deliveries`, {
        headers: { Cookie: cookie },
      })
    ).json()) as {
      items: Array<{ event: string; entryId: string }>;
    };
    expect(
      items.some(
        (d) => d.event === 'ENTRY_UNPUBLISHED' && d.entryId === created.id
      )
    ).toBe(true);
  });

  it('returns 409 DRAFT_PRESENT when a CHANGED draft exists', async () => {
    const cookie = await getSessionCookie();
    const ct = await ensureBlogContentType();
    const created = (await (
      await fetch('/api/content-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title: `Arc-C ${Date.now()}` },
        }),
      })
    ).json()) as { id: string; data: { title: string } };
    await fetch(`/api/content-entries/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'PUBLISHED', data: created.data }),
    });
    await fetch(`/api/content-entries/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        data: { title: `${created.data.title} draft` },
      }),
    });

    const res = await fetch(`/api/content-entries/${created.id}/archive`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { data?: { error?: string } };
    expect(body.data?.error).toBe('DRAFT_PRESENT');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter cms test:run -- server/api/content-entries/content-entries.test.ts`
Expected: the new tests fail.

- [ ] **Step 3: Create `apps/cms/server/api/content-entries/[id]/archive.post.ts`**

```typescript
import { assertUuid } from '../../../utils/validation';
import {
  isCmsRequest,
  flattenEntryWithVersion,
} from '../../../utils/resolveVersion';
import { enforceMutationRateLimit } from '../../../utils/rateLimitEndpoint';
import { planTransition } from '../../../utils/entryTransitions';
import { enqueueWebhookDeliveries } from '../../../utils/webhooks';

export default defineEventHandler(async (event) => {
  if (!isCmsRequest(event)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }
  enforceMutationRateLimit(event, 'content-entries.archive');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');

  const entry = await prisma.contentEntry.findUnique({
    where: { id },
    include: {
      versions: true,
      contentType: { select: { id: true, identifier: true } },
    },
  });
  if (!entry) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content entry not found',
    });
  }

  const plan = planTransition(entry, 'archive');
  if (plan.kind === 'error') {
    throw createError({
      statusCode: 409,
      statusMessage: plan.message,
      data: { error: plan.error },
    });
  }

  await prisma.$transaction(async (tx) => {
    for (const m of plan.mutations) {
      if (m.kind === 'update-status') {
        await tx.contentEntryVersion.update({
          where: { id: m.versionId },
          data: { status: m.status },
        });
      }
    }
    if (plan.webhookEvent && plan.snapshot) {
      await enqueueWebhookDeliveries(tx, {
        event: plan.webhookEvent,
        contentType: entry.contentType,
        entry: plan.snapshot,
      });
    }
  });

  const refreshed = await prisma.contentEntry.findUniqueOrThrow({
    where: { id },
    include: { versions: true, contentType: true },
  });
  const archived = refreshed.versions.find((v) => v.status === 'ARCHIVED')!;
  return flattenEntryWithVersion(refreshed, archived, {
    contentType: refreshed.contentType,
    hasPublishedVersion: false,
    publishedVersionPublishedAt: null,
  });
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter cms test:run -- server/api/content-entries/content-entries.test.ts`
Expected: all archive tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/api/content-entries/[id]/archive.post.ts apps/cms/server/api/content-entries/content-entries.test.ts
git commit -m "feat(lifecycle): add POST /api/content-entries/[id]/archive"
```

---

### Task 12: `POST /unarchive` Endpoint

**Files:**

- Create: `apps/cms/server/api/content-entries/[id]/unarchive.post.ts`
- Modify: `apps/cms/server/api/content-entries/content-entries.test.ts`

No webhook fires — consumers never saw ARCHIVED.

- [ ] **Step 1: Write failing tests**

Append:

```typescript
describe('POST /api/content-entries/[id]/unarchive', () => {
  it('flips ARCHIVED → DRAFT and does not enqueue a webhook delivery', async () => {
    const cookie = await getSessionCookie();
    const hook = (await (
      await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name: 'No unarchive hook',
          url: 'https://example.com/hook',
          events: ['ENTRY_PUBLISHED', 'ENTRY_UNPUBLISHED', 'ENTRY_DELETED'],
          contentTypeIds: [],
        }),
      })
    ).json()) as { id: string };

    const ct = await ensureBlogContentType();
    const created = (await (
      await fetch('/api/content-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title: `Unarc ${Date.now()}` },
        }),
      })
    ).json()) as { id: string; data: { title: string } };
    await fetch(`/api/content-entries/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'PUBLISHED', data: created.data }),
    });
    await fetch(`/api/content-entries/${created.id}/archive`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    const before = (await (
      await fetch(`/api/webhooks/${hook.id}/deliveries`, {
        headers: { Cookie: cookie },
      })
    ).json()) as { items: unknown[] };

    const res = await fetch(`/api/content-entries/${created.id}/unarchive`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('DRAFT');

    const after = (await (
      await fetch(`/api/webhooks/${hook.id}/deliveries`, {
        headers: { Cookie: cookie },
      })
    ).json()) as { items: unknown[] };
    expect(after.items.length).toBe(before.items.length);
  });

  it('returns 409 when entry has no ARCHIVED version', async () => {
    const cookie = await getSessionCookie();
    const ct = await ensureBlogContentType();
    const created = (await (
      await fetch('/api/content-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title: `Unarc-fail ${Date.now()}` },
        }),
      })
    ).json()) as { id: string };

    const res = await fetch(`/api/content-entries/${created.id}/unarchive`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter cms test:run -- server/api/content-entries/content-entries.test.ts`

- [ ] **Step 3: Create `apps/cms/server/api/content-entries/[id]/unarchive.post.ts`**

```typescript
import { assertUuid } from '../../../utils/validation';
import {
  isCmsRequest,
  flattenEntryWithVersion,
  getDraftVersion,
} from '../../../utils/resolveVersion';
import { enforceMutationRateLimit } from '../../../utils/rateLimitEndpoint';
import { planTransition } from '../../../utils/entryTransitions';

export default defineEventHandler(async (event) => {
  if (!isCmsRequest(event)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }
  enforceMutationRateLimit(event, 'content-entries.unarchive');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');

  const entry = await prisma.contentEntry.findUnique({
    where: { id },
    include: { versions: true, contentType: true },
  });
  if (!entry) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content entry not found',
    });
  }

  const plan = planTransition(entry, 'unarchive');
  if (plan.kind === 'error') {
    throw createError({
      statusCode: 409,
      statusMessage: plan.message,
      data: { error: plan.error },
    });
  }

  await prisma.$transaction(async (tx) => {
    for (const m of plan.mutations) {
      if (m.kind === 'update-status') {
        await tx.contentEntryVersion.update({
          where: { id: m.versionId },
          data: { status: m.status, publishedAt: null },
        });
      }
    }
  });

  const refreshed = await prisma.contentEntry.findUniqueOrThrow({
    where: { id },
    include: { versions: true, contentType: true },
  });
  const draft = getDraftVersion(refreshed.versions)!;
  return flattenEntryWithVersion(refreshed, draft, {
    contentType: refreshed.contentType,
    hasPublishedVersion: false,
    publishedVersionPublishedAt: null,
  });
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter cms test:run -- server/api/content-entries/content-entries.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/api/content-entries/[id]/unarchive.post.ts apps/cms/server/api/content-entries/content-entries.test.ts
git commit -m "feat(lifecycle): add POST /api/content-entries/[id]/unarchive"
```

---

### Task 13: `POST /republish` Endpoint

**Files:**

- Create: `apps/cms/server/api/content-entries/[id]/republish.post.ts`
- Modify: `apps/cms/server/api/content-entries/content-entries.test.ts`

No data change — the plan returns zero mutations. The only side-effect is the `ENTRY_PUBLISHED` webhook enqueue. Useful for re-firing a delivery that a consumer missed.

- [ ] **Step 1: Write failing tests**

Append:

```typescript
describe('POST /api/content-entries/[id]/republish', () => {
  it('enqueues ENTRY_PUBLISHED without mutating the entry', async () => {
    const cookie = await getSessionCookie();
    const hook = (await (
      await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name: 'Repub hook',
          url: 'https://example.com/hook',
          events: ['ENTRY_PUBLISHED'],
          contentTypeIds: [],
        }),
      })
    ).json()) as { id: string };

    const ct = await ensureBlogContentType();
    const created = (await (
      await fetch('/api/content-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title: `Repub ${Date.now()}` },
        }),
      })
    ).json()) as { id: string; data: { title: string } };
    await fetch(`/api/content-entries/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'PUBLISHED', data: created.data }),
    });

    const beforeRes = await fetch(`/api/webhooks/${hook.id}/deliveries`, {
      headers: { Cookie: cookie },
    });
    const before = (await beforeRes.json()) as {
      items: Array<{ event: string; entryId: string }>;
    };

    const res = await fetch(`/api/content-entries/${created.id}/republish`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('PUBLISHED');

    const after = (await (
      await fetch(`/api/webhooks/${hook.id}/deliveries`, {
        headers: { Cookie: cookie },
      })
    ).json()) as {
      items: Array<{ event: string; entryId: string }>;
    };
    const newPublishedForEntry = after.items.filter(
      (d) => d.event === 'ENTRY_PUBLISHED' && d.entryId === created.id
    );
    const oldPublishedForEntry = before.items.filter(
      (d) => d.event === 'ENTRY_PUBLISHED' && d.entryId === created.id
    );
    expect(newPublishedForEntry.length).toBeGreaterThan(
      oldPublishedForEntry.length
    );
  });

  it('returns 409 NOT_PUBLISHED when entry has no PUBLISHED version', async () => {
    const cookie = await getSessionCookie();
    const ct = await ensureBlogContentType();
    const created = (await (
      await fetch('/api/content-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title: `Repub-fail ${Date.now()}` },
        }),
      })
    ).json()) as { id: string };

    const res = await fetch(`/api/content-entries/${created.id}/republish`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { data?: { error?: string } };
    expect(body.data?.error).toBe('NOT_PUBLISHED');
  });

  it('is unaffected by a CHANGED draft', async () => {
    const cookie = await getSessionCookie();
    const ct = await ensureBlogContentType();
    const created = (await (
      await fetch('/api/content-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title: `Repub-CH ${Date.now()}` },
        }),
      })
    ).json()) as { id: string; data: { title: string } };
    await fetch(`/api/content-entries/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'PUBLISHED', data: created.data }),
    });
    await fetch(`/api/content-entries/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ data: { title: `${created.data.title} dr` } }),
    });

    const res = await fetch(`/api/content-entries/${created.id}/republish`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter cms test:run -- server/api/content-entries/content-entries.test.ts`

- [ ] **Step 3: Create `apps/cms/server/api/content-entries/[id]/republish.post.ts`**

```typescript
import { assertUuid } from '../../../utils/validation';
import {
  isCmsRequest,
  flattenEntryWithVersion,
  getPublishedVersion,
} from '../../../utils/resolveVersion';
import { enforceMutationRateLimit } from '../../../utils/rateLimitEndpoint';
import { planTransition } from '../../../utils/entryTransitions';
import { enqueueWebhookDeliveries } from '../../../utils/webhooks';

export default defineEventHandler(async (event) => {
  if (!isCmsRequest(event)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }
  enforceMutationRateLimit(event, 'content-entries.republish');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');

  const entry = await prisma.contentEntry.findUnique({
    where: { id },
    include: {
      versions: true,
      contentType: { select: { id: true, identifier: true } },
    },
  });
  if (!entry) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content entry not found',
    });
  }

  const plan = planTransition(entry, 'republish');
  if (plan.kind === 'error') {
    throw createError({
      statusCode: 409,
      statusMessage: plan.message,
      data: { error: plan.error },
    });
  }

  await prisma.$transaction(async (tx) => {
    if (plan.webhookEvent && plan.snapshot) {
      await enqueueWebhookDeliveries(tx, {
        event: plan.webhookEvent,
        contentType: entry.contentType,
        entry: plan.snapshot,
      });
    }
  });

  const full = await prisma.contentEntry.findUniqueOrThrow({
    where: { id },
    include: { versions: true, contentType: true },
  });
  const published = getPublishedVersion(full.versions)!;
  return flattenEntryWithVersion(full, published, {
    contentType: full.contentType,
    hasPublishedVersion: true,
    publishedVersionPublishedAt: published.publishedAt,
  });
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter cms test:run -- server/api/content-entries/content-entries.test.ts`
Expected: all republish tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/api/content-entries/[id]/republish.post.ts apps/cms/server/api/content-entries/content-entries.test.ts
git commit -m "feat(lifecycle): add POST /api/content-entries/[id]/republish"
```

---

### Task 14: Worker — Single Attempt Dispatch

**Files:**

- Create: `apps/cms/server/utils/webhookWorker.ts`
- Create: `apps/cms/server/utils/webhookWorker.test.ts`

The worker is structured as a pure `runWorkerTick(deps)` function that operates on an injected Prisma client and an injected `fetch`. `startWorker` / `stopWorker` wrap it in a `setInterval` and signal handlers — those stay thin and untested.

- [ ] **Step 1: Write failing unit tests**

Create `apps/cms/server/utils/webhookWorker.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { runWorkerTick } from './webhookWorker';

type DeliveryRow = {
  id: string;
  webhookId: string;
  event: 'ENTRY_PUBLISHED' | 'ENTRY_DELETED' | 'ENTRY_UNPUBLISHED';
  contentTypeId: string;
  entryId: string;
  payload: unknown;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'DEAD_LETTERED';
  attempts: number;
  nextAttemptAt: Date | null;
  lastResponseCode: number | null;
  lastResponseBody: string | null;
  lastError: string | null;
  isTest: boolean;
  createdAt: Date;
  completedAt: Date | null;
};
type WebhookRow = { id: string; url: string; secret: string };

function makeFakePrisma(deliveries: DeliveryRow[], webhooks: WebhookRow[]) {
  return {
    $queryRaw: async () =>
      deliveries.filter(
        (d) =>
          d.status === 'PENDING' &&
          (d.nextAttemptAt === null || d.nextAttemptAt <= new Date())
      ),
    webhook: {
      findUnique: async ({ where: { id } }: { where: { id: string } }) =>
        webhooks.find((w) => w.id === id) ?? null,
    },
    webhookDelivery: {
      update: async ({
        where: { id },
        data,
      }: {
        where: { id: string };
        data: Partial<DeliveryRow>;
      }) => {
        const row = deliveries.find((d) => d.id === id)!;
        Object.assign(row, data);
        return row;
      },
    },
  } as const;
}

const baseDelivery: DeliveryRow = {
  id: 'd1',
  webhookId: 'w1',
  event: 'ENTRY_PUBLISHED',
  contentTypeId: 'ct1',
  entryId: 'e1',
  payload: { hello: 'world' },
  status: 'PENDING',
  attempts: 0,
  nextAttemptAt: new Date(0),
  lastResponseCode: null,
  lastResponseBody: null,
  lastError: null,
  isTest: false,
  createdAt: new Date(0),
  completedAt: null,
};

describe('runWorkerTick', () => {
  let deliveries: DeliveryRow[];
  let webhooks: WebhookRow[];

  beforeEach(() => {
    deliveries = [{ ...baseDelivery }];
    webhooks = [{ id: 'w1', url: 'https://example.com/hook', secret: 'sek' }];
  });

  it('marks delivery SUCCESS on 2xx and sets completedAt', async () => {
    const fetchImpl = async () =>
      new Response('ok', { status: 200, statusText: 'OK' });
    const prisma = makeFakePrisma(deliveries, webhooks);
    await runWorkerTick({ prisma, fetch: fetchImpl, now: () => new Date() });

    const row = deliveries[0]!;
    expect(row.status).toBe('SUCCESS');
    expect(row.attempts).toBe(1);
    expect(row.lastResponseCode).toBe(200);
    expect(row.completedAt).toBeInstanceOf(Date);
    expect(row.nextAttemptAt).toBeNull();
  });

  it('reschedules with backoff on 5xx when attempts < MAX', async () => {
    const now = new Date('2026-04-22T12:00:00Z');
    const fetchImpl = async () =>
      new Response('boom', { status: 500, statusText: 'Server Error' });
    const prisma = makeFakePrisma(deliveries, webhooks);
    await runWorkerTick({ prisma, fetch: fetchImpl, now: () => now });

    const row = deliveries[0]!;
    expect(row.status).toBe('PENDING');
    expect(row.attempts).toBe(1);
    expect(row.lastResponseCode).toBe(500);
    expect(row.nextAttemptAt?.getTime()).toBe(now.getTime() + 1_000);
  });

  it('dead-letters after 6 attempts', async () => {
    deliveries[0]!.attempts = 5;
    const fetchImpl = async () =>
      new Response('boom', { status: 500, statusText: 'Server Error' });
    const prisma = makeFakePrisma(deliveries, webhooks);
    await runWorkerTick({ prisma, fetch: fetchImpl, now: () => new Date() });
    expect(deliveries[0]!.status).toBe('DEAD_LETTERED');
    expect(deliveries[0]!.attempts).toBe(6);
  });

  it('captures lastError on transport failure', async () => {
    const fetchImpl = async () => {
      throw new Error('ECONNRESET');
    };
    const prisma = makeFakePrisma(deliveries, webhooks);
    await runWorkerTick({ prisma, fetch: fetchImpl, now: () => new Date() });
    expect(deliveries[0]!.lastError).toBe('ECONNRESET');
    expect(deliveries[0]!.status).toBe('PENDING');
  });

  it('truncates lastResponseBody to 2KB', async () => {
    const big = 'x'.repeat(5_000);
    const fetchImpl = async () => new Response(big, { status: 500 });
    const prisma = makeFakePrisma(deliveries, webhooks);
    await runWorkerTick({ prisma, fetch: fetchImpl, now: () => new Date() });
    expect(deliveries[0]!.lastResponseBody!.length).toBe(2048);
  });

  it('signs the outgoing body with HMAC over "<timestamp>.<body>"', async () => {
    let sentBody = '';
    let sentHeaders: Record<string, string> = {};
    const fetchImpl = async (_url: string, init: RequestInit) => {
      sentBody = init.body as string;
      sentHeaders = init.headers as Record<string, string>;
      return new Response('ok', { status: 200 });
    };
    const prisma = makeFakePrisma(deliveries, webhooks);
    await runWorkerTick({
      prisma,
      fetch: fetchImpl,
      now: () => new Date(1700000000_000),
    });
    expect(sentHeaders['X-Boject-Timestamp']).toBe('1700000000');
    expect(sentHeaders['X-Boject-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(sentBody).toBe(JSON.stringify({ hello: 'world' }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter cms test:run -- server/utils/webhookWorker.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `apps/cms/server/utils/webhookWorker.ts`**

```typescript
import type { PrismaClient, DeliveryStatus, WebhookEvent } from '#prisma';
import { signPayload } from './signPayload';
import { backoffMs, MAX_ATTEMPTS } from './webhookBackoff';

const REQUEST_TIMEOUT_MS = 10_000;
const RESPONSE_BODY_MAX = 2048;

interface DeliveryRow {
  id: string;
  webhookId: string;
  event: WebhookEvent;
  payload: unknown;
  attempts: number;
  status: DeliveryStatus;
}

export interface RunWorkerTickDeps {
  prisma: Pick<PrismaClient, 'webhook' | 'webhookDelivery'> & {
    $queryRaw: (...args: unknown[]) => Promise<DeliveryRow[]>;
  };
  fetch: (
    url: string,
    init: RequestInit & { signal?: AbortSignal }
  ) => Promise<Response>;
  now: () => Date;
  batchSize?: number;
}

const DEFAULT_BATCH = 10;

export async function runWorkerTick(deps: RunWorkerTickDeps): Promise<void> {
  const batchSize = deps.batchSize ?? DEFAULT_BATCH;
  const rows = await selectPending(deps, batchSize);
  for (const row of rows) {
    await dispatch(deps, row);
  }
}

async function selectPending(
  deps: RunWorkerTickDeps,
  batchSize: number
): Promise<DeliveryRow[]> {
  // `FOR UPDATE SKIP LOCKED` is defensive against future multi-worker setups.
  // Use template-string raw SQL; the table name is static so it's safe.
  return deps.prisma.$queryRaw`
    SELECT id, "webhookId", event, payload, attempts, status
    FROM "WebhookDelivery"
    WHERE status = 'PENDING'
      AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= NOW())
    ORDER BY "nextAttemptAt" ASC NULLS FIRST
    LIMIT ${batchSize}
    FOR UPDATE SKIP LOCKED
  `;
}

async function dispatch(
  deps: RunWorkerTickDeps,
  row: DeliveryRow
): Promise<void> {
  const webhook = await deps.prisma.webhook.findUnique({
    where: { id: row.webhookId },
  });
  if (!webhook) {
    await deps.prisma.webhookDelivery.update({
      where: { id: row.id },
      data: {
        status: 'FAILED',
        lastError: 'Webhook no longer exists',
        completedAt: deps.now(),
      },
    });
    return;
  }

  const attempts = row.attempts + 1;
  const now = deps.now();
  const body = JSON.stringify(row.payload);
  const tsSeconds = Math.floor(now.getTime() / 1000);
  const signature = signPayload(webhook.secret, tsSeconds, body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let responseCode: number | null = null;
  let responseBody: string | null = null;
  let transportError: string | null = null;

  try {
    const res = await deps.fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `boject-cms`,
        'X-Boject-Event': row.event,
        'X-Boject-Delivery-Id': row.id,
        'X-Boject-Timestamp': String(tsSeconds),
        'X-Boject-Signature': `sha256=${signature}`,
      },
      body,
      signal: controller.signal,
    });
    responseCode = res.status;
    const text = await res.text();
    responseBody = text.slice(0, RESPONSE_BODY_MAX);
  } catch (err) {
    transportError = (err as Error).message.slice(0, 500);
  } finally {
    clearTimeout(timer);
  }

  const succeeded =
    responseCode !== null && responseCode >= 200 && responseCode < 300;

  if (succeeded) {
    await deps.prisma.webhookDelivery.update({
      where: { id: row.id },
      data: {
        status: 'SUCCESS',
        attempts,
        lastResponseCode: responseCode,
        lastResponseBody: responseBody,
        lastError: null,
        completedAt: now,
        nextAttemptAt: null,
      },
    });
    return;
  }

  const nextDelay = attempts < MAX_ATTEMPTS ? backoffMs(attempts + 1) : null;
  if (nextDelay === null) {
    await deps.prisma.webhookDelivery.update({
      where: { id: row.id },
      data: {
        status: 'DEAD_LETTERED',
        attempts,
        lastResponseCode: responseCode,
        lastResponseBody: responseBody,
        lastError: transportError,
        completedAt: now,
        nextAttemptAt: null,
      },
    });
  } else {
    await deps.prisma.webhookDelivery.update({
      where: { id: row.id },
      data: {
        status: 'PENDING',
        attempts,
        lastResponseCode: responseCode,
        lastResponseBody: responseBody,
        lastError: transportError,
        nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)!),
      },
    });
  }
}

let intervalHandle: NodeJS.Timeout | null = null;

export function startWorker(deps: Omit<RunWorkerTickDeps, 'now'>): void {
  if (intervalHandle) return;
  const fullDeps: RunWorkerTickDeps = { ...deps, now: () => new Date() };
  intervalHandle = setInterval(() => {
    runWorkerTick(fullDeps).catch((err) => {
      console.error('[webhook-worker] tick failed', err);
    });
  }, 1_000);
  intervalHandle.unref?.();
}

export function stopWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
```

Note the backoff semantics:

- `attempts` in the DB row is **pre-increment** (count of prior attempts).
- After dispatch, we have made `attempts = row.attempts + 1` attempts total.
- When a failure occurs, the next delay is `backoffMs(attempts)` — i.e. the
  schedule value indexed by the just-completed attempt count. After attempt 1
  fails, wait 1s; after attempt 2 fails, wait 10s; etc.
- After attempt 6 fails, `attempts === MAX_ATTEMPTS` and we dead-letter.
  (The 6th schedule value `6h` is thus never applied in practice — the
  schedule array is one slot over-specified relative to what code uses.)

Replace the `else` branch of the succeeded-check with:

```typescript
const willRetry = attempts < MAX_ATTEMPTS;
if (!willRetry) {
  await deps.prisma.webhookDelivery.update({
    where: { id: row.id },
    data: {
      status: 'DEAD_LETTERED',
      attempts,
      lastResponseCode: responseCode,
      lastResponseBody: responseBody,
      lastError: transportError,
      completedAt: now,
      nextAttemptAt: null,
    },
  });
} else {
  const delay = backoffMs(attempts)!;
  await deps.prisma.webhookDelivery.update({
    where: { id: row.id },
    data: {
      status: 'PENDING',
      attempts,
      lastResponseCode: responseCode,
      lastResponseBody: responseBody,
      lastError: transportError,
      nextAttemptAt: new Date(now.getTime() + delay),
    },
  });
}
```

(Delete the earlier conflicting block so only this version remains.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter cms test:run -- server/utils/webhookWorker.test.ts`
Expected: all tests pass, including the "1s after first failure" check.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/utils/webhookWorker.ts apps/cms/server/utils/webhookWorker.test.ts
git commit -m "feat(webhooks): add dispatch worker with backoff + dead-lettering"
```

---

### Task 15: Nitro Plugin — Start/Stop Worker

**Files:**

- Create: `apps/cms/server/plugins/webhook-worker.ts`

Nitro plugins under `server/plugins/` auto-register. We start the worker on boot and stop it on shutdown hooks.

- [ ] **Step 1: Create `apps/cms/server/plugins/webhook-worker.ts`**

```typescript
import { startWorker, stopWorker } from '../utils/webhookWorker';

export default defineNitroPlugin((nitroApp) => {
  // The worker uses the singleton `prisma` + global `fetch`.
  startWorker({
    prisma: prisma as never,
    fetch: (url, init) => fetch(url, init as RequestInit),
  });

  nitroApp.hooks.hookOnce('close', () => {
    stopWorker();
  });
});
```

- [ ] **Step 2: Start the dev server and check logs**

Run: `pnpm --filter cms dev`
Manually: visit `http://localhost:4000`, confirm no `[webhook-worker] tick failed` errors in the console during the first 10 seconds. Ctrl-C to stop.

- [ ] **Step 3: Commit**

```bash
git add apps/cms/server/plugins/webhook-worker.ts
git commit -m "feat(webhooks): register background worker as Nitro plugin"
```

---

### Task 16: REST — List + Create + Detail

**Files:**

- Create: `apps/cms/server/api/webhooks.get.ts`
- Create: `apps/cms/server/api/webhooks/index.post.ts`
- Create: `apps/cms/server/api/webhooks/[id].get.ts`
- Create: `apps/cms/server/api/webhooks/webhooks.test.ts`

Conventions:

- Path-param handlers go under `server/api/webhooks/`; the bare-list `GET /api/webhooks` goes to `server/api/webhooks.get.ts` (matches the repo pattern of `content.get.ts`, `content-entries.get.ts`).
- Auth: every route asserts `isCmsRequest(event)` — the session middleware already allows API keys, and we need to exclude them.
- `secret` is returned on `POST` only. `GET` returns without it.

- [ ] **Step 1: Create integration test file skeleton**

Create `apps/cms/server/api/webhooks/webhooks.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { setup, fetch } from '@nuxt/test-utils/e2e';
import { resetRateLimitStore } from '../../utils/rateLimit';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

let _sessionCookie: string | null = null;
async function getSessionCookie(): Promise<string> {
  if (_sessionCookie) return _sessionCookie;
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@example.com',
      password: 'password',
    }),
  });
  _sessionCookie = response.headers.getSetCookie().join('; ');
  return _sessionCookie;
}

describe('Webhooks REST', async () => {
  await setup({ dev: true });
  beforeAll(() => resetRateLimitStore());

  describe('POST /api/webhooks', () => {
    it('creates a webhook and returns the secret exactly once', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name: 'Test 1',
          url: 'https://example.com/a',
          events: ['ENTRY_PUBLISHED'],
          contentTypeIds: [],
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; secret: string };
      expect(body.secret).toMatch(/^[A-Za-z0-9+/=]+$/);
      expect(
        Buffer.from(body.secret, 'base64').byteLength
      ).toBeGreaterThanOrEqual(32);

      const getRes = await fetch(`/api/webhooks/${body.id}`, {
        headers: { Cookie: cookie },
      });
      const detail = (await getRes.json()) as Record<string, unknown>;
      expect(detail.secret).toBeUndefined();
    });

    it('rejects invalid URL', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name: 'bad',
          url: 'not a url',
          events: ['ENTRY_PUBLISHED'],
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects empty events array', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name: 'no events',
          url: 'https://example.com',
          events: [],
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects API-key callers', async () => {
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({
          name: 'apikey',
          url: 'https://example.com',
          events: ['ENTRY_PUBLISHED'],
        }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/webhooks', () => {
    it('returns the list without secrets', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/webhooks', {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: Array<Record<string, unknown>>;
      };
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items.every((i) => i.secret === undefined)).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter cms test:run -- server/api/webhooks/webhooks.test.ts`
Expected: all fail — endpoints missing.

- [ ] **Step 3: Create `apps/cms/server/api/webhooks.get.ts`**

```typescript
import { isCmsRequest } from './utils/resolveVersion';

export default defineEventHandler(async (event) => {
  if (!isCmsRequest(event)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Webhook management requires a CMS session',
    });
  }

  const items = await prisma.webhook.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      url: true,
      enabled: true,
      contentTypeIds: true,
      events: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return { items };
});
```

- [ ] **Step 4: Create `apps/cms/server/api/webhooks/index.post.ts`**

```typescript
import type { WebhookEvent } from '#prisma';
import { isCmsRequest } from '../utils/resolveVersion';
import { enforceMutationRateLimit } from '../utils/rateLimitEndpoint';
import { assertStringLength } from '../utils/validation';
import { assertWebhookUrl } from '../utils/webhookUrl';
import { generateWebhookSecret } from '../utils/webhooks';

const VALID_EVENTS: readonly WebhookEvent[] = [
  'ENTRY_PUBLISHED',
  'ENTRY_UNPUBLISHED',
  'ENTRY_DELETED',
];

export default defineEventHandler(async (event) => {
  if (!isCmsRequest(event)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Webhook management requires a CMS session',
    });
  }
  enforceMutationRateLimit(event, 'webhooks.post');
  const body = await readBody<Record<string, unknown>>(event);

  const name = assertStringLength(body.name, 'name', 200);
  assertWebhookUrl(typeof body.url === 'string' ? body.url : '');
  const url = body.url as string;

  if (!Array.isArray(body.events) || body.events.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'events must be a non-empty array',
    });
  }
  const events = body.events.map((e, i) => {
    if (typeof e !== 'string' || !VALID_EVENTS.includes(e as WebhookEvent)) {
      throw createError({
        statusCode: 400,
        statusMessage: `events[${i}] is not a valid WebhookEvent`,
      });
    }
    return e as WebhookEvent;
  });

  const contentTypeIds = Array.isArray(body.contentTypeIds)
    ? body.contentTypeIds.map((id, i) => {
        if (typeof id !== 'string') {
          throw createError({
            statusCode: 400,
            statusMessage: `contentTypeIds[${i}] must be a string`,
          });
        }
        return id;
      })
    : [];

  const enabled = typeof body.enabled === 'boolean' ? body.enabled : true;
  const secret = generateWebhookSecret();

  const created = await prisma.webhook.create({
    data: { name, url, secret, enabled, contentTypeIds, events },
  });

  setResponseStatus(event, 201);
  return { ...created };
});
```

- [ ] **Step 5: Create `apps/cms/server/api/webhooks/[id].get.ts`**

```typescript
import { assertUuid } from '../utils/validation';
import { isCmsRequest } from '../utils/resolveVersion';

export default defineEventHandler(async (event) => {
  if (!isCmsRequest(event)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Webhook management requires a CMS session',
    });
  }
  const id = assertUuid(getRouterParam(event, 'id'), 'id');
  const webhook = await prisma.webhook.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      url: true,
      enabled: true,
      contentTypeIds: true,
      events: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!webhook) {
    throw createError({ statusCode: 404, statusMessage: 'Webhook not found' });
  }
  return webhook;
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter cms test:run -- server/api/webhooks/webhooks.test.ts`
Expected: all Task 16 tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/cms/server/api/webhooks.get.ts apps/cms/server/api/webhooks/index.post.ts apps/cms/server/api/webhooks/[id].get.ts apps/cms/server/api/webhooks/webhooks.test.ts
git commit -m "feat(webhooks): add REST list/create/detail endpoints"
```

---

### Task 17: REST — Update + Delete

**Files:**

- Create: `apps/cms/server/api/webhooks/[id].put.ts`
- Create: `apps/cms/server/api/webhooks/[id].delete.ts`
- Modify: `apps/cms/server/api/webhooks/webhooks.test.ts`

- [ ] **Step 1: Add failing tests**

Append inside the existing top-level `describe`:

```typescript
describe('PUT /api/webhooks/:id', () => {
  it('updates fields but does not return the secret', async () => {
    const cookie = await getSessionCookie();
    const created = await (
      await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name: 'Upd-1',
          url: 'https://example.com/x',
          events: ['ENTRY_PUBLISHED'],
        }),
      })
    ).json();
    const res = await fetch(`/api/webhooks/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ enabled: false, name: 'Upd-1-renamed' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.secret).toBeUndefined();
    expect(body.enabled).toBe(false);
    expect(body.name).toBe('Upd-1-renamed');
  });
});

describe('DELETE /api/webhooks/:id', () => {
  it('deletes the webhook and cascades deliveries', async () => {
    const cookie = await getSessionCookie();
    const created = await (
      await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name: 'Del-1',
          url: 'https://example.com/x',
          events: ['ENTRY_PUBLISHED'],
        }),
      })
    ).json();
    const res = await fetch(`/api/webhooks/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const getRes = await fetch(`/api/webhooks/${created.id}`, {
      headers: { Cookie: cookie },
    });
    expect(getRes.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failures**

Run: `pnpm --filter cms test:run -- server/api/webhooks/webhooks.test.ts`
Expected: new tests fail.

- [ ] **Step 3: Create `apps/cms/server/api/webhooks/[id].put.ts`**

```typescript
import type { Prisma, WebhookEvent } from '#prisma';
import { assertUuid, assertStringLength } from '../utils/validation';
import { isCmsRequest } from '../utils/resolveVersion';
import { enforceMutationRateLimit } from '../utils/rateLimitEndpoint';
import { assertWebhookUrl } from '../utils/webhookUrl';
import { withPrismaErrors } from '../utils/prismaErrors';

const VALID_EVENTS: readonly WebhookEvent[] = [
  'ENTRY_PUBLISHED',
  'ENTRY_UNPUBLISHED',
  'ENTRY_DELETED',
];

export default defineEventHandler(async (event) => {
  if (!isCmsRequest(event)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }
  enforceMutationRateLimit(event, 'webhooks.put');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');
  const body = await readBody<Record<string, unknown>>(event);

  const data: Prisma.WebhookUpdateInput = {};
  if ('name' in body) {
    data.name = assertStringLength(body.name, 'name', 200);
  }
  if ('url' in body) {
    assertWebhookUrl(typeof body.url === 'string' ? body.url : '');
    data.url = body.url as string;
  }
  if ('enabled' in body) {
    if (typeof body.enabled !== 'boolean') {
      throw createError({
        statusCode: 400,
        statusMessage: 'enabled must be boolean',
      });
    }
    data.enabled = body.enabled;
  }
  if ('events' in body) {
    if (!Array.isArray(body.events) || body.events.length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'events must be a non-empty array',
      });
    }
    data.events = body.events.map((e, i) => {
      if (typeof e !== 'string' || !VALID_EVENTS.includes(e as WebhookEvent)) {
        throw createError({
          statusCode: 400,
          statusMessage: `events[${i}] is not a valid WebhookEvent`,
        });
      }
      return e as WebhookEvent;
    });
  }
  if ('contentTypeIds' in body) {
    if (!Array.isArray(body.contentTypeIds)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'contentTypeIds must be an array',
      });
    }
    data.contentTypeIds = body.contentTypeIds.map((id, i) => {
      if (typeof id !== 'string') {
        throw createError({
          statusCode: 400,
          statusMessage: `contentTypeIds[${i}] must be a string`,
        });
      }
      return id;
    });
  }

  const updated = await withPrismaErrors(
    () =>
      prisma.webhook.update({
        where: { id },
        data,
        select: {
          id: true,
          name: true,
          url: true,
          enabled: true,
          contentTypeIds: true,
          events: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    { notFoundMessage: 'Webhook not found' }
  );
  return updated;
});
```

- [ ] **Step 4: Create `apps/cms/server/api/webhooks/[id].delete.ts`**

```typescript
import { assertUuid } from '../utils/validation';
import { isCmsRequest } from '../utils/resolveVersion';
import { enforceMutationRateLimit } from '../utils/rateLimitEndpoint';
import { withPrismaErrors } from '../utils/prismaErrors';

export default defineEventHandler(async (event) => {
  if (!isCmsRequest(event)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }
  enforceMutationRateLimit(event, 'webhooks.delete');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');

  await withPrismaErrors(() => prisma.webhook.delete({ where: { id } }), {
    notFoundMessage: 'Webhook not found',
  });
  return { success: true };
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter cms test:run -- server/api/webhooks/webhooks.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/cms/server/api/webhooks/[id].put.ts apps/cms/server/api/webhooks/[id].delete.ts apps/cms/server/api/webhooks/webhooks.test.ts
git commit -m "feat(webhooks): add update + delete endpoints"
```

---

### Task 18: REST — Rotate Secret

**Files:**

- Create: `apps/cms/server/api/webhooks/[id]/rotate.post.ts`
- Modify: `apps/cms/server/api/webhooks/webhooks.test.ts`

- [ ] **Step 1: Write failing test**

Append inside the top-level `describe`:

```typescript
describe('POST /api/webhooks/:id/rotate', () => {
  it('rotates the secret and returns the new one once', async () => {
    const cookie = await getSessionCookie();
    const created = (await (
      await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name: 'Rot-1',
          url: 'https://example.com/x',
          events: ['ENTRY_PUBLISHED'],
        }),
      })
    ).json()) as { id: string; secret: string };

    const res = await fetch(`/api/webhooks/${created.id}/rotate`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { secret: string };
    expect(body.secret).not.toBe(created.secret);
    expect(
      Buffer.from(body.secret, 'base64').byteLength
    ).toBeGreaterThanOrEqual(32);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter cms test:run -- server/api/webhooks/webhooks.test.ts`
Expected: new test fails.

- [ ] **Step 3: Create `apps/cms/server/api/webhooks/[id]/rotate.post.ts`**

```typescript
import { assertUuid } from '../../utils/validation';
import { isCmsRequest } from '../../utils/resolveVersion';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';
import { generateWebhookSecret } from '../../utils/webhooks';
import { withPrismaErrors } from '../../utils/prismaErrors';

export default defineEventHandler(async (event) => {
  if (!isCmsRequest(event)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }
  enforceMutationRateLimit(event, 'webhooks.rotate');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');
  const secret = generateWebhookSecret();
  const updated = await withPrismaErrors(
    () =>
      prisma.webhook.update({
        where: { id },
        data: { secret },
      }),
    { notFoundMessage: 'Webhook not found' }
  );
  return { id: updated.id, secret: updated.secret };
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter cms test:run -- server/api/webhooks/webhooks.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/api/webhooks/[id]/rotate.post.ts apps/cms/server/api/webhooks/webhooks.test.ts
git commit -m "feat(webhooks): add secret rotation endpoint"
```

---

### Task 19: REST — Send Test

**Files:**

- Create: `apps/cms/server/api/webhooks/[id]/test.post.ts`
- Modify: `apps/cms/server/api/webhooks/webhooks.test.ts`

Creates a `WebhookDelivery` row flagged `isTest: true` with a stub payload so the worker dispatches it on its next tick.

- [ ] **Step 1: Write failing test**

Append:

```typescript
describe('POST /api/webhooks/:id/test', () => {
  it('enqueues a test delivery row', async () => {
    const cookie = await getSessionCookie();
    const created = (await (
      await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name: 'Test-1',
          url: 'https://example.com/x',
          events: ['ENTRY_PUBLISHED'],
        }),
      })
    ).json()) as { id: string };

    const res = await fetch(`/api/webhooks/${created.id}/test`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      deliveryId: string;
      isTest: boolean;
    };
    expect(body.isTest).toBe(true);

    const listRes = await fetch(`/api/webhooks/${created.id}/deliveries`, {
      headers: { Cookie: cookie },
    });
    const { items } = (await listRes.json()) as {
      items: Array<{ id: string; isTest: boolean }>;
    };
    expect(items.some((i) => i.id === body.deliveryId && i.isTest)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter cms test:run -- server/api/webhooks/webhooks.test.ts`
Expected: fails — endpoint missing.

- [ ] **Step 3: Create `apps/cms/server/api/webhooks/[id]/test.post.ts`**

```typescript
import type { Prisma } from '#prisma';
import { assertUuid } from '../../utils/validation';
import { isCmsRequest } from '../../utils/resolveVersion';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';

export default defineEventHandler(async (event) => {
  if (!isCmsRequest(event)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }
  enforceMutationRateLimit(event, 'webhooks.test');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');

  const webhook = await prisma.webhook.findUnique({ where: { id } });
  if (!webhook) {
    throw createError({ statusCode: 404, statusMessage: 'Webhook not found' });
  }

  const now = new Date();
  const placeholder = await prisma.webhookDelivery.create({
    data: {
      webhookId: webhook.id,
      event: 'ENTRY_PUBLISHED',
      contentTypeId: '00000000-0000-0000-0000-000000000000',
      entryId: '00000000-0000-0000-0000-000000000000',
      payload: {},
      isTest: true,
      status: 'PENDING',
      nextAttemptAt: now,
    },
  });
  const payload = {
    event: 'ENTRY_PUBLISHED' as const,
    deliveryId: placeholder.id,
    timestamp: now.toISOString(),
    test: true,
    message: 'This is a test delivery from boject-cms',
  };
  await prisma.webhookDelivery.update({
    where: { id: placeholder.id },
    data: { payload: payload as unknown as Prisma.InputJsonValue },
  });
  setResponseStatus(event, 201);
  return { deliveryId: placeholder.id, isTest: true };
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter cms test:run -- server/api/webhooks/webhooks.test.ts`
Expected: all pass (including the deliveries list — which is built in Task 20; if running in order, the test depends on Task 20; if needed, re-order or stub).

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/api/webhooks/[id]/test.post.ts apps/cms/server/api/webhooks/webhooks.test.ts
git commit -m "feat(webhooks): add send-test endpoint"
```

---

### Task 20: REST — List Deliveries + Retry

**Files:**

- Create: `apps/cms/server/api/webhooks/[id]/deliveries.get.ts`
- Create: `apps/cms/server/api/webhooks/deliveries/[id]/retry.post.ts`
- Modify: `apps/cms/server/api/webhooks/webhooks.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```typescript
describe('GET /api/webhooks/:id/deliveries', () => {
  it('returns paginated deliveries for a webhook', async () => {
    const cookie = await getSessionCookie();
    const hook = (await (
      await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name: 'D-1',
          url: 'https://example.com/x',
          events: ['ENTRY_PUBLISHED'],
        }),
      })
    ).json()) as { id: string };

    // Trigger a test delivery so we have something in the list.
    await fetch(`/api/webhooks/${hook.id}/test`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });

    const res = await fetch(`/api/webhooks/${hook.id}/deliveries`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ event: string; status: string }>;
      total: number;
    };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.total).toBeGreaterThan(0);
  });
});

describe('POST /api/webhooks/deliveries/:id/retry', () => {
  it('requeues a FAILED / DEAD_LETTERED delivery as a new PENDING row', async () => {
    const cookie = await getSessionCookie();
    const hook = (await (
      await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name: 'R-1',
          url: 'https://example.com/x',
          events: ['ENTRY_PUBLISHED'],
        }),
      })
    ).json()) as { id: string };

    // Insert a DEAD_LETTERED delivery directly in the DB for determinism.
    const dead = await prisma.webhookDelivery.create({
      data: {
        webhookId: hook.id,
        event: 'ENTRY_PUBLISHED',
        contentTypeId: '00000000-0000-0000-0000-000000000000',
        entryId: '00000000-0000-0000-0000-000000000000',
        payload: { reused: true },
        status: 'DEAD_LETTERED',
        attempts: 6,
      },
    });

    const res = await fetch(`/api/webhooks/deliveries/${dead.id}/retry`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(201);
    const { deliveryId } = (await res.json()) as { deliveryId: string };
    expect(deliveryId).not.toBe(dead.id);

    const requeued = await prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
    });
    expect(requeued?.status).toBe('PENDING');
    expect(requeued?.attempts).toBe(0);
    expect((requeued?.payload as { reused: boolean }).reused).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failures**

Run: `pnpm --filter cms test:run -- server/api/webhooks/webhooks.test.ts`

- [ ] **Step 3: Create `apps/cms/server/api/webhooks/[id]/deliveries.get.ts`**

```typescript
import { assertUuid } from '../../utils/validation';
import { isCmsRequest } from '../../utils/resolveVersion';

export default defineEventHandler(async (event) => {
  if (!isCmsRequest(event)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }
  const id = assertUuid(getRouterParam(event, 'id'), 'id');
  const query = getQuery(event);
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20));

  const [items, total] = await Promise.all([
    prisma.webhookDelivery.findMany({
      where: { webhookId: id },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.webhookDelivery.count({ where: { webhookId: id } }),
  ]);
  return { items, total };
});
```

- [ ] **Step 4: Create `apps/cms/server/api/webhooks/deliveries/[id]/retry.post.ts`**

```typescript
import type { Prisma } from '#prisma';
import { assertUuid } from '../../../utils/validation';
import { isCmsRequest } from '../../../utils/resolveVersion';
import { enforceMutationRateLimit } from '../../../utils/rateLimitEndpoint';

export default defineEventHandler(async (event) => {
  if (!isCmsRequest(event)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }
  enforceMutationRateLimit(event, 'webhooks.retry');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');

  const original = await prisma.webhookDelivery.findUnique({ where: { id } });
  if (!original) {
    throw createError({ statusCode: 404, statusMessage: 'Delivery not found' });
  }

  const requeued = await prisma.webhookDelivery.create({
    data: {
      webhookId: original.webhookId,
      event: original.event,
      contentTypeId: original.contentTypeId,
      entryId: original.entryId,
      payload: original.payload as Prisma.InputJsonValue,
      isTest: original.isTest,
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: new Date(),
    },
  });
  setResponseStatus(event, 201);
  return { deliveryId: requeued.id };
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter cms test:run -- server/api/webhooks/webhooks.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/cms/server/api/webhooks/[id]/deliveries.get.ts apps/cms/server/api/webhooks/deliveries/[id]/retry.post.ts apps/cms/server/api/webhooks/webhooks.test.ts
git commit -m "feat(webhooks): add deliveries list and retry endpoints"
```

---

### Task 21: End-to-End Delivery Test (stub HTTP server)

**Files:**

- Create: `apps/cms/server/api/webhooks/webhook-e2e.test.ts`

Full publish → worker → success path against a real HTTP server spun up in the test.

- [ ] **Step 1: Write the e2e test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, fetch } from '@nuxt/test-utils/e2e';
import { createServer, type Server } from 'node:http';
import { createHmac } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { resetRateLimitStore } from '../../utils/rateLimit';

let stubServer: Server;
let received: Array<{ headers: Record<string, string>; body: string }> = [];
let stubUrl = '';

let _sessionCookie: string | null = null;
async function getSessionCookie(): Promise<string> {
  if (_sessionCookie) return _sessionCookie;
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@example.com',
      password: 'password',
    }),
  });
  _sessionCookie = response.headers.getSetCookie().join('; ');
  return _sessionCookie;
}

async function startStub(
  handler: (
    headers: Record<string, string>,
    body: string
  ) => {
    status: number;
    body?: string;
  }
): Promise<string> {
  received = [];
  return new Promise((resolve) => {
    stubServer = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const hdrs: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === 'string') hdrs[k] = v;
        }
        received.push({ headers: hdrs, body: raw });
        const { status, body } = handler(hdrs, raw);
        res.statusCode = status;
        res.end(body ?? '');
      });
    }).listen(0, '127.0.0.1', () => {
      const port = (stubServer.address() as AddressInfo).port;
      resolve(`http://127.0.0.1:${port}/`);
    });
  });
}

describe('Webhook delivery E2E', async () => {
  await setup({ dev: true });
  beforeAll(() => resetRateLimitStore());
  afterAll(() => stubServer?.close());

  it('delivers a published entry to the stub on first try', async () => {
    stubUrl = await startStub(() => ({ status: 200, body: 'ok' }));
    const cookie = await getSessionCookie();
    const hook = (await (
      await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name: 'E2E',
          url: stubUrl,
          events: ['ENTRY_PUBLISHED'],
        }),
      })
    ).json()) as { id: string; secret: string };

    const ct = await prisma.contentType.upsert({
      where: { identifier: 'E2EBlog' },
      update: {},
      create: {
        identifier: 'E2EBlog',
        name: 'E2E Blog',
        fields: {
          create: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              order: 0,
              required: true,
              unique: true,
            },
          ],
        },
      },
    });
    const entry = (await (
      await fetch('/api/content-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title: `E2E ${Date.now()}` },
        }),
      })
    ).json()) as { id: string; data: { title: string } };
    await fetch(`/api/content-entries/${entry.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'PUBLISHED', data: entry.data }),
    });

    // Worker ticks every 1s. Poll for up to 5s.
    const deadline = Date.now() + 5_000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(received.length).toBeGreaterThan(0);

    const delivery = received[0]!;
    expect(delivery.headers['x-boject-event']).toBe('ENTRY_PUBLISHED');
    const timestamp = delivery.headers['x-boject-timestamp'];
    const sigHeader = delivery.headers['x-boject-signature']!;
    const expected = createHmac('sha256', hook.secret)
      .update(`${timestamp}.${delivery.body}`)
      .digest('hex');
    expect(sigHeader).toBe(`sha256=${expected}`);
  });

  it('retries a 500 and eventually succeeds on next attempt', async () => {
    let callCount = 0;
    stubUrl = await startStub(() => {
      callCount += 1;
      return callCount === 1
        ? { status: 500, body: 'boom' }
        : { status: 200, body: 'ok' };
    });
    const cookie = await getSessionCookie();
    const hook = (await (
      await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name: 'E2E retry',
          url: stubUrl,
          events: ['ENTRY_PUBLISHED'],
        }),
      })
    ).json()) as { id: string };

    // Fire a test delivery — faster than publishing another entry.
    await fetch(`/api/webhooks/${hook.id}/test`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });

    // First tick hits, 500; worker schedules retry at now+1s. Second tick succeeds.
    const deadline = Date.now() + 8_000;
    while (callCount < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(callCount).toBeGreaterThanOrEqual(2);

    const row = await prisma.webhookDelivery.findFirst({
      where: { webhookId: hook.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(row?.status).toBe('SUCCESS');
  });
});
```

- [ ] **Step 2: Run the e2e test**

Run: `pnpm --filter cms test:run -- server/api/webhooks/webhook-e2e.test.ts`
Expected: both tests pass (may take 10s+ due to polling).

- [ ] **Step 3: Add lifecycle-event e2e coverage**

Append a third `it(...)` block inside the same `describe('Webhook delivery E2E', …)`:

```typescript
it('delivers ENTRY_UNPUBLISHED end-to-end when an entry is unpublished', async () => {
  const received: Array<{ headers: Record<string, string>; body: string }> = [];
  const localServer = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const hdrs: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') hdrs[k] = v;
      }
      received.push({ headers: hdrs, body: raw });
      res.statusCode = 200;
      res.end('ok');
    });
  });
  await new Promise<void>((r) => localServer.listen(0, '127.0.0.1', () => r()));
  const port = (localServer.address() as AddressInfo).port;
  const stubUrl2 = `http://127.0.0.1:${port}/`;
  try {
    const cookie = await getSessionCookie();
    await (
      await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name: 'E2E unpublish',
          url: stubUrl2,
          events: ['ENTRY_UNPUBLISHED'],
        }),
      })
    ).json();

    const ct = await prisma.contentType.upsert({
      where: { identifier: 'E2EBlog' },
      update: {},
      create: {
        identifier: 'E2EBlog',
        name: 'E2E Blog',
        fields: {
          create: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              order: 0,
              required: true,
              unique: true,
            },
          ],
        },
      },
    });
    const entry = (await (
      await fetch('/api/content-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title: `E2E-unpub ${Date.now()}` },
        }),
      })
    ).json()) as { id: string; data: { title: string } };
    await fetch(`/api/content-entries/${entry.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'PUBLISHED', data: entry.data }),
    });
    await fetch(`/api/content-entries/${entry.id}/unpublish`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });

    const deadline = Date.now() + 5_000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(received.length).toBeGreaterThan(0);
    expect(received[0]!.headers['x-boject-event']).toBe('ENTRY_UNPUBLISHED');
    const parsed = JSON.parse(received[0]!.body) as {
      event: string;
      entry: { data: { title: string }; status: string };
    };
    expect(parsed.event).toBe('ENTRY_UNPUBLISHED');
    expect(parsed.entry.status).toBe('PUBLISHED');
    expect(parsed.entry.data.title).toBe(entry.data.title);
  } finally {
    localServer.close();
  }
});
```

A similar test for `archive` and `republish` follows the same shape — copy the block, change the subscribed event and the action endpoint, adjust the assertion. Keeping all three in the same file so they share the `setup({ dev: true })` bootstrap and the same stub-server utility.

- [ ] **Step 4: Run e2e again**

Run: `pnpm --filter cms test:run -- server/api/webhooks/webhook-e2e.test.ts`
Expected: all lifecycle e2e tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/api/webhooks/webhook-e2e.test.ts
git commit -m "test(webhooks): e2e publish/retry + lifecycle event delivery"
```

---

### Task 22: Daily Cleanup Scheduled Task

**Files:**

- Create: `apps/cms/server/tasks/webhooks-cleanup.ts`
- Modify: `apps/cms/nuxt.config.ts`
- Create: `apps/cms/server/utils/webhookCleanup.ts`
- Create: `apps/cms/server/utils/webhookCleanup.test.ts`

Spec: delete rows where `completedAt < now - 30 days` OR (`status = DEAD_LETTERED` AND `createdAt < now - 30 days`). Tasks run via Nitro scheduled tasks — enable `nitro.experimental.tasks` and register `scheduledTasks`.

- [ ] **Step 1: Write failing unit test for the pure cleanup function**

Create `apps/cms/server/utils/webhookCleanup.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { runCleanup } from './webhookCleanup';

describe('runCleanup', () => {
  const now = new Date('2026-04-22T12:00:00Z');

  type Row = {
    id: string;
    status: string;
    createdAt: Date;
    completedAt: Date | null;
  };

  let rows: Row[];

  beforeEach(() => {
    rows = [
      {
        id: 'old-success',
        status: 'SUCCESS',
        createdAt: new Date('2026-03-01'),
        completedAt: new Date('2026-03-01'),
      },
      {
        id: 'recent-success',
        status: 'SUCCESS',
        createdAt: new Date('2026-04-20'),
        completedAt: new Date('2026-04-20'),
      },
      {
        id: 'old-dead',
        status: 'DEAD_LETTERED',
        createdAt: new Date('2026-02-01'),
        completedAt: null,
      },
      {
        id: 'recent-dead',
        status: 'DEAD_LETTERED',
        createdAt: new Date('2026-04-10'),
        completedAt: null,
      },
    ];
  });

  it('deletes SUCCESS rows older than 30 days by completedAt', async () => {
    const prisma = {
      webhookDelivery: {
        deleteMany: async ({ where }: { where: unknown }) => {
          const before = rows.length;
          rows = rows.filter((r) => !matches(r, where));
          return { count: before - rows.length };
        },
      },
    };
    await runCleanup({ prisma: prisma as never, now: () => now });
    expect(rows.map((r) => r.id).sort()).toEqual(
      ['recent-dead', 'recent-success'].sort()
    );
  });
});

// trivial matcher for the deleteMany call
function matches(
  row: { status: string; createdAt: Date; completedAt: Date | null },
  where: unknown
): boolean {
  const w = where as {
    OR: Array<{
      completedAt?: { lt: Date };
      AND?: Array<{ status?: string; createdAt?: { lt: Date } }>;
    }>;
  };
  return w.OR.some((clause) => {
    if (
      clause.completedAt &&
      row.completedAt &&
      row.completedAt < clause.completedAt.lt
    ) {
      return true;
    }
    if (clause.AND) {
      const [statusClause, dateClause] = clause.AND;
      if (
        row.status === statusClause?.status &&
        dateClause?.createdAt &&
        row.createdAt < dateClause.createdAt.lt
      ) {
        return true;
      }
    }
    return false;
  });
}
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter cms test:run -- server/utils/webhookCleanup.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `apps/cms/server/utils/webhookCleanup.ts`**

```typescript
import type { PrismaClient } from '#prisma';

const RETENTION_DAYS = 30;

export interface CleanupDeps {
  prisma: Pick<PrismaClient, 'webhookDelivery'>;
  now: () => Date;
}

export async function runCleanup(deps: CleanupDeps): Promise<number> {
  const cutoff = new Date(
    deps.now().getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  );
  const result = await deps.prisma.webhookDelivery.deleteMany({
    where: {
      OR: [
        { completedAt: { lt: cutoff } },
        { AND: [{ status: 'DEAD_LETTERED' }, { createdAt: { lt: cutoff } }] },
      ],
    },
  });
  return result.count;
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter cms test:run -- server/utils/webhookCleanup.test.ts`
Expected: pass.

- [ ] **Step 5: Register the Nitro scheduled task**

Create `apps/cms/server/tasks/webhooks-cleanup.ts`:

```typescript
import { runCleanup } from '../utils/webhookCleanup';

export default defineTask({
  meta: {
    name: 'webhooks:cleanup',
    description: 'Prune WebhookDelivery rows older than 30 days',
  },
  async run() {
    const deleted = await runCleanup({
      prisma: prisma as never,
      now: () => new Date(),
    });
    return { result: { deleted } };
  },
});
```

- [ ] **Step 6: Enable scheduled tasks in `apps/cms/nuxt.config.ts`**

Inside the `nitro` block, add (or extend):

```typescript
  nitro: {
    // …existing config…
    experimental: { tasks: true },
    scheduledTasks: {
      '0 3 * * *': ['webhooks:cleanup'],
    },
  },
```

(If `nitro.experimental` already exists, merge these keys rather than replacing.)

- [ ] **Step 7: Smoke-test scheduled tasks**

Run: `pnpm --filter cms dev` and in another shell: `curl http://localhost:4000/_nitro/tasks/webhooks:cleanup` (Nitro exposes a debug trigger in dev). Expect `{"result":{"deleted":<n>}}`.

- [ ] **Step 8: Commit**

```bash
git add apps/cms/server/utils/webhookCleanup.ts apps/cms/server/utils/webhookCleanup.test.ts apps/cms/server/tasks/webhooks-cleanup.ts apps/cms/nuxt.config.ts
git commit -m "feat(webhooks): 30-day delivery log cleanup as Nitro scheduled task"
```

---

### Task 23: UI — Sidebar Nav Entry

**Files:**

- Modify: `apps/cms/layouts/default.vue`

- [ ] **Step 1: Locate the Content Types nav section in `default.vue`**

Read the file; the `UNavigationMenu` contains a static section plus a dynamic "Content Types" list. Add a new static item above the dynamic section:

```vue
{ label: 'Webhooks', icon: 'i-lucide-webhook', to: '/webhooks', }
```

Insert it immediately after the "All Content" item, keeping the `UDivider` between static items and the dynamic types intact.

- [ ] **Step 2: Verify the link renders**

Run `pnpm --filter cms dev`, visit `http://localhost:4000`, confirm a "Webhooks" sidebar link appears and routes to `/webhooks` (will 404 until Task 24).

- [ ] **Step 3: Commit**

```bash
git add apps/cms/layouts/default.vue
git commit -m "feat(webhooks): add Webhooks sidebar nav entry"
```

---

### Task 24: UI — List Page

**Files:**

- Create: `apps/cms/pages/webhooks/index.vue`

- [ ] **Step 1: Create the page**

```vue
<script setup lang="ts">
import { useAuthedFetch } from '~/composables/useAuthedFetch';

interface WebhookListItem {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  contentTypeIds: string[];
  events: string[];
  createdAt: string;
  updatedAt: string;
}

const { data } = await useAuthedFetch<{ items: WebhookListItem[] }>(
  '/api/webhooks'
);

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'url', header: 'URL' },
  { accessorKey: 'events', header: 'Events' },
  { accessorKey: 'enabled', header: 'Status' },
];
</script>

<template>
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-semibold">Webhooks</h1>
    <UButton to="/webhooks/new" icon="i-lucide-plus">New webhook</UButton>
  </div>

  <UTable :data="data?.items ?? []" :columns="columns">
    <template #name-cell="{ row }">
      <NuxtLink :to="`/webhooks/${row.original.id}`" class="font-medium">
        {{ row.original.name }}
      </NuxtLink>
    </template>
    <template #url-cell="{ row }">
      <code class="text-xs">{{ row.original.url }}</code>
    </template>
    <template #events-cell="{ row }">
      <div class="flex flex-wrap gap-1">
        <UBadge v-for="e in row.original.events" :key="e" color="neutral">{{
          e
        }}</UBadge>
      </div>
    </template>
    <template #enabled-cell="{ row }">
      <UBadge :color="row.original.enabled ? 'success' : 'neutral'">
        {{ row.original.enabled ? 'Enabled' : 'Disabled' }}
      </UBadge>
    </template>
  </UTable>
</template>
```

- [ ] **Step 2: Verify manually**

Start dev server; visit `/webhooks`. With no hooks yet you should see an empty table and a "New webhook" button.

- [ ] **Step 3: Commit**

```bash
git add apps/cms/pages/webhooks/index.vue
git commit -m "feat(webhooks): add list page"
```

---

### Task 25: UI — Reusable Secret Reveal Panel

**Files:**

- Create: `apps/cms/components/webhook-secret-reveal/WebhookSecretReveal.vue`
- Create: `apps/cms/components/webhook-secret-reveal/webhookSecretReveal.config.ts`
- Create: `apps/cms/components/webhook-secret-reveal/webhookSecretReveal.types.ts`

- [ ] **Step 1: Create types**

`webhookSecretReveal.types.ts`:

```typescript
import type { BasicComponentProps } from '~/types/basicComponentProps';

export interface WebhookSecretRevealProps extends BasicComponentProps {
  secret: string;
}
```

- [ ] **Step 2: Create config**

`webhookSecretReveal.config.ts`:

```typescript
import { testIds } from '~/utils/test-config/testConfig.utils';

export const QA_WEBHOOK_SECRET_REVEAL = testIds('webhookSecretReveal', [
  'container',
  'secret',
  'copy',
]);
```

- [ ] **Step 3: Create component**

`WebhookSecretReveal.vue`:

```vue
<script setup lang="ts">
import type { WebhookSecretRevealProps } from './webhookSecretReveal.types';
import { QA_WEBHOOK_SECRET_REVEAL } from './webhookSecretReveal.config';

const props = defineProps<WebhookSecretRevealProps>();

async function copy() {
  await navigator.clipboard.writeText(props.secret);
}
</script>

<template>
  <div
    :data-testid="QA_WEBHOOK_SECRET_REVEAL.container"
    class="border border-warning-500/50 bg-warning-50 dark:bg-warning-950/40 rounded-md p-4 mb-6"
  >
    <p class="font-medium mb-2">Your webhook secret</p>
    <p class="text-sm mb-3 text-neutral-700 dark:text-neutral-300">
      Copy and store this now — it will never be shown again. Use it to verify
      the <code>X-Boject-Signature</code> header on incoming requests.
    </p>
    <div class="flex items-center gap-2">
      <code
        :data-testid="QA_WEBHOOK_SECRET_REVEAL.secret"
        class="flex-1 break-all rounded bg-neutral-100 dark:bg-neutral-900 px-3 py-2 text-xs"
        >{{ secret }}</code
      >
      <UButton
        :data-testid="QA_WEBHOOK_SECRET_REVEAL.copy"
        icon="i-lucide-copy"
        color="neutral"
        variant="subtle"
        @click="copy"
        >Copy</UButton
      >
    </div>
  </div>
</template>
```

- [ ] **Step 4: Commit**

```bash
git add apps/cms/components/webhook-secret-reveal
git commit -m "feat(webhooks): add reusable one-time secret reveal panel"
```

---

### Task 26: UI — Create Page

**Files:**

- Create: `apps/cms/pages/webhooks/new.vue`

- [ ] **Step 1: Create the page**

```vue
<script setup lang="ts">
import { ref } from 'vue';

interface ContentTypeOption {
  id: string;
  name: string;
  identifier: string;
}

interface CreatedWebhook {
  id: string;
  secret: string;
}

const { data: contentTypes } = await useAuthedFetch<{
  items: ContentTypeOption[];
}>('/api/content-types');

const form = ref({
  name: '',
  url: '',
  enabled: true,
  contentTypeIds: [] as string[],
  events: ['ENTRY_PUBLISHED'] as string[],
});
const created = ref<CreatedWebhook | null>(null);
const error = ref<string | null>(null);
const submitting = ref(false);

async function onSubmit() {
  error.value = null;
  submitting.value = true;
  try {
    const res = await $fetch<CreatedWebhook>('/api/webhooks', {
      method: 'POST',
      body: form.value,
    });
    created.value = res;
  } catch (err) {
    error.value = (err as { statusMessage?: string }).statusMessage ?? 'Failed';
  } finally {
    submitting.value = false;
  }
}

const EVENTS = [
  { value: 'ENTRY_PUBLISHED', label: 'Entry published' },
  { value: 'ENTRY_UNPUBLISHED', label: 'Entry unpublished' },
  { value: 'ENTRY_DELETED', label: 'Entry deleted' },
];
</script>

<template>
  <div class="max-w-2xl">
    <h1 class="text-2xl font-semibold mb-6">New webhook</h1>

    <WebhookSecretReveal v-if="created" :secret="created.secret" />
    <div v-if="created" class="mb-6">
      <UButton :to="`/webhooks/${created.id}`">Go to webhook</UButton>
    </div>

    <UForm v-if="!created" :state="form" @submit="onSubmit">
      <UFormField label="Name" name="name" class="mb-4">
        <UInput v-model="form.name" required />
      </UFormField>
      <UFormField label="URL" name="url" class="mb-4">
        <UInput v-model="form.url" placeholder="https://…" required />
      </UFormField>

      <UFormField label="Content types" class="mb-4">
        <USelectMenu
          v-model="form.contentTypeIds"
          multiple
          :items="
            (contentTypes?.items ?? []).map((c) => ({
              label: c.name,
              value: c.id,
            }))
          "
          value-key="value"
          placeholder="All content types"
        />
        <template #help>Leave empty to match every content type.</template>
      </UFormField>

      <UFormField label="Events" class="mb-4">
        <div class="flex flex-col gap-2">
          <UCheckbox
            v-for="ev in EVENTS"
            :key="ev.value"
            :model-value="form.events.includes(ev.value)"
            :label="ev.label"
            @update:model-value="
              (v) => {
                form.events = v
                  ? [...form.events, ev.value]
                  : form.events.filter((e) => e !== ev.value);
              }
            "
          />
        </div>
      </UFormField>

      <UFormField class="mb-6">
        <UCheckbox v-model="form.enabled" label="Enabled" />
      </UFormField>

      <UAlert v-if="error" color="error" :title="error" class="mb-4" />
      <UButton type="submit" :loading="submitting">Create webhook</UButton>
    </UForm>
  </div>
</template>
```

- [ ] **Step 2: Manual verify**

Create one webhook through the UI with `https://example.com/hook`, confirm the secret panel appears once, click "Go to webhook" — it 404s until Task 27 (acceptable).

- [ ] **Step 3: Commit**

```bash
git add apps/cms/pages/webhooks/new.vue
git commit -m "feat(webhooks): add create page with one-time secret reveal"
```

---

### Task 27: UI — Detail / Edit Page with Delivery Log

**Files:**

- Create: `apps/cms/pages/webhooks/[id].vue`

This page is intentionally larger — it owns the edit form, rotate secret, send test, delivery log, and retry actions. We still keep it under ~250 lines by delegating the secret reveal to the component built in Task 25.

- [ ] **Step 1: Create the page**

```vue
<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthedFetch } from '~/composables/useAuthedFetch';

interface Webhook {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  contentTypeIds: string[];
  events: string[];
  createdAt: string;
  updatedAt: string;
}

interface Delivery {
  id: string;
  event: string;
  entryId: string;
  status: string;
  attempts: number;
  lastResponseCode: number | null;
  lastResponseBody: string | null;
  lastError: string | null;
  isTest: boolean;
  createdAt: string;
  completedAt: string | null;
  payload: unknown;
}

const route = useRoute();
const id = route.params.id as string;

const { data, refresh } = await useAuthedFetch<Webhook>(`/api/webhooks/${id}`);
const { data: deliveriesData, refresh: refreshDeliveries } =
  await useAuthedFetch<{
    items: Delivery[];
  }>(`/api/webhooks/${id}/deliveries?perPage=100`);

const { data: contentTypes } = await useAuthedFetch<{
  items: Array<{ id: string; name: string }>;
}>('/api/content-types');

const rotatedSecret = ref<string | null>(null);
const saving = ref(false);
const expanded = ref<string | null>(null);

async function save() {
  saving.value = true;
  await $fetch(`/api/webhooks/${id}`, {
    method: 'PUT',
    body: {
      name: data.value!.name,
      url: data.value!.url,
      enabled: data.value!.enabled,
      events: data.value!.events,
      contentTypeIds: data.value!.contentTypeIds,
    },
  });
  saving.value = false;
  await refresh();
}

async function rotate() {
  if (
    !confirm('Rotate the secret? The old secret will stop working immediately.')
  )
    return;
  const res = await $fetch<{ secret: string }>(`/api/webhooks/${id}/rotate`, {
    method: 'POST',
  });
  rotatedSecret.value = res.secret;
}

async function sendTest() {
  await $fetch(`/api/webhooks/${id}/test`, { method: 'POST' });
  await refreshDeliveries();
}

async function retry(deliveryId: string) {
  await $fetch(`/api/webhooks/deliveries/${deliveryId}/retry`, {
    method: 'POST',
  });
  await refreshDeliveries();
}

async function deleteWebhook() {
  if (!confirm('Delete this webhook and its delivery log?')) return;
  await $fetch(`/api/webhooks/${id}`, { method: 'DELETE' });
  navigateTo('/webhooks');
}

const EVENTS = ['ENTRY_PUBLISHED', 'ENTRY_UNPUBLISHED', 'ENTRY_DELETED'];
const statusColor = (s: string) =>
  s === 'SUCCESS'
    ? 'success'
    : s === 'FAILED'
      ? 'error'
      : s === 'DEAD_LETTERED'
        ? 'error'
        : 'neutral';
</script>

<template>
  <div v-if="data" class="max-w-4xl">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-semibold">{{ data.name }}</h1>
      <div class="flex gap-2">
        <UButton variant="subtle" @click="sendTest">Send test payload</UButton>
        <UButton variant="subtle" color="warning" @click="rotate"
          >Rotate secret</UButton
        >
      </div>
    </div>

    <WebhookSecretReveal
      v-if="rotatedSecret"
      :secret="rotatedSecret"
      class="mb-6"
    />

    <UForm :state="data" @submit="save" class="mb-10">
      <UFormField label="Name" class="mb-4">
        <UInput v-model="data.name" />
      </UFormField>
      <UFormField label="URL" class="mb-4">
        <UInput v-model="data.url" />
      </UFormField>
      <UFormField label="Content types" class="mb-4">
        <USelectMenu
          v-model="data.contentTypeIds"
          multiple
          :items="
            (contentTypes?.items ?? []).map((c) => ({
              label: c.name,
              value: c.id,
            }))
          "
          value-key="value"
        />
      </UFormField>
      <UFormField label="Events" class="mb-4">
        <div class="flex flex-col gap-2">
          <UCheckbox
            v-for="ev in EVENTS"
            :key="ev"
            :model-value="data.events.includes(ev)"
            :label="ev"
            @update:model-value="
              (v) => {
                data!.events = v
                  ? [...data!.events, ev]
                  : data!.events.filter((e) => e !== ev);
              }
            "
          />
        </div>
      </UFormField>
      <UFormField class="mb-6">
        <UCheckbox v-model="data.enabled" label="Enabled" />
      </UFormField>
      <UButton type="submit" :loading="saving">Save changes</UButton>
    </UForm>

    <h2 class="text-xl font-semibold mb-3">Delivery log</h2>
    <UTable
      :data="deliveriesData?.items ?? []"
      :columns="[
        { accessorKey: 'createdAt', header: 'When' },
        { accessorKey: 'event', header: 'Event' },
        { accessorKey: 'status', header: 'Status' },
        { accessorKey: 'attempts', header: 'Attempts' },
        { accessorKey: 'actions', header: '' },
      ]"
    >
      <template #createdAt-cell="{ row }">
        <time :title="row.original.createdAt">{{
          new Date(row.original.createdAt).toLocaleString()
        }}</time>
      </template>
      <template #status-cell="{ row }">
        <UBadge :color="statusColor(row.original.status)">{{
          row.original.status
        }}</UBadge>
        <UBadge v-if="row.original.isTest" color="info" class="ml-1"
          >TEST</UBadge
        >
      </template>
      <template #actions-cell="{ row }">
        <div class="flex gap-1">
          <UButton
            size="xs"
            variant="ghost"
            @click="
              expanded = expanded === row.original.id ? null : row.original.id
            "
            >{{ expanded === row.original.id ? 'Hide' : 'Show' }}</UButton
          >
          <UButton
            v-if="
              row.original.status === 'FAILED' ||
              row.original.status === 'DEAD_LETTERED'
            "
            size="xs"
            variant="subtle"
            @click="retry(row.original.id)"
            >Retry</UButton
          >
        </div>
      </template>
    </UTable>

    <div
      v-for="d in deliveriesData?.items ?? []"
      :key="d.id"
      v-show="expanded === d.id"
      class="mt-4 border rounded p-4 text-xs"
    >
      <div class="font-semibold mb-1">Response</div>
      <pre class="mb-3"
        >{{ d.lastResponseCode ?? 'no response' }} {{
          d.lastError ?? d.lastResponseBody ?? ''
        }}</pre
      >
      <div class="font-semibold mb-1">Payload</div>
      <pre>{{ JSON.stringify(d.payload, null, 2) }}</pre>
    </div>

    <div class="mt-12 border-t pt-6">
      <h2 class="text-sm font-semibold text-error-600 mb-2">Danger zone</h2>
      <UButton color="error" variant="subtle" @click="deleteWebhook"
        >Delete webhook</UButton
      >
    </div>
  </div>
</template>
```

- [ ] **Step 2: Manual verify**

Run `pnpm --filter cms dev`. Create a webhook pointing at `https://example.com/hook`, visit its detail page, click "Send test payload", confirm the delivery appears in the log. Click Retry on a failed row and confirm a new row is created.

- [ ] **Step 3: Commit**

```bash
git add apps/cms/pages/webhooks/[id].vue
git commit -m "feat(webhooks): add detail page with delivery log, rotate, test, retry"
```

---

### Task 28: Entry Action Overflow Menu

**Files:**

- Create: `apps/cms/components/entry-action-menu/EntryActionMenu.vue`
- Create: `apps/cms/components/entry-action-menu/entryActionMenu.types.ts`
- Create: `apps/cms/components/entry-action-menu/entryActionMenu.config.ts`
- Modify: `apps/cms/components/entry-sidebar/EntrySidebar.vue`
- Modify: `apps/cms/components/entry-sidebar/entrySidebar.types.ts`

Menu item visibility rules (from the entry-lifecycle spec):

| Item      | Visible when                    | Confirmation                                                         |
| --------- | ------------------------------- | -------------------------------------------------------------------- |
| Unpublish | entry has a `PUBLISHED` version | inline two-step click (dropdown item shows "Click again to confirm") |
| Republish | entry has a `PUBLISHED` version | none                                                                 |
| Archive   | entry has a `PUBLISHED` version | modal with inline 409 `DRAFT_PRESENT` fallback                       |
| Unarchive | entry has an `ARCHIVED` version | none                                                                 |
| Delete    | always                          | modal (unchanged)                                                    |

- [ ] **Step 1: Create the types file**

`apps/cms/components/entry-action-menu/entryActionMenu.types.ts`:

```typescript
import type { BasicComponentProps } from '~/types/basicComponentProps';

export interface EntryActionMenuProps extends BasicComponentProps {
  hasPublishedVersion: boolean;
  hasArchivedVersion: boolean;
}

export type EntryAction =
  | 'unpublish'
  | 'republish'
  | 'archive'
  | 'unarchive'
  | 'delete';
```

- [ ] **Step 2: Create the config file**

`apps/cms/components/entry-action-menu/entryActionMenu.config.ts`:

```typescript
import { testIds } from '~/utils/test-config/testConfig.utils';

export const QA_ENTRY_ACTION_MENU = testIds('entryActionMenu', [
  'trigger',
  'unpublish',
  'republish',
  'archive',
  'unarchive',
  'delete',
  'archiveModal',
  'archiveConfirm',
  'archiveCancel',
]);
```

- [ ] **Step 3: Create the component**

`apps/cms/components/entry-action-menu/EntryActionMenu.vue`:

```vue
<script setup lang="ts">
import { ref, computed } from 'vue';
import type {
  EntryActionMenuProps,
  EntryAction,
} from './entryActionMenu.types';
import { QA_ENTRY_ACTION_MENU } from './entryActionMenu.config';

const props = defineProps<EntryActionMenuProps>();
const emit = defineEmits<{
  (e: 'action', action: EntryAction): void;
}>();

const unpublishConfirmPending = ref(false);
const archiveModalOpen = ref(false);
const archiveError = ref<string | null>(null);
const archiveLoading = ref(false);

const items = computed(() => {
  const list: Array<{
    action: EntryAction;
    label: string;
    icon: string;
    destructive?: boolean;
  }> = [];
  if (props.hasPublishedVersion) {
    list.push(
      { action: 'unpublish', label: 'Unpublish', icon: 'i-lucide-eye-off' },
      { action: 'republish', label: 'Republish', icon: 'i-lucide-refresh-cw' },
      { action: 'archive', label: 'Archive', icon: 'i-lucide-archive' }
    );
  }
  if (props.hasArchivedVersion) {
    list.push({
      action: 'unarchive',
      label: 'Unarchive',
      icon: 'i-lucide-archive-restore',
    });
  }
  list.push({
    action: 'delete',
    label: 'Delete',
    icon: 'i-lucide-trash-2',
    destructive: true,
  });
  return list;
});

function handleClick(action: EntryAction) {
  if (action === 'unpublish') {
    if (!unpublishConfirmPending.value) {
      unpublishConfirmPending.value = true;
      setTimeout(() => (unpublishConfirmPending.value = false), 3_000);
      return;
    }
    unpublishConfirmPending.value = false;
    emit('action', 'unpublish');
    return;
  }
  if (action === 'archive') {
    archiveModalOpen.value = true;
    archiveError.value = null;
    return;
  }
  emit('action', action);
}

async function confirmArchive() {
  archiveLoading.value = true;
  archiveError.value = null;
  try {
    emit('action', 'archive');
    archiveModalOpen.value = false;
  } catch (err) {
    const e = err as {
      data?: { data?: { error?: string } };
      statusMessage?: string;
    };
    if (e.data?.data?.error === 'DRAFT_PRESENT') {
      archiveError.value =
        'Publish or discard your draft before archiving this entry.';
    } else {
      archiveError.value = e.statusMessage ?? 'Archive failed.';
    }
  } finally {
    archiveLoading.value = false;
  }
}

defineExpose({ setArchiveError: (msg: string) => (archiveError.value = msg) });
</script>

<template>
  <UDropdownMenu
    :items="[
      items.map((i) => ({
        label:
          i.action === 'unpublish' && unpublishConfirmPending
            ? 'Click again to confirm'
            : i.label,
        icon: i.icon,
        color: i.destructive ? 'error' : undefined,
        onSelect: () => handleClick(i.action),
      })),
    ]"
    :data-testid="QA_ENTRY_ACTION_MENU.trigger"
  >
    <UButton icon="i-lucide-more-horizontal" color="neutral" variant="ghost" />
  </UDropdownMenu>

  <UModal v-model:open="archiveModalOpen">
    <template #content>
      <div class="p-6 max-w-md">
        <h3 class="text-lg font-semibold mb-2">Archive this entry?</h3>
        <p class="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
          Archived entries are hidden from lists and pickers. You can unarchive
          later.
        </p>
        <UAlert
          v-if="archiveError"
          color="error"
          :title="archiveError"
          class="mb-4"
        />
        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="subtle"
            :data-testid="QA_ENTRY_ACTION_MENU.archiveCancel"
            @click="archiveModalOpen = false"
            >Cancel</UButton
          >
          <UButton
            color="warning"
            :loading="archiveLoading"
            :data-testid="QA_ENTRY_ACTION_MENU.archiveConfirm"
            @click="confirmArchive"
            >Archive</UButton
          >
        </div>
      </div>
    </template>
  </UModal>
</template>
```

- [ ] **Step 4: Wire the menu into `EntrySidebar.vue`**

Add to `entrySidebar.types.ts` a `hasArchivedVersion` prop alongside `hasPublishedVersion`. In `EntrySidebar.vue`, render `<EntryActionMenu>` next to the Publish / Save Draft / Discard Changes button stack and forward its `@action` event up:

```vue
<EntryActionMenu
  :has-published-version="hasPublishedVersion"
  :has-archived-version="hasArchivedVersion"
  @action="onAction"
/>
```

Expose an `onAction(action)` prop on `EntrySidebar` that the catch-all pane page implements, calling the matching `$fetch('/api/content-entries/:id/<action>')` and refreshing the entry state.

- [ ] **Step 5: Manual smoke**

Run `pnpm --filter cms dev`. Publish an entry, confirm the overflow menu shows Unpublish / Republish / Archive / Delete. Archive it, confirm the menu now shows Unarchive / Delete. Try Archive with a CHANGED draft pending and confirm the modal surfaces `DRAFT_PRESENT`.

- [ ] **Step 6: Commit**

```bash
git add apps/cms/components/entry-action-menu apps/cms/components/entry-sidebar
git commit -m "feat(lifecycle): add entry overflow action menu"
```

---

### Task 29: List-Page Archive Filter Chip

**Files:**

- Modify: `apps/cms/server/api/content-entries.get.ts` — accept `archiveFilter` query param
- Modify: `apps/cms/server/api/content.get.ts` — same param on the unified list
- Modify: `apps/cms/pages/content-types/[id]/entries/index.vue`
- Modify: `apps/cms/pages/index.vue` (All Content)
- Modify: `apps/cms/components/content-table/ContentTable.vue` — add `ARCHIVED` badge styling via `useContentTable`
- Modify: `apps/cms/composables/useContentTable.ts`
- Modify: `apps/cms/server/api/content-entries/content-entries.test.ts`

Server param: `archiveFilter=active|archived|all`. Default `active`. `active` and `all` keep the existing `isCms` / status-filter logic; `archived` returns entries whose latest version is `ARCHIVED`.

- [ ] **Step 1: Add failing test for the server param**

In `content-entries.test.ts`, inside the existing describe:

```typescript
describe('GET /api/content-entries archiveFilter', () => {
  it('excludes archived entries by default (archiveFilter=active)', async () => {
    const cookie = await getSessionCookie();
    const ct = await ensureBlogContentType();
    const live = (await (
      await fetch('/api/content-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title: `Live ${Date.now()}` },
        }),
      })
    ).json()) as { id: string; data: { title: string } };
    await fetch(`/api/content-entries/${live.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'PUBLISHED', data: live.data }),
    });

    const archived = (await (
      await fetch('/api/content-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title: `Arc ${Date.now()}` },
        }),
      })
    ).json()) as { id: string; data: { title: string } };
    await fetch(`/api/content-entries/${archived.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'PUBLISHED', data: archived.data }),
    });
    await fetch(`/api/content-entries/${archived.id}/archive`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });

    const defaultList = (await (
      await fetch(`/api/content-entries?contentTypeId=${ct.id}`, {
        headers: { Cookie: cookie },
      })
    ).json()) as { items: Array<{ id: string }> };
    expect(defaultList.items.some((i) => i.id === archived.id)).toBe(false);
    expect(defaultList.items.some((i) => i.id === live.id)).toBe(true);

    const archivedList = (await (
      await fetch(
        `/api/content-entries?contentTypeId=${ct.id}&archiveFilter=archived`,
        { headers: { Cookie: cookie } }
      )
    ).json()) as { items: Array<{ id: string }> };
    expect(archivedList.items.some((i) => i.id === archived.id)).toBe(true);
    expect(archivedList.items.some((i) => i.id === live.id)).toBe(false);

    const allList = (await (
      await fetch(
        `/api/content-entries?contentTypeId=${ct.id}&archiveFilter=all`,
        { headers: { Cookie: cookie } }
      )
    ).json()) as { items: Array<{ id: string }> };
    expect(allList.items.some((i) => i.id === archived.id)).toBe(true);
    expect(allList.items.some((i) => i.id === live.id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter cms test:run -- server/api/content-entries/content-entries.test.ts`

- [ ] **Step 3: Implement the `archiveFilter` param in `content-entries.get.ts`**

Modify `apps/cms/server/api/content-entries.get.ts`. Add immediately after the existing `isCms` and `where` setup:

```typescript
const archiveFilter =
  typeof query.archiveFilter === 'string' &&
  ['active', 'archived', 'all'].includes(query.archiveFilter)
    ? (query.archiveFilter as 'active' | 'archived' | 'all')
    : 'active';

if (isCms) {
  if (archiveFilter === 'archived') {
    where.versions = { some: { status: 'ARCHIVED' } };
  } else if (archiveFilter === 'active') {
    where.versions = { none: { status: 'ARCHIVED' } };
  }
  // 'all': leave `where.versions` alone (may still have status filter)
} else {
  // API key: never shows archived; existing PUBLISHED filter already excludes them
}
```

Make the same change in `apps/cms/server/api/content.get.ts` (the unified list).

For `archived` mode, the version-resolution in the CMS branch needs to pick the ARCHIVED version as the display version. Update `getVersionForContext` to accept an explicit hint, or in the handler post-process: if `archiveFilter === 'archived'`, pick the `ARCHIVED` version; otherwise use `getVersionForContext`.

Simplest: inline branch in the `.map`:

```typescript
const items = entries
  .map((entry) => {
    let version: ContentEntryVersion | undefined;
    if (isCms && archiveFilter === 'archived') {
      version = entry.versions.find((v) => v.status === 'ARCHIVED');
    } else {
      version = getVersionForContext(entry.versions, isCms) ?? undefined;
    }
    if (!version) return null;
    return flattenEntryWithVersion(entry, version);
  })
  .filter((item): item is NonNullable<typeof item> => item !== null);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter cms test:run -- server/api/content-entries/content-entries.test.ts`
Expected: all archiveFilter tests pass.

- [ ] **Step 5: Add the filter chip to the list pages**

In `apps/cms/pages/content-types/[id]/entries/index.vue`, above the `ContentTable`, add a chip row:

```vue
<script setup lang="ts">
import { ref, watch } from 'vue';

const archiveFilter = ref<'active' | 'archived' | 'all'>('active');

const { data, refresh } = await useAuthedFetch(
  () =>
    `/api/content-entries?contentTypeId=${contentTypeId}&archiveFilter=${archiveFilter.value}`
);
watch(archiveFilter, () => refresh());
</script>

<template>
  <div class="flex gap-2 mb-4">
    <UButton
      :color="archiveFilter === 'active' ? 'primary' : 'neutral'"
      variant="subtle"
      size="xs"
      @click="archiveFilter = 'active'"
      >Active</UButton
    >
    <UButton
      :color="archiveFilter === 'archived' ? 'primary' : 'neutral'"
      variant="subtle"
      size="xs"
      @click="archiveFilter = 'archived'"
      >Archived</UButton
    >
    <UButton
      :color="archiveFilter === 'all' ? 'primary' : 'neutral'"
      variant="subtle"
      size="xs"
      @click="archiveFilter = 'all'"
      >All</UButton
    >
  </div>
  <ContentTable … />
</template>
```

Mirror the same in `apps/cms/pages/index.vue` (All Content).

- [ ] **Step 6: Add `ARCHIVED` status badge styling**

In `apps/cms/composables/useContentTable.ts`, update `statusColor`:

```typescript
export function useContentTable() {
  function statusColor(status: string) {
    switch (status) {
      case 'PUBLISHED':
        return 'success';
      case 'CHANGED':
        return 'warning';
      case 'ARCHIVED':
        return 'neutral';
      case 'DRAFT':
      default:
        return 'neutral';
    }
  }
  // …existing formatDate, etc.
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/cms/server/api/content-entries.get.ts apps/cms/server/api/content.get.ts apps/cms/server/api/content-entries/content-entries.test.ts apps/cms/pages/content-types apps/cms/pages/index.vue apps/cms/composables/useContentTable.ts
git commit -m "feat(lifecycle): add archive filter chip + ARCHIVED badge styling"
```

---

### Task 30: Entry Picker Archive Filter

**Files:**

- Modify: `apps/cms/components/entry-picker-modal/EntryPickerModal.vue`
- Modify: `apps/cms/server/api/content-entries/content-entries.test.ts`

Archived entries must never appear in the relation picker. The cleanest implementation is to have `EntryPickerModal` request the list with `archiveFilter=active`.

- [ ] **Step 1: Add failing test**

Append to `content-entries.test.ts`:

```typescript
describe('Relation picker archive exclusion', () => {
  it('archived entries do not appear in the picker list (archiveFilter=active)', async () => {
    const cookie = await getSessionCookie();
    const ct = await ensureBlogContentType();
    const target = (await (
      await fetch('/api/content-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          contentTypeId: ct.id,
          data: { title: `Picker target ${Date.now()}` },
        }),
      })
    ).json()) as { id: string; data: { title: string } };
    await fetch(`/api/content-entries/${target.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'PUBLISHED', data: target.data }),
    });
    await fetch(`/api/content-entries/${target.id}/archive`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });

    const res = await fetch(
      `/api/content-entries?contentTypeId=${ct.id}&archiveFilter=active`,
      { headers: { Cookie: cookie } }
    );
    const body = (await res.json()) as { items: Array<{ id: string }> };
    expect(body.items.some((i) => i.id === target.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter cms test:run -- server/api/content-entries/content-entries.test.ts`
Expected: the new test passes already (Task 29 implemented the server-side filter).

- [ ] **Step 3: Update `EntryPickerModal.vue`'s list fetch to pass `archiveFilter=active`**

Find the `useAuthedFetch` or `$fetch` call that loads entries inside the picker; append `&archiveFilter=active` to the URL. If the picker uses a dedicated endpoint, add the param there too.

Search pattern to locate the fetch (read the file first):

```bash
grep -n "content-entries" apps/cms/components/entry-picker-modal/EntryPickerModal.vue
```

Update each matching URL to include `archiveFilter=active`.

- [ ] **Step 4: Manual verify**

Run `pnpm --filter cms dev`. Open a parent entry that has a RELATION field. Click "Add entry" — the picker should list active entries. Open a second tab, archive one of the candidate entries via `/api/content-entries/:id/archive`. Return to the first tab, reopen the picker; the archived entry should no longer appear.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/components/entry-picker-modal/EntryPickerModal.vue apps/cms/server/api/content-entries/content-entries.test.ts
git commit -m "feat(lifecycle): exclude archived entries from the relation picker"
```

---

### Task 31: CLAUDE.md Documentation

**Files:**

- Modify: `apps/cms/CLAUDE.md`

- [ ] **Step 1: Add Architecture bullets**

Under the Architecture section (after "Mutation rate limiting"), add:

```markdown
- **Webhooks** — `apps/cms/server/utils/webhooks.ts::enqueueWebhookDeliveries(tx, {event, contentType, entry})` inserts `WebhookDelivery` rows inside the triggering mutation's Prisma transaction. Wired into `PUT /api/content-entries/[id]` (fires `ENTRY_PUBLISHED`), `DELETE /api/content-entries/[id]` (fires `ENTRY_DELETED` only when a PUBLISHED version existed), and the four new lifecycle endpoints listed below. Payloads are snapshotted at enqueue time and replayed verbatim on every retry.
- **Webhook worker** — Single in-process worker started by `apps/cms/server/plugins/webhook-worker.ts`. Polls `WebhookDelivery` every 1s using `FOR UPDATE SKIP LOCKED`, POSTs with HMAC-SHA256 signature header (`X-Boject-Signature: sha256=<hex>` over `"<timestamp>.<body>"`), retries on non-2xx with backoff 1s → 10s → 1m → 10m → 1h → 6h (6 attempts total), dead-letters after. 10s per-attempt timeout. `runWorkerTick(deps)` is pure + tested against a fake Prisma.
- **Webhook cleanup** — Daily Nitro scheduled task `webhooks:cleanup` (`apps/cms/server/tasks/webhooks-cleanup.ts`) deletes delivery rows older than 30 days (SUCCESS by `completedAt`, DEAD_LETTERED by `createdAt`). `nitro.experimental.tasks` must be enabled in `nuxt.config.ts`.
- **Webhook REST API** — `/api/webhooks` (list/create), `/api/webhooks/:id` (detail/update/delete), `/api/webhooks/:id/rotate` (new secret, returned once), `/api/webhooks/:id/test` (enqueue `isTest` delivery), `/api/webhooks/:id/deliveries` (paginated log), `/api/webhooks/deliveries/:id/retry` (requeue as new PENDING row with `attempts=0`). All routes require CMS session (`isCmsRequest`); API-key callers get 403. Mutations protected by `enforceMutationRateLimit` + existing CSRF middleware.
- **Webhook UI** — `/webhooks` list, `/webhooks/new` create, `/webhooks/:id` detail with delivery log. Secret shown exactly once on create/rotate via the reusable `WebhookSecretReveal` component. Dev allows `localhost`/RFC1918 URLs; production blocks them unless `WEBHOOK_ALLOW_PRIVATE_URLS=true`.
- **Entry lifecycle transitions** — `apps/cms/server/utils/entryTransitions.ts::planTransition(entry, action)` encodes the state machine for `unpublish` / `archive` / `unarchive` / `republish`. Four thin endpoints (`POST /api/content-entries/[id]/{unpublish,archive,unarchive,republish}`) load the entry, call `planTransition`, run the returned mutation plan in a `prisma.$transaction`, and enqueue the matching webhook event. All session-gated; all rate-limited per endpoint.
- **Entry lifecycle rules** — Archive mutates a single row (PUBLISHED → ARCHIVED); ARCHIVED count per entry is ≤1. Archive returns 409 `DRAFT_PRESENT` if a CHANGED draft exists. Unpublish with a CHANGED draft drops the PUBLISHED row and flips CHANGED to DRAFT — the editor's in-progress work survives. Republish fires `ENTRY_PUBLISHED` without mutating anything and is unaffected by a CHANGED draft. Unarchive fires no webhook (consumers never saw ARCHIVED). Archive reserves title + slug on the envelope; delete is the escape hatch if the title needs to be reused.
- **Entry action overflow menu** — `apps/cms/components/entry-action-menu/EntryActionMenu.vue` is rendered in `EntrySidebar` and exposes Unpublish / Republish / Archive / Unarchive / Delete. Menu items are hidden (not disabled) when their source state is wrong. Archive triggers a confirmation modal; Unpublish uses a two-step inline click ("Click again to confirm"); Republish and Unarchive have no confirmation.
- **Archived entry visibility** — List endpoints (`GET /api/content-entries`, `GET /api/content`) accept `archiveFilter=active|archived|all` (default `active`). CMS list pages surface this as a filter chip row; API-key callers never see archived entries at all (the existing PUBLISHED-only filter excludes them). `EntryPickerModal` always passes `archiveFilter=active`.
```

Under Key Files:

```markdown
- `apps/cms/server/utils/webhooks.ts` — `enqueueWebhookDeliveries` + `generateWebhookSecret`
- `apps/cms/server/utils/webhookWorker.ts` — `runWorkerTick`, `startWorker`, `stopWorker`
- `apps/cms/server/utils/webhookBackoff.ts` — retry schedule
- `apps/cms/server/utils/webhookUrl.ts` — SSRF-aware URL validator
- `apps/cms/server/utils/webhookPayload.ts` — payload shape builder
- `apps/cms/server/utils/signPayload.ts` — HMAC-SHA256 signer
- `apps/cms/server/utils/webhookCleanup.ts` — `runCleanup` pure function
- `apps/cms/server/plugins/webhook-worker.ts` — Nitro plugin starting the worker
- `apps/cms/server/tasks/webhooks-cleanup.ts` — daily retention task
- `apps/cms/prisma/schema/webhook.prisma` — Webhook, WebhookDelivery
- `apps/cms/pages/webhooks/index.vue`, `apps/cms/pages/webhooks/new.vue`, `apps/cms/pages/webhooks/[id].vue` — management UI
- `apps/cms/components/webhook-secret-reveal/` — one-time secret reveal panel
- `apps/cms/server/utils/entryTransitions.ts` — `planTransition` state-machine helper
- `apps/cms/server/api/content-entries/[id]/unpublish.post.ts` — demote PUBLISHED → DRAFT
- `apps/cms/server/api/content-entries/[id]/archive.post.ts` — PUBLISHED → ARCHIVED (blocks on CHANGED)
- `apps/cms/server/api/content-entries/[id]/unarchive.post.ts` — ARCHIVED → DRAFT
- `apps/cms/server/api/content-entries/[id]/republish.post.ts` — re-fire `ENTRY_PUBLISHED` webhook
- `apps/cms/components/entry-action-menu/EntryActionMenu.vue` — overflow menu in `EntrySidebar`
```

Under Database Schema, after ContentEntry models:

```markdown
### Webhooks

- **Webhook** — Outbound HTTP subscription. Fields: `name`, `url`, `secret` (32-byte base64, plaintext — HMAC keys can't be hashed; returned once on create/rotate), `enabled` (default true), `contentTypeIds` (string array; empty = all types), `events` (WebhookEvent array). Has many `WebhookDelivery`s, cascade on delete.
- **WebhookDelivery** — One queued/delivered attempt-chain. Fields: `webhookId`, `event`, `contentTypeId`, `entryId`, `payload` (JSONB, snapshotted on enqueue; replayed byte-for-byte on every retry), `status` (`DeliveryStatus` enum: PENDING/SUCCESS/FAILED/DEAD_LETTERED), `attempts`, `nextAttemptAt`, `lastResponseCode`, `lastResponseBody` (truncated to 2KB), `lastError`, `isTest`, `completedAt`. Indexed on `(status, nextAttemptAt)` for the worker poll and `(webhookId, createdAt)` for the log.
- **WebhookEvent enum** — `ENTRY_PUBLISHED`, `ENTRY_UNPUBLISHED`, `ENTRY_DELETED`.
- **DeliveryStatus enum** — `PENDING`, `SUCCESS`, `FAILED`, `DEAD_LETTERED`.
```

Under Commands, add:

```markdown
pnpm ... # no new commands — lifecycle actions go through existing REST endpoints
```

Under CMS UI (in the Dynamic Content Types section), update the entry editor description to mention the overflow menu:

```markdown
- **Entry editor** — `ContentEditor` renders the form; `EntrySidebar` hosts the action stack (Save Draft / Publish / Discard Changes) and the new `EntryActionMenu` overflow menu (Unpublish / Republish / Archive / Unarchive / Delete). `EntryActionMenu` hides items that are illegal for the current state. Archive uses a confirmation modal and surfaces the 409 `DRAFT_PRESENT` error inline if a CHANGED draft exists.
- **List-page archive filter** — Each entry list page (per-type + All Content) renders a chip row (Active / Archived / All). Default `Active` hides ARCHIVED entries; `EntryPickerModal` always passes `archiveFilter=active`.
```

- [ ] **Step 2: Commit**

```bash
git add apps/cms/CLAUDE.md
git commit -m "docs: document webhooks + entry lifecycle architecture and endpoints"
```

---

### Task 32: Verification Pass

- [ ] **Step 1: Full test suite**

Run: `pnpm test:run`
Expected: all green.

- [ ] **Step 2: Lint + format + typecheck**

Run: `pnpm lint && pnpm format && pnpm typecheck`
Expected: no errors. If format auto-fixed anything, commit: `git add -A && git commit -m "chore: formatting"`.

- [ ] **Step 3: Manual smoke (webhooks)**

With `pnpm --filter cms dev` running:

1. Create a webhook via `/webhooks/new` pointing at `http://localhost:4100/hook` (start a one-liner `python3 -m http.server 4100` in another shell — the stub will 200 to anything; any Node stub also works).
2. Publish any content entry from `/entries/new:<contentTypeId>`.
3. Open `/webhooks/:id`, confirm the new delivery shows `SUCCESS` within a few seconds.
4. Rotate the secret and confirm the one-time panel appears.
5. Send a test payload, confirm it shows as `TEST` in the log.
6. Delete the webhook and confirm it's gone from `/webhooks`.

- [ ] **Step 4: Manual smoke (entry lifecycle)**

Still against the dev server, create and subscribe a webhook to all three events (ENTRY_PUBLISHED, ENTRY_UNPUBLISHED, ENTRY_DELETED) pointing at the same stub:

1. **Unpublish:** publish an entry, open the overflow menu, click Unpublish, click again to confirm. Entry status goes to `Draft`. The stub receives `ENTRY_UNPUBLISHED`.
2. **Unpublish with CHANGED:** publish an entry, save a draft edit (status goes to `Changed`), then Unpublish. Status goes to `Draft` and the editor's in-progress text survives. Stub receives `ENTRY_UNPUBLISHED` with the OLD published data.
3. **Archive:** publish an entry, click Archive in the overflow menu, confirm the modal. Entry status goes to `Archived`. Stub receives `ENTRY_UNPUBLISHED`.
4. **Archive blocked:** on a `Changed` entry, click Archive. The modal shows "Publish or discard your draft before archiving." Stub receives nothing.
5. **Unarchive:** from the archived entry, overflow menu → Unarchive. Status goes to `Draft`. Stub receives nothing.
6. **Republish:** on a `Published` entry (no pending draft), click Republish. No visual change; stub receives `ENTRY_PUBLISHED` again with identical `entry.data`.
7. **List filter:** in the content-type entries list, toggle Active/Archived/All. Archived entries appear only under Archived/All; archived entries are absent from the relation picker.

- [ ] **Step 5: Confirm Wallaby is green (per CLAUDE.md push workflow)**

If Wallaby MCP is available, check `wallaby_failingTests`. If clean, push with `WALLABY_VERIFIED=1 git push`. Otherwise, regular `git push` (pre-push hook re-runs tests).
