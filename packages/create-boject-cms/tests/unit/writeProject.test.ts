import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
};

describe('writeProject', () => {
  it('creates the target directory and writes the expected files for starter=base', async () => {
    const target = join(workDir, 'site');
    const result = await writeProject({
      ...baseArgs,
      targetDir: target,
      starter: 'base',
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
    expect(starterFiles).toEqual(['base.boject.json']);

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
        starter: 'base',
        force: false,
      })
    ).rejects.toThrow(/not empty/);
  });

  it('succeeds in a non-empty target when force is true', async () => {
    await writeFile(join(workDir, 'existing.txt'), 'hi');
    const result = await writeProject({
      ...baseArgs,
      targetDir: workDir,
      starter: 'base',
      force: true,
    });
    expect(result.adminPassword.length).toBeGreaterThan(0);
  });

  it('writes the image tag into docker-compose.yml', async () => {
    const target = join(workDir, 'site');
    await writeProject({
      ...baseArgs,
      targetDir: target,
      starter: 'base',
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
      starter: 'base',
      force: false,
      hostPort: 4100,
    });

    const env = await readFile(join(target, '.env'), 'utf8');
    expect(env).toMatch(/^BOJECT_HOST_PORT=4100$/m);

    const compose = await readFile(join(target, 'docker-compose.yml'), 'utf8');
    expect(compose).toContain("'${BOJECT_HOST_PORT:-4000}:3000'");
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
      starter: 'base',
      force: false,
    });
    const written = await readFile(
      join(target, 'content-types', 'schema.boject.json'),
      'utf8'
    );
    const expected = await readFile(join(FIXTURES, 'base.boject.json'), 'utf8');
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
});
