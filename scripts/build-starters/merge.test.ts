// scripts/build-starters/merge.test.ts
import { describe, expect, it } from 'vitest';
import type { Bundle } from '../content-bundle/types';
import type { Overlay } from './types';
import { mergeOverlay } from './merge';

const parent: Bundle = {
  version: 1,
  exportedAt: '2026-04-15T00:00:00.000Z',
  portable: true,
  contentTypes: [
    {
      id: null,
      identifier: 'Player',
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
        {
          id: null,
          identifier: 'bio',
          name: 'Bio',
          type: 'TEXTAREA',
          required: false,
          order: 1,
          options: null,
        },
      ],
    },
  ],
  entries: [],
};

describe('mergeOverlay', () => {
  it('appends new content types in create mode', () => {
    const overlay: Overlay = {
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
    };
    const out = mergeOverlay(parent, overlay);
    expect(out.contentTypes?.map((c) => c.identifier)).toEqual([
      'Player',
      'Team',
    ]);
  });

  it('rejects create when identifier already exists in parent', () => {
    const overlay: Overlay = {
      version: 1,
      name: 'x',
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
    };
    expect(() => mergeOverlay(parent, overlay)).toThrow(
      /already exists.*Player/
    );
  });

  it('appends new fields in patch mode', () => {
    const overlay: Overlay = {
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
              type: 'RELATION',
              required: false,
              order: 10,
              options: {
                targetContentTypeIds: [null],
                targetContentTypeIdentifiers: ['Position'],
              },
            },
          ],
        },
      ],
    };
    const out = mergeOverlay(parent, overlay);
    const player = out.contentTypes!.find((c) => c.identifier === 'Player')!;
    expect(player.fields.map((f) => f.identifier)).toEqual([
      'name',
      'bio',
      'position',
    ]);
  });

  it('replaces existing fields wholesale when patch identifier collides', () => {
    const overlay: Overlay = {
      version: 1,
      name: 'x',
      extends: 'base',
      contentTypes: [
        {
          identifier: 'Player',
          mode: 'patch',
          fields: [
            {
              id: null,
              identifier: 'bio',
              name: 'Biography',
              type: 'TEXTAREA',
              required: true,
              order: 1,
              options: null,
            },
          ],
        },
      ],
    };
    const out = mergeOverlay(parent, overlay);
    const player = out.contentTypes!.find((c) => c.identifier === 'Player')!;
    const bio = player.fields.find((f) => f.identifier === 'bio')!;
    expect(bio.type).toBe('TEXTAREA');
    expect(bio.name).toBe('Biography');
    expect(bio.required).toBe(true);
  });

  it('rejects patch field type change', () => {
    const overlay: Overlay = {
      version: 1,
      name: 'x',
      extends: 'base',
      contentTypes: [
        {
          identifier: 'Player',
          mode: 'patch',
          fields: [
            {
              id: null,
              identifier: 'name',
              name: 'Name',
              type: 'NUMBER',
              required: true,
              order: 0,
              options: null,
            },
          ],
        },
      ],
    };
    expect(() => mergeOverlay(parent, overlay)).toThrow(
      /cannot change field type/i
    );
  });

  it('rejects patch on missing content type', () => {
    const overlay: Overlay = {
      version: 1,
      name: 'x',
      extends: 'base',
      contentTypes: [
        {
          identifier: 'Ghost',
          mode: 'patch',
          fields: [],
        },
      ],
    };
    expect(() => mergeOverlay(parent, overlay)).toThrow(
      /Ghost.*not found in parent/
    );
  });

  it('does not mutate the parent bundle', () => {
    const overlay: Overlay = {
      version: 1,
      name: 'x',
      extends: 'base',
      contentTypes: [
        {
          identifier: 'Player',
          mode: 'patch',
          fields: [
            {
              id: null,
              identifier: 'height',
              name: 'Height',
              type: 'NUMBER',
              required: false,
              order: 5,
              options: null,
            },
          ],
        },
      ],
    };
    const before = JSON.stringify(parent);
    mergeOverlay(parent, overlay);
    expect(JSON.stringify(parent)).toBe(before);
  });

  it('updates exportedAt to current timestamp', () => {
    const overlay: Overlay = {
      version: 1,
      name: 'x',
      extends: 'base',
      contentTypes: [],
    };
    const before = new Date().toISOString();
    const out = mergeOverlay(parent, overlay);
    expect(out.exportedAt >= before).toBe(true);
  });
});
