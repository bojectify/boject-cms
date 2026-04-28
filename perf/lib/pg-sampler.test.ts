import { describe, expect, it, vi } from 'vitest';
import { sampleOnce, formatCsvRow, parseIntervalMs } from './pg-sampler';

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
