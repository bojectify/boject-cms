import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DRIFT_CHECKS } from '../../../src/drift/checks/index.js';
import {
  cliApiKey,
  resolveApiKey,
} from '../../../src/drift/checks/cliApiKey.js';
import { envLocalGitignored } from '../../../src/drift/checks/envLocalGitignored.js';
import { staleBootstrapKey } from '../../../src/drift/checks/staleBootstrapKey.js';
import { createDriftContext } from '../../../src/drift/context.js';
import { FIRST_API_KEY_COMMAND } from '../../../src/vendor/scaffoldApiKey.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'boject-drift-env-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const KEY = `boject_abcd${'1'.repeat(53)}`;
const OTHER_KEY = `boject_ffff${'2'.repeat(53)}`;
const HASH = 'a'.repeat(64);

const ctxFor = (
  shellEnv: Record<string, string | undefined> = {},
  isGitIgnored?: (p: string, r: string) => Promise<boolean | null>
) => createDriftContext({ root, version: null, shellEnv, isGitIgnored });

describe('envLocalGitignored', () => {
  it('has the expected metadata', () => {
    expect(envLocalGitignored.id).toBe('env-local-gitignored');
    expect(envLocalGitignored.appliesFrom).toBe('0.0.2');
    expect(envLocalGitignored.severity).toBe('advice');
  });

  it('finding when not ignored', async () => {
    const out = await envLocalGitignored.run(
      await ctxFor({}, async () => false)
    );
    expect(out).toMatchObject({
      title: ".env.local isn't gitignored",
      snippets: [{ file: '.gitignore', text: '.env.local' }],
    });
  });

  it('skipped when not a git repo', async () => {
    const out = await envLocalGitignored.run(
      await ctxFor({}, async () => null)
    );
    expect(out).toEqual({
      skipped: "not a git repository (or git isn't installed)",
    });
  });

  it('null when ignored', async () => {
    expect(
      await envLocalGitignored.run(await ctxFor({}, async () => true))
    ).toBeNull();
  });

  it("checks <root>/.env.local even when the file doesn't exist", async () => {
    const fn = vi.fn(async () => true);
    await envLocalGitignored.run(await ctxFor({}, fn));
    expect(fn).toHaveBeenCalledWith(join(root, '.env.local'), root);
  });
});

describe('cliApiKey', () => {
  it('has the expected metadata', () => {
    expect(cliApiKey.id).toBe('cli-api-key');
    expect(cliApiKey.appliesFrom).toBe('0.0.3');
    expect(cliApiKey.severity).toBe('advice');
  });

  it('skipped with no env files', async () => {
    expect(await cliApiKey.run(await ctxFor())).toEqual({
      skipped: 'no .env or .env.local found',
    });
  });

  it('null when the shell has the key', async () => {
    await writeFile(join(root, '.env'), 'FOO=bar\n');
    expect(
      await cliApiKey.run(await ctxFor({ BOJECT_API_KEY: KEY }))
    ).toBeNull();
  });

  it('null when only .env has it', async () => {
    await writeFile(join(root, '.env'), `BOJECT_API_KEY=${KEY}\n`);
    expect(await cliApiKey.run(await ctxFor())).toBeNull();
  });

  it("empty shell value doesn't mask .env.local", async () => {
    await writeFile(join(root, '.env.local'), `BOJECT_API_KEY=${KEY}\n`);
    expect(
      await cliApiKey.run(await ctxFor({ BOJECT_API_KEY: '' }))
    ).toBeNull();
  });

  it('resolveApiKey skips an empty shell value for .env.local', async () => {
    await writeFile(join(root, '.env.local'), `BOJECT_API_KEY=${KEY}\n`);
    expect(await resolveApiKey(await ctxFor({ BOJECT_API_KEY: '' }))).toBe(KEY);
  });

  it('empty shell value with no key anywhere gives the finding', async () => {
    await writeFile(join(root, '.env'), 'FOO=bar\n');
    const out = await cliApiKey.run(await ctxFor({ BOJECT_API_KEY: '' }));
    expect(out).toMatchObject({
      title: 'No CLI API key (BOJECT_API_KEY) found',
    });
  });

  it('finding snippet contains FIRST_API_KEY_COMMAND', async () => {
    await writeFile(join(root, '.env'), 'FOO=bar\n');
    const out = await cliApiKey.run(await ctxFor());
    expect(out).toMatchObject({
      title: 'No CLI API key (BOJECT_API_KEY) found',
      snippets: [
        { file: 'terminal', text: FIRST_API_KEY_COMMAND },
        {
          file: '.env.local',
          text: 'BOJECT_API_KEY=<the key printed by the command above>',
        },
      ],
    });
  });

  it('finding text never mentions BOJECT_BOOTSTRAP_API_KEY', async () => {
    await writeFile(join(root, '.env'), 'FOO=bar\n');
    const out = await cliApiKey.run(await ctxFor());
    expect(JSON.stringify(out)).not.toContain('BOJECT_BOOTSTRAP_API_KEY');
  });
});

