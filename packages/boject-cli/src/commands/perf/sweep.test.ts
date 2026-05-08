import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPerfSweep } from './sweep.js';
import * as preflightModule from '../../perf/preflight.js';
import * as runK6Module from '../../perf/runK6.js';
import * as renderModule from '../../perf/render.js';
import * as confirmModule from '../../perf/confirm.js';
import * as resetModule from './reset.js';
import * as seedModule from './seed.js';

describe('runPerfSweep', () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'boject-perf-sweep-'));
  });
  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('runs sitemap × matrix + flat × shapes', async () => {
    vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue({
      ok: true,
      fields: {
        listField: 'articleList',
        filterField: 'publishDate',
        relationField: 'author',
      },
      warnings: [],
    });
    const runK6 = vi
      .spyOn(runK6Module, 'runK6')
      .mockImplementation(async (p) => ({
        ok: true,
        exitCode: 0,
        rawJsonPath: join(p.outDir, p.rawFilename ?? 'raw.json'),
        stderrLogPath: join(p.outDir, 'k6-stderr.log'),
      }));
    vi.spyOn(renderModule, 'renderReport').mockResolvedValue();
    vi.spyOn(confirmModule, 'confirmHeavyRun').mockResolvedValue(true);

    const r = await runPerfSweep({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: {
        url: 'https://x.example.com',
        contentType: 'Article',
        out: outDir,
        yes: true,
        pageSizes: [100, 500],
        vus: [1, 5],
        readOnly: true,
      },
      stdout: () => {},
      stderr: () => {},
    });
    expect(r.exitCode).toBe(0);

    // 4 sitemap (2 page sizes × 2 VUs) + 3 flat shapes = 7 invocations.
    expect(runK6).toHaveBeenCalledTimes(7);

    const sitemapCalls = runK6.mock.calls.filter((c) =>
      String(c[0].scenarioFile).endsWith('graphql-sitemap.ts')
    );
    expect(sitemapCalls).toHaveLength(4);
    const sitemapEnvs = sitemapCalls.map((c) => ({
      pageSize: c[0].env.PERF_PAGE_SIZE,
      vus: c[0].env.PERF_VUS,
    }));
    expect(sitemapEnvs).toEqual(
      expect.arrayContaining([
        { pageSize: '100', vus: '1' },
        { pageSize: '100', vus: '5' },
        { pageSize: '500', vus: '1' },
        { pageSize: '500', vus: '5' },
      ])
    );

    const flatCalls = runK6.mock.calls.filter((c) =>
      String(c[0].scenarioFile).endsWith('graphql-flat.ts')
    );
    expect(flatCalls).toHaveLength(3);
    const flatShapes = flatCalls.map((c) => c[0].env.PERF_QUERY_SHAPE);
    expect(flatShapes).toEqual(['bare', 'filtered', 'relation']);
  });

  it('returns 1 with explicit error when all runs fail', async () => {
    vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue({
      ok: true,
      fields: {
        listField: 'articleList',
        filterField: 'publishDate',
        relationField: 'author',
      },
      warnings: [],
    });
    vi.spyOn(runK6Module, 'runK6').mockResolvedValue({
      ok: false,
      error: 'k6 process error: ENOENT',
    });
    vi.spyOn(confirmModule, 'confirmHeavyRun').mockResolvedValue(true);
    const renderSpy = vi
      .spyOn(renderModule, 'renderReport')
      .mockResolvedValue();

    const stderr: string[] = [];
    const r = await runPerfSweep({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: {
        url: 'https://x.example.com',
        contentType: 'Article',
        out: outDir,
        yes: true,
        pageSizes: [100],
        vus: [1],
        readOnly: true,
      },
      stdout: () => {},
      stderr: (l) => stderr.push(l),
    });
    expect(r.exitCode).toBe(1);
    expect(stderr.join('\n')).toMatch(/no data captured/i);
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it('returns 130 when user declines confirm prompt', async () => {
    vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue({
      ok: true,
      fields: {
        listField: 'articleList',
        filterField: 'publishDate',
        relationField: 'author',
      },
      warnings: [],
    });
    vi.spyOn(confirmModule, 'confirmHeavyRun').mockResolvedValue(false);
    const r = await runPerfSweep({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: {
        url: 'https://x.example.com',
        contentType: 'Article',
        out: outDir,
        yes: false,
        readOnly: true,
      },
      stdout: () => {},
      stderr: () => {},
    });
    expect(r.exitCode).toBe(130);
  });

  it('errors on missing apiKey/url/contentType', async () => {
    const r1 = await runPerfSweep({
      cwd: process.cwd(),
      apiKey: undefined,
      flags: {
        url: 'https://x.example.com',
        contentType: 'Article',
        out: outDir,
        yes: true,
        readOnly: true,
      },
      stdout: () => {},
      stderr: () => {},
    });
    expect(r1.exitCode).toBe(2);

    const r2 = await runPerfSweep({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: { contentType: 'Article', out: outDir, yes: true, readOnly: true },
      stdout: () => {},
      stderr: () => {},
    });
    expect(r2.exitCode).toBe(2);

    const r3 = await runPerfSweep({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: {
        url: 'https://x.example.com',
        out: outDir,
        yes: true,
        readOnly: true,
      },
      stdout: () => {},
      stderr: () => {},
    });
    expect(r3.exitCode).toBe(3);
  });

  it('attributes partial outcome per-scenario when only flat fails', async () => {
    vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue({
      ok: true,
      fields: {
        listField: 'articleList',
        filterField: 'publishDate',
        relationField: 'author',
      },
      warnings: [],
    });
    vi.spyOn(runK6Module, 'runK6').mockImplementation(async (p) => {
      const exitCode = String(p.scenarioFile).endsWith('graphql-flat.ts')
        ? 1
        : 0;
      return {
        ok: true,
        exitCode,
        rawJsonPath: join(p.outDir, p.rawFilename ?? 'raw.json'),
        stderrLogPath: join(p.outDir, 'k6-stderr.log'),
      };
    });
    const renderSpy = vi
      .spyOn(renderModule, 'renderReport')
      .mockResolvedValue();
    vi.spyOn(confirmModule, 'confirmHeavyRun').mockResolvedValue(true);

    await runPerfSweep({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: {
        url: 'https://x.example.com',
        contentType: 'Article',
        out: outDir,
        yes: true,
        pageSizes: [100],
        vus: [1],
        readOnly: true,
      },
      stdout: () => {},
      stderr: () => {},
    });

    const renderedMeta = renderSpy.mock.calls[0]?.[0].runMetadata;
    expect(renderedMeta?.scenarios[0]?.name).toBe('graphql-sitemap');
    expect(renderedMeta?.scenarios[0]?.outcome).toBe('completed');
    expect(renderedMeta?.scenarios[1]?.name).toBe('graphql-flat');
    expect(renderedMeta?.scenarios[1]?.outcome).toBe('partial');
    expect(renderedMeta).toMatchObject({
      partial: true,
      partialFailureSource: 'k6',
      mode: 'read-only',
    });
  });

  it("renders a partial report when reset throws (partialFailureSource: 'reset')", async () => {
    vi.spyOn(resetModule, 'runPerfReset').mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:5432')
    );
    const preflightSpy = vi.spyOn(preflightModule, 'runPreflight');
    const runK6Spy = vi.spyOn(runK6Module, 'runK6');
    const renderSpy = vi
      .spyOn(renderModule, 'renderReport')
      .mockResolvedValue();

    const stderr: string[] = [];
    const r = await runPerfSweep({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: {
        url: 'https://x.example.com',
        contentType: 'Article',
        out: outDir,
        yes: true,
        databaseUrl: 'postgresql://boject:boject@localhost:5432/boject_perf',
        reset: true,
        allowDatabase: ['boject_perf'],
      },
      stdout: () => {},
      stderr: (l) => stderr.push(l),
    });
    expect(r.exitCode).toBe(1);
    expect(preflightSpy).not.toHaveBeenCalled();
    expect(runK6Spy).not.toHaveBeenCalled();
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(renderSpy.mock.calls[0]?.[0].runMetadata).toMatchObject({
      partial: true,
      partialFailureSource: 'reset',
      mode: 'seed-direct',
      seedSize: null,
    });
  });

  it("renders a partial report when seed throws (partialFailureSource: 'seed')", async () => {
    vi.spyOn(seedModule, 'runPerfSeed').mockRejectedValue(
      new Error('seed bundle missing required field')
    );
    const preflightSpy = vi.spyOn(preflightModule, 'runPreflight');
    const runK6Spy = vi.spyOn(runK6Module, 'runK6');
    const renderSpy = vi
      .spyOn(renderModule, 'renderReport')
      .mockResolvedValue();

    const stderr: string[] = [];
    const r = await runPerfSweep({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: {
        url: 'https://x.example.com',
        contentType: 'Article',
        out: outDir,
        yes: true,
        httpSeed: true,
        seed: 7,
        size: 50,
      },
      stdout: () => {},
      stderr: (l) => stderr.push(l),
    });
    expect(r.exitCode).toBe(1);
    expect(preflightSpy).not.toHaveBeenCalled();
    expect(runK6Spy).not.toHaveBeenCalled();
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(renderSpy.mock.calls[0]?.[0].runMetadata).toMatchObject({
      partial: true,
      partialFailureSource: 'seed',
      mode: 'seed-http',
      seedSize: null,
      seedDeterministicSeed: 7,
    });
  });

  it('returns 2 with hint when output dir cannot be created', async () => {
    vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue({
      ok: true,
      fields: {
        listField: 'articleList',
        filterField: 'publishDate',
        relationField: 'author',
      },
      warnings: [],
    });
    vi.spyOn(confirmModule, 'confirmHeavyRun').mockResolvedValue(true);

    // /dev/null/no can never be created — mkdir fails on POSIX.
    const stderr: string[] = [];
    const r = await runPerfSweep({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: {
        url: 'https://x.example.com',
        contentType: 'Article',
        out: '/dev/null/no',
        yes: true,
        readOnly: true,
      },
      stdout: () => {},
      stderr: (l) => stderr.push(l),
    });
    expect(r.exitCode).toBe(2);
    expect(stderr.join('\n')).toMatch(/cannot create output directory/i);
    expect(stderr.join('\n')).toMatch(/--out/);
  });

  it('uses default matrix [100,500,1000] × [1,5,20] when flags omitted', async () => {
    vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue({
      ok: true,
      fields: {
        listField: 'articleList',
        filterField: 'publishDate',
        relationField: 'author',
      },
      warnings: [],
    });
    const runK6 = vi
      .spyOn(runK6Module, 'runK6')
      .mockImplementation(async (p) => ({
        ok: true,
        exitCode: 0,
        rawJsonPath: join(p.outDir, p.rawFilename ?? 'raw.json'),
        stderrLogPath: join(p.outDir, 'k6-stderr.log'),
      }));
    vi.spyOn(renderModule, 'renderReport').mockResolvedValue();
    vi.spyOn(confirmModule, 'confirmHeavyRun').mockResolvedValue(true);

    await runPerfSweep({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: {
        url: 'https://x.example.com',
        contentType: 'Article',
        out: outDir,
        yes: true,
        readOnly: true,
        // pageSizes / vus omitted
      },
      stdout: () => {},
      stderr: () => {},
    });

    // Default matrix: 3 page sizes × 3 VUs = 9 sitemap + 3 flat = 12 total
    expect(runK6).toHaveBeenCalledTimes(12);
  });

  it('hard-fails with exit code 2 when neither --read-only nor a seed transport is set (#159)', async () => {
    const stderrLines: string[] = [];
    const r = await runPerfSweep({
      cwd: process.cwd(),
      apiKey: 'boject_test',
      flags: {
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
});
