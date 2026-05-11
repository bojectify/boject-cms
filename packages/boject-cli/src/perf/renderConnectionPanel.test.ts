import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeConnectionStats,
  renderConnectionPanel,
  readSamplesIfPresent,
} from './renderConnectionPanel.js';

const HEADER = 'timestamp,total,active,idle,cpu_percent,mem_mb';

describe('computeConnectionStats', () => {
  it('returns null when CSV is header-only', () => {
    expect(computeConnectionStats(HEADER + '\n')).toBeNull();
  });

  it('returns peak === mean for a single data row', () => {
    const csv = [HEADER, '2026-05-11T00:00:00Z,12,4,8,0,0'].join('\n');
    const stats = computeConnectionStats(csv);
    expect(stats).not.toBeNull();
    expect(stats!.sampleCount).toBe(1);
    expect(stats!.peak).toEqual({ total: 12, active: 4, idle: 8 });
    expect(stats!.mean).toEqual({ total: 12, active: 4, idle: 8 });
  });

  it('computes peak and rounded mean across multiple rows', () => {
    const csv = [
      HEADER,
      '2026-05-11T00:00:00Z,10,2,8,0,0',
      '2026-05-11T00:00:05Z,20,8,12,0,0',
      '2026-05-11T00:00:10Z,15,5,10,0,0',
    ].join('\n');
    const stats = computeConnectionStats(csv);
    expect(stats).not.toBeNull();
    expect(stats!.sampleCount).toBe(3);
    expect(stats!.peak).toEqual({ total: 20, active: 8, idle: 12 });
    // mean: total=(10+20+15)/3=15, active=(2+8+5)/3=5, idle=(8+12+10)/3=10
    expect(stats!.mean).toEqual({ total: 15, active: 5, idle: 10 });
  });

  it('filters out rows with malformed numeric data', () => {
    const csv = [
      HEADER,
      '2026-05-11T00:00:00Z,10,2,8,0,0',
      '2026-05-11T00:00:05Z,abc,xyz,def,0,0',
      '2026-05-11T00:00:10Z,20,4,16,0,0',
    ].join('\n');
    const stats = computeConnectionStats(csv);
    expect(stats).not.toBeNull();
    expect(stats!.sampleCount).toBe(2);
    expect(stats!.peak).toEqual({ total: 20, active: 4, idle: 16 });
    expect(stats!.mean).toEqual({ total: 15, active: 3, idle: 12 });
  });

  it('returns null when all rows are malformed', () => {
    const csv = [
      HEADER,
      '2026-05-11T00:00:00Z,abc,xyz,def,0,0',
      '2026-05-11T00:00:05Z,,,, ,',
    ].join('\n');
    expect(computeConnectionStats(csv)).toBeNull();
  });

  it('tolerates empty/whitespace lines mixed in', () => {
    const csv = [
      HEADER,
      '',
      '2026-05-11T00:00:00Z,10,2,8,0,0',
      '   ',
      '2026-05-11T00:00:05Z,20,4,16,0,0',
      '',
    ].join('\n');
    const stats = computeConnectionStats(csv);
    expect(stats).not.toBeNull();
    expect(stats!.sampleCount).toBe(2);
    expect(stats!.peak).toEqual({ total: 20, active: 4, idle: 16 });
    expect(stats!.mean).toEqual({ total: 15, active: 3, idle: 12 });
  });
});

describe('renderConnectionPanel', () => {
  it('emits the expected markdown shape', () => {
    const md = renderConnectionPanel({
      peak: { total: 20, active: 8, idle: 12 },
      mean: { total: 15, active: 5, idle: 10 },
      sampleCount: 36,
    });
    expect(md).toContain('## Database connection pool');
    expect(md).toContain('_36 samples over the run._');
    expect(md).toContain('| peak  | 20 | 8 | 12 |');
    expect(md).toContain('| mean  | 15 | 5 | 10 |');
  });
});

describe('readSamplesIfPresent', () => {
  it('returns the file contents when the file exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'boject-conn-panel-'));
    const path = join(dir, 'pg-samples.csv');
    const payload = HEADER + '\n2026-05-11T00:00:00Z,10,2,8,0,0\n';
    await writeFile(path, payload);
    const got = await readSamplesIfPresent(path);
    expect(got).toBe(payload);
  });

  it('returns null when the file does not exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'boject-conn-panel-'));
    const got = await readSamplesIfPresent(join(dir, 'missing.csv'));
    expect(got).toBeNull();
  });
});
