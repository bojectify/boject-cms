import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { runApikeyRevoke } from './revoke.js';

describe('runApikeyRevoke', () => {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const stdout = (line: string) => stdoutLines.push(line);
  const stderr = (line: string) => stderrLines.push(line);

  beforeEach(() => {
    stdoutLines.length = 0;
    stderrLines.length = 0;
  });
  afterEach(() => vi.restoreAllMocks());

  it('errors out when no prefix is supplied', async () => {
    const r = await runApikeyRevoke({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: {},
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(1);
    expect(stderrLines.join('\n')).toMatch(/prefix/);
  });

  it('rejects bad-shape prefix client-side without calling the API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const r = await runApikeyRevoke({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: { prefix: 'not-a-prefix' },
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(1);
    expect(stderrLines.join('\n')).toMatch(/Invalid prefix shape/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports success on 204', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 })
    );
    const r = await runApikeyRevoke({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: { prefix: 'boject_a1b2', url: 'http://localhost:4000' },
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(0);
    expect(stdoutLines.join('\n')).toMatch(/boject_a1b2/);
    expect(stdoutLines.join('\n')).toMatch(/Revoked/i);
  });

  it('maps APIKEY_NOT_FOUND to a helpful message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { error: 'APIKEY_NOT_FOUND' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    );
    const r = await runApikeyRevoke({
      cwd: process.cwd(),
      apiKey: 'k',
      flags: { prefix: 'boject_a1b2', url: 'http://localhost:4000' },
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(1);
    expect(stderrLines.join('\n')).toMatch(/No active API key/);
    expect(stderrLines.join('\n')).toMatch(/boject apikey list/);
  });

  it('errors out when BOJECT_API_KEY is missing', async () => {
    const r = await runApikeyRevoke({
      cwd: process.cwd(),
      apiKey: undefined,
      flags: { prefix: 'boject_a1b2', url: 'http://localhost:4000' },
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(1);
    expect(stderrLines.join('\n')).toMatch(/BOJECT_API_KEY/);
  });
});
