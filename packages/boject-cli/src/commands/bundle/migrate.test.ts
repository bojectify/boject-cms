import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBundleMigrate } from './migrate.js';
import { BUNDLE_VERSION } from '../../vendor/contentBundleTypes.js';

let tmpDir: string;
const stdoutLines: string[] = [];
const stderrLines: string[] = [];

const stdout = (line: string) => stdoutLines.push(line);
const stderr = (line: string) => stderrLines.push(line);

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'boject-bundle-migrate-'));
  stdoutLines.length = 0;
  stderrLines.length = 0;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeFixture(filename: string, bundle: unknown): string {
  const path = join(tmpDir, filename);
  writeFileSync(path, JSON.stringify(bundle, null, 2) + '\n', 'utf8');
  return path;
}

const validV2Bundle = {
  version: 2,
  exportedAt: '2026-05-28T00:00:00.000Z',
  portable: false,
};

describe('runBundleMigrate', () => {
  it('prints "already at version N" and exits 0 when bundle matches current version', async () => {
    const path = writeFixture('already.boject.json', validV2Bundle);
    const before = readFileSync(path, 'utf8');

    const result = await runBundleMigrate({ path, flags: {}, stdout, stderr });

    expect(result.exitCode).toBe(0);
    expect(stdoutLines.some((l) => /already at version 2/.test(l))).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('exits 1 when path does not exist', async () => {
    const result = await runBundleMigrate({
      path: join(tmpDir, 'does-not-exist.json'),
      flags: {},
      stdout,
      stderr,
    });
    expect(result.exitCode).toBe(1);
    expect(stderrLines.join('\n')).toMatch(/does-not-exist\.json/);
  });

  it('exits 1 when file is not valid JSON', async () => {
    const path = join(tmpDir, 'broken.json');
    writeFileSync(path, '{not json', 'utf8');
    const result = await runBundleMigrate({ path, flags: {}, stdout, stderr });
    expect(result.exitCode).toBe(1);
    expect(stderrLines.join('\n')).toMatch(/JSON|parse/i);
  });

  it('exits 1 when bundle is newer than the CLI supports', async () => {
    const path = writeFixture('future.boject.json', {
      ...validV2Bundle,
      version: BUNDLE_VERSION + 1,
    });
    const before = readFileSync(path, 'utf8');

    const result = await runBundleMigrate({ path, flags: {}, stdout, stderr });

    expect(result.exitCode).toBe(1);
    expect(stderrLines.join('\n')).toMatch(/newer than this CLI supports/);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('exits 1 when no migration is registered for the source version', async () => {
    // BUNDLE_VERSION is currently 2 and MIGRATIONS is []. A v1 bundle has
    // nowhere to go.
    const path = writeFixture('v1.boject.json', {
      ...validV2Bundle,
      version: 1,
    });
    const result = await runBundleMigrate({ path, flags: {}, stdout, stderr });
    expect(result.exitCode).toBe(1);
    expect(stderrLines.join('\n')).toMatch(
      /no migration registered from version 1/
    );
  });

  it('--dry-run prints the planned transition and does not write the file', async () => {
    const path = writeFixture('v1.boject.json', {
      ...validV2Bundle,
      version: 1,
    });
    const before = readFileSync(path, 'utf8');

    const result = await runBundleMigrate({
      path,
      flags: { dryRun: true },
      stdout,
      stderr,
      _testHook: {
        migrations: [{ from: 1, to: 2, apply: (b) => ({ ...b, version: 2 }) }],
      },
    });

    expect(result.exitCode).toBe(0);
    expect(stdoutLines.some((l) => /would migrate v1 → v2/.test(l))).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('writes the migrated bundle back to disk when not dry-run', async () => {
    const path = writeFixture('v1.boject.json', {
      ...validV2Bundle,
      version: 1,
    });

    const result = await runBundleMigrate({
      path,
      flags: {},
      stdout,
      stderr,
      _testHook: {
        migrations: [{ from: 1, to: 2, apply: (b) => ({ ...b, version: 2 }) }],
      },
    });

    expect(result.exitCode).toBe(0);
    expect(stdoutLines.some((l) => /migrated v1 → v2/.test(l))).toBe(true);

    const after = JSON.parse(readFileSync(path, 'utf8'));
    expect(after.version).toBe(2);
  });

  it('writes deterministic JSON output (2-space indent, trailing newline)', async () => {
    const path = writeFixture('v1.boject.json', {
      ...validV2Bundle,
      version: 1,
    });

    await runBundleMigrate({
      path,
      flags: {},
      stdout,
      stderr,
      _testHook: {
        migrations: [{ from: 1, to: 2, apply: (b) => ({ ...b, version: 2 }) }],
      },
    });

    const written = readFileSync(path, 'utf8');
    expect(written.endsWith('\n')).toBe(true);
    expect(written).toMatch(/^\{\n {2}"version": 2/);
  });
});
