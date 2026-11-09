import { createHash } from 'node:crypto';
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeProject } from '../../src/writeProject.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures/starters');

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'create-boject-cms-test-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const baseArgs = {
  imageTag: 'ghcr.io/bojectify/boject-cms:latest',
  startersSourceDir: FIXTURES,
  hostPort: 4000,
  aiAssist: false,
};

describe('writeProject', () => {
  it('creates the target directory and writes the expected files for starter=web-base', async () => {
    const target = join(workDir, 'site');
    const result = await writeProject({
      ...baseArgs,
      targetDir: target,
      starter: 'web-base',
      force: false,
    });

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

    const starterFiles = await readdir(join(target, 'starters'));
    expect(starterFiles).toEqual(['web-base.boject.json']);

    expect(result.adminEmail).toBe('admin@local');
    expect(result.adminPassword.length).toBeGreaterThan(0);
  });

  it('omits the starters directory when starter=none', async () => {
    const target = join(workDir, 'site');
    await writeProject({
      ...baseArgs,
      targetDir: target,
      starter: 'none',
      force: false,
    });

    const files = await readdir(target);
    expect(files).not.toContain('starters');
  });

  it('throws when the target directory is non-empty and force is false', async () => {
    await writeFile(join(workDir, 'existing.txt'), 'hi');

    await expect(
      writeProject({
        ...baseArgs,
        targetDir: workDir,
        starter: 'web-base',
        force: false,
      })
    ).rejects.toThrow(/not empty/);
  });

  it('succeeds in a non-empty target when force is true', async () => {
    await writeFile(join(workDir, 'existing.txt'), 'hi');
    const result = await writeProject({
      ...baseArgs,
      targetDir: workDir,
      starter: 'web-base',
      force: true,
    });
    expect(result.adminPassword.length).toBeGreaterThan(0);
  });

  it('writes the image tag into docker-compose.yml', async () => {
    const target = join(workDir, 'site');
    await writeProject({
      ...baseArgs,
      targetDir: target,
      starter: 'web-base',
      force: false,
      imageTag: 'localhost:5555/boject/cms:dev',
    });

    const compose = await readFile(join(target, 'docker-compose.yml'), 'utf8');
    expect(compose).toContain('image: localhost:5555/boject/cms:dev');
  });

  it('writes BOJECT_HOST_PORT into .env; compose reads it via interpolation', async () => {
    const target = join(workDir, 'site');
    await writeProject({
      ...baseArgs,
      targetDir: target,
      starter: 'web-base',
      force: false,
      hostPort: 4100,
    });

    const env = await readFile(join(target, '.env'), 'utf8');
    expect(env).toMatch(/^BOJECT_HOST_PORT=4100$/m);

    const compose = await readFile(join(target, 'docker-compose.yml'), 'utf8');
    expect(compose).toContain("'${BOJECT_HOST_PORT:-4000}:3000'");
  });

  it('uses the same host port in .env, README.md and .boject.config.json (#511)', async () => {
    const target = join(workDir, 'site');
    await writeProject({
      ...baseArgs,
      targetDir: target,
      starter: 'web-base',
      force: false,
      hostPort: 4100,
    });

    const env = await readFile(join(target, '.env'), 'utf8');
    expect(env).toMatch(/^BOJECT_HOST_PORT=4100$/m);
    const readme = await readFile(join(target, 'README.md'), 'utf8');
    expect(readme).toContain('http://localhost:4100/login');
    const config = JSON.parse(
      await readFile(join(target, '.boject.config.json'), 'utf8')
    );
    expect(config.cms.url).toBe('http://localhost:4100');
  });

  it('throws when the starter bundle is missing from the source directory', async () => {
    const target = join(workDir, 'site');
    await expect(
      writeProject({
        ...baseArgs,
        targetDir: target,
        starter: 'sport',
        force: false,
      })
    ).rejects.toThrow(/sport.boject.json/);
  });

  it('writes content-types/schema.boject.json copying the chosen starter', async () => {
    const target = join(workDir, 'site');
    await writeProject({
      ...baseArgs,
      targetDir: target,
      starter: 'web-base',
      force: false,
    });
    const written = await readFile(
      join(target, 'content-types', 'schema.boject.json'),
      'utf8'
    );
    const expected = await readFile(
      join(FIXTURES, 'web-base.boject.json'),
      'utf8'
    );
    expect(written).toBe(expected);
  });

  it('writes the empty-bundle stub for the "none" starter', async () => {
    const target = join(workDir, 'site');
    await writeProject({
      ...baseArgs,
      targetDir: target,
      starter: 'none',
      force: false,
    });
    const written = await readFile(
      join(target, 'content-types', 'schema.boject.json'),
      'utf8'
    );
    const parsed = JSON.parse(written);
    expect(parsed.version).toBe(2);
    expect(parsed.contentTypes).toEqual([]);
  });

  it('writes .mcp.json when aiAssist is true', async () => {
    const target = join(workDir, 'ai-site');
    await writeProject({
      ...baseArgs,
      aiAssist: true,
      targetDir: target,
      starter: 'none',
      force: false,
    });
    const files = await readdir(target);
    expect(files).toContain('.mcp.json');
    const mcp = JSON.parse(await readFile(join(target, '.mcp.json'), 'utf8'));
    expect(mcp.mcpServers.boject.args).toContain('mcp');
    const readme = await readFile(join(target, 'README.md'), 'utf8');
    expect(readme).toContain('/mcp__boject__model_content');
  });

  it('omits .mcp.json when aiAssist is false', async () => {
    const target = join(workDir, 'plain-site');
    await writeProject({
      ...baseArgs,
      aiAssist: false,
      targetDir: target,
      starter: 'none',
      force: false,
    });
    const files = await readdir(target);
    expect(files).not.toContain('.mcp.json');
  });

  describe('CLI API key (#510)', () => {
    async function scaffold(cliApiKey: boolean, force = false) {
      const target = join(workDir, 'site');
      const result = await writeProject({
        ...baseArgs,
        targetDir: target,
        starter: 'web-base',
        force,
        cliApiKey,
      });
      return { target, result };
    }

    it('writes the raw key to .env.local (0600) and only its prefix:hash to .env', async () => {
      const { target, result } = await scaffold(true);
      expect(result.cliApiKeyCreated).toBe(true);

      const local = await readFile(join(target, '.env.local'), 'utf8');
      const raw = /^BOJECT_API_KEY=(boject_[0-9a-f]{64})$/m.exec(local)?.[1];
      expect(raw).toBeDefined();
      expect((await stat(join(target, '.env.local'))).mode & 0o777).toBe(0o600);

      const hash = createHash('sha256').update(raw!).digest('hex');
      const env = await readFile(join(target, '.env'), 'utf8');
      expect(env).toMatch(
        new RegExp(
          `^BOJECT_BOOTSTRAP_API_KEY=${raw!.slice(0, 11)}:${hash}$`,
          'm'
        )
      );
      expect(env).not.toContain(raw!);
      const readme = await readFile(join(target, 'README.md'), 'utf8');
      expect(readme).not.toContain(raw!);
      expect(readme).toContain('## Your CLI API key');
    });

    it('writes no key when opted out', async () => {
      const { target, result } = await scaffold(false);
      expect(result.cliApiKeyCreated).toBe(false);
      expect(await readdir(target)).not.toContain('.env.local');
      const env = await readFile(join(target, '.env'), 'utf8');
      expect(env).not.toMatch(/^BOJECT_BOOTSTRAP_API_KEY/m);
    });

    it('rewrites an existing .env.local with mode 0600 on --force', async () => {
      const target = join(workDir, 'site');
      await writeProject({
        ...baseArgs,
        targetDir: target,
        starter: 'web-base',
        force: false,
        cliApiKey: false,
      });
      await writeFile(join(target, '.env.local'), 'OLD=1\n');
      await chmod(join(target, '.env.local'), 0o644);

      await scaffold(true, true);
      const local = await readFile(join(target, '.env.local'), 'utf8');
      expect(local).not.toContain('OLD=1');
      expect(local).toMatch(/^BOJECT_API_KEY=boject_[0-9a-f]{64}$/m);
      expect((await stat(join(target, '.env.local'))).mode & 0o777).toBe(0o600);
    });
  });
});
