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
import { CLI_VERSION } from '../../src/version.js';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..', '..');
const CLI_PATH = join(PACKAGE_ROOT, 'dist', 'index.js');

let server: Server;
let port: number;
const tagsToServe: { value: string[] } = { value: [] };

beforeAll(async () => {
  await run('pnpm', ['--filter', '@boject/cli', 'build'], {
    cwd: resolve(PACKAGE_ROOT, '..', '..'),
  });

  server = createServer((req, res) => {
    if (req.url === '/v2/boject/cms/tags/list') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ name: 'boject/cms', tags: tagsToServe.value }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  port = address.port;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'boject-cli-e2e-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeFixture(tag: string): Promise<string> {
  const path = join(workDir, 'docker-compose.yml');
  await writeFile(
    path,
    `services:\n  cms:\n    image: localhost:${port}/boject/cms:${tag}\n  db:\n    image: postgres:17\n`
  );
  return path;
}

function runCli(args: string[]) {
  return run(process.execPath, [CLI_PATH, ...args], {
    cwd: workDir,
    env: { ...process.env },
  });
}

describe('boject upgrade E2E (mock registry)', () => {
  it('--check exits 1 when an update is available', async () => {
    await writeFixture('1.0.0');
    tagsToServe.value = ['1.0.0', '1.2.0', 'latest'];
    await expect(runCli(['upgrade', '--check'])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('Update available: 1.0.0 → 1.2.0'),
    });
  });

  it('--check exits 0 when current is latest semver', async () => {
    await writeFixture('1.2.0');
    tagsToServe.value = ['1.0.0', '1.2.0'];
    const { stdout } = await runCli(['upgrade', '--check']);
    expect(stdout).toContain('Up to date: 1.2.0');
  });

  it('--dry-run prints a diff and leaves the file untouched', async () => {
    const path = await writeFixture('1.0.0');
    tagsToServe.value = ['1.0.0', '1.1.0'];
    const { stdout } = await runCli(['upgrade', '--dry-run']);
    expect(stdout).toContain('- image: boject/cms:1.0.0');
    expect(stdout).toContain('+ image: boject/cms:1.1.0');
    const body = await readFile(path, 'utf8');
    expect(body).toContain(`localhost:${port}/boject/cms:1.0.0`);
  });

  it('exits 1 when no semver tags are available', async () => {
    await writeFixture('1.0.0');
    tagsToServe.value = ['latest', 'dev'];
    await expect(runCli(['upgrade'])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(/No semver tags/i),
    });
  });

  it('--version prints CLI_VERSION', async () => {
    const { stdout } = await run(process.execPath, [CLI_PATH, '--version']);
    expect(stdout.trim()).toBe(CLI_VERSION);
  });
});
