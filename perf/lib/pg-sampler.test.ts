import { describe, expect, it, vi } from 'vitest';
import {
  sampleOnce,
  formatCsvRow,
  nextTickDelay,
  parseDockerStatsJson,
  parseIntervalMs,
} from './pg-sampler';

describe('sampleOnce', () => {
  it('queries pg_stat_activity and returns connection + activity counts', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ total: '8', active: '3', idle: '5' }],
    });
    const dockerStats = vi.fn().mockResolvedValue({
      cpu_percent: 42.5,
      mem_mb: 512,
    });
    const sample = await sampleOnce({ query, dockerStats });
    expect(sample.total).toBe(8);
    expect(sample.active).toBe(3);
    expect(sample.idle).toBe(5);
    expect(sample.cpuPercent).toBe(42.5);
    expect(sample.memMb).toBe(512);
    expect(sample.timestamp).toBeInstanceOf(Date);
  });
});

describe('formatCsvRow', () => {
  it('emits comma-separated numeric values with ISO timestamp', () => {
    const row = formatCsvRow({
      timestamp: new Date('2026-01-01T00:00:00.000Z'),
      total: 8,
      active: 3,
      idle: 5,
      cpuPercent: 42.5,
      memMb: 512,
    });
    expect(row).toBe('2026-01-01T00:00:00.000Z,8,3,5,42.5,512');
  });
});

describe('parseDockerStatsJson', () => {
  it('extracts CPU percent and memory MiB from a typical line', () => {
    const line = '{"CPUPerc":"42.5%","MemUsage":"512MiB / 1GiB"}';
    const result = parseDockerStatsJson(line);
    expect(result.cpu_percent).toBe(42.5);
    expect(result.mem_mb).toBe(512);
  });

  it('strips whitespace and percent sign from CPUPerc', () => {
    const line = '{"CPUPerc":" 12.3 %","MemUsage":"100MiB / 1GiB"}';
    expect(parseDockerStatsJson(line).cpu_percent).toBe(12.3);
  });

  it('parses fractional MiB values', () => {
    const line = '{"CPUPerc":"5%","MemUsage":"512.75MiB / 1GiB"}';
    expect(parseDockerStatsJson(line).mem_mb).toBe(512.75);
  });

  it('trims surrounding whitespace before JSON.parse', () => {
    const line = '\n{"CPUPerc":"5%","MemUsage":"50MiB / 1GiB"}\n';
    const result = parseDockerStatsJson(line);
    expect(result.cpu_percent).toBe(5);
    expect(result.mem_mb).toBe(50);
  });

  it('returns mem_mb=0 for non-MiB units (documents current behaviour)', () => {
    // The regex only matches `MiB`. KiB / GiB inputs fall back to 0,
    // which surfaces as "no memory data" in the CSV. If/when docker
    // starts emitting GiB for the perf container, parser + CSV need
    // unit conversion — flagged here so the failure is not silent.
    expect(
      parseDockerStatsJson('{"CPUPerc":"1%","MemUsage":"1.5GiB / 4GiB"}').mem_mb
    ).toBe(0);
    expect(
      parseDockerStatsJson('{"CPUPerc":"1%","MemUsage":"800KiB / 1GiB"}').mem_mb
    ).toBe(0);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseDockerStatsJson('not json')).toThrow();
  });
});

describe('nextTickDelay', () => {
  it('schedules tick N at startedAt + N * intervalMs', () => {
    expect(
      nextTickDelay({ startedAt: 0, tickIndex: 1, intervalMs: 5000, now: 1500 })
    ).toBe(3500);
  });

  it('returns 0 when work overran the slot — no negative sleep', () => {
    expect(
      nextTickDelay({ startedAt: 0, tickIndex: 1, intervalMs: 5000, now: 7000 })
    ).toBe(0);
  });

  it('catches up on a fixed grid after an overrun (no drift accumulation)', () => {
    // Tick 1 fired at t=7000 (2s overrun). Tick 2 is anchored at t=10000,
    // so we sleep 3000ms — NOT 5000ms after tick 1 (which would compound).
    expect(
      nextTickDelay({ startedAt: 0, tickIndex: 2, intervalMs: 5000, now: 7000 })
    ).toBe(3000);
  });

  it('returns the full interval when sampling completes instantly', () => {
    expect(
      nextTickDelay({
        startedAt: 1000,
        tickIndex: 1,
        intervalMs: 5000,
        now: 1000,
      })
    ).toBe(5000);
  });
});

describe('parseIntervalMs', () => {
  it('defaults to 5000ms when env var is unset', () => {
    expect(parseIntervalMs(undefined)).toBe(5000);
  });

  it('parses a positive integer string', () => {
    expect(parseIntervalMs('1000')).toBe(1000);
  });

  it('throws on non-numeric input (e.g. "5s")', () => {
    expect(() => parseIntervalMs('5s')).toThrow(
      /Invalid PERF_SAMPLER_INTERVAL_MS/
    );
  });

  it('throws on zero or negative values', () => {
    expect(() => parseIntervalMs('0')).toThrow();
    expect(() => parseIntervalMs('-100')).toThrow();
  });
});
