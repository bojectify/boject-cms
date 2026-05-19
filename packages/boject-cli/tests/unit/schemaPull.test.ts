import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
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
import { runSchemaPull } from '../../src/commands/schema/pull.js';
import { FIELD_TYPES } from '../../src/vendor/fieldTypes.js';

let server: Server;
let port: number;
const responder: { value: (req: Request) => Response } = {
  value: () => new Response('not configured', { status: 500 }),
};

beforeAll(async () => {
  server = createServer(async (req, res) => {
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
  workDir = await mkdtemp(join(tmpdir(), 'boject-pull-'));
  await writeFile(
    join(workDir, '.boject.config.json'),
    JSON.stringify({
      cms: { url: `http://localhost:${port}` },
      schema: { path: 'content-types/schema.boject.json' },
    })
  );
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

describe('runSchemaPull', () => {
  it('writes the response body to <project>/<schema.path>', async () => {
    const bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'X',
          name: 'X',
          description: null,
          fields: [
            {
              id: null,
              identifier: 'name',
              name: 'Name',
              type: FIELD_TYPES.ENTRY_TITLE,
              required: true,
              order: 0,
              options: null,
            },
          ],
        },
      ],
    };
    responder.value = () =>
      new Response(JSON.stringify(bundle), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    const result = await runSchemaPull({
      cwd: workDir,
      apiKey: 'boject_test_key',
      stdout,
      stderr,
    });
    expect(result.exitCode).toBe(0);
    const written = await readFile(
      join(workDir, 'content-types/schema.boject.json'),
      'utf8'
    );
    expect(JSON.parse(written)).toEqual(bundle);
  });

  it('exits 1 when the API returns 401', async () => {
    responder.value = () =>
      new Response(JSON.stringify({ message: 'Unauthorized' }), {
        status: 401,
      });
    const result = await runSchemaPull({
      cwd: workDir,
      apiKey: 'boject_bad',
      stdout,
      stderr,
    });
    expect(result.exitCode).toBe(1);
    expect(lines.some((l) => /401|unauthor/i.test(l))).toBe(true);
  });

  it('exits 1 with a clear message when no .boject.config.json is present', async () => {
    await rm(join(workDir, '.boject.config.json'));
    const result = await runSchemaPull({
      cwd: workDir,
      apiKey: 'boject_test_key',
      stdout,
      stderr,
    });
    expect(result.exitCode).toBe(1);
    expect(lines.some((l) => /\.boject\.config\.json/.test(l))).toBe(true);
  });

  it('honours --out and --url flags overriding config', async () => {
    responder.value = () =>
      new Response(
        JSON.stringify({
          version: 2,
          exportedAt: 'x',
          portable: true,
          contentTypes: [],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      );
    await mkdir(join(workDir, 'custom'), { recursive: true });
    const result = await runSchemaPull({
      cwd: workDir,
      apiKey: 'boject_test_key',
      flags: { out: 'custom/out.json', url: `http://localhost:${port}` },
      stdout,
      stderr,
    });
    expect(result.exitCode).toBe(0);
    const written = await readFile(join(workDir, 'custom/out.json'), 'utf8');
    expect(JSON.parse(written).version).toBe(2);
  });
});
