import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
import { runEntriesImport } from '../../src/commands/entries/import.js';

let server: Server;
let port: number;
const handler: {
  value: (
    req: import('node:http').IncomingMessage
  ) => Promise<{ status: number; body: unknown }>;
} = {
  value: async () => ({ status: 500, body: 'not configured' }),
};
const requests: Array<{ method: string; url: string; body: unknown }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c.toString()));
    req.on('end', async () => {
      let body: unknown;
      try {
        body = raw.length ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      requests.push({ method: req.method ?? '', url: req.url ?? '', body });
      const r = await handler.value(req);
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no addr');
  port = addr.port;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const BUNDLE = {
  version: 2,
  exportedAt: '2026-05-01T00:00:00.000Z',
  portable: true,
  contentTypes: [],
  entries: [{ entryKey: 'home', contentTypeIdentifier: 'Note', versions: [] }],
};

let workDir: string;
let bundlePath: string;
const lines: string[] = [];
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'boject-entries-import-'));
  await writeFile(
    join(workDir, '.boject.config.json'),
    JSON.stringify({
      cms: { url: `http://localhost:${port}` },
      schema: { path: 'schema.boject.json' },
    })
  );
  bundlePath = join(workDir, 'content-entries.boject.json');
  await writeFile(bundlePath, JSON.stringify(BUNDLE));
  requests.length = 0;
  lines.length = 0;
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const stdout = (l: string) => lines.push(l);
const stderr = (l: string) => lines.push(l);

const SUCCESS_BODY = {
  contentTypesCreated: 0,
  entriesCreated: 3,
  entriesUpdated: 1,
  entriesSkipped: 0,
};

describe('runEntriesImport', () => {
  it('exits 1 and mentions BOJECT_API_KEY when no API key is set', async () => {
    const r = await runEntriesImport({
      cwd: workDir,
      apiKey: undefined,
      flags: { path: bundlePath },
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(1);
    expect(lines.some((l) => /BOJECT_API_KEY/.test(l))).toBe(true);
  });

  it('exits 1 when no bundle path is provided', async () => {
    const r = await runEntriesImport({
      cwd: workDir,
      apiKey: 'k',
      flags: {},
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(1);
    expect(lines.some((l) => /path/i.test(l))).toBe(true);
  });

  it('POSTs the bundle and prints the summary on success', async () => {
    handler.value = async () => ({ status: 200, body: SUCCESS_BODY });
    const r = await runEntriesImport({
      cwd: workDir,
      apiKey: 'k',
      flags: { path: bundlePath },
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe('POST');
    expect(requests[0]!.url).toBe('/api/content-bundle/import');
    expect(lines.some((l) => /3.*created/.test(l))).toBe(true);
    expect(lines.some((l) => /1.*updated/.test(l))).toBe(true);
    expect(lines.some((l) => /0.*skipped/.test(l))).toBe(true);
  });

  it('maps a 409 ENTRY_IMPORT_CONFLICT to an actionable message and exits 1', async () => {
    handler.value = async () => ({
      status: 409,
      body: {
        data: {
          error: 'ENTRY_IMPORT_CONFLICT',
          message: 'Entry "Note:home" already exists on target',
        },
        message: 'Entry "Note:home" already exists on target',
      },
    });
    const r = await runEntriesImport({
      cwd: workDir,
      apiKey: 'k',
      flags: { path: bundlePath },
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(1);
    expect(lines.some((l) => /already exists/.test(l))).toBe(true);
    expect(lines.some((l) => /--on-conflict/.test(l))).toBe(true);
  });

  it('falls back to data.message when the top-level message is empty', async () => {
    handler.value = async () => ({
      status: 400,
      body: {
        message: '',
        data: {
          error: 'ENTRY_IMPORT_REFERENCE_INVALID',
          message:
            'Entry "Article:home" field "author" references missing entry ct:bogus',
        },
      },
    });
    const r = await runEntriesImport({
      cwd: workDir,
      apiKey: 'k',
      flags: { path: bundlePath },
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(1);
    expect(lines.some((l) => /references missing entry/.test(l))).toBe(true);
  });

  it('passes dryRun: true and prints a dry-run banner', async () => {
    handler.value = async () => ({ status: 200, body: SUCCESS_BODY });
    const r = await runEntriesImport({
      cwd: workDir,
      apiKey: 'k',
      flags: { path: bundlePath, dryRun: true },
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(0);
    const reqBody = requests[0]!.body as { dryRun?: boolean };
    expect(reqBody.dryRun).toBe(true);
    expect(lines.some((l) => /dry run/i.test(l))).toBe(true);
  });
});
