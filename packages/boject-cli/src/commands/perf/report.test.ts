import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPerfReport } from './report.js';
import * as renderModule from '../../perf/render.js';

afterEach(() => vi.restoreAllMocks());

async function makeRun(parent: string, suffix: string): Promise<string> {
  const dir = join(parent, suffix);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'raw.json'), '');
  const meta = {
    perfCalibratedAt: '2026-05-06T14:32:11Z',
    cliVersion: '0.0.1',
    k6Version: '0.50.0',
    target: { host: 'x.example.com', scheme: 'https' },
    contentType: 'Article',
    fields: { list: 'articleList', filter: 'publishDate', relation: 'author' },
    scenarios: [],
    intensity: { targetRps: 2000, duration: '180s', stages: [] },
    partial: false,
  };
  await writeFile(join(dir, 'metadata.json'), JSON.stringify(meta));
  return dir;
}

describe('runPerfReport', () => {
  it('re-renders the latest run when no --from is given', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boject-report-'));
    await makeRun(root, '2026-05-06T14-32-11Z-aaaa');
    const latestDir = await makeRun(root, '2026-05-06T14-32-11Z-zzzz');
    const renderSpy = vi
      .spyOn(renderModule, 'renderReport')
      .mockResolvedValue();
    const r = await runPerfReport({
      cwd: process.cwd(),
      flags: { out: root },
      stdout: () => {},
      stderr: () => {},
    });
    expect(r.exitCode).toBe(0);
    expect(renderSpy).toHaveBeenCalledTimes(1);
    // Lex-last (zzzz > aaaa) should be picked
    expect(renderSpy.mock.calls[0]?.[0].outDir).toBe(latestDir);
  });

  it('errors when --from points at a missing dir', async () => {
    const stderr: string[] = [];
    const r = await runPerfReport({
      cwd: process.cwd(),
      flags: { from: '/no/such/dir' },
      stdout: () => {},
      stderr: (l) => stderr.push(l),
    });
    expect(r.exitCode).toBe(2);
    expect(stderr.join('\n')).toMatch(/no such|missing|not found/i);
  });

  it('errors when raw.json is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boject-report-'));
    const dir = join(root, 'broken');
    await mkdir(dir);
    await writeFile(
      join(dir, 'metadata.json'),
      JSON.stringify({
        perfCalibratedAt: '2026-05-06T14:32:11Z',
        cliVersion: '0.0.1',
        k6Version: '0.50.0',
        target: { host: 'x.example.com', scheme: 'https' },
        contentType: 'Article',
        fields: { list: 'articleList', filter: null, relation: null },
        scenarios: [],
        intensity: { targetRps: 2000, duration: '180s', stages: [] },
        partial: false,
      })
    );
    const stderr: string[] = [];
    const r = await runPerfReport({
      cwd: process.cwd(),
      flags: { from: dir },
      stdout: () => {},
      stderr: (l) => stderr.push(l),
    });
    expect(r.exitCode).toBe(2);
    expect(stderr.join('\n')).toMatch(/raw\.json/);
  });

  it('re-renders a v1 metadata.json with v2 defaults', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boject-report-v1-'));
    const dir = join(root, 'run');
    await mkdir(dir);
    await writeFile(join(dir, 'raw.json'), '');
    // v1-shaped metadata: schemaVersion 1, no mode/seedSize/seedDeterministicSeed/partialFailureSource.
    const v1Meta = {
      schemaVersion: 1,
      perfCalibratedAt: '2026-05-06T14:32:11Z',
      cliVersion: '0.0.1',
      k6Version: '0.50.0',
      target: { host: 'x.example.com', scheme: 'https' },
      contentType: 'Article',
      fields: {
        list: 'articleList',
        filter: 'publishDate',
        relation: 'author',
      },
      scenarios: [],
      intensity: { targetRps: 2000, duration: '180s', stages: [] },
      partial: false,
    };
    await writeFile(join(dir, 'metadata.json'), JSON.stringify(v1Meta));

    const r = await runPerfReport({
      cwd: process.cwd(),
      flags: { from: dir },
      stdout: () => {},
      stderr: () => {},
    });
    expect(r.exitCode).toBe(0);

    const reRendered = JSON.parse(
      await readFile(join(dir, 'metadata.json'), 'utf8')
    );
    expect(reRendered.schemaVersion).toBe(2);
    expect(reRendered.mode).toBe('read-only');
    expect(reRendered.seedSize).toBeNull();
    expect(reRendered.seedDeterministicSeed).toBeNull();
    expect(reRendered.partial).toBe(false);
    expect(reRendered.partialFailureSource).toBeNull();

    const summary = await readFile(join(dir, 'summary.md'), 'utf8');
    expect(summary).toContain('Read-only run');
  });

  it('errors on malformed metadata.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'boject-report-'));
    const dir = join(root, 'broken');
    await mkdir(dir);
    await writeFile(join(dir, 'raw.json'), '');
    await writeFile(join(dir, 'metadata.json'), '{ malformed json');
    const stderr: string[] = [];
    const r = await runPerfReport({
      cwd: process.cwd(),
      flags: { from: dir },
      stdout: () => {},
      stderr: (l) => stderr.push(l),
    });
    expect(r.exitCode).toBe(2);
    expect(stderr.join('\n')).toMatch(/Error parsing/);
  });
});
