import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderDockerCompose } from '../../../create-boject-cms/src/templates/dockerCompose.js';
import { runDoctor } from '../../src/commands/doctor.js';

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'boject-doctor-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

const KEY = `boject_${'a'.repeat(64)}`;
const FULL_ENV =
  'MEILI_URL=http://meilisearch:7700\nMEILI_MASTER_KEY=abc\nREDIS_URL=redis://redis:6379\n';
const compose = (tag: string) =>
  renderDockerCompose({
    imageTag: `ghcr.io/bojectify/boject-cms:${tag}`,
    starter: 'none',
  });
const ignored = async () => true;

async function scaffold(
  tag: string,
  env = FULL_ENV,
  local = `BOJECT_API_KEY=${KEY}\n`
) {
  await writeFile(join(cwd, 'docker-compose.yml'), compose(tag));
  await writeFile(join(cwd, '.env'), env);
  await writeFile(join(cwd, '.env.local'), local);
}

describe('runDoctor', () => {
  it('exit 0 and "No drift found" for a fully scaffolded fixture', async () => {
    await scaffold('0.0.3');
    const r = await runDoctor({ cwd, shellEnv: {}, isGitIgnored: ignored });
    expect(r).toEqual({ exitCode: 0, output: 'No drift found for 0.0.3.' });
  });

  it('exit 1 on a required finding', async () => {
    await scaffold('0.0.3', 'FOO=bar\n');
    const r = await runDoctor({ cwd, shellEnv: {}, isGitIgnored: ignored });
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain('✗ required  search-and-cache-services');
  });

  it('advice only → exit 0; with strict → exit 1', async () => {
    await scaffold('0.0.3');
    const notIgnored = async () => false;
    const loose = await runDoctor({
      cwd,
      shellEnv: {},
      isGitIgnored: notIgnored,
    });
    expect(loose.exitCode).toBe(0);
    expect(loose.output).toContain('· advice    env-local-gitignored');
    expect(loose.output).toContain(
      'No problems found for 0.0.3 (advice above).'
    );
    const strict = await runDoctor({
      cwd,
      shellEnv: {},
      flags: { strict: true },
      isGitIgnored: notIgnored,
    });
    expect(strict.exitCode).toBe(1);
  });

  it('warning-only finding exits 1 without --strict', async () => {
    await scaffold('0.0.3');
    await writeFile(
      join(cwd, '.env'),
      `${FULL_ENV}BOJECT_BOOTSTRAP_API_KEY=boject_${'b'.repeat(64)}\n`
    );
    const r = await runDoctor({ cwd, shellEnv: {}, isGitIgnored: ignored });
    expect(r.output).toContain('! warning   stale-bootstrap-key');
    expect(r.output).not.toContain('✗ required');
    expect(r.exitCode).toBe(1);
    expect(r.error).toBeUndefined();
  });

  it('non-semver tag runs every check', async () => {
    await scaffold('latest', 'FOO=bar\n');
    const r = await runDoctor({
      cwd,
      shellEnv: {},
      flags: { json: true },
      isGitIgnored: ignored,
    });
    const parsed = JSON.parse(r.output);
    expect(parsed.version).toBeNull();
    expect(parsed.tag).toBe('latest');
    expect(
      parsed.findings.map((f: { checkId: string }) => f.checkId)
    ).toContain('search-and-cache-services');
  });

  it('--json shape', async () => {
    await scaffold('0.0.3');
    const r = await runDoctor({
      cwd,
      shellEnv: {},
      flags: { json: true },
      isGitIgnored: ignored,
    });
    expect(Object.keys(JSON.parse(r.output))).toEqual([
      'version',
      'tag',
      'findings',
      'skipped',
    ]);
  });

  it('missing docker-compose.yml → exit 1 with the message', async () => {
    const r = await runDoctor({ cwd, shellEnv: {}, isGitIgnored: ignored });
    expect(r).toEqual({
      exitCode: 1,
      error: true,
      output: `No docker-compose.yml in ${cwd} — run boject doctor from your project directory.`,
    });
  });

  it('doctor never modifies files', async () => {
    await scaffold('0.0.3', 'FOO=bar\nBOJECT_BOOTSTRAP_API_KEY=x\n');
    const snapshot = async () => {
      const out: Record<string, [string, number]> = {};
      for (const name of (await readdir(cwd)).sort()) {
        out[name] = [
          await readFile(join(cwd, name), 'utf8'),
          (await stat(join(cwd, name))).mtimeMs,
        ];
      }
      return out;
    };
    const before = await snapshot();
    await runDoctor({ cwd, shellEnv: {}, isGitIgnored: async () => false });
    await runDoctor({
      cwd,
      shellEnv: {},
      flags: { json: true },
      isGitIgnored: ignored,
    });
    expect(await snapshot()).toEqual(before);
  });
});
