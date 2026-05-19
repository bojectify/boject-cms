import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { FIELD_TYPES } from '../../src/vendor/fieldTypes.js';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..', '..');
const CLI_PATH = join(PACKAGE_ROOT, 'dist', 'index.js');

const BUNDLE = {
  version: 2,
  exportedAt: '2026-05-01T00:00:00.000Z',
  portable: true,
  contentTypes: [
    {
      id: null,
      identifier: 'Article',
      name: 'Article',
      description: null,
      fields: [
        {
          id: null,
          identifier: 'title',
          name: 'Title',
          type: FIELD_TYPES.ENTRY_TITLE,
          required: true,
          order: 0,
          options: null,
        },
      ],
    },
  ],
};

let server: Server;
let port: number;
const requests: Array<{ method?: string; url?: string; body?: string }> = [];

beforeAll(async () => {
  await run('pnpm', ['--filter', '@boject/cli', 'build'], {
    cwd: resolve(PACKAGE_ROOT, '..', '..'),
  });

  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk.toString()));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body });
      if (req.method === 'GET' && req.url === '/api/schema/export') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(BUNDLE));
        return;
      }
      if (req.method === 'POST' && req.url === '/api/schema/apply') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            changed: true,
            applied: {
              contentTypesCreated: 1,
              contentTypesUpdated: 0,
              contentTypesRemoved: 0,
              fieldsCreated: 1,
              fieldsUpdated: 0,
              fieldsRemoved: 0,
            },
          })
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no addr');
  port = addr.port;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let workDir: string;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'boject-e2e-'));
  await writeFile(
    join(workDir, '.boject.config.json'),
    JSON.stringify({
      cms: { url: `http://localhost:${port}` },
      schema: { path: 'content-types/schema.boject.json' },
    })
  );
  requests.length = 0;
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('boject schema (e2e)', () => {
  it('pull → check (in sync) → apply', async () => {
    // Pull
    {
      const { stdout, stderr } = await run(
        'node',
        [CLI_PATH, 'schema', 'pull'],
        {
          cwd: workDir,
          env: { ...process.env, BOJECT_API_KEY: 'boject_e2e' },
        }
      );
      expect(stdout).toContain('Pulled schema from');
      expect(stderr).toBe('');
    }
    // Check — local matches remote.
    {
      const { stdout } = await run('node', [CLI_PATH, 'schema', 'check'], {
        cwd: workDir,
        env: { ...process.env, BOJECT_API_KEY: 'boject_e2e' },
      });
      expect(stdout).toContain('in sync');
    }
    // Apply
    {
      const { stdout } = await run('node', [CLI_PATH, 'schema', 'apply'], {
        cwd: workDir,
        env: { ...process.env, BOJECT_API_KEY: 'boject_e2e' },
      });
      expect(stdout).toContain('Applied');
    }

    // Three requests: GET (pull), GET (check), POST (apply).
    expect(requests.filter((r) => r.method === 'GET')).toHaveLength(2);
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  });

  it('validate exits 1 on a malformed file with a helpful message', async () => {
    const path = join(workDir, 'broken.boject.json');
    await writeFile(path, '{not json');
    await expect(
      run('node', [CLI_PATH, 'schema', 'validate', path], { cwd: workDir })
    ).rejects.toMatchObject({ code: 1 });
  });
});
