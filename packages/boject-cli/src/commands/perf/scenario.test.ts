import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPerfScenario } from './scenario.js';
import * as preflightModule from '../../perf/preflight.js';
import * as runK6Module from '../../perf/runK6.js';
import * as renderModule from '../../perf/render.js';
import * as confirmModule from '../../perf/confirm.js';
import * as resetModule from './reset.js';
import * as seedModule from './seed.js';

import type { startPgSampler } from '../../perf/runPgSampler.js';

function makeFakeSampler(
  opts: { csvPath?: string; stopMs?: number; callOrder?: string[] } = {}
) {
  const stopSpy = vi.fn(async () => {
    if (opts.callOrder) opts.callOrder.push('stop');
    if (opts.stopMs) await new Promise((r) => setTimeout(r, opts.stopMs));
  });
  const factory = vi.fn<typeof startPgSampler>(async () => ({
    csvPath: opts.csvPath ?? '/tmp/fake-samples.csv',
    stop: stopSpy,
  }));
  return { stopSpy, factory };
}

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

  it('rest-crud-cycle --read-only is refused with exit 2 and an actionable hint', async () => {
    const preflightSpy = vi.spyOn(preflightModule, 'runPreflight');
    const runK6Spy = vi.spyOn(runK6Module, 'runK6');
    const stderr: string[] = [];
    const r = await runPerfScenario({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: {
        ...baseFlags,
        scenario: 'rest-crud-cycle',
        out: outDir,
        readOnly: true,
      },
      stdout: () => {},
      stderr: (l) => stderr.push(l),
    });
    expect(r.exitCode).toBe(2);
    const joined = stderr.join('\n');
    expect(joined).toMatch(/rest-crud-cycle mutates target state/);
    expect(joined).toMatch(/--database-url or --http-seed/);
    expect(preflightSpy).not.toHaveBeenCalled();
    expect(runK6Spy).not.toHaveBeenCalled();
  });

  it('unknown scenario errors with the updated three-scenario list', async () => {
    const stderr: string[] = [];
    const r = await runPerfScenario({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: { ...baseFlags, scenario: 'xyz', out: outDir },
      stdout: () => {},
      stderr: (l) => stderr.push(l),
    });
    expect(r.exitCode).toBe(3);
    const joined = stderr.join('\n');
    expect(joined).toMatch(/unknown scenario "xyz"/);
    expect(joined).toMatch(/graphql-flat/);
    expect(joined).toMatch(/graphql-sitemap/);
    expect(joined).toMatch(/rest-crud-cycle/);
  });

  it('rest-crud-cycle --database-url runs preflight and invokes k6 with the crud scenario file', async () => {
    vi.spyOn(seedModule, 'runPerfSeed').mockResolvedValue({ inserted: 1 });
    const preflightSpy = vi
      .spyOn(preflightModule, 'runPreflight')
      .mockResolvedValue(okPreflight);
    const runK6 = vi
      .spyOn(runK6Module, 'runK6')
      .mockImplementation(async (p) => ({
        ok: true,
        exitCode: 0,
        rawJsonPath: `${p.outDir}/${p.rawFilename ?? 'raw.json'}`,
        stderrLogPath: `${p.outDir}/k6-stderr.log`,
      }));
    vi.spyOn(renderModule, 'renderReport').mockResolvedValue();
    const { factory } = makeFakeSampler();

    const r = await runPerfScenario({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: {
        ...baseFlags,
        scenario: 'rest-crud-cycle',
        out: outDir,
        readOnly: false,
        databaseUrl: 'postgresql://boject:boject@localhost:5432/boject_perf',
        size: 1,
      },
      stdout: () => {},
      stderr: () => {},
      startPgSampler: factory,
    });
    expect(r.exitCode).toBe(0);
    expect(preflightSpy).toHaveBeenCalledTimes(1);
    expect(runK6).toHaveBeenCalledTimes(1);
    expect(runK6.mock.calls[0]?.[0].scenarioFile).toMatch(
      /vendor\/perf\/scenarios\/rest-crud-cycle\.ts$/
    );
  });

  it('rest-crud-cycle --http-seed runs k6 with the crud scenario file and skips the pg-sampler', async () => {
    vi.spyOn(seedModule, 'runPerfSeed').mockResolvedValue({ inserted: 1 });
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
    const { factory } = makeFakeSampler();

    const r = await runPerfScenario({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: {
        ...baseFlags,
        scenario: 'rest-crud-cycle',
        out: outDir,
        readOnly: false,
        httpSeed: true,
        size: 1,
      },
      stdout: () => {},
      stderr: () => {},
      startPgSampler: factory,
    });
    expect(r.exitCode).toBe(0);
    expect(runK6).toHaveBeenCalledTimes(1);
    expect(runK6.mock.calls[0]?.[0].scenarioFile).toMatch(
      /vendor\/perf\/scenarios\/rest-crud-cycle\.ts$/
    );
    // mode = 'seed-http' → sampler must NOT be started.
    expect(factory).not.toHaveBeenCalled();
  });

  it('rest-crud-cycle --crud-n 50 forwards PERF_CRUD_N=50 to k6', async () => {
    vi.spyOn(seedModule, 'runPerfSeed').mockResolvedValue({ inserted: 1 });
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

    const r = await runPerfScenario({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: {
        ...baseFlags,
        scenario: 'rest-crud-cycle',
        out: outDir,
        readOnly: false,
        httpSeed: true,
        size: 1,
        crudN: 50,
      },
      stdout: () => {},
      stderr: () => {},
    });
    expect(r.exitCode).toBe(0);
    expect(runK6).toHaveBeenCalledTimes(1);
    expect(runK6.mock.calls[0]?.[0].env.PERF_CRUD_N).toBe('50');
  });

  it('rest-crud-cycle without --crud-n omits PERF_CRUD_N (canonical default applies)', async () => {
    vi.spyOn(seedModule, 'runPerfSeed').mockResolvedValue({ inserted: 1 });
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

    const r = await runPerfScenario({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: {
        ...baseFlags,
        scenario: 'rest-crud-cycle',
        out: outDir,
        readOnly: false,
        httpSeed: true,
        size: 1,
      },
      stdout: () => {},
      stderr: () => {},
    });
    expect(r.exitCode).toBe(0);
    expect(runK6).toHaveBeenCalledTimes(1);
    expect(runK6.mock.calls[0]?.[0].env).not.toHaveProperty('PERF_CRUD_N');
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
    // preflight / k6 / confirm should not be reached in the reset-throw path
    const preflightSpy = vi.spyOn(preflightModule, 'runPreflight');
    const runK6Spy = vi.spyOn(runK6Module, 'runK6');
    const renderSpy = vi
      .spyOn(renderModule, 'renderReport')
      .mockResolvedValue();

    const stderr: string[] = [];
    const r = await runPerfScenario({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: {
        ...baseFlags,
        scenario: 'graphql-flat',
        out: outDir,
        readOnly: false,
        databaseUrl: 'postgresql://boject:boject@localhost:5432/boject_perf',
        reset: true,
        allowDatabase: ['boject_perf'],
        yes: true,
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
    const r = await runPerfScenario({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: {
        ...baseFlags,
        scenario: 'graphql-flat',
        out: outDir,
        readOnly: false,
        httpSeed: true,
        seed: 7,
        size: 50,
        yes: true,
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
      // runPerfSeed only returns on success today, so a throw means
      // seedResult is still null when the catch runs.
      seedSize: null,
      seedDeterministicSeed: 7,
    });
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

  it('--http-seed without --read-only sets requireContentWrite=true on preflight', async () => {
    vi.spyOn(seedModule, 'runPerfSeed').mockResolvedValue({ inserted: 0 });
    // Make preflight surface the missing-scope error so we can also pin
    // that scenario exits 2 and never invokes k6.
    const preflightSpy = vi
      .spyOn(preflightModule, 'runPreflight')
      .mockResolvedValue({
        ok: false,
        errors: [
          'API key missing required scope "content:write". Mint a new key with: boject apikey create --scopes content:write,content:read',
        ],
      });
    const runK6Spy = vi.spyOn(runK6Module, 'runK6');
    const probe = vi.fn(
      async () => ({ ok: false, missingScope: 'content:write' }) as const
    );

    const stderrLines: string[] = [];
    const r = await runPerfScenario({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: {
        ...baseFlags,
        scenario: 'graphql-flat',
        out: outDir,
        readOnly: false,
        httpSeed: true,
        size: 1,
      },
      stdout: () => {},
      stderr: (l) => stderrLines.push(l),
      probeContentWrite: probe,
    });

    expect(r.exitCode).toBe(2);
    expect(runK6Spy).not.toHaveBeenCalled();
    expect(preflightSpy).toHaveBeenCalledTimes(1);
    const preflightArgs = preflightSpy.mock.calls[0]?.[0];
    expect(preflightArgs?.requireContentWrite).toBe(true);
    // Probe is threaded through to runPreflight (test injection seam).
    expect(preflightArgs?.probeContentWrite).toBe(probe);
    expect(stderrLines.join('\n')).toMatch(
      /API key missing required scope "content:write"/
    );
  });

  it('--http-seed with passing preflight runs k6 as today', async () => {
    vi.spyOn(seedModule, 'runPerfSeed').mockResolvedValue({ inserted: 1 });
    const preflightSpy = vi
      .spyOn(preflightModule, 'runPreflight')
      .mockResolvedValue(okPreflight);
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
      flags: {
        ...baseFlags,
        scenario: 'graphql-flat',
        out: outDir,
        readOnly: false,
        httpSeed: true,
        size: 1,
      },
      stdout: () => {},
      stderr: () => {},
    });
    expect(r.exitCode).toBe(0);
    expect(preflightSpy).toHaveBeenCalledTimes(1);
    expect(preflightSpy.mock.calls[0]?.[0].requireContentWrite).toBe(true);
    expect(runK6).toHaveBeenCalled();
  });

  it('--http-seed --read-only sets requireContentWrite=false (read-only wins)', async () => {
    const preflightSpy = vi
      .spyOn(preflightModule, 'runPreflight')
      .mockResolvedValue(okPreflight);
    vi.spyOn(runK6Module, 'runK6').mockImplementation(async (p) => ({
      ok: true,
      exitCode: 0,
      rawJsonPath: `${p.outDir}/${p.rawFilename ?? 'raw.json'}`,
      stderrLogPath: `${p.outDir}/k6-stderr.log`,
    }));
    vi.spyOn(renderModule, 'renderReport').mockResolvedValue();
    vi.spyOn(confirmModule, 'confirmHeavyRun').mockResolvedValue(true);
    const probe = vi.fn(async () => ({ ok: true }) as const);
    const seedSpy = vi.spyOn(seedModule, 'runPerfSeed');

    const r = await runPerfScenario({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: {
        ...baseFlags,
        scenario: 'graphql-flat',
        out: outDir,
        readOnly: true,
        httpSeed: true,
      },
      stdout: () => {},
      stderr: () => {},
      probeContentWrite: probe,
    });
    expect(r.exitCode).toBe(0);
    expect(preflightSpy.mock.calls[0]?.[0].requireContentWrite).toBe(false);
    // Probe is wired through but read-only short-circuits the gate inside
    // runPreflight (asserted in preflight.test.ts). It must not have been
    // invoked by scenario.ts itself.
    expect(probe).not.toHaveBeenCalled();
    // Read-only path → seed must not run either.
    expect(seedSpy).not.toHaveBeenCalled();
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

  describe('pg-sampler wiring', () => {
    it('starts the sampler in seed-direct mode with databaseUrl + outDir', async () => {
      vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue(okPreflight);
      vi.spyOn(seedModule, 'runPerfSeed').mockResolvedValue({ inserted: 1 });
      vi.spyOn(runK6Module, 'runK6').mockImplementation(async (p) => ({
        ok: true,
        exitCode: 0,
        rawJsonPath: `${p.outDir}/${p.rawFilename ?? 'raw.json'}`,
        stderrLogPath: `${p.outDir}/k6-stderr.log`,
      }));
      vi.spyOn(renderModule, 'renderReport').mockResolvedValue();
      vi.spyOn(confirmModule, 'confirmHeavyRun').mockResolvedValue(true);
      const { factory } = makeFakeSampler();

      const r = await runPerfScenario({
        cwd: process.cwd(),
        apiKey: 'k',
        flags: {
          ...baseFlags,
          scenario: 'graphql-flat',
          out: outDir,
          readOnly: false,
          databaseUrl: 'postgresql://boject:boject@localhost:5432/boject_perf',
          size: 1,
        },
        stdout: () => {},
        stderr: () => {},
        startPgSampler: factory,
      });
      expect(r.exitCode).toBe(0);
      expect(factory).toHaveBeenCalledTimes(1);
      const arg = factory.mock.calls[0]?.[0];
      expect(arg?.databaseUrl).toBe(
        'postgresql://boject:boject@localhost:5432/boject_perf'
      );
      expect(arg?.outDir).toContain(outDir);
    });

    it('does NOT start the sampler in read-only mode', async () => {
      vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue(okPreflight);
      vi.spyOn(runK6Module, 'runK6').mockImplementation(async (p) => ({
        ok: true,
        exitCode: 0,
        rawJsonPath: `${p.outDir}/${p.rawFilename ?? 'raw.json'}`,
        stderrLogPath: `${p.outDir}/k6-stderr.log`,
      }));
      vi.spyOn(renderModule, 'renderReport').mockResolvedValue();
      vi.spyOn(confirmModule, 'confirmHeavyRun').mockResolvedValue(true);
      const { factory } = makeFakeSampler();

      const r = await runPerfScenario({
        cwd: process.cwd(),
        apiKey: 'k',
        flags: { ...baseFlags, scenario: 'graphql-flat', out: outDir },
        stdout: () => {},
        stderr: () => {},
        startPgSampler: factory,
      });
      expect(r.exitCode).toBe(0);
      expect(factory).not.toHaveBeenCalled();
    });

    it('does NOT start the sampler in seed-http mode', async () => {
      vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue(okPreflight);
      vi.spyOn(seedModule, 'runPerfSeed').mockResolvedValue({ inserted: 1 });
      vi.spyOn(runK6Module, 'runK6').mockImplementation(async (p) => ({
        ok: true,
        exitCode: 0,
        rawJsonPath: `${p.outDir}/${p.rawFilename ?? 'raw.json'}`,
        stderrLogPath: `${p.outDir}/k6-stderr.log`,
      }));
      vi.spyOn(renderModule, 'renderReport').mockResolvedValue();
      vi.spyOn(confirmModule, 'confirmHeavyRun').mockResolvedValue(true);
      const { factory } = makeFakeSampler();

      const r = await runPerfScenario({
        cwd: process.cwd(),
        apiKey: 'k',
        flags: {
          ...baseFlags,
          scenario: 'graphql-flat',
          out: outDir,
          readOnly: false,
          httpSeed: true,
          size: 1,
        },
        stdout: () => {},
        stderr: () => {},
        startPgSampler: factory,
      });
      expect(r.exitCode).toBe(0);
      expect(factory).not.toHaveBeenCalled();
    });

    it('continues without panel + warns on sampler-start failure', async () => {
      vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue(okPreflight);
      vi.spyOn(seedModule, 'runPerfSeed').mockResolvedValue({ inserted: 1 });
      vi.spyOn(runK6Module, 'runK6').mockImplementation(async (p) => ({
        ok: true,
        exitCode: 0,
        rawJsonPath: `${p.outDir}/${p.rawFilename ?? 'raw.json'}`,
        stderrLogPath: `${p.outDir}/k6-stderr.log`,
      }));
      const renderSpy = vi
        .spyOn(renderModule, 'renderReport')
        .mockResolvedValue();
      vi.spyOn(confirmModule, 'confirmHeavyRun').mockResolvedValue(true);
      const factory = vi.fn(async () => {
        throw new Error('connect ECONNREFUSED');
      });

      const stderr: string[] = [];
      const r = await runPerfScenario({
        cwd: process.cwd(),
        apiKey: 'k',
        flags: {
          ...baseFlags,
          scenario: 'graphql-flat',
          out: outDir,
          readOnly: false,
          databaseUrl: 'postgresql://boject:boject@localhost:5432/boject_perf',
          size: 1,
        },
        stdout: () => {},
        stderr: (l) => stderr.push(l),
        startPgSampler: factory,
      });
      expect(r.exitCode).toBe(0);
      expect(factory).toHaveBeenCalledTimes(1);
      expect(stderr.join('\n')).toMatch(/\[pg-sampler\] failed to start:/);
      expect(renderSpy).toHaveBeenCalledTimes(1);
      // CSV path is undefined when start failed.
      expect(renderSpy.mock.calls[0]?.[0].pgSamplesCsvPath).toBeUndefined();
    });

    it('calls sampler.stop BEFORE renderReport (happy path)', async () => {
      const callOrder: string[] = [];
      vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue(okPreflight);
      vi.spyOn(seedModule, 'runPerfSeed').mockResolvedValue({ inserted: 1 });
      vi.spyOn(runK6Module, 'runK6').mockImplementation(async (p) => ({
        ok: true,
        exitCode: 0,
        rawJsonPath: `${p.outDir}/${p.rawFilename ?? 'raw.json'}`,
        stderrLogPath: `${p.outDir}/k6-stderr.log`,
      }));
      vi.spyOn(renderModule, 'renderReport').mockImplementation(async () => {
        callOrder.push('render');
      });
      vi.spyOn(confirmModule, 'confirmHeavyRun').mockResolvedValue(true);
      const { factory } = makeFakeSampler({ callOrder });

      const r = await runPerfScenario({
        cwd: process.cwd(),
        apiKey: 'k',
        flags: {
          ...baseFlags,
          scenario: 'graphql-flat',
          out: outDir,
          readOnly: false,
          databaseUrl: 'postgresql://boject:boject@localhost:5432/boject_perf',
          size: 1,
        },
        stdout: () => {},
        stderr: () => {},
        startPgSampler: factory,
      });
      expect(r.exitCode).toBe(0);
      expect(callOrder).toEqual(['stop', 'render']);
    });

    it('still stops the sampler when all k6 shapes fail (no render path)', async () => {
      vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue(okPreflight);
      vi.spyOn(seedModule, 'runPerfSeed').mockResolvedValue({ inserted: 1 });
      vi.spyOn(runK6Module, 'runK6').mockResolvedValue({
        ok: false,
        error: 'k6 process error: ENOENT',
      });
      vi.spyOn(renderModule, 'renderReport').mockResolvedValue();
      vi.spyOn(confirmModule, 'confirmHeavyRun').mockResolvedValue(true);
      const { factory, stopSpy } = makeFakeSampler();

      const r = await runPerfScenario({
        cwd: process.cwd(),
        apiKey: 'k',
        flags: {
          ...baseFlags,
          scenario: 'graphql-flat',
          out: outDir,
          readOnly: false,
          databaseUrl: 'postgresql://boject:boject@localhost:5432/boject_perf',
          size: 1,
        },
        stdout: () => {},
        stderr: () => {},
        startPgSampler: factory,
      });
      expect(r.exitCode).toBe(1);
      // Sampler still started + stopped even though render is skipped.
      expect(factory).toHaveBeenCalledTimes(1);
      expect(stopSpy).toHaveBeenCalledTimes(1);
    });
  });
});
