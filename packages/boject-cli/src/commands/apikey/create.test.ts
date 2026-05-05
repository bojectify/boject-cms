import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { runApikeyCreate } from './create.js';

describe('runApikeyCreate', () => {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const stdout = (line: string) => {
    stdoutLines.push(line);
  };
  const stderr = (line: string) => {
    stderrLines.push(line);
  };

  beforeEach(() => {
    stdoutLines.length = 0;
    stderrLines.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('errors out when --name is missing', async () => {
    const r = await runApikeyCreate({
      cwd: process.cwd(),
      apiKey: 'key',
      flags: { scopes: 'content:read' },
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(1);
    expect(stderrLines.join('\n')).toMatch(/--name/);
  });

  it('errors out when --scopes is missing', async () => {
    const r = await runApikeyCreate({
      cwd: process.cwd(),
      apiKey: 'key',
      flags: { name: 'X' },
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(1);
    expect(stderrLines.join('\n')).toMatch(/--scopes/);
    expect(stderrLines.join('\n')).toMatch(/content:read/);
  });

  it('errors out for an unknown scope (caught client-side, no fetch)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const r = await runApikeyCreate({
      cwd: process.cwd(),
      apiKey: 'key',
      flags: { name: 'X', scopes: 'content:read,nope' },
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(1);
    expect(stderrLines.join('\n')).toMatch(/Unknown scope.*nope/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('errors out when BOJECT_API_KEY is missing', async () => {
    const r = await runApikeyCreate({
      cwd: process.cwd(),
      apiKey: undefined,
      flags: { name: 'X', scopes: 'content:read' },
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(1);
    expect(stderrLines.join('\n')).toMatch(/BOJECT_API_KEY/);
  });

  it('happy path: posts to /api/apikeys and prints the raw key once', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'id-1',
          name: 'CI',
          prefix: 'boject_a1b2',
          scopes: ['content:read'],
          rawKey: 'boject_a1b2c3d4',
          createdAt: '2026-05-05T12:00:00.000Z',
        }),
        { status: 201, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await runApikeyCreate({
      cwd: process.cwd(),
      apiKey: 'key',
      flags: {
        name: 'CI',
        scopes: 'content:read',
        url: 'http://localhost:4000',
      },
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(0);
    const out = stdoutLines.join('\n');
    expect(out).toMatch(/API key created/);
    expect(out).toMatch(/Name:\s+CI/);
    expect(out).toMatch(/Prefix:\s+boject_a1b2/);
    expect(out).toMatch(/Scopes:\s+content:read/);
    expect(out).toMatch(/Key:\s+boject_a1b2c3d4/);
    expect(out).toMatch(/cannot be retrieved/);
  });

  it('maps APIKEY_WRITE_REQUIRES_SESSION to a helpful message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            error: 'APIKEY_WRITE_REQUIRES_SESSION',
            message: 'session required',
          },
        }),
        { status: 403, headers: { 'content-type': 'application/json' } }
      )
    );
    const r = await runApikeyCreate({
      cwd: process.cwd(),
      apiKey: 'key',
      flags: {
        name: 'X',
        scopes: 'apikey:write',
        url: 'http://localhost:4000',
      },
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(1);
    expect(stderrLines.join('\n')).toMatch(/session/i);
    expect(stderrLines.join('\n')).toMatch(/recovery script|CMS UI/i);
  });
});
