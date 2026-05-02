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
import { runSchemaApply } from '../../src/commands/schemaApply.js';

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

let workDir: string;
const lines: string[] = [];
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'boject-apply-'));
  await writeFile(
    join(workDir, '.boject.config.json'),
    JSON.stringify({
      cms: { url: `http://localhost:${port}` },
      schema: { path: 'schema.boject.json' },
    })
  );
  await writeFile(
    join(workDir, 'schema.boject.json'),
    JSON.stringify({
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [],
    })
  );
  requests.length = 0;
  lines.length = 0;
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const stdout = (l: string) => lines.push(l);
const stderr = (l: string) => lines.push(l);

describe('runSchemaApply', () => {
  it('POSTs the bundle and prints the apply result on success', async () => {
    handler.value = async () => ({
      status: 200,
      body: {
        changed: true,
        applied: {
          contentTypesCreated: 0,
          contentTypesUpdated: 1,
          contentTypesRemoved: 0,
          fieldsCreated: 2,
          fieldsUpdated: 0,
          fieldsRemoved: 0,
        },
      },
    });
    const r = await runSchemaApply({
      cwd: workDir,
      apiKey: 'k',
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe('POST');
    expect(requests[0]!.url).toBe('/api/schema/apply');
    expect(lines.some((l) => l.includes('1 content type updated'))).toBe(true);
    expect(lines.some((l) => l.includes('2 fields created'))).toBe(true);
  });

  it('passes dryRun: true in the body when --dry-run is set', async () => {
    handler.value = async () => ({
      status: 200,
      body: {
        changed: false,
        applied: {
          contentTypesCreated: 0,
          contentTypesUpdated: 0,
          contentTypesRemoved: 0,
          fieldsCreated: 0,
          fieldsUpdated: 0,
          fieldsRemoved: 0,
        },
      },
    });
    await runSchemaApply({
      cwd: workDir,
      apiKey: 'k',
      flags: { dryRun: true },
      stdout,
      stderr,
    });
    const reqBody = requests[0]!.body as { dryRun?: boolean };
    expect(reqBody.dryRun).toBe(true);
  });

  it('renders blockers and exits 1 on SCHEMA_APPLY_BLOCKED', async () => {
    handler.value = async () => ({
      status: 400,
      body: {
        data: {
          error: 'SCHEMA_APPLY_BLOCKED',
          blockers: [
            {
              code: 'CONTENT_TYPE_REMOVAL_WITH_ENTRIES',
              message: 'Tag has 4 entries',
              path: 'contentTypes.Tag',
            },
          ],
        },
      },
    });
    const r = await runSchemaApply({
      cwd: workDir,
      apiKey: 'k',
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(1);
    expect(
      lines.some((l) => l.includes('CONTENT_TYPE_REMOVAL_WITH_ENTRIES'))
    ).toBe(true);
    expect(lines.some((l) => l.includes('Tag has 4 entries'))).toBe(true);
  });

  it('retries once on SCHEMA_CHANGED_DURING_APPLY (409)', async () => {
    let calls = 0;
    handler.value = async () => {
      calls += 1;
      if (calls === 1) {
        return {
          status: 409,
          body: { data: { error: 'SCHEMA_CHANGED_DURING_APPLY' } },
        };
      }
      return {
        status: 200,
        body: {
          changed: true,
          applied: {
            contentTypesCreated: 0,
            contentTypesUpdated: 0,
            contentTypesRemoved: 0,
            fieldsCreated: 0,
            fieldsUpdated: 0,
            fieldsRemoved: 0,
          },
        },
      };
    };
    const r = await runSchemaApply({
      cwd: workDir,
      apiKey: 'k',
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(0);
    expect(requests).toHaveLength(2);
  });

  it('exits 1 if SCHEMA_CHANGED_DURING_APPLY persists across retry', async () => {
    handler.value = async () => ({
      status: 409,
      body: { data: { error: 'SCHEMA_CHANGED_DURING_APPLY' } },
    });
    const r = await runSchemaApply({
      cwd: workDir,
      apiKey: 'k',
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(1);
    expect(requests).toHaveLength(2);
  });
});
