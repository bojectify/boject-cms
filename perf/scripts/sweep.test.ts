import { describe, expect, it, vi } from 'vitest';
import { planSweep, runSweep } from './sweep';

describe('planSweep', () => {
  it('generates one reset+seed pair per size, nested scenario runs', () => {
    const plan = planSweep({
      sizes: [1000, 10000],
      pageSizes: [100, 500],
      vusLevels: [1, 5],
    });
    // 2 sizes × (reset + seed + 2 page × 2 vu sitemap runs) + 1 flat at 30K only (not 10K → 0)
    const steps = plan.map((s) => s.kind);
    expect(steps.filter((k) => k === 'reset').length).toBe(2);
    expect(steps.filter((k) => k === 'seed').length).toBe(2);
    expect(
      plan.filter((s) => s.kind === 'scenario' && s.name === 'graphql-sitemap')
        .length
    ).toBe(8); // 2 sizes × 2 page × 2 vus
  });

  it('runs flat scenario only at the 30K waypoint', () => {
    const plan = planSweep({
      sizes: [1000, 30000, 100000],
      pageSizes: [100],
      vusLevels: [1],
    });
    const flat = plan.filter(
      (s) => s.kind === 'scenario' && s.name === 'graphql-flat'
    );
    expect(flat).toHaveLength(3); // bare + filtered + relation shapes
    flat.forEach((s) => expect(s.size).toBe(30000));
  });

  it('appends REST CRUD scenario once at the end', () => {
    const plan = planSweep({
      sizes: [1000],
      pageSizes: [100],
      vusLevels: [1],
    });
    expect(plan[plan.length - 1]!.name).toBe('rest-crud-cycle');
  });
});

describe('runSweep', () => {
  it('invokes each step in order', async () => {
    const calls: string[] = [];
    await runSweep({
      plan: [
        { kind: 'reset' },
        { kind: 'seed', size: 1000 },
        {
          kind: 'scenario',
          name: 'graphql-sitemap',
          size: 1000,
          env: { PERF_PAGE_SIZE: '100', PERF_VUS: '1' },
        },
      ],
      reset: async () => {
        calls.push('reset');
      },
      seed: async (size) => {
        calls.push(`seed:${size}`);
      },
      scenario: async (name, env) => {
        calls.push(`scenario:${name}:${env.PERF_PAGE_SIZE}`);
      },
      render: async () => {
        calls.push('render');
      },
    });
    expect(calls).toEqual([
      'reset',
      'seed:1000',
      'scenario:graphql-sitemap:100',
      'render',
    ]);
  });
});
