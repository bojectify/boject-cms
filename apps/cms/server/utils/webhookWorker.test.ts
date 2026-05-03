import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolvePublicHost } from './resolvePublicHost';
import { runWorkerTick } from './webhookWorker';

vi.mock('./resolvePublicHost', async (importOriginal) => {
  const original = await importOriginal<typeof import('./resolvePublicHost')>();
  return {
    ...original,
    resolvePublicHost: vi
      .fn()
      .mockResolvedValue({ addresses: ['203.0.113.5'] }),
  };
});

const mockResolve = resolvePublicHost as unknown as ReturnType<typeof vi.fn>;

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
  lastRequestHeaders: Record<string, string> | null;
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
  lastRequestHeaders: null,
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
    expect(deliveries[0]!.lastRequestHeaders).toEqual(sentHeaders);
  });

  it('marks delivery FAILED when webhook no longer exists', async () => {
    const fetchCalled = { value: false };
    const fetchImpl = async () => {
      fetchCalled.value = true;
      return new Response('ok', { status: 200 });
    };
    // Same deliveries[], but webhooks[] is empty — findUnique will return null.
    const prisma = makeFakePrisma(deliveries, []);
    await runWorkerTick({ prisma, fetch: fetchImpl, now: () => new Date() });

    expect(deliveries[0]!.status).toBe('FAILED');
    expect(deliveries[0]!.lastError).toBe('Webhook no longer exists');
    expect(deliveries[0]!.completedAt).toBeInstanceOf(Date);
    expect(fetchCalled.value).toBe(false); // Never attempted the POST
  });
});

describe('runWorkerTick — DNS resolution + IP pinning', () => {
  let deliveries: DeliveryRow[];
  let webhooks: WebhookRow[];

  beforeEach(() => {
    deliveries = [{ ...baseDelivery }];
    webhooks = [{ id: 'w1', url: 'https://example.com/hook', secret: 'sek' }];
    mockResolve.mockReset();
    mockResolve.mockResolvedValue({ addresses: ['203.0.113.5'] });
  });

  it('skips DNS resolution and dispatcher when allowPrivate=true', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
    const prisma = makeFakePrisma(deliveries, webhooks);
    await runWorkerTick({
      prisma,
      fetch: fetchImpl as never,
      now: () => new Date(),
      allowPrivate: true,
    });

    expect(mockResolve).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = (
      fetchImpl.mock.calls[0] as unknown as [string, { dispatcher?: unknown }]
    )[1];
    expect(init.dispatcher).toBeUndefined();
    expect(deliveries[0]!.status).toBe('SUCCESS');
  });

  it('skips DNS resolution when URL hostname is an IP literal', async () => {
    webhooks = [{ id: 'w1', url: 'https://203.0.113.5/hook', secret: 'sek' }];
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
    const prisma = makeFakePrisma(deliveries, webhooks);
    await runWorkerTick({
      prisma,
      fetch: fetchImpl as never,
      now: () => new Date(),
      allowPrivate: false,
    });

    expect(mockResolve).not.toHaveBeenCalled();
    const init = (
      fetchImpl.mock.calls[0]! as unknown as [string, { dispatcher?: unknown }]
    )[1];
    expect(init.dispatcher).toBeUndefined();
    expect(deliveries[0]!.status).toBe('SUCCESS');
  });

  it('resolves the hostname and passes a dispatcher to fetch in production', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
    const prisma = makeFakePrisma(deliveries, webhooks);
    await runWorkerTick({
      prisma,
      fetch: fetchImpl as never,
      now: () => new Date(),
      allowPrivate: false,
    });

    expect(mockResolve).toHaveBeenCalledWith('example.com');
    const init = (
      fetchImpl.mock.calls[0] as unknown as [string, { dispatcher?: unknown }]
    )[1];
    expect(init.dispatcher).toBeDefined();
    expect(deliveries[0]!.status).toBe('SUCCESS');
  });

  it('marks delivery FAILED with no fetch when resolver detects rebinding (PRIVATE_IP)', async () => {
    const { WebhookDnsError } = await import('./resolvePublicHost');
    mockResolve.mockRejectedValueOnce(
      new WebhookDnsError('PRIVATE_IP', 'example.com', '127.0.0.1')
    );
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
    const prisma = makeFakePrisma(deliveries, webhooks);
    await runWorkerTick({
      prisma,
      fetch: fetchImpl as never,
      now: () => new Date(),
      allowPrivate: false,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    const row = deliveries[0]!;
    expect(row.status).toBe('FAILED');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toMatch(/private/i);
    expect(row.completedAt).toBeInstanceOf(Date);
    expect(row.nextAttemptAt).toBeNull();
    expect(row.lastResponseCode).toBeNull();
  });

  it('marks delivery FAILED on dispatch-time NXDOMAIN', async () => {
    const { WebhookDnsError } = await import('./resolvePublicHost');
    mockResolve.mockRejectedValueOnce(
      new WebhookDnsError('NXDOMAIN', 'example.com')
    );
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
    const prisma = makeFakePrisma(deliveries, webhooks);
    await runWorkerTick({
      prisma,
      fetch: fetchImpl as never,
      now: () => new Date(),
      allowPrivate: false,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(deliveries[0]!.status).toBe('FAILED');
    expect(deliveries[0]!.attempts).toBe(1);
    expect(deliveries[0]!.lastError).toMatch(/could not be resolved/i);
  });

  it('marks delivery FAILED on dispatch-time TIMEOUT', async () => {
    const { WebhookDnsError } = await import('./resolvePublicHost');
    mockResolve.mockRejectedValueOnce(
      new WebhookDnsError('TIMEOUT', 'example.com')
    );
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
    const prisma = makeFakePrisma(deliveries, webhooks);
    await runWorkerTick({
      prisma,
      fetch: fetchImpl as never,
      now: () => new Date(),
      allowPrivate: false,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(deliveries[0]!.status).toBe('FAILED');
    expect(deliveries[0]!.attempts).toBe(1);
    expect(deliveries[0]!.lastError).toMatch(/timed out/i);
  });
});