describe('staleBootstrapKey', () => {
  it('has the expected metadata', () => {
    expect(staleBootstrapKey.id).toBe('stale-bootstrap-key');
    expect(staleBootstrapKey.appliesFrom).toBeNull();
    expect(staleBootstrapKey.severity).toBe('warning');
  });

  it('null when prefixes match', async () => {
    await writeFile(
      join(root, '.env'),
      `BOJECT_BOOTSTRAP_API_KEY=boject_abcd:${HASH}\n`
    );
    expect(
      await staleBootstrapKey.run(await ctxFor({ BOJECT_API_KEY: KEY }))
    ).toBeNull();
  });

  it('warning when they differ, naming both prefixes', async () => {
    await writeFile(
      join(root, '.env'),
      `BOJECT_BOOTSTRAP_API_KEY=boject_abcd:${HASH}\n`
    );
    const out = await staleBootstrapKey.run(
      await ctxFor({ BOJECT_API_KEY: OTHER_KEY })
    );
    expect(out).toEqual({
      title: 'BOJECT_BOOTSTRAP_API_KEY points at a different key',
      detail: [
        'BOJECT_BOOTSTRAP_API_KEY in .env refers to key `boject_abcd`, but your CLI uses `boject_ffff`.',
        "If you've rotated the key, remove BOJECT_BOOTSTRAP_API_KEY and BOJECT_BOOTSTRAP_API_KEY_SCOPES from .env, or a database reset will bring the old key back.",
      ],
      snippets: [],
      notesVersion: null,
    });
  });

  it('never prints the raw key or hash', async () => {
    await writeFile(
      join(root, '.env'),
      `BOJECT_BOOTSTRAP_API_KEY=boject_abcd:${HASH}\n`
    );
    const out = await staleBootstrapKey.run(
      await ctxFor({ BOJECT_API_KEY: OTHER_KEY })
    );
    const json = JSON.stringify(out);
    expect(json).not.toContain(OTHER_KEY);
    expect(json).not.toContain(HASH);
  });

  it('empty shell value does not cause a false warning', async () => {
    await writeFile(
      join(root, '.env'),
      `BOJECT_BOOTSTRAP_API_KEY=boject_abcd:${HASH}\n`
    );
    await writeFile(join(root, '.env.local'), `BOJECT_API_KEY=${KEY}\n`);
    expect(
      await staleBootstrapKey.run(await ctxFor({ BOJECT_API_KEY: '' }))
    ).toBeNull();
  });

  it('truncates a colon-less (raw key) bootstrap value to 11 chars', async () => {
    const raw = `boject_9999${'3'.repeat(53)}`;
    await writeFile(join(root, '.env'), `BOJECT_BOOTSTRAP_API_KEY=${raw}\n`);
    const out = await staleBootstrapKey.run(
      await ctxFor({ BOJECT_API_KEY: KEY })
    );
    const json = JSON.stringify(out);
    expect(json).not.toContain(raw);
    expect(json).not.toContain(KEY);
    expect(json).toContain('refers to key `boject_9999`');
  });

  it('null with no bootstrap var', async () => {
    await writeFile(join(root, '.env'), 'FOO=bar\n');
    expect(
      await staleBootstrapKey.run(await ctxFor({ BOJECT_API_KEY: KEY }))
    ).toBeNull();
  });

  it('null with no resolvable API key', async () => {
    await writeFile(
      join(root, '.env'),
      `BOJECT_BOOTSTRAP_API_KEY=boject_abcd:${HASH}\n`
    );
    expect(await staleBootstrapKey.run(await ctxFor())).toBeNull();
  });

  it('skipped with no .env', async () => {
    expect(await staleBootstrapKey.run(await ctxFor())).toEqual({
      skipped: 'no .env found',
    });
  });
});

describe('DRIFT_CHECKS', () => {
  it('ids are unique and in the specified order', () => {
    expect(DRIFT_CHECKS.map((c) => c.id)).toEqual([
      'search-and-cache-services',
      'env-local-gitignored',
      'cli-api-key',
      'stale-bootstrap-key',
    ]);
  });
});
