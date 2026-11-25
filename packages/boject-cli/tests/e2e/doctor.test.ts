import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..', '..');
const CLI_PATH = join(PACKAGE_ROOT, 'dist', 'index.js');

let workDir: string;

beforeAll(async () => {
  await run('pnpm', ['--filter', '@boject/cli', 'build'], {
    cwd: resolve(PACKAGE_ROOT, '..', '..'),
  });
}, 60_000);

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'boject-cli-doctor-e2e-'));
  // A git repo with .env.local ignored, so loadProjectEnv's "not gitignored"
  // warning can't appear and the only finding is the missing search/cache keys.
  await run('git', ['init', '-q'], { cwd: workDir });
  await writeFile(join(workDir, '.gitignore'), '.env.local\n');
  await writeFile(join(workDir, '.env'), 'DATABASE_URL=postgres://x\n');
  await writeFile(
    join(workDir, 'docker-compose.yml'),
    'services:\n  cms:\n    image: ghcr.io/bojectify/boject-cms:0.0.1-rc.2\n  db:\n    image: postgres:17\n'
  );
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

afterAll(() => undefined);

async function runDoctor(args: string[]) {
  try {
    const r = await run(process.execPath, [CLI_PATH, 'doctor', ...args], {
      cwd: workDir,
      env: { ...process.env },
    });
    return { code: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (error) {
    const e = error as { code: number; stdout: string; stderr: string };
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

describe('boject doctor E2E', () => {
  it('--json exits 1 on drift with only parseable JSON on stdout', async () => {
    const r = await runDoctor(['--json']);
    expect(r.code).toBe(1);
    const parsed = JSON.parse(r.stdout);
    expect(
      parsed.findings.map((f: { checkId: string }) => f.checkId)
    ).toContain('search-and-cache-services');
  });

  it('text report goes to stdout even when exiting 1', async () => {
    const r = await runDoctor([]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('search-and-cache-services');
  });

  it('missing docker-compose.yml: error on stderr, stdout empty', async () => {
    await rm(join(workDir, 'docker-compose.yml'));
    const r = await runDoctor(['--json']);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('No docker-compose.yml');
  });
});
