import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDriftContext } from '../../../src/drift/context.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'boject-drift-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const make = () => createDriftContext({ root, version: null, shellEnv: {} });

describe('createDriftContext', () => {
  it('readEnvFile returns null when the file is absent', async () => {
    const ctx = await make();
    expect(await ctx.readEnvFile('.env')).toBeNull();
  });

  it('readEnvFile parses quoted values, comments and CRLF', async () => {
    await writeFile(join(root, '.env'), 'A="x y"\r\n# c\r\nB=2\r\n');
    const ctx = await make();
    expect(await ctx.readEnvFile('.env')).toEqual({ A: 'x y', B: '2' });
  });

  it('readEnvFile rethrows non-ENOENT errors', async () => {
    await mkdir(join(root, '.env'));
    const ctx = await make();
    await expect(ctx.readEnvFile('.env')).rejects.toThrow();
  });

  it('compose is null when docker-compose.yml is absent', async () => {
    expect((await make()).compose).toBeNull();
  });

  it('compose is the parsed object', async () => {
    await writeFile(
      join(root, 'docker-compose.yml'),
      'services:\n  cms:\n    image: ghcr.io/x/cms:1\n'
    );
    const ctx = await make();
    const services = ctx.compose?.services as {
      cms: { image: string };
    };
    expect(services.cms.image).toBe('ghcr.io/x/cms:1');
  });

  it('createDriftContext throws on malformed YAML', async () => {
    await writeFile(join(root, 'docker-compose.yml'), 'services: [\n');
    await expect(make()).rejects.toThrow();
  });

  it('isGitIgnored delegates with root', async () => {
    const fn = vi.fn().mockResolvedValue(true);
    const ctx = await createDriftContext({
      root,
      version: '0.0.3',
      shellEnv: {},
      isGitIgnored: fn,
    });
    expect(await ctx.isGitIgnored('.env.local')).toBe(true);
    expect(fn).toHaveBeenCalledWith('.env.local', root);
  });
});
