import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runSchemaValidate } from '../../src/commands/schemaValidate.js';

let workDir: string;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'boject-validate-'));
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

const VALID_BUNDLE = {
  version: 2,
  exportedAt: '2026-05-01T00:00:00.000Z',
  portable: true,
  contentTypes: [
    {
      id: null,
      identifier: 'Article',
      name: 'Article',
      description: null,
      fields: [
        {
          id: null,
          identifier: 'title',
          name: 'Title',
          type: 'ENTRY_TITLE',
          required: true,
          order: 0,
          options: null,
        },
      ],
    },
  ],
};

describe('runSchemaValidate', () => {
  it('exits 0 for a structurally-sound bundle', async () => {
    const path = join(workDir, 'schema.boject.json');
    await writeFile(path, JSON.stringify(VALID_BUNDLE));
    const r = await runSchemaValidate({ path, stdout, stderr });
    expect(r.exitCode).toBe(0);
    expect(lines.some((l) => l.includes('Bundle valid'))).toBe(true);
  });

  it('exits 1 with errors for a bundle missing a required field', async () => {
    const path = join(workDir, 'schema.boject.json');
    await writeFile(
      path,
      JSON.stringify({
        version: 2,
        exportedAt: 'x',
        portable: true,
        contentTypes: [{ identifier: 'X' /* no fields! */ }],
      })
    );
    const r = await runSchemaValidate({ path, stdout, stderr });
    expect(r.exitCode).toBe(1);
    expect(lines.some((l) => /invalid|fields/i.test(l))).toBe(true);
  });

  it('exits 1 for a RELATION pointing at a missing target type', async () => {
    const path = join(workDir, 'schema.boject.json');
    await writeFile(
      path,
      JSON.stringify({
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Article',
            name: 'Article',
            description: null,
            fields: [
              {
                id: null,
                identifier: 'title',
                name: 'Title',
                type: 'ENTRY_TITLE',
                required: true,
                order: 0,
                options: null,
              },
              {
                id: null,
                identifier: 'author',
                name: 'Author',
                type: 'RELATION',
                required: false,
                order: 1,
                options: {
                  targetContentTypeIds: [null],
                  targetContentTypeIdentifiers: ['Auther'],
                },
              },
            ],
          },
        ],
      })
    );
    const r = await runSchemaValidate({ path, stdout, stderr });
    expect(r.exitCode).toBe(1);
    expect(lines.some((l) => /Auther|target/i.test(l))).toBe(true);
  });
});
