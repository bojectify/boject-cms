import { Client } from 'pg';
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
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

async function dockerStatsDefault(): Promise<{
  cpu_percent: number;
  mem_mb: number;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [
      'stats',
      '--no-stream',
      '--format',
      '{{json .}}',
      'boject-cms-postgres-1',
    ]);
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString();
    });
    child.on('close', (code) => {
      if (code !== 0) {
        return resolve({ cpu_percent: 0, mem_mb: 0 });
      }
      try {
        const j = JSON.parse(buf.trim()) as {
          CPUPerc: string;
          MemUsage: string;
        };
        const cpu = Number(j.CPUPerc.replace('%', '').trim());
        const memMatch = j.MemUsage.match(/([\d.]+)\s*MiB/);
        const mem = memMatch ? Number(memMatch[1]) : 0;
        resolve({ cpu_percent: cpu, mem_mb: mem });
      } catch (err) {
        reject(err);
      }
    });
  });
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const outPath = process.env.PERF_SAMPLER_OUT ?? 'pg-samples.csv';
  const intervalMs = Number(process.env.PERF_SAMPLER_INTERVAL_MS ?? '5000');
  const cfg = loadNodeConfig();
  mkdirSync(dirname(outPath), { recursive: true });
  appendFileSync(outPath, CSV_HEADER + '\n');

  const client = new Client({ connectionString: cfg.perfDatabaseUrl });
  await client.connect();

  const stop = () => {
    client.end().finally(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (true) {
    try {
      const sample = await sampleOnce({
        query: (sql) => client.query(sql),
        dockerStats: dockerStatsDefault,
      });
      appendFileSync(outPath, formatCsvRow(sample) + '\n');
    } catch (err) {
      console.error('[pg-sampler]', err);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
