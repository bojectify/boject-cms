import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runEntriesValidate } from '../../src/commands/entries/validate.js';

let workDir: string;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'boject-entries-validate-'));
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const lines: string[] = [];
const stdout = (l: string) => lines.push(l);
const stderr = (l: string) => lines.push(l);
beforeEach(() => {
  lines.length = 0;
});

describe('runEntriesValidate', () => {
  it('exits 0 for a well-formed entries bundle', async () => {
    const path = join(workDir, 'entries.boject.json');
    await writeFile(
      path,
      JSON.stringify({
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        entries: [],
      })
    );
    const r = await runEntriesValidate({ path, stdout, stderr });
    expect(r.exitCode).toBe(0);
    expect(lines.some((l) => l.includes('Bundle valid'))).toBe(true);
  });

  it('exits 1 for a bundle with a bad version', async () => {
    const path = join(workDir, 'entries.boject.json');
    await writeFile(
      path,
      JSON.stringify({ version: 999, exportedAt: 't', portable: true })
    );
    const r = await runEntriesValidate({ path, stdout, stderr });
    expect(r.exitCode).toBe(1);
    expect(lines.some((l) => /invalid|version/i.test(l))).toBe(true);
  });

  it('exits 1 for an unreadable / missing file', async () => {
    const path = join(workDir, 'does-not-exist.json');
    const r = await runEntriesValidate({ path, stdout, stderr });
    expect(r.exitCode).toBe(1);
    expect(lines.some((l) => /Error reading/i.test(l))).toBe(true);
  });
});
