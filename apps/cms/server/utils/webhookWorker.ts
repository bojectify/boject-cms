import type { DeliveryStatus, Prisma, WebhookEvent } from '#prisma';
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

/**
 * Structural prisma shape the worker actually touches. Narrow on purpose so
 * unit tests can pass a minimal fake without having to implement the full
 * `PrismaClient` surface. Production code passes the real singleton, which
 * satisfies this shape transparently.
 */
export interface WorkerPrisma {
  $queryRaw: (...args: unknown[]) => Promise<DeliveryRow[]>;
  webhook: {
    findUnique: (args: {
      where: { id: string };
    }) => Promise<{ id: string; url: string; secret: string } | null>;
  };
  webhookDelivery: {
    update: (args: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => Promise<unknown>;
  };
}

export interface RunWorkerTickDeps {
  prisma: WorkerPrisma;
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

/**
 * Select PENDING deliveries ready for dispatch.
 *
 * The `FOR UPDATE SKIP LOCKED` clause is defensive for future multi-worker
 * deployments, but the lock is scoped to the SELECT statement only — the
 * subsequent UPDATE runs in a separate operation outside any transaction.
 * In the current single-worker setup this is harmless.
 *
 * TODO(multi-worker): wrap this SELECT together with the per-row UPDATE
 * in the same `prisma.$transaction` so that two workers cannot race on the
 * same delivery row. Tracked alongside the external-queue follow-up (#87).
 */
async function selectPending(
  deps: RunWorkerTickDeps,
  batchSize: number
): Promise<DeliveryRow[]> {
  // `FOR UPDATE SKIP LOCKED` is defensive against future multi-worker setups.
  // Template-string raw SQL; the table name is static so it's safe.
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

/**
 * Dispatch a single delivery.
 *
 * Delivery semantics are **at-least-once**: if a successful POST is followed
 * by a crash before the status UPDATE lands, the row remains PENDING and
 * will be re-delivered on the next tick. Consumers should treat
 * `X-Boject-Delivery-Id` as an idempotency key.
 */
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

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'boject-cms',
    'X-Boject-Event': row.event,
    'X-Boject-Delivery-Id': row.id,
    'X-Boject-Timestamp': String(tsSeconds),
    'X-Boject-Signature': `sha256=${signature}`,
  };

  try {
    const res = await deps.fetch(webhook.url, {
      method: 'POST',
      headers: requestHeaders,
      body,
      signal: controller.signal,
    });
    responseCode = res.status;
    const text = await res.text();
    responseBody = text.slice(0, RESPONSE_BODY_MAX);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    transportError = msg.slice(0, 500);
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
        lastRequestHeaders: requestHeaders as unknown as Prisma.InputJsonValue,
        lastResponseCode: responseCode,
        lastResponseBody: responseBody,
        lastError: null,
        completedAt: now,
        nextAttemptAt: null,
      },
    });
    return;
  }

  const willRetry = attempts < MAX_ATTEMPTS;
  if (!willRetry) {
    await deps.prisma.webhookDelivery.update({
      where: { id: row.id },
      data: {
        status: 'DEAD_LETTERED',
        attempts,
        lastRequestHeaders: requestHeaders as unknown as Prisma.InputJsonValue,
        lastResponseCode: responseCode,
        lastResponseBody: responseBody,
        lastError: transportError,
        completedAt: now,
        nextAttemptAt: null,
      },
    });
  } else {
    // Delay BEFORE the next attempt uses the schedule indexed by the
    // just-completed attempt count. After attempt 1 fails, wait backoffMs(1)
    // = 1s before attempt 2; after attempt 2 fails, wait backoffMs(2) = 10s;
    // and so on.
    const delay = backoffMs(attempts)!;
    await deps.prisma.webhookDelivery.update({
      where: { id: row.id },
      data: {
        status: 'PENDING',
        attempts,
        lastRequestHeaders: requestHeaders as unknown as Prisma.InputJsonValue,
        lastResponseCode: responseCode,
        lastResponseBody: responseBody,
        lastError: transportError,
        nextAttemptAt: new Date(now.getTime() + delay),
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
