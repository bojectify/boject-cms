// scripts/build-starters/build.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAll } from './build';

function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'starters-build-'));
  mkdirSync(join(root, 'src'));
  return root;
}

const baseBundle = {
  version: 1,
  exportedAt: '2026-04-15T00:00:00.000Z',
  portable: true,
  contentTypes: [
    {
      id: null,
      identifier: 'Image',
      name: 'Image',
      description: null,
      fields: [
        {
          id: null,
          identifier: 'name',
          name: 'Name',
          type: 'ENTRY_TITLE',
          required: true,
          order: 0,
          options: null,
        },
      ],
    },
  ],
  entries: [],
};

describe('buildAll', () => {
  let root: string;

  beforeEach(() => {
    root = makeWorkspace();
  });

  it('builds a single overlay extending base', async () => {
    writeFileSync(join(root, 'base.boject.json'), JSON.stringify(baseBundle));
    writeFileSync(
      join(root, 'src', 'sport.overlay.json'),
      JSON.stringify({
        version: 1,
        name: 'sport',
        extends: 'base',
        contentTypes: [
          {
            identifier: 'Team',
            mode: 'create',
            name: 'Team',
            description: null,
            fields: [
              {
                id: null,
                identifier: 'name',
                name: 'Name',
                type: 'ENTRY_TITLE',
                required: true,
                order: 0,
                options: null,
              },
            ],
          },
        ],
      })
    );
    await buildAll(root);
    const out = JSON.parse(
      readFileSync(join(root, 'sport.boject.json'), 'utf8')
    );
    expect(
      out.contentTypes.map((c: { identifier: string }) => c.identifier)
    ).toEqual(['Image', 'Team']);
  });

  it('builds chained overlays (rugby extends sport extends base)', async () => {
    writeFileSync(join(root, 'base.boject.json'), JSON.stringify(baseBundle));
    writeFileSync(
      join(root, 'src', 'sport.overlay.json'),
      JSON.stringify({
        version: 1,
        name: 'sport',
        extends: 'base',
        contentTypes: [
          {
            identifier: 'Player',
            mode: 'create',
            name: 'Player',
            description: null,
            fields: [
              {
                id: null,
                identifier: 'name',
                name: 'Name',
                type: 'ENTRY_TITLE',
                required: true,
                order: 0,
                options: null,
              },
            ],
          },
        ],
      })
    );
    writeFileSync(
      join(root, 'src', 'rugby.overlay.json'),
      JSON.stringify({
        version: 1,
        name: 'rugby',
        extends: 'sport',
        contentTypes: [
          {
            identifier: 'Player',
            mode: 'patch',
            fields: [
              {
                id: null,
                identifier: 'position',
                name: 'Position',
                type: 'TEXT',
                required: false,
                order: 5,
                options: null,
              },
            ],
          },
        ],
      })
    );
    await buildAll(root);
    const rugby = JSON.parse(
      readFileSync(join(root, 'rugby.boject.json'), 'utf8')
    );
    const player = rugby.contentTypes.find(
      (c: { identifier: string }) => c.identifier === 'Player'
    );
    expect(
      player.fields.map((f: { identifier: string }) => f.identifier)
    ).toEqual(['name', 'position']);
  });

  it('throws on cycle', async () => {
    writeFileSync(join(root, 'base.boject.json'), JSON.stringify(baseBundle));
    writeFileSync(
      join(root, 'src', 'a.overlay.json'),
      JSON.stringify({ version: 1, name: 'a', extends: 'b', contentTypes: [] })
    );
    writeFileSync(
      join(root, 'src', 'b.overlay.json'),
      JSON.stringify({ version: 1, name: 'b', extends: 'a', contentTypes: [] })
    );
    await expect(buildAll(root)).rejects.toThrow(/cycle/i);
  });

  it('throws on unknown parent', async () => {
    writeFileSync(join(root, 'base.boject.json'), JSON.stringify(baseBundle));
    writeFileSync(
      join(root, 'src', 'orphan.overlay.json'),
      JSON.stringify({
        version: 1,
        name: 'orphan',
        extends: 'missing',
        contentTypes: [],
      })
    );
    await expect(buildAll(root)).rejects.toThrow(/unknown parent.*missing/i);
  });

  it('validates each built bundle with validateBundle', async () => {
    writeFileSync(join(root, 'base.boject.json'), JSON.stringify(baseBundle));
    writeFileSync(
      join(root, 'src', 'bad.overlay.json'),
      JSON.stringify({
        version: 1,
        name: 'bad',
        extends: 'base',
        contentTypes: [
          {
            identifier: 'Broken',
            mode: 'create',
            name: 'Broken',
            description: null,
            fields: [
              {
                id: null,
                identifier: 'f',
                name: 'F',
                type: 'SELECT',
                required: false,
                order: 0,
                options: null,
              },
            ],
          },
        ],
      })
    );
    await expect(buildAll(root)).rejects.toThrow();
  });

  it('writes deterministic JSON (2-space indent, trailing newline)', async () => {
    writeFileSync(join(root, 'base.boject.json'), JSON.stringify(baseBundle));
    writeFileSync(
      join(root, 'src', 'sport.overlay.json'),
      JSON.stringify({
        version: 1,
        name: 'sport',
        extends: 'base',
        contentTypes: [],
      })
    );
    await buildAll(root, { now: '2026-04-15T12:00:00.000Z' });
    const content = readFileSync(join(root, 'sport.boject.json'), 'utf8');
    expect(content.endsWith('\n')).toBe(true);
    expect(content).toContain('  "version": 1');
  });

  it('successive rebuilds differ only by exportedAt', async () => {
    writeFileSync(join(root, 'base.boject.json'), JSON.stringify(baseBundle));
    writeFileSync(
      join(root, 'src', 'sport.overlay.json'),
      JSON.stringify({
        version: 1,
        name: 'sport',
        extends: 'base',
        contentTypes: [],
      })
    );
    await buildAll(root);
    const first = JSON.parse(
      readFileSync(join(root, 'sport.boject.json'), 'utf8')
    );
    await buildAll(root);
    const second = JSON.parse(
      readFileSync(join(root, 'sport.boject.json'), 'utf8')
    );
    const stripExported = (b: Record<string, unknown>) => {
      const { exportedAt: _, ...rest } = b;
      return rest;
    };
    expect(stripExported(second)).toEqual(stripExported(first));
  });

  it('throws when overlay name does not match filename', async () => {
    writeFileSync(join(root, 'base.boject.json'), JSON.stringify(baseBundle));
    writeFileSync(
      join(root, 'src', 'sport.overlay.json'),
      JSON.stringify({
        version: 1,
        name: 'football',
        extends: 'base',
        contentTypes: [],
      })
    );
    await expect(buildAll(root)).rejects.toThrow(
      /sport\.overlay\.json declares name "football"/
    );
  });
});
