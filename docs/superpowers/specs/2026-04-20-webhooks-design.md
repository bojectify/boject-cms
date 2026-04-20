# Webhooks

## Overview

Deliver content-lifecycle events to external HTTP consumers so downstream systems — static-site frontends, search indexers, realtime fanout providers — react to published content without polling the API.

Three event types: `ENTRY_PUBLISHED`, `ENTRY_UNPUBLISHED`, `ENTRY_DELETED`. Consumers register webhooks scoped to any subset of content types and event types. Delivery is at-least-once with DB-backed queueing, exponential backoff retries, HMAC-signed payloads, and a 30-day delivery log.

## Approach

**DB-backed queue, no external infra.** On a triggering mutation, the handler enqueues `WebhookDelivery` rows inside the same transaction as the publish/delete. A single worker polls the table every second and POSTs to consumers. Survives CMS crashes; no new services required. Scales to a single Nuxt process — multi-instance deployments are a separate roadmap item (external queue).

**Full payload.** Each delivery carries the complete flattened published entry. Search indexers and fanout providers get what they need in one hop; cache invalidators have the slug and identifier they need. Avoids the race between webhook arrival and entry being queryable.

**Payload snapshotted on enqueue.** The body stored in `WebhookDelivery.payload` is the exact bytes every retry attempt replays. If an entry is republished during a retry cycle, the retry still delivers the state of the original triggering event — no drift.

## Data Model

Two new Prisma models in `apps/cms/prisma/schema/webhook.prisma`:

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
  id             String   @id @default(uuid())
  name           String
  url            String
  secret         String                         // 32 bytes base64; HMAC key (plaintext)
  enabled        Boolean  @default(true)
  contentTypeIds String[]                       // empty = all content types
  events         WebhookEvent[]                 // at least one required
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  deliveries     WebhookDelivery[]
}

model WebhookDelivery {
  id               String         @id @default(uuid())
  webhookId        String
  webhook          Webhook        @relation(fields: [webhookId], references: [id], onDelete: Cascade)
  event            WebhookEvent
  contentTypeId    String
  entryId          String
  payload          Json                          // full POST body, snapshotted on enqueue
  status           DeliveryStatus @default(PENDING)
  attempts         Int            @default(0)
  nextAttemptAt    DateTime?
  lastResponseCode Int?
  lastResponseBody String?                       // truncated to 2KB
  lastError        String?                       // transport/DNS/timeout errors
  isTest           Boolean        @default(false)
  createdAt        DateTime       @default(now())
  completedAt      DateTime?

  @@index([status, nextAttemptAt])
  @@index([webhookId, createdAt])
}
```

- `secret` stored plaintext because HMAC verification needs it. Returned once on create / rotate, never re-exposed.
- Delivery rows retained 30 days from `completedAt` (or `createdAt` if dead-lettered), cleaned daily by a Nitro scheduled task.

## Event Wiring

| Event               | Trigger                                                       | Condition                                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENTRY_PUBLISHED`   | `PUT /api/content-entries/[id]` with `status === 'PUBLISHED'` | After the publish transaction commits a new or updated PUBLISHED version                                                                                                                                                                     |
| `ENTRY_UNPUBLISHED` | — (reserved)                                                  | No core endpoint demotes a PUBLISHED version today. The event is defined in the enum so consumers can subscribe forward-compatibly, and so a future explicit "unpublish" action can fire it without a schema migration. Does not fire in v1. |
| `ENTRY_DELETED`     | `DELETE /api/content-entries/[id]`                            | Only if a PUBLISHED version existed at deletion time                                                                                                                                                                                         |

Draft-only entries that are never published do not produce deletion events — consumers never saw them.

Documented gap: there is no explicit "unpublish" flow in core today (only delete). If an explicit unpublish action is added later, it wires into the same `enqueueWebhookDeliveries` helper and fires `ENTRY_UNPUBLISHED` with no other surface changes.

Enqueue helper: `server/utils/webhooks.ts::enqueueWebhookDeliveries(tx, event, contentTypeId, entryId, payload)`.

- Takes a Prisma transaction client — runs **inside the same transaction** as the source mutation so the publish and the enqueue are atomic. If the publish rolls back, the delivery rows roll back with it.
- Queries `Webhook` where `enabled = true`, `events` contains the event, and (`contentTypeIds` is empty OR contains `contentTypeId`).
- Inserts one `WebhookDelivery` row per matching webhook with `payload` serialised at enqueue time.
- For `ENTRY_DELETED`, the caller captures the last-known published snapshot **before** the entry row is deleted, and passes it through.

