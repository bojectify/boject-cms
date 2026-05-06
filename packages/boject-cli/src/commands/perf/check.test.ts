import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runPerfCheck } from './check.js';
import * as preflightModule from '../../perf/preflight.js';

describe('runPerfCheck', () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const recordOut = (l: string) => stdout.push(l);
  const recordErr = (l: string) => stderr.push(l);

  beforeEach(() => {
    stdout.length = 0;
    stderr.length = 0;
  });
  afterEach(() => vi.restoreAllMocks());

  it('errors out when --content-type is missing', async () => {
    const r = await runPerfCheck({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: { url: 'https://x.example.com' },
      stdout: recordOut,
      stderr: recordErr,
    });
    expect(r.exitCode).toBe(3);
    expect(stderr.join('\n')).toMatch(/--content-type/);
  });

  it('errors out when API key is missing', async () => {
    const r = await runPerfCheck({
      cwd: process.cwd(),
      apiKey: undefined,
      flags: { url: 'https://x.example.com', contentType: 'Article' },
      stdout: recordOut,
      stderr: recordErr,
    });
    expect(r.exitCode).toBe(2);
    expect(stderr.join('\n')).toMatch(/BOJECT_API_KEY/);
  });

  it('returns 0 and prints fields on a successful preflight', async () => {
    vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue({
      ok: true,
      fields: {
        listField: 'articleList',
        filterField: 'publishDate',
        relationField: 'author',
      },
      warnings: [],
    });
    const r = await runPerfCheck({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: { url: 'https://x.example.com', contentType: 'Article' },
      stdout: recordOut,
      stderr: recordErr,
    });
    expect(r.exitCode).toBe(0);
    expect(stdout.join('\n')).toMatch(/articleList/);
    expect(stdout.join('\n')).toMatch(/publishDate/);
    expect(stdout.join('\n')).toMatch(/author/);
  });

  it('returns 2 and prints all errors on a failed preflight', async () => {
    vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue({
      ok: false,
      errors: ['k6 is not on PATH', 'Target unreachable'],
    });
    const r = await runPerfCheck({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: { url: 'https://x.example.com', contentType: 'Article' },
      stdout: recordOut,
      stderr: recordErr,
    });
    expect(r.exitCode).toBe(2);
    expect(stderr.join('\n')).toMatch(/k6 is not on PATH/);
    expect(stderr.join('\n')).toMatch(/Target unreachable/);
  });
});
