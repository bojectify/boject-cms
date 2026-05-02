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
import { runSchemaCheck } from '../../src/commands/schemaCheck.js';

let server: Server;
let port: number;
const remote: { value: unknown } = { value: null };

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(remote.value));
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
  workDir = await mkdtemp(join(tmpdir(), 'boject-check-'));
  await writeFile(
    join(workDir, '.boject.config.json'),
    JSON.stringify({
      cms: { url: `http://localhost:${port}` },
      schema: { path: 'schema.boject.json' },
    })
  );
  lines.length = 0;
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const stdout = (l: string) => lines.push(l);
const stderr = (l: string) => lines.push(l);

const TYPE = (id: string) => ({
  id: null,
  identifier: id,
  name: id,
  description: null,
  fields: [
    {
      id: null,
      identifier: 'name',
      name: 'Name',
      type: 'ENTRY_TITLE',
      required: true,
      order: 0,
      options: null,
    },
  ],
});

describe('runSchemaCheck', () => {
  it('exits 0 when local matches remote (ignoring exportedAt)', async () => {
    const bundle = {
      version: 2,
      exportedAt: 'remote-time',
      portable: true,
      contentTypes: [TYPE('Article')],
    };
    remote.value = bundle;
    await writeFile(
      join(workDir, 'schema.boject.json'),
      JSON.stringify({ ...bundle, exportedAt: 'local-time' })
    );
    const r = await runSchemaCheck({
      cwd: workDir,
      apiKey: 'k',
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(0);
    expect(lines.some((l) => l.includes('in sync'))).toBe(true);
  });

  it('exits 1 with a diff when content types differ', async () => {
    remote.value = {
      version: 2,
      exportedAt: 'remote-time',
      portable: true,
      contentTypes: [TYPE('Article'), TYPE('Tag')],
    };
    await writeFile(
      join(workDir, 'schema.boject.json'),
      JSON.stringify({
        version: 2,
        exportedAt: 'local-time',
        portable: true,
        contentTypes: [TYPE('Article')],
      })
    );
    const r = await runSchemaCheck({
      cwd: workDir,
      apiKey: 'k',
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(1);
    expect(lines.some((l) => l.includes('Tag'))).toBe(true);
    expect(lines.some((l) => /server|local/i.test(l))).toBe(true);
  });
});
