import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..', '..');
const CLI_PATH = join(PACKAGE_ROOT, 'dist', 'index.js');

async function runCli(args: string[], opts: { env?: NodeJS.ProcessEnv } = {}) {
  return run(process.execPath, [CLI_PATH, ...args], {
    env: { ...process.env, ...opts.env },
  });
}

beforeAll(async () => {
  await run('pnpm', ['--filter', 'create-boject-cms', 'build'], {
    cwd: resolve(PACKAGE_ROOT, '..', '..'),
  });
}, 60_000);

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'create-boject-cms-e2e-'));
});

afterAll(async () => {
  // nothing global; per-test workDirs are removed below
});

describe('create-boject-cms E2E', () => {
  it('scaffolds the full file set with --starter web-base', async () => {
    const target = join(workDir, 'site');
    const { stdout } = await runCli([target, '--starter', 'web-base']);

    expect(stdout).toContain('Scaffolded boject-cms project');
    expect(stdout).toContain('admin@local');

    const files = await readdir(target);
    expect(files.sort()).toEqual(
      [
        '.boject.config.json',
        '.env',
        '.gitignore',
        'README.md',
        'content-types',
        'docker-compose.yml',
        'package.json',
        'starters',
      ].sort()
    );

    const env = await readFile(join(target, '.env'), 'utf8');
    // Session password: 32 bytes → 43 base64 chars + 1 '=' padding
    expect(env).toMatch(/^NUXT_SESSION_PASSWORD=[A-Za-z0-9+/]{43}=$/m);
    // Admin password: 16 bytes → 22 base64 chars + 2 '=' padding
    expect(env).toMatch(/^BOJECT_ADMIN_PASSWORD=[A-Za-z0-9+/]{22}==$/m);

    // Search + cache infra wired for a bootable production stack.
    expect(env).toMatch(/^MEILI_URL=http:\/\/meilisearch:7700$/m);
    expect(env).toMatch(/^MEILI_MASTER_KEY=[A-Za-z0-9+/]{43}=$/m);
    expect(env).toMatch(/^REDIS_URL=redis:\/\/redis:6379$/m);

    const starterBundle = await readFile(
      join(target, 'starters', 'web-base.boject.json'),
      'utf8'
    );
    const canonical = await readFile(
      resolve(PACKAGE_ROOT, '..', '..', 'starters', 'web-base.boject.json'),
      'utf8'
    );
    expect(starterBundle).toBe(canonical);

    const compose = await readFile(join(target, 'docker-compose.yml'), 'utf8');
    expect(compose).toContain('image: getmeili/meilisearch:v1.45.2');
    expect(compose).toContain('image: redis:7.4-alpine');
    expect(compose).toContain('MEILI_MASTER_KEY: ${MEILI_MASTER_KEY}');
    expect(compose).toContain('- meilidata:/meili_data');

    await rm(target, { recursive: true, force: true });
  }, 30_000);

  it('scaffolds Article/Tag/Category content types with --starter articles', async () => {
    const target = join(workDir, 'site');
    await runCli([target, '--starter', 'articles']);

    const files = await readdir(target);
    expect(files).not.toContain('.mcp.json');

    const schema = await readFile(
      join(target, 'content-types', 'schema.boject.json'),
      'utf8'
    );
    const parsed = JSON.parse(schema) as {
      contentTypes: { identifier: string }[];
    };
    const identifiers = parsed.contentTypes.map((ct) => ct.identifier);
    expect(identifiers).toContain('Article');
    expect(identifiers).toContain('Tag');
    expect(identifiers).toContain('Category');

    await rm(target, { recursive: true, force: true });
  }, 30_000);

  it('omits starters/ and BOJECT_INITIAL_STARTER when --starter none', async () => {
    const target = join(workDir, 'site');
    await runCli([target, '--starter', 'none']);

    const files = await readdir(target);
    expect(files).not.toContain('starters');

    const env = await readFile(join(target, '.env'), 'utf8');
    expect(env).not.toMatch(/BOJECT_INITIAL_STARTER/);

    await rm(target, { recursive: true, force: true });
  }, 30_000);

  it('exits non-zero when the target is non-empty without --force', async () => {
    const target = workDir; // the tempdir itself has at least `.` / `..`; we'll put a marker
    await writeFile(join(target, 'marker.txt'), 'hi');

    await expect(
      runCli([target, '--starter', 'web-base'])
    ).rejects.toMatchObject({
      code: 1,
    });

    const files = await readdir(target);
    expect(files).toContain('marker.txt');
    expect(files).not.toContain('.env');
  }, 30_000);

  it('succeeds into a non-empty target when --force is passed', async () => {
    const target = workDir;
    await writeFile(join(target, 'marker.txt'), 'hi');

    const { stdout } = await runCli([
      target,
      '--starter',
      'web-base',
      '--force',
    ]);
    expect(stdout).toContain('Scaffolded');

    const files = await readdir(target);
    expect(files).toContain('.env');
    expect(files).toContain('marker.txt');
  }, 30_000);

  it('exits 1 with usage when no target is provided', async () => {
    await expect(runCli([])).rejects.toMatchObject({ code: 1 });
  }, 30_000);

  it('honours --image to override the default tag', async () => {
    const target = join(workDir, 'site');
    await runCli([
      target,
      '--starter',
      'web-base',
      '--image',
      'localhost:5555/boject/cms:dev',
    ]);

    const compose = await readFile(join(target, 'docker-compose.yml'), 'utf8');
    expect(compose).toContain('image: localhost:5555/boject/cms:dev');
    expect(compose).not.toContain('ghcr.io/bojectify/boject-cms:latest');

    await rm(target, { recursive: true, force: true });
  }, 30_000);

  it('writes .mcp.json + README AI section + AI next-steps with --ai', async () => {
    const target = join(workDir, 'ai-site');
    const { stdout } = await runCli([target, '--starter', 'none', '--ai']);

    const files = await readdir(target);
    expect(files).toContain('.mcp.json');

    const mcp = JSON.parse(await readFile(join(target, '.mcp.json'), 'utf8'));
    expect(mcp.mcpServers.boject).toEqual({
      command: 'npx',
      args: ['-y', '@boject/cli', 'mcp'],
    });

    const readme = await readFile(join(target, 'README.md'), 'utf8');
    expect(readme).toContain('## AI-assisted content modelling');

    expect(stdout).toContain('/mcp__boject__model_content');
  });

  it('omits AI wiring without --ai', async () => {
    const target = join(workDir, 'plain-site');
    const { stdout } = await runCli([target, '--starter', 'none']);
    const files = await readdir(target);
    expect(files).not.toContain('.mcp.json');
    expect(stdout).not.toContain('/mcp__boject__');
  });
});
