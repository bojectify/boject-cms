import { Client } from 'pg';
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadNodeConfig } from './config-node.ts';

export interface Sample {
  timestamp: Date;
  total: number;
  active: number;
  idle: number;
  cpuPercent: number;
  memMb: number;
}

export interface SampleOpts {
  query: (sql: string) => Promise<{
    rows: Array<{ total: string; active: string; idle: string }>;
  }>;
  dockerStats: () => Promise<{ cpu_percent: number; mem_mb: number }>;
}

export async function sampleOnce(opts: SampleOpts): Promise<Sample> {
  const [pgResult, docker] = await Promise.all([
    opts.query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE state = 'active') AS active,
              COUNT(*) FILTER (WHERE state = 'idle') AS idle
       FROM pg_stat_activity
       WHERE datname = current_database()`
    ),
    opts.dockerStats(),
  ]);
  const row = pgResult.rows[0]!;
  return {
    timestamp: new Date(),
    total: Number(row.total),
    active: Number(row.active),
    idle: Number(row.idle),
    cpuPercent: docker.cpu_percent,
    memMb: docker.mem_mb,
  };
}

export function formatCsvRow(s: Sample): string {
  return [
    s.timestamp.toISOString(),
    s.total,
    s.active,
    s.idle,
    s.cpuPercent,
    s.memMb,
  ].join(',');
}

export const CSV_HEADER = 'timestamp,total,active,idle,cpu_percent,mem_mb';

// Container name varies with the docker compose project name (defaults to the
// repo directory) and the compose service name (`db` in docker-compose.yml).
// The default below matches `pnpm db:up` in this repo; override via env when
// running against a different deployment.
const DEFAULT_CONTAINER = 'boject-cms-db-1';

// Pure parser extracted so the regex/JSON behaviour is unit-testable
// without spawning docker. Currently only matches `MiB` — non-MiB units
// (KiB / GiB) yield mem_mb=0; the test suite documents this.
export function parseDockerStatsJson(line: string): {
  cpu_percent: number;
  mem_mb: number;
} {
  const j = JSON.parse(line.trim()) as {
    CPUPerc: string;
    MemUsage: string;
  };
  const cpu = Number(j.CPUPerc.replace('%', '').trim());
  const memMatch = j.MemUsage.match(/([\d.]+)\s*MiB/);
  const mem = memMatch ? Number(memMatch[1]) : 0;
  return { cpu_percent: cpu, mem_mb: mem };
}

async function dockerStatsDefault(): Promise<{
  cpu_percent: number;
  mem_mb: number;
}> {
  const container = process.env.PERF_SAMPLER_CONTAINER ?? DEFAULT_CONTAINER;
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [
      'stats',
      '--no-stream',
      '--format',
      '{{json .}}',
      container,
    ]);
    let buf = '';
    let errBuf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString();
    });
    child.stderr.on('data', (d) => {
      errBuf += d.toString();
    });
    child.on('close', (code) => {
      if (code !== 0) {
        console.error(
          `[pg-sampler] docker stats ${container} exited ${code}: ${errBuf.trim()}`
        );
        return resolve({ cpu_percent: 0, mem_mb: 0 });
      }
      try {
        resolve(parseDockerStatsJson(buf));
      } catch (err) {
        reject(err);
      }
    });
  });
}

// Fixed-cadence scheduler: the Nth sample is anchored at
// `startedAt + N * intervalMs`. Returns the ms to sleep before that tick.
// Returns 0 when work overran the slot — the caller should sample again
// immediately rather than padding `intervalMs` on top of every overrun
// (which would let drift accumulate).
export function nextTickDelay(opts: {
  startedAt: number;
  tickIndex: number;
  intervalMs: number;
  now: number;
}): number {
  return Math.max(
    0,
    opts.startedAt + opts.tickIndex * opts.intervalMs - opts.now
  );
}

export function parseIntervalMs(raw: string | undefined): number {
  const n = Number(raw ?? '5000');
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(
      `Invalid PERF_SAMPLER_INTERVAL_MS=${JSON.stringify(raw)} — expected a positive number of milliseconds`
    );
  }
  return n;
}

async function main(): Promise<void> {
  const outPath = process.env.PERF_SAMPLER_OUT ?? 'pg-samples.csv';
  const intervalMs = parseIntervalMs(process.env.PERF_SAMPLER_INTERVAL_MS);
  const cfg = loadNodeConfig();
  mkdirSync(dirname(outPath), { recursive: true });
  appendFileSync(outPath, CSV_HEADER + '\n');

  const client = new Client({ connectionString: cfg.perfDatabaseUrl });
  await client.connect();

  // Cooperative shutdown: SIGINT/SIGTERM flips `running` and aborts the
  // current sleep so Ctrl+C is responsive even between samples. The loop
  // exits naturally; client.end() runs in the finally block exactly once.
  let running = true;
  let sleepAbort: AbortController | null = null;
  const stop = (): void => {
    running = false;
    sleepAbort?.abort();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  const startedAt = Date.now();
  let tickIndex = 0;

  try {
    while (running) {
      try {
        const sample = await sampleOnce({
          query: (sql) => client.query(sql),
          dockerStats: dockerStatsDefault,
        });
        appendFileSync(outPath, formatCsvRow(sample) + '\n');
      } catch (err) {
        // Suppress fallout from the in-flight query racing the signal —
        // those errors are expected during graceful shutdown.
        if (running) {
          console.error('[pg-sampler]', err);
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
    await client.end();
  }
}

// CLI entry — pathToFileURL handles symlinks, spaces in paths, and
// platform path separators. The naked `file://${argv[1]}` form silently
// no-ops in those cases.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err: unknown) => {
    console.error('[pg-sampler] fatal', err);
    process.exit(1);
  });
}
