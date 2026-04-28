import { describe, expect, it } from 'vitest';
import {
  parsePositiveInt,
  parseSizeList,
  planSweep,
  runSweep,
  type Step,
} from './sweep';

type ScenarioStep = Extract<Step, { kind: 'scenario' }>;
const isScenario = (s: Step): s is ScenarioStep => s.kind === 'scenario';

describe('planSweep', () => {
  it('generates one reset+seed pair per size, nested scenario runs', () => {
    const plan = planSweep({
      sizes: [1000, 10000],
      pageSizes: [100, 500],
      vusLevels: [1, 5],
    });
    const steps = plan.map((s) => s.kind);
    expect(steps.filter((k) => k === 'reset').length).toBe(2);
    expect(steps.filter((k) => k === 'seed').length).toBe(2);
    expect(
      plan.filter((s) => s.kind === 'scenario' && s.name === 'graphql-sitemap')
        .length
    ).toBe(8); // 2 sizes × 2 page × 2 vus
  });

  it('emits no flat scenarios when sizes do not include the 30K waypoint', () => {
    const plan = planSweep({
      sizes: [1000, 10000],
      pageSizes: [100],
      vusLevels: [1],
    });
    expect(
      plan.filter((s) => s.kind === 'scenario' && s.name === 'graphql-flat')
    ).toHaveLength(0);
  });

  it('runs flat scenario only at the 30K waypoint', () => {
    const plan = planSweep({
      sizes: [1000, 30000, 100000],
      pageSizes: [100],
      vusLevels: [1],
    });
    const flat = plan
      .filter(isScenario)
      .filter((s) => s.name === 'graphql-flat');
    expect(flat).toHaveLength(3); // bare + filtered + relation shapes
    flat.forEach((s) => expect(s.size).toBe(30000));
  });

  it('appends REST CRUD scenario once at the end', () => {
    const plan = planSweep({
      sizes: [1000],
      pageSizes: [100],
      vusLevels: [1],
    });
    const last = plan.at(-1);
    expect(last && isScenario(last) && last.name).toBe('rest-crud-cycle');
  });

  it('defaults PERF_CRUD_N to 10000 and threads an explicit value through', () => {
    const find = (plan: Step[]): ScenarioStep | undefined =>
      plan.filter(isScenario).find((s) => s.name === 'rest-crud-cycle');

    const defaultPlan = planSweep({
      sizes: [1000],
      pageSizes: [100],
      vusLevels: [1],
    });
    expect(find(defaultPlan)?.env.PERF_CRUD_N).toBe('10000');

    const customPlan = planSweep({
      sizes: [1000],
      pageSizes: [100],
      vusLevels: [1],
      crudN: 250,
    });
    expect(find(customPlan)?.env.PERF_CRUD_N).toBe('250');
  });
});

describe('parseSizeList', () => {
  it('parses a comma-separated list of positive numbers', () => {
    expect(parseSizeList('1000,10000,30000', 'PERF_SIZES')).toEqual([
      1000, 10000, 30000,
    ]);
  });

  it('trims whitespace around values', () => {
    expect(parseSizeList(' 100 , 500 , 1000 ', 'PERF_SIZES')).toEqual([
      100, 500, 1000,
    ]);
  });

  it('throws when any value is non-numeric', () => {
    expect(() => parseSizeList('100,foo,300', 'PERF_SIZES')).toThrow(
      /Invalid PERF_SIZES/
    );
  });

  it('throws when any value is zero or negative', () => {
    expect(() => parseSizeList('100,0,300', 'PERF_SIZES')).toThrow();
    expect(() => parseSizeList('-1,2', 'PERF_SIZES')).toThrow();
  });
});

describe('parsePositiveInt', () => {
  it('parses a positive integer string', () => {
    expect(parsePositiveInt('250', 'PERF_CRUD_N')).toBe(250);
  });

  it('throws on non-numeric input', () => {
    expect(() => parsePositiveInt('many', 'PERF_CRUD_N')).toThrow();
  });

  it('throws on zero or negative values', () => {
    expect(() => parsePositiveInt('0', 'PERF_CRUD_N')).toThrow();
    expect(() => parsePositiveInt('-1', 'PERF_CRUD_N')).toThrow();
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