## Payload Shape

Identical shape for all three events:

```json
{
  "event": "ENTRY_PUBLISHED",
  "deliveryId": "9f1c...",
  "timestamp": "2026-04-20T12:34:56.789Z",
  "contentType": {
    "id": "...",
    "identifier": "Article"
  },
  "entry": {
    "id": "...",
    "entryTitle": "...",
    "slug": "...",
    "status": "PUBLISHED",
    "publishedAt": "...",
    "createdAt": "...",
    "updatedAt": "...",
    "data": { "...": "flattened published version field values" }
  }
}
```

For `ENTRY_DELETED`, `entry` carries the last-known published snapshot captured in the delete transaction.

Only PUBLISHED data is ever sent. Drafts never leak into webhook payloads (matches existing API-key visibility).

## Delivery Worker

A single background worker inside the Nuxt server process, registered via a Nitro plugin (`apps/cms/server/plugins/webhook-worker.ts`). Starts on boot, drains gracefully on shutdown.

**Loop** (every 1s):

1. `SELECT ... FOR UPDATE SKIP LOCKED LIMIT N` PENDING rows where `nextAttemptAt <= NOW()`, ordered by `nextAttemptAt`. Uses `prisma.$queryRaw` because Prisma's `findMany` does not support `FOR UPDATE SKIP LOCKED`.
2. For each row: increment `attempts`, POST the payload.
3. On 2xx: `status = SUCCESS`, `completedAt = now`, `nextAttemptAt = null`, record response code + truncated body.
4. On non-2xx or transport error: if `attempts < 6`, set `status = PENDING`, `nextAttemptAt = now + backoff(attempts)`. Otherwise `status = DEAD_LETTERED`.
5. Record `lastResponseCode` / `lastResponseBody` on HTTP responses; `lastError` on transport errors.

`FOR UPDATE SKIP LOCKED` is defensive against future multi-worker deployments and safe for the single-worker case. Polling cost is negligible (indexed query on `(status, nextAttemptAt)`, returns empty when idle). Wake-on-enqueue is deferred as an optimisation.

**Backoff schedule:** 1s, 10s, 1m, 10m, 1h, 6h. Six attempts total before dead-letter.

**Timeout:** 10s per attempt.

**HTTP request:**

```
POST <webhook.url>
Content-Type: application/json
User-Agent: boject-cms/<version>
X-Boject-Event: ENTRY_PUBLISHED
X-Boject-Delivery-Id: <WebhookDelivery.id>
X-Boject-Timestamp: <unix seconds>
X-Boject-Signature: sha256=<hex hmac>
```

- **Signature:** `HMAC-SHA256(secret, "<timestamp>.<raw body>")`. Timestamp-in-signature prevents replay. Documented in the `/webhooks` UI with a verification code sample.
- **Body:** raw JSON bytes stored in `payload` — no re-serialisation between attempts.

**Cleanup:** a Nitro scheduled task runs daily, deletes `WebhookDelivery` rows where `completedAt < now - 30 days` OR (`status = DEAD_LETTERED` AND `createdAt < now - 30 days`).

## Management UI

New sidebar entry under the existing nav. All pages are session-auth-gated (admin-only once role-based auth lands; documented gap in v1).

**List view** (`apps/cms/pages/webhooks/index.vue`):

- Table: Name, URL, Events (badges), Content types (badges or "All"), Status (enabled/disabled), Last delivery (relative time + success/fail indicator).
- "New webhook" button top-right.
- Row click → detail view.

**Create page** (`apps/cms/pages/webhooks/new.vue`):

- Name, URL (validated http/https; SSRF filter in prod), content type multi-select (empty = all), event checkboxes (at least one required), enabled toggle.
- On save: generate 32-byte base64 secret, create row, show "Your webhook secret" panel **once** with copy button and a warning that it won't be shown again.

**Detail / edit page** (`apps/cms/pages/webhooks/[id].vue`):

