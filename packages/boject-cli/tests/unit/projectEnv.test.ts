import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadProjectEnv, missingApiKeyMessage } from '../../src/projectEnv.js';

let root: string;
const CONFIG = JSON.stringify({
  cms: { url: 'http://localhost:4000' },
  schema: { path: 'content-types/schema.boject.json' },
});
const ignored = vi.fn(async () => true as boolean | null);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'boject-env-'));
  await writeFile(join(root, '.boject.config.json'), CONFIG);
  ignored.mockReset();
  ignored.mockResolvedValue(true);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function load(env: NodeJS.ProcessEnv = {}, cwd = root) {
  return loadProjectEnv({ cwd, env, isGitIgnored: ignored });
}

describe('loadProjectEnv (#505)', () => {
  it('loads BOJECT_API_KEY from .env next to .boject.config.json', async () => {
    await writeFile(join(root, '.env'), 'BOJECT_API_KEY=from-env-file\n');
    const env: NodeJS.ProcessEnv = {};
    const result = await load(env);
    expect(env.BOJECT_API_KEY).toBe('from-env-file');
    expect(result.loadedKeys).toEqual(['BOJECT_API_KEY']);
  });

  it('never overwrites a variable already set in the shell', async () => {
    await writeFile(join(root, '.env'), 'BOJECT_API_KEY=from-env-file\n');
    await writeFile(join(root, '.env.local'), 'BOJECT_API_KEY=from-local\n');
    const env: NodeJS.ProcessEnv = { BOJECT_API_KEY: 'from-shell' };
    await load(env);
    expect(env.BOJECT_API_KEY).toBe('from-shell');
  });

  it('prefers .env.local over .env', async () => {
    await writeFile(
      join(root, '.env'),
      'BOJECT_API_KEY=from-env-file\nBOJECT_CMS_URL=http://from-env\n'
    );
    await writeFile(join(root, '.env.local'), 'BOJECT_API_KEY=from-local\n');
    const env: NodeJS.ProcessEnv = {};
    await load(env);
    expect(env.BOJECT_API_KEY).toBe('from-local');
    expect(env.BOJECT_CMS_URL).toBe('http://from-env');
  });

  it('only loads the variables the CLI reads (#512)', async () => {
    await writeFile(
      join(root, '.env'),
      [
        'BOJECT_API_KEY=k',
        'BOJECT_CMS_URL=http://cms',
        'PERF_DATABASE_URL=postgresql://perf',
        'PERF_SAMPLER_CONTAINER=db',
        'PERF_SAMPLER_INTERVAL_MS=500',
        'PERF_SAMPLER_OUT=out.csv',
        // Container settings the CLI never reads:
        'BOJECT_ADMIN_EMAIL=admin@local',
        'BOJECT_ADMIN_PASSWORD=secret',
        'BOJECT_HOST_PORT=4000',
        'BOJECT_SCHEMA_DIR=/app/content-types',
        'BOJECT_BOOTSTRAP_API_KEY=boject_ab12:00',
        'PERF_SOMETHING_ELSE=x',
        'DATABASE_URL=postgresql://boject:boject@db:5432/boject',
        'NUXT_SESSION_PASSWORD=secret',
      ].join('\n')
    );
    const env: NodeJS.ProcessEnv = {};
    await load(env);
    expect(env).toStrictEqual({
      BOJECT_API_KEY: 'k',
      BOJECT_CMS_URL: 'http://cms',
      PERF_DATABASE_URL: 'postgresql://perf',
      PERF_SAMPLER_CONTAINER: 'db',
      PERF_SAMPLER_INTERVAL_MS: '500',
      PERF_SAMPLER_OUT: 'out.csv',
    });
  });

  it('never loads BOJECT_NO_DOTENV from a file', async () => {
    await writeFile(
      join(root, '.env'),
      'BOJECT_NO_DOTENV=1\nBOJECT_API_KEY=k\n'
    );
    const env: NodeJS.ProcessEnv = {};
    await load(env);
    expect(env).toStrictEqual({ BOJECT_API_KEY: 'k' });
  });

  it('works with no .env files', async () => {
    const env: NodeJS.ProcessEnv = {};
    const result = await load(env);
    expect(env).toStrictEqual({});
    expect(result.root).toBe(root);
    expect(result.loadedKeys).toEqual([]);
  });

  it('does nothing outside a project (no .boject.config.json)', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'boject-env-outside-'));
    try {
      await writeFile(join(outside, '.env'), 'BOJECT_API_KEY=stray\n');
      const env: NodeJS.ProcessEnv = {};
      const result = await load(env, outside);
      expect(env).toStrictEqual({});
      expect(result.root).toBeNull();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('loads the project-root .env when run from a subfolder', async () => {
    await writeFile(join(root, '.env'), 'BOJECT_API_KEY=root-key\n');
    const sub = join(root, 'content-types', 'nested');
    await mkdir(sub, { recursive: true });
    const env: NodeJS.ProcessEnv = {};
    await load(env, sub);
    expect(env.BOJECT_API_KEY).toBe('root-key');
  });

  it('still loads when .boject.config.json is invalid', async () => {
    await writeFile(join(root, '.boject.config.json'), '{ not json');
    await writeFile(join(root, '.env'), 'BOJECT_API_KEY=k\n');
    const env: NodeJS.ProcessEnv = {};
    await load(env);
    expect(env.BOJECT_API_KEY).toBe('k');
  });

  it.each(['1', 'true'])('BOJECT_NO_DOTENV=%s turns it off', async (v) => {
    await writeFile(join(root, '.env'), 'BOJECT_API_KEY=k\n');
    const env: NodeJS.ProcessEnv = { BOJECT_NO_DOTENV: v };
    const result = await load(env);
    expect(env.BOJECT_API_KEY).toBeUndefined();
    expect(result.checkedFiles).toEqual([]);
  });

  it('warns when a loaded .env.local is not gitignored', async () => {
    await writeFile(join(root, '.env.local'), 'BOJECT_API_KEY=k\n');
    ignored.mockResolvedValue(false);
    const result = await load();
    expect(ignored).toHaveBeenCalledWith(join(root, '.env.local'), root);
    expect(result.warnings).toEqual([
      expect.stringMatching(/^Warning: .*\.env\.local is not gitignored/),
    ]);
  });

  it('does not warn when .env.local is ignored or the folder is not a git repo', async () => {
    await writeFile(join(root, '.env.local'), 'BOJECT_API_KEY=k\n');
    ignored.mockResolvedValueOnce(true);
    expect((await load()).warnings).toEqual([]);
    ignored.mockResolvedValueOnce(null);
    expect((await load()).warnings).toEqual([]);
  });

  it('does not check git when there is no .env.local', async () => {
    await writeFile(join(root, '.env'), 'BOJECT_API_KEY=k\n');
    await load();
    expect(ignored).not.toHaveBeenCalled();
  });
});

