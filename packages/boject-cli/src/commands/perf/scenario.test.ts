import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPerfScenario } from './scenario.js';
import * as preflightModule from '../../perf/preflight.js';
import * as runK6Module from '../../perf/runK6.js';
import * as renderModule from '../../perf/render.js';
import * as confirmModule from '../../perf/confirm.js';

const baseFlags = {
  url: 'https://cms.example.com',
  contentType: 'Article',
  yes: true,
  out: undefined as string | undefined,
  readOnly: true,
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
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'boject-perf-scenario-'));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('errors when scenario name is missing', async () => {
    const r = await runPerfScenario({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: { ...baseFlags, scenario: undefined, out: outDir },
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
      flags: { ...baseFlags, scenario: 'rest-crud-cycle', out: outDir },
      stdout: () => {},
      stderr: (l) => stderr.push(l),
    });
    expect(r.exitCode).toBe(3);
    expect(stderr.join('\n')).toMatch(/seed mode|#171/);
  });

  it('runs graphql-flat across all three shapes', async () => {
    vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue(okPreflight);
    const runK6 = vi
      .spyOn(runK6Module, 'runK6')
      .mockImplementation(async (p) => ({
        ok: true,
        exitCode: 0,
        rawJsonPath: `${p.outDir}/${p.rawFilename ?? 'raw.json'}`,
        stderrLogPath: `${p.outDir}/k6-stderr.log`,
      }));
    vi.spyOn(renderModule, 'renderReport').mockResolvedValue();
    vi.spyOn(confirmModule, 'confirmHeavyRun').mockResolvedValue(true);

    const r = await runPerfScenario({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: { ...baseFlags, scenario: 'graphql-flat', out: outDir },
      stdout: () => {},
      stderr: () => {},
    });
    expect(r.exitCode).toBe(0);
    expect(runK6).toHaveBeenCalledTimes(3);
    const shapes = runK6.mock.calls.map((c) => c[0].env.PERF_QUERY_SHAPE);
    expect(shapes).toEqual(['bare', 'filtered', 'relation']);
    const rawFilenames = runK6.mock.calls.map((c) => c[0].rawFilename);
    expect(rawFilenames).toEqual([
      'raw-bare.json',
      'raw-filtered.json',
      'raw-relation.json',
    ]);
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
    const runK6 = vi
      .spyOn(runK6Module, 'runK6')
      .mockImplementation(async (p) => ({
        ok: true,
        exitCode: 0,
        rawJsonPath: `${p.outDir}/${p.rawFilename ?? 'raw.json'}`,
        stderrLogPath: `${p.outDir}/k6-stderr.log`,
      }));
    vi.spyOn(renderModule, 'renderReport').mockResolvedValue();
    vi.spyOn(confirmModule, 'confirmHeavyRun').mockResolvedValue(true);

    await runPerfScenario({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: { ...baseFlags, scenario: 'graphql-flat', out: outDir },
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
      flags: {
        ...baseFlags,
        scenario: 'graphql-flat',
        yes: false,
        out: outDir,
      },
      stdout: () => {},
      stderr: () => {},
    });
    expect(r.exitCode).toBe(130);
  });

  it('returns 1 (partial) and renders when k6 fails mid-run', async () => {
    vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue(okPreflight);
    let call = 0;
    vi.spyOn(runK6Module, 'runK6').mockImplementation(async (p) => {
      const exitCode = call++ === 1 ? 1 : 0;
      return {
        ok: true,
        exitCode,
        rawJsonPath: `${p.outDir}/${p.rawFilename ?? 'raw.json'}`,
        stderrLogPath: `${p.outDir}/k6-stderr.log`,
      };
    });
    const renderSpy = vi
      .spyOn(renderModule, 'renderReport')
      .mockResolvedValue();
    vi.spyOn(confirmModule, 'confirmHeavyRun').mockResolvedValue(true);

    const r = await runPerfScenario({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: { ...baseFlags, scenario: 'graphql-flat', out: outDir },
      stdout: () => {},
      stderr: () => {},
    });
    expect(r.exitCode).toBe(1);
    expect(renderSpy).toHaveBeenCalled();
    const renderedMeta = renderSpy.mock.calls[0]?.[0].runMetadata;
    expect(renderedMeta?.partial).toBe(true);
  });

  it('forwards --target-rps via PERF_TARGET_RPS env and scales metadata stages', async () => {
    vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue(okPreflight);
    const runK6 = vi
      .spyOn(runK6Module, 'runK6')
      .mockImplementation(async (p) => ({
        ok: true,
        exitCode: 0,
        rawJsonPath: `${p.outDir}/${p.rawFilename ?? 'raw.json'}`,
        stderrLogPath: `${p.outDir}/k6-stderr.log`,
      }));
    const renderSpy = vi
      .spyOn(renderModule, 'renderReport')
      .mockResolvedValue();
    vi.spyOn(confirmModule, 'confirmHeavyRun').mockResolvedValue(true);

    await runPerfScenario({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: {
        ...baseFlags,
        scenario: 'graphql-flat',
        out: outDir,
        targetRps: 4000,
      },
      stdout: () => {},
      stderr: () => {},
    });

    // PERF_TARGET_RPS forwarded to k6 on every shape invocation.
    for (const call of runK6.mock.calls) {
      expect(call[0].env.PERF_TARGET_RPS).toBe('4000');
    }
    const renderedMeta = renderSpy.mock.calls[0]?.[0].runMetadata;
    expect(renderedMeta?.intensity.targetRps).toBe(4000);
    // Default ramp scaled from targetRps: [100, 200, 500, 1000, 2000, 4000].
    expect(renderedMeta?.intensity.stages).toEqual([
      100, 200, 500, 1000, 2000, 4000,
    ]);
  });

  it('forwards --stages via PERF_STAGES env and reflects them in metadata', async () => {
    vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue(okPreflight);
    const runK6 = vi
      .spyOn(runK6Module, 'runK6')
      .mockImplementation(async (p) => ({
        ok: true,
        exitCode: 0,
        rawJsonPath: `${p.outDir}/${p.rawFilename ?? 'raw.json'}`,
        stderrLogPath: `${p.outDir}/k6-stderr.log`,
      }));
    const renderSpy = vi
      .spyOn(renderModule, 'renderReport')
      .mockResolvedValue();
    vi.spyOn(confirmModule, 'confirmHeavyRun').mockResolvedValue(true);

    await runPerfScenario({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: {
        ...baseFlags,
        scenario: 'graphql-flat',
        out: outDir,
        stages: [10, 50, 100],
      },
      stdout: () => {},
      stderr: () => {},
    });

    for (const call of runK6.mock.calls) {
      expect(call[0].env.PERF_STAGES).toBe('10,50,100');
    }
    const renderedMeta = renderSpy.mock.calls[0]?.[0].runMetadata;
    expect(renderedMeta?.intensity.stages).toEqual([10, 50, 100]);
  });

  it('returns 2 with hint when output dir cannot be created', async () => {
    vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue(okPreflight);
    vi.spyOn(confirmModule, 'confirmHeavyRun').mockResolvedValue(true);

    // /dev/null/no can never be created — mkdir fails with ENOTDIR /
    // EEXIST depending on platform but always rejects.
    const stderr: string[] = [];
    const r = await runPerfScenario({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: {
        ...baseFlags,
        scenario: 'graphql-flat',
        out: '/dev/null/no',
      },
      stdout: () => {},
      stderr: (l) => stderr.push(l),
    });
    expect(r.exitCode).toBe(2);
    expect(stderr.join('\n')).toMatch(/cannot create output directory/i);
    expect(stderr.join('\n')).toMatch(/--out/);
  });

  it('hard-fails with exit code 2 when neither --read-only nor a seed transport is set (#159)', async () => {
    const stderrLines: string[] = [];
    const r = await runPerfScenario({
      cwd: process.cwd(),
      apiKey: 'boject_test',
      flags: {
        scenario: 'graphql-flat',
        url: 'http://cms.test',
        apiKey: 'boject_test',
        contentType: 'Article',
        yes: true,
      },
      stdout: () => {},
      stderr: (line) => stderrLines.push(line),
    });
    expect(r.exitCode).toBe(2);
    expect(
      stderrLines.some((l) => /--read-only|--database-url|--http-seed/.test(l))
    ).toBe(true);
  });

  it('returns 1 with explicit error when all shapes fail', async () => {
    vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue(okPreflight);
    vi.spyOn(runK6Module, 'runK6').mockResolvedValue({
      ok: false,
      error: 'k6 process error: ENOENT',
    });
    vi.spyOn(confirmModule, 'confirmHeavyRun').mockResolvedValue(true);
    const renderSpy = vi
      .spyOn(renderModule, 'renderReport')
      .mockResolvedValue();

    const stderr: string[] = [];
    const r = await runPerfScenario({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: { ...baseFlags, scenario: 'graphql-flat', out: outDir },
      stdout: () => {},
      stderr: (l) => stderr.push(l),
    });
    expect(r.exitCode).toBe(1);
    expect(stderr.join('\n')).toMatch(/no data captured/i);
    expect(renderSpy).not.toHaveBeenCalled();
  });
});
