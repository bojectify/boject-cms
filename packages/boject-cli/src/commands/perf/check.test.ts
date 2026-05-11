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

  it('does not request the content:write probe when --http-seed is not set', async () => {
    const spy = vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue({
      ok: true,
      fields: {
        listField: 'articleList',
        filterField: 'publishDate',
        relationField: 'author',
      },
      warnings: [],
    });
    const probeSpy = vi.fn(async () => ({ ok: true as const }));
    const r = await runPerfCheck({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: { url: 'https://x.example.com', contentType: 'Article' },
      stdout: recordOut,
      stderr: recordErr,
      probeContentWrite: probeSpy,
    });
    expect(r.exitCode).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
    const callArg = spy.mock.calls[0]![0];
    expect(callArg.requireContentWrite).toBe(false);
    expect(stdout.join('\n')).not.toMatch(/content:write/);
  });

  it('prints the content:write verified line on a successful --http-seed preflight', async () => {
    const spy = vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue({
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
      flags: {
        url: 'https://x.example.com',
        contentType: 'Article',
        httpSeed: true,
      },
      stdout: recordOut,
      stderr: recordErr,
    });
    expect(r.exitCode).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].requireContentWrite).toBe(true);
    expect(stdout.join('\n')).toMatch(/content:write:\s+verified/);
  });

  it('returns 2 with the actionable mint hint when --http-seed surfaces a missing scope', async () => {
    vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue({
      ok: false,
      errors: [
        'API key missing required scope "content:write". Mint a new key with: boject apikey create --scopes content:write,content:read',
      ],
    });
    const r = await runPerfCheck({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: {
        url: 'https://x.example.com',
        contentType: 'Article',
        httpSeed: true,
      },
      stdout: recordOut,
      stderr: recordErr,
    });
    expect(r.exitCode).toBe(2);
    const joined = stderr.join('\n');
    expect(joined).toContain('API key missing required scope "content:write"');
    expect(joined).toContain(
      'boject apikey create --scopes content:write,content:read'
    );
  });

  it('returns 2 with the indeterminate error when --http-seed surfaces a probe failure', async () => {
    vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue({
      ok: false,
      errors: [
        'Could not verify content:write scope: rate limited by CMS — wait 60s and retry',
      ],
    });
    const r = await runPerfCheck({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: {
        url: 'https://x.example.com',
        contentType: 'Article',
        httpSeed: true,
      },
      stdout: recordOut,
      stderr: recordErr,
    });
    expect(r.exitCode).toBe(2);
    expect(stderr.join('\n')).toContain(
      'Could not verify content:write scope: rate limited by CMS'
    );
  });

  it('forwards the injected probeContentWrite implementation to runPreflight', async () => {
    const spy = vi.spyOn(preflightModule, 'runPreflight').mockResolvedValue({
      ok: true,
      fields: {
        listField: 'articleList',
        filterField: 'publishDate',
        relationField: 'author',
      },
      warnings: [],
    });
    const probeSpy = vi.fn(async () => ({ ok: true as const }));
    await runPerfCheck({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: {
        url: 'https://x.example.com',
        contentType: 'Article',
        httpSeed: true,
      },
      stdout: recordOut,
      stderr: recordErr,
      probeContentWrite: probeSpy,
    });
    expect(spy.mock.calls[0]![0].probeContentWrite).toBe(probeSpy);
  });

  it('surfaces a warning (not an error) when config is malformed', async () => {
    const { writeFile, mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'boject-cli-config-'));
    await writeFile(join(dir, '.boject.config.json'), '{ malformed json');

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
      cwd: dir,
      apiKey: 'k',
      flags: { url: 'https://x.example.com', contentType: 'Article' },
      stdout: recordOut,
      stderr: recordErr,
    });
    expect(r.exitCode).toBe(0); // flags cover everything; warning isn't fatal
    expect(stderr.join('\n')).toMatch(/Warning: ignoring config/);
    expect(stderr.join('\n')).toMatch(/Failed to parse/);
  });
});
