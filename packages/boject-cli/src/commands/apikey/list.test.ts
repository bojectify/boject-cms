import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { runApikeyList } from './list.js';

describe('runApikeyList', () => {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const stdout = (line: string) => stdoutLines.push(line);
  const stderr = (line: string) => stderrLines.push(line);

  beforeEach(() => {
    stdoutLines.length = 0;
    stderrLines.length = 0;
  });
  afterEach(() => vi.restoreAllMocks());

  function mockList(items: unknown[]) {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ items }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
  }

  it('renders an empty list message when there are no keys', async () => {
    mockList([]);
    const r = await runApikeyList({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: { url: 'http://localhost:4000' },
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(0);
    expect(stdoutLines.join('\n')).toMatch(/No API keys found/);
  });

  it('renders a table with the standard columns', async () => {
    mockList([
      {
        id: 'id-1',
        name: 'CI',
        prefix: 'boject_a1b2',
        scopes: ['content:read'],
        revokedAt: null,
        lastUsedAt: null,
        createdAt: '2026-05-05T12:00:00.000Z',
      },
    ]);
    const r = await runApikeyList({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: { url: 'http://localhost:4000' },
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(0);
    const out = stdoutLines.join('\n');
    expect(out).toMatch(/Prefix/);
    expect(out).toMatch(/Name/);
    expect(out).toMatch(/Status/);
    expect(out).toMatch(/Scopes/);
    expect(out).toMatch(/Last Used/);
    expect(out).toMatch(/Created/);
    expect(out).toMatch(/boject_a1b2/);
    expect(out).toMatch(/CI/);
    expect(out).toMatch(/ACTIVE/);
    expect(out).toMatch(/content:read/);
  });

  it('emits raw JSON with --json', async () => {
    mockList([
      {
        id: 'id-1',
        name: 'CI',
        prefix: 'boject_a1b2',
        scopes: ['content:read'],
        revokedAt: null,
        lastUsedAt: null,
        createdAt: '2026-05-05T12:00:00.000Z',
      },
    ]);
    const r = await runApikeyList({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: { url: 'http://localhost:4000', json: true },
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(0);
    const out = stdoutLines.join('\n');
    const parsed = JSON.parse(out) as { items: unknown[] };
    expect(parsed.items).toHaveLength(1);
  });

  it('maps INSUFFICIENT_SCOPE to a helpful message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { error: 'INSUFFICIENT_SCOPE' } }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      })
    );
    const r = await runApikeyList({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: { url: 'http://localhost:4000' },
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(1);
    expect(stderrLines.join('\n')).toMatch(/apikey:read/);
  });

  it('errors out when BOJECT_API_KEY is missing', async () => {
    const r = await runApikeyList({
      cwd: process.cwd(),
      apiKey: undefined,
      flags: { url: 'http://localhost:4000' },
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(1);
    expect(stderrLines.join('\n')).toMatch(/BOJECT_API_KEY/);
  });
});
