import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { runEntriesExport } from '../../src/commands/entries/export.js';

let server: Server;
let port: number;
const responder: { value: (req: Request) => Response } = {
  value: () => new Response('not configured', { status: 500 }),
};
let lastRequestUrl: string | undefined;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    lastRequestUrl = req.url;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) headers.set(k, v.join(','));
      else if (typeof v === 'string') headers.set(k, v);
    }
    const url = `http://localhost${req.url ?? '/'}`;
    const request = new Request(url, { method: req.method, headers });
    const response = await responder.value(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no addr');
  port = addr.port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let workDir: string;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'boject-entries-export-'));
  await writeFile(
    join(workDir, '.boject.config.json'),
    JSON.stringify({
      cms: { url: `http://localhost:${port}` },
      schema: { path: 'content-types/schema.boject.json' },
    })
  );
  lastRequestUrl = undefined;
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const lines: string[] = [];
const stdout = (l: string) => lines.push(l);
const stderr = (l: string) => lines.push(l);

beforeEach(() => {
  lines.length = 0;
});

function bundleWithEntries(count: number) {
  return {
    version: 2,
    exportedAt: '2026-05-01T00:00:00.000Z',
    portable: true,
    contentTypes: [],
    entries: Array.from({ length: count }, (_, i) => ({
      entryKey: `note-${i}`,
      contentTypeIdentifier: 'Note',
      versions: [],
    })),
  };
}

describe('runEntriesExport', () => {
  it('exits 1 and mentions BOJECT_API_KEY when no API key is set', async () => {
    const result = await runEntriesExport({
      cwd: workDir,
      apiKey: undefined,
      stdout,
      stderr,
    });
    expect(result.exitCode).toBe(1);
    expect(lines.some((l) => /BOJECT_API_KEY/.test(l))).toBe(true);
  });

  it('writes the bundle to the default output path and reports the entry count', async () => {
    const bundle = bundleWithEntries(2);
    responder.value = () =>
      new Response(JSON.stringify(bundle), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    const result = await runEntriesExport({
      cwd: workDir,
      apiKey: 'boject_test_key',
      stdout,
      stderr,
    });
    expect(result.exitCode).toBe(0);

    const written = await readFile(
      join(workDir, 'content-entries.boject.json'),
      'utf8'
    );
    expect(JSON.parse(written)).toEqual(bundle);
    expect(lines.some((l) => /2 entr/.test(l))).toBe(true);
  });

  it('passes includeDrafts and contentType through to the request', async () => {
    const bundle = bundleWithEntries(1);
    responder.value = () =>
      new Response(JSON.stringify(bundle), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    const result = await runEntriesExport({
      cwd: workDir,
      apiKey: 'boject_test_key',
      flags: {
        includeDrafts: true,
        contentType: 'Note',
        out: join(workDir, 'out.json'),
      },
      stdout,
      stderr,
    });
    expect(result.exitCode).toBe(0);
    expect(lastRequestUrl).toBeDefined();
    expect(lastRequestUrl).toContain('includeDrafts=true');
    expect(lastRequestUrl).toContain('contentType=Note');
  });

  it('strips a trailing slash from the url so the request hits /api (single slash)', async () => {
    const bundle = bundleWithEntries(1);
    responder.value = () =>
      new Response(JSON.stringify(bundle), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    const result = await runEntriesExport({
      cwd: workDir,
      apiKey: 'boject_test_key',
      flags: {
        url: `http://localhost:${port}/`,
        out: join(workDir, 'out.json'),
      },
      stdout,
      stderr,
    });
    expect(result.exitCode).toBe(0);
    expect(lastRequestUrl).toBeDefined();
    expect(lastRequestUrl!.startsWith('//')).toBe(false);
    expect(lastRequestUrl!.startsWith('/api/content-bundle/export')).toBe(true);
  });

  it('exits 1 and writes no file when a 200 response body is not JSON', async () => {
    responder.value = () =>
      new Response('<!DOCTYPE html><html><body>not a bundle</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });

    const outPath = join(workDir, 'out.json');
    const result = await runEntriesExport({
      cwd: workDir,
      apiKey: 'boject_test_key',
      flags: { out: outPath },
      stdout,
      stderr,
    });

    expect(result.exitCode).toBe(1);
    expect(lines.some((l) => /Error/.test(l))).toBe(true);
    await expect(readFile(outPath, 'utf8')).rejects.toThrow();
  });
});
