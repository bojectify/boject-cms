import { access, readFile } from 'node:fs/promises';

export interface ConnectionStats {
  peak: { total: number; active: number; idle: number };
  mean: { total: number; active: number; idle: number };
  sampleCount: number;
}

interface ParsedRow {
  total: number;
  active: number;
  idle: number;
}

function parseRows(csv: string): ParsedRow[] {
  const lines = csv
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) return [];
  const rows: ParsedRow[] = [];
  // Skip header row (lines[0]).
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(',').map((c) => c.trim());
    // Expect at least 4 columns: timestamp,total,active,idle,...
    if (cols.length < 4) continue;
    const rawTotal = cols[1] ?? '';
    const rawActive = cols[2] ?? '';
    const rawIdle = cols[3] ?? '';
    if (rawTotal === '' || rawActive === '' || rawIdle === '') continue;
    const total = Number(rawTotal);
    const active = Number(rawActive);
    const idle = Number(rawIdle);
    if (!Number.isFinite(total)) continue;
    if (!Number.isFinite(active)) continue;
    if (!Number.isFinite(idle)) continue;
    rows.push({ total, active, idle });
  }
  return rows;
}

export function computeConnectionStats(csv: string): ConnectionStats | null {
  const rows = parseRows(csv);
  if (rows.length === 0) return null;

  let peakTotal = -Infinity;
  let peakActive = -Infinity;
  let peakIdle = -Infinity;
  let sumTotal = 0;
  let sumActive = 0;
  let sumIdle = 0;

  for (const row of rows) {
    if (row.total > peakTotal) peakTotal = row.total;
    if (row.active > peakActive) peakActive = row.active;
    if (row.idle > peakIdle) peakIdle = row.idle;
    sumTotal += row.total;
    sumActive += row.active;
    sumIdle += row.idle;
  }

  const count = rows.length;
  return {
    peak: { total: peakTotal, active: peakActive, idle: peakIdle },
    mean: {
      total: Math.round(sumTotal / count),
      active: Math.round(sumActive / count),
      idle: Math.round(sumIdle / count),
    },
    sampleCount: count,
  };
}

export function renderConnectionPanel(stats: ConnectionStats): string {
  return [
    '## Database connection pool',
    '',
    `_${stats.sampleCount} samples over the run._`,
    '',
    '|       | total | active | idle |',
    '| ---   | ---   | ---    | ---  |',
    `| peak  | ${stats.peak.total} | ${stats.peak.active} | ${stats.peak.idle} |`,
    `| mean  | ${stats.mean.total} | ${stats.mean.active} | ${stats.mean.idle} |`,
  ].join('\n');
}

export async function readSamplesIfPresent(
  csvPath: string
): Promise<string | null> {
  try {
    await access(csvPath);
    return await readFile(csvPath, 'utf8');
  } catch {
    return null;
  }
}
