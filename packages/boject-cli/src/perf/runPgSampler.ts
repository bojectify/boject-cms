import { Client } from 'pg';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  sampleOnce,
  formatCsvRow,
  CSV_HEADER,
  nextTickDelay,
  parseIntervalMs,
} from '../vendor/perf/lib/pg-sampler.js';

export interface PgSamplerHandle {
  stop: () => Promise<void>;
  csvPath: string;
}

export interface PgSamplerClient {
  connect: () => Promise<void>;
  query: (sql: string) => Promise<{
    rows: Array<{ total: string; active: string; idle: string }>;
  }>;
  end: () => Promise<void>;
}

export interface RunPgSamplerOptions {
  databaseUrl: string;
  outDir: string;
  intervalMs?: number;
  clientFactory?: (databaseUrl: string) => PgSamplerClient;
}

const noopDockerStats = async (): Promise<{
  cpu_percent: number;
  mem_mb: number;
}> => ({ cpu_percent: 0, mem_mb: 0 });

export async function startPgSampler(
  opts: RunPgSamplerOptions
): Promise<PgSamplerHandle> {
  const csvPath = join(opts.outDir, 'pg-samples.csv');
  const intervalMs =
    opts.intervalMs ?? parseIntervalMs(process.env.PERF_SAMPLER_INTERVAL_MS);

  const client: PgSamplerClient = opts.clientFactory
    ? opts.clientFactory(opts.databaseUrl)
    : (new Client({
        connectionString: opts.databaseUrl,
      }) as unknown as PgSamplerClient);

  await client.connect();
  await appendFile(csvPath, CSV_HEADER + '\n');

  let running = true;
  let sleepAbort: AbortController | null = null;

  const loop = (async (): Promise<void> => {
    const startedAt = Date.now();
    let tickIndex = 0;
    try {
      while (running) {
        try {
          const sample = await sampleOnce({
            query: (sql) => client.query(sql),
            dockerStats: noopDockerStats,
          });
          await appendFile(csvPath, formatCsvRow(sample) + '\n');
        } catch (err) {
          if (running) {
            process.stderr.write(
              `[pg-sampler] ${(err as Error).message ?? String(err)}\n`
            );
          }
        }
        if (!running) break;
        tickIndex++;
        const sleepFor = nextTickDelay({
          startedAt,
          tickIndex,
          intervalMs,
          now: Date.now(),
        });
        sleepAbort = new AbortController();
        const ac = sleepAbort;
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, sleepFor);
          ac.signal.addEventListener('abort', () => {
            clearTimeout(t);
            resolve();
          });
        });
        sleepAbort = null;
      }
    } finally {
      await client.end().catch(() => {});
    }
  })();

  return {
    csvPath,
    stop: async () => {
      running = false;
      sleepAbort?.abort();
      await loop;
    },
  };
}
