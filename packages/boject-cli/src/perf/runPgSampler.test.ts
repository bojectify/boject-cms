import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPgSampler, type PgSamplerClient } from './runPgSampler.js';
import { CSV_HEADER } from '../vendor/perf/lib/pg-sampler.js';

interface FakeClientOptions {
  queryError?: (callNumber: number) => Error | null;
  endDelayMs?: number;
  onConnect?: () => void;
  onQuery?: (callNumber: number) => void;
}

interface FakeClient extends PgSamplerClient {
  connectCalls: number;
  queryCalls: number;
  endCalls: number;
}

function makeFakeClient(opts: FakeClientOptions = {}): FakeClient {
  const state = { connectCalls: 0, queryCalls: 0, endCalls: 0 };
  const client: FakeClient = {
    ...state,
    connect: async () => {
      state.connectCalls++;
      client.connectCalls = state.connectCalls;
      opts.onConnect?.();
    },
    query: async (_sql: string) => {
      state.queryCalls++;
      client.queryCalls = state.queryCalls;
      opts.onQuery?.(state.queryCalls);
      const err = opts.queryError?.(state.queryCalls);
      if (err) throw err;
      return { rows: [{ total: '10', active: '5', idle: '5' }] };
    },
    end: async () => {
      state.endCalls++;
      client.endCalls = state.endCalls;
      if (opts.endDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, opts.endDelayMs));
      }
    },
  };
  return client;
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function mkOutDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'boject-sampler-'));
}

function countDataRows(csv: string): number {
  const lines = csv.split('\n').filter((line) => line.length > 0);
  // Header + data rows. Filter out header.
  return lines.filter((line) => line !== CSV_HEADER).length;
}

describe('startPgSampler', () => {
  const originalInterval = process.env.PERF_SAMPLER_INTERVAL_MS;

  beforeEach(() => {
    delete process.env.PERF_SAMPLER_INTERVAL_MS;
  });

  afterEach(() => {
    if (originalInterval === undefined) {
      delete process.env.PERF_SAMPLER_INTERVAL_MS;
    } else {
      process.env.PERF_SAMPLER_INTERVAL_MS = originalInterval;
    }
    vi.restoreAllMocks();
  });

  it('writes CSV header on start', async () => {
    const outDir = await mkOutDir();
    const client = makeFakeClient();
    const handle = await startPgSampler({
      databaseUrl: 'postgresql://u:p@h/test_perf',
      outDir,
      intervalMs: 60_000,
      clientFactory: () => client,
    });
    // Read immediately — sleep gives the loop a chance to fire its first tick,
    // but we want to check that the header is present whether or not a tick
    // has fired yet. Read after a very short tick window to be deterministic.
    const contents = await readFile(handle.csvPath, 'utf8');
    expect(contents.startsWith(CSV_HEADER + '\n')).toBe(true);
    await handle.stop();
  });

  it('writes one row per tick', async () => {
    const outDir = await mkOutDir();
    const client = makeFakeClient();
    const handle = await startPgSampler({
      databaseUrl: 'postgresql://u:p@h/test_perf',
      outDir,
      intervalMs: 50,
      clientFactory: () => client,
    });
    await wait(120);
    await handle.stop();
    const csv = await readFile(handle.csvPath, 'utf8');
    const rows = countDataRows(csv);
    // Tick 1 fires immediately; tick 2 after 50ms; tick 3 after 100ms.
    // Allow some slack: assert at least 2 rows.
    expect(rows).toBeGreaterThanOrEqual(2);
  });

  it('stop() returns within 100ms even if mid-sleep', async () => {
    const outDir = await mkOutDir();
    const client = makeFakeClient();
    const handle = await startPgSampler({
      databaseUrl: 'postgresql://u:p@h/test_perf',
      outDir,
      intervalMs: 60_000,
      clientFactory: () => client,
    });
    await wait(50);
    const start = Date.now();
    await handle.stop();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  it('stop() awaits client.end()', async () => {
    const outDir = await mkOutDir();
    const client = makeFakeClient({ endDelayMs: 50 });
    const handle = await startPgSampler({
      databaseUrl: 'postgresql://u:p@h/test_perf',
      outDir,
      intervalMs: 60_000,
      clientFactory: () => client,
    });
    await wait(20);
    const start = Date.now();
    await handle.stop();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(50);
    expect(client.endCalls).toBe(1);
  });

  it('per-tick query error is logged but loop continues', async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const outDir = await mkOutDir();
    const client = makeFakeClient({
      queryError: (n) => (n === 2 ? new Error('boom') : null),
    });
    const handle = await startPgSampler({
      databaseUrl: 'postgresql://u:p@h/test_perf',
      outDir,
      intervalMs: 30,
      clientFactory: () => client,
    });
    // Wait long enough for at least 3 ticks.
    await wait(120);
    await handle.stop();
    const csv = await readFile(handle.csvPath, 'utf8');
    const rows = countDataRows(csv);
    // Tick 2 errors, ticks 1 + 3 succeed → at least 2 rows.
    expect(rows).toBeGreaterThanOrEqual(2);
    // Stderr was written to with the [pg-sampler] tag.
    const calls = stderrSpy.mock.calls.map((args) => String(args[0]));
    expect(calls.some((line) => line.includes('[pg-sampler]'))).toBe(true);
    expect(calls.some((line) => line.includes('boom'))).toBe(true);
  });

  it('clientFactory injection wins over real Client', async () => {
    const outDir = await mkOutDir();
    const client = makeFakeClient();
    const factory = vi.fn(() => client);
    const handle = await startPgSampler({
      databaseUrl: 'postgresql://u:p@h/test_perf',
      outDir,
      intervalMs: 60_000,
      clientFactory: factory,
    });
    expect(factory).toHaveBeenCalledWith('postgresql://u:p@h/test_perf');
    expect(client.connectCalls).toBe(1);
    await handle.stop();
  });

  it('intervalMs option beats env var', async () => {
    process.env.PERF_SAMPLER_INTERVAL_MS = '5000';
    const outDir = await mkOutDir();
    const client = makeFakeClient();
    const handle = await startPgSampler({
      databaseUrl: 'postgresql://u:p@h/test_perf',
      outDir,
      intervalMs: 50,
      clientFactory: () => client,
    });
    await wait(120);
    await handle.stop();
    const csv = await readFile(handle.csvPath, 'utf8');
    const rows = countDataRows(csv);
    // If env var was honoured (5000ms) we'd see exactly 1 row. The override
    // should give us at least 2 rows.
    expect(rows).toBeGreaterThanOrEqual(2);
  });

  it('concurrent samplers produce separate CSVs', async () => {
    const outDirA = await mkOutDir();
    const outDirB = await mkOutDir();
    const clientA = makeFakeClient();
    const clientB = makeFakeClient();
    const handleA = await startPgSampler({
      databaseUrl: 'postgresql://u:p@h/test_perf_a',
      outDir: outDirA,
      intervalMs: 60_000,
      clientFactory: () => clientA,
    });
    const handleB = await startPgSampler({
      databaseUrl: 'postgresql://u:p@h/test_perf_b',
      outDir: outDirB,
      intervalMs: 60_000,
      clientFactory: () => clientB,
    });
    expect(handleA.csvPath).not.toBe(handleB.csvPath);
    const a = await readFile(handleA.csvPath, 'utf8');
    const b = await readFile(handleB.csvPath, 'utf8');
    expect(a.startsWith(CSV_HEADER + '\n')).toBe(true);
    expect(b.startsWith(CSV_HEADER + '\n')).toBe(true);
    await handleA.stop();
    await handleB.stop();
  });
});