- Edit name, URL, content types, events, enabled flag.
- **Rotate secret** button — generates a new secret, shows once, old one immediately invalid.
- **Send test payload** button — fires a synthetic `ENTRY_PUBLISHED` with a stub payload (`{ test: true, ... }`). Creates a real `WebhookDelivery` row flagged `isTest = true`.
- **Delivery log** table: last 100 deliveries with event, entry id, status, attempts, response code, timestamp. Rows expandable to show full payload + response body. "Retry" button on `FAILED` / `DEAD_LETTERED` rows re-queues as a new delivery with `attempts = 0`.
- **Danger zone:** delete webhook (cascades deliveries).

## REST API Surface

All routes require CMS session auth. Mutations protected by `enforceMutationRateLimit` and the existing CSRF middleware.

```
GET    /api/webhooks                            → list
POST   /api/webhooks                            → create (response includes secret ONCE)
GET    /api/webhooks/:id                        → detail (no secret)
PUT    /api/webhooks/:id                        → update
DELETE /api/webhooks/:id                        → delete (cascades deliveries)
POST   /api/webhooks/:id/rotate                 → rotate secret (response includes new secret ONCE)
POST   /api/webhooks/:id/test                   → fire test delivery
GET    /api/webhooks/:id/deliveries             → list (paginated)
POST   /api/webhooks/deliveries/:id/retry       → re-queue a specific delivery
```

## Security

- **Secret handling:** generated server-side (32 bytes base64), returned **once** on create/rotate, never exposed via GET. Stored plaintext because HMAC keys cannot be hashed.
- **SSRF defence:** URL validation helper rejects non-http(s) schemes, `localhost`, link-local (`169.254.0.0/16`), and RFC1918 ranges (`10/8`, `172.16/12`, `192.168/16`) in production. Dev allows localhost so developers can test against their own machine. Opt-in override: `WEBHOOK_ALLOW_PRIVATE_URLS=true` for staging environments that need it.
- **Payload leak:** only PUBLISHED data ever sent. Drafts never leak.
- **Response body capture:** truncated at 2KB before insert, to avoid filling the DB with large error pages.
- **Signature verification window:** consumers should reject if `|now - X-Boject-Timestamp| > 5 min`. Documented in the UI.

## Authorisation

v1 ships before the role-based auth ticket (#83) lands. All webhook management endpoints are gated on `isCmsRequest(event)` — any CMS-session user can manage webhooks. Documented as a known gap. Once roles land, webhook endpoints become Admin-only; the existing role-check helper slots in at the top of each handler.

## Testing

**Unit** (`server/utils/webhooks.test.ts`, `server/utils/signPayload.test.ts`):

- `signPayload()` produces correct HMAC hex for known fixtures.
- Backoff schedule returns the right delay for each attempt number.
- URL validation helper rejects SSRF targets.
- Payload builder produces the right shape for each event type.

**Integration:**

- Publishing an entry inserts `WebhookDelivery` rows for matching webhooks (content-type filter respected, event filter respected, disabled webhooks skipped).
- Deleting a published entry enqueues `ENTRY_DELETED` with last-known data; deleting a draft-only entry does not.
- Worker dispatches PENDING, transitions to SUCCESS on 2xx, retries on 5xx, applies the right backoff at each attempt, dead-letters after 6 attempts.
- Payload bytes are identical across all retry attempts.
- Signature verifies end-to-end with a stub consumer.
- CSRF + rate-limit + auth cover management endpoints.
- Rotate secret invalidates the old one.
- Delete webhook cascades deliveries.

**E2E:** full publish → delivery → success flow against a stub HTTP server spun up in a test. Second test: publish → delivery fails → retries → eventually succeeds.

## Out of Scope (separate roadmap tickets)

- **External queue** (Redis/BullMQ/SQS) — required for multi-instance deployments. Constraint: must be first-party through the existing container setup, not BYO infra.
- **Multi-instance delivery coordination** beyond `FOR UPDATE SKIP LOCKED`.
- **Webhook management for API-key consumers** — v1 is CMS-session-only.
- **`contentType.*` events** — schema-change notifications. Intentionally excluded from the event set; consuming frontends don't need them.
- **Per-consumer outbound rate limiting.**
- **Webhook activity RSS / audit feed.**

## Migration Notes

- New Prisma schema file (`webhook.prisma`) — regenerate client via `pnpm prisma:generate`.
- One migration adds both tables + enums.
- No data migration required.
- Nitro plugin registration is additive — existing deployments on upgrade get the worker automatically.
