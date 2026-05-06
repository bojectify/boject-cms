import { afterEach, describe, expect, it, vi } from 'vitest';
import { runPerfScenario } from './scenario.js';
import * as preflightModule from '../../perf/preflight.js';
import * as runK6Module from '../../perf/runK6.js';
import * as renderModule from '../../perf/render.js';
import * as confirmModule from '../../perf/confirm.js';

afterEach(() => vi.restoreAllMocks());

const baseFlags = {
  url: 'https://cms.example.com',
  contentType: 'Article',
  yes: true,
  out: undefined as string | undefined,
};

const okPreflight = {
  ok: true as const,
  fields: {
    listField: 'articleList',
    filterField: 'publishDate',
    relationField: 'author',
  },
  warnings: [],
};

describe('runPerfScenario', () => {
  it('errors when scenario name is missing', async () => {
    const r = await runPerfScenario({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: { ...baseFlags, scenario: undefined },
      stdout: () => {},
      stderr: () => {},
    });
    expect(r.exitCode).toBe(3);
  });

  it('errors when scenario name is not graphql-flat or graphql-sitemap', async () => {
    const stderr: string[] = [];
    const r = await runPerfScenario({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: { ...baseFlags, scenario: 'rest-crud-cycle' },
      stdout: () => {},
      stderr: (l) => stderr.push(l),
    });
    expect(r.exitCode).toBe(3);
    expect(stderr.join('\n')).toMatch(/seed mode|#171/);
  });

  it('runs graphql-flat across all three shapes', async () => {
    vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue(okPreflight);
    const runK6 = vi.spyOn(runK6Module, 'runK6').mockResolvedValue({
      ok: true,
      exitCode: 0,
      rawJsonPath: '/tmp/raw.json',
      stderrLogPath: '/tmp/stderr.log',
    });
    vi.spyOn(renderModule, 'renderReport').mockResolvedValue();
    vi.spyOn(confirmModule, 'confirmHeavyRun').mockResolvedValue(true);

    const r = await runPerfScenario({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: { ...baseFlags, scenario: 'graphql-flat' },
      stdout: () => {},
      stderr: () => {},
    });
    expect(r.exitCode).toBe(0);
    expect(runK6).toHaveBeenCalledTimes(3);
    const shapes = runK6.mock.calls.map((c) => c[0].env.PERF_QUERY_SHAPE);
    expect(shapes).toEqual(['bare', 'filtered', 'relation']);
  });

  it('skips filtered shape when introspection finds no DATETIME', async () => {
    vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue({
      ok: true,
      fields: {
        listField: 'articleList',
        filterField: null,
        relationField: 'author',
      },
      warnings: ['filtered shape skipped — no DATETIME field on Article'],
    });
    const runK6 = vi.spyOn(runK6Module, 'runK6').mockResolvedValue({
      ok: true,
      exitCode: 0,
      rawJsonPath: '/tmp/raw.json',
      stderrLogPath: '/tmp/stderr.log',
    });
    vi.spyOn(renderModule, 'renderReport').mockResolvedValue();
    vi.spyOn(confirmModule, 'confirmHeavyRun').mockResolvedValue(true);

    await runPerfScenario({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: { ...baseFlags, scenario: 'graphql-flat' },
      stdout: () => {},
      stderr: () => {},
    });
    const shapes = runK6.mock.calls.map((c) => c[0].env.PERF_QUERY_SHAPE);
    expect(shapes).toEqual(['bare', 'relation']);
  });

  it('returns 130 when user declines confirm prompt', async () => {
    vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue(okPreflight);
    vi.spyOn(confirmModule, 'confirmHeavyRun').mockResolvedValue(false);
    const r = await runPerfScenario({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: { ...baseFlags, scenario: 'graphql-flat', yes: false },
      stdout: () => {},
      stderr: () => {},
    });
    expect(r.exitCode).toBe(130);
  });

  it('returns 1 (partial) and renders when k6 fails mid-run', async () => {
    vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue(okPreflight);
    vi.spyOn(runK6Module, 'runK6')
      .mockResolvedValueOnce({
        ok: true,
        exitCode: 0,
        rawJsonPath: '/tmp/raw.json',
        stderrLogPath: '/tmp/stderr.log',
      })
      .mockResolvedValueOnce({
        ok: true,
        exitCode: 1,
        rawJsonPath: '/tmp/raw.json',
        stderrLogPath: '/tmp/stderr.log',
      });
    const renderSpy = vi
      .spyOn(renderModule, 'renderReport')
      .mockResolvedValue();
    vi.spyOn(confirmModule, 'confirmHeavyRun').mockResolvedValue(true);

    const r = await runPerfScenario({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: { ...baseFlags, scenario: 'graphql-flat' },
      stdout: () => {},
      stderr: () => {},
    });
    expect(r.exitCode).toBe(1);
    expect(renderSpy).toHaveBeenCalled();
    const renderedMeta = renderSpy.mock.calls[0]?.[0].runMetadata;
    expect(renderedMeta?.partial).toBe(true);
  });
});