describe('loadProjectEnv — real git check-ignore (#505)', () => {
  it('warns only when .env.local is not ignored by the repo', async () => {
    execFileSync('git', ['init', '-q'], { cwd: root });
    await writeFile(join(root, '.env.local'), 'BOJECT_API_KEY=k\n');

    await writeFile(join(root, '.gitignore'), '.env\n');
    const unignored = await loadProjectEnv({ cwd: root, env: {} });
    expect(unignored.warnings).toHaveLength(1);

    await writeFile(join(root, '.gitignore'), '.env\n.env.local\n');
    const ignoredResult = await loadProjectEnv({ cwd: root, env: {} });
    expect(ignoredResult.warnings).toEqual([]);
  });

  it('does not warn outside a git repo', async () => {
    await writeFile(join(root, '.env.local'), 'BOJECT_API_KEY=k\n');
    const result = await loadProjectEnv({ cwd: root, env: {} });
    expect(result.warnings).toEqual([]);
  });
});

describe('missingApiKeyMessage (#505)', () => {
  it('lists the environment and the files that were checked', async () => {
    const result = await load({});
    expect(missingApiKeyMessage(result)).toBe(
      `Error: BOJECT_API_KEY is not set (checked: environment, ${join(root, '.env.local')}, ${join(root, '.env')}).`
    );
  });

  it('mentions only the environment outside a project', () => {
    expect(
      missingApiKeyMessage({
        root: null,
        checkedFiles: [],
        loadedKeys: [],
        warnings: [],
      })
    ).toBe('Error: BOJECT_API_KEY is not set (checked: environment).');
  });
});
