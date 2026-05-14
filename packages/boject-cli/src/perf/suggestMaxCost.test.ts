import { describe, it, expect } from 'vitest';
import { suggestMaxCost } from './suggestMaxCost.js';

describe('suggestMaxCost', () => {
  const healthyFlatStats = [
    {
      scenario: 'flat',
      shape: 'bare',
      pageSize: '-',
      count: 100,
      p50: 1,
      p95: 5,
      p99: 8,
      errorRate: 0,
    },
    {
      scenario: 'flat',
      shape: 'relation',
      pageSize: '-',
      count: 100,
      p50: 1,
      p95: 5,
      p99: 8,
      errorRate: 0,
    },
  ];

  it('returns mode=info when currentMaxCost is undefined', () => {
    const r = suggestMaxCost(healthyFlatStats, {});
    expect(r).not.toBeNull();
    expect(r!.mode).toBe('info');
    expect(r!.suggested).toBeGreaterThan(0);
  });

  it('returns mode=green when suggested >= currentMaxCost', () => {
    const r = suggestMaxCost(healthyFlatStats, { currentMaxCost: 500 });
    expect(r).not.toBeNull();
    expect(r!.mode).toBe('green');
    expect(r!.suggested).toBeGreaterThanOrEqual(500);
  });

  it('returns mode=warn when suggested < currentMaxCost', () => {
    const stressed = [
      {
        scenario: 'flat',
        shape: 'bare',
        pageSize: '-',
        count: 100,
        p50: 50,
        p95: 400,
        p99: 800,
        errorRate: 0.05,
      },
      {
        scenario: 'flat',
        shape: 'relation',
        pageSize: '-',
        count: 100,
        p50: 80,
        p95: 600,
        p99: 1200,
        errorRate: 0.1,
      },
    ];
    const r = suggestMaxCost(stressed, { currentMaxCost: 5000 });
    expect(r).not.toBeNull();
    expect(r!.mode).toBe('warn');
    expect(r!.suggested).toBeLessThan(5000);
  });

  it('returns null when no graphql-flat stats present', () => {
    const r = suggestMaxCost([], {});
    expect(r).toBeNull();
  });

  it('falls back to bare-only when relation shape is missing', () => {
    const bareOnly = [
      {
        scenario: 'flat',
        shape: 'bare',
        pageSize: '-',
        count: 100,
        p50: 1,
        p95: 5,
        p99: 8,
        errorRate: 0,
      },
    ];
    const r = suggestMaxCost(bareOnly, {});
    expect(r).not.toBeNull();
    expect(r!.suggested).toBeGreaterThan(0);
  });
});
