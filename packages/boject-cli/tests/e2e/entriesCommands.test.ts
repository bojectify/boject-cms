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
  entries: [
    {
      id: null,
      entryKey: 'hello-world',
      entryTitle: 'Hello World',
      contentTypeIdentifier: 'Article',
      slug: null,
      versions: [
        {
          data: { title: 'Hello World' },
          status: 'PUBLISHED',
          publishedAt: '2026-05-01T00:00:00.000Z',
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
      if (
        req.method === 'GET' &&
        req.url?.startsWith('/api/content-bundle/export')
      ) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(BUNDLE));
        return;
      }
      if (req.method === 'POST' && req.url === '/api/content-bundle/import') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            entriesCreated: 1,
            entriesUpdated: 0,
            entriesSkipped: 0,
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

describe('boject entries (e2e)', () => {
  it('entries --help → exit 0, prints usage', async () => {
    const { stdout } = await run('node', [CLI_PATH, 'entries', '--help'], {
      cwd: workDir,
    });
    expect(stdout).toContain('entries');
    expect(stdout).toContain('export');
    expect(stdout).toContain('import');
    expect(stdout).toContain('validate');
  });

  it('export round-trip writes a bundle file', async () => {
    const outPath = join(workDir, 'out.boject.json');
    const { stdout, stderr } = await run(
      'node',
      [CLI_PATH, 'entries', 'export', '--out', outPath],
      {
        cwd: workDir,
        env: { ...process.env, BOJECT_API_KEY: 'boject_e2e' },
      }
    );
    expect(stderr).toBe('');
    expect(stdout).toContain('Exported entries from');

    const written = JSON.parse(await readFile(outPath, 'utf8'));
    expect(written.entries).toHaveLength(1);
    expect(written.entries[0].entryKey).toBe('hello-world');

    const gets = requests.filter(
      (r) =>
        r.method === 'GET' && r.url?.startsWith('/api/content-bundle/export')
    );
    expect(gets).toHaveLength(1);
  });

  it('validate round-trip on a valid bundle → exit 0', async () => {
    const path = join(workDir, 'valid.boject.json');
    await writeFile(path, JSON.stringify(BUNDLE));
    const { stdout } = await run(
      'node',
      [CLI_PATH, 'entries', 'validate', path],
      { cwd: workDir }
    );
    expect(stdout).toContain('Bundle valid');
  });

  it('import round-trip posts the bundle and shows counts', async () => {
    const path = join(workDir, 'to-import.boject.json');
    await writeFile(path, JSON.stringify(BUNDLE));
    const { stdout, stderr } = await run(
      'node',
      [CLI_PATH, 'entries', 'import', path],
      {
        cwd: workDir,
        env: { ...process.env, BOJECT_API_KEY: 'boject_e2e' },
      }
    );
    expect(stderr).toBe('');
    expect(stdout).toContain('Imported entries');
    expect(stdout).toContain('1 created');

    const posts = requests.filter(
      (r) => r.method === 'POST' && r.url === '/api/content-bundle/import'
    );
    expect(posts).toHaveLength(1);
  });

  it('import rejects a bad --on-conflict value with exit 1', async () => {
    const path = join(workDir, 'to-import.boject.json');
    await writeFile(path, JSON.stringify(BUNDLE));
    await expect(
      run(
        'node',
        [CLI_PATH, 'entries', 'import', path, '--on-conflict', 'bogus'],
        {
          cwd: workDir,
          env: { ...process.env, BOJECT_API_KEY: 'boject_e2e' },
        }
      )
    ).rejects.toMatchObject({ code: 1 });
  });
});
