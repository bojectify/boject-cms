// scripts/build-starters/merge.test.ts
import { describe, expect, it } from 'vitest';
import type { Bundle } from '../content-bundle/types';
import type { Overlay } from './types';
import { mergeOverlay, composeParents } from './merge';
import { FIELD_TYPES } from '../../utils/fieldTypes';

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
          type: FIELD_TYPES.ENTRY_TITLE,
          required: true,
          order: 0,
          options: null,
        },
        {
          id: null,
          identifier: 'bio',
          name: 'Bio',
          type: FIELD_TYPES.TEXTAREA,
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
              type: FIELD_TYPES.ENTRY_TITLE,
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
              type: FIELD_TYPES.ENTRY_TITLE,
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
              type: FIELD_TYPES.RELATION,
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
              type: FIELD_TYPES.RICHTEXT,
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
    expect(bio.type).toBe(FIELD_TYPES.RICHTEXT);
    expect(bio.required).toBe(true);
    expect(bio.name).toBe('Biography');
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
              type: FIELD_TYPES.NUMBER,
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

describe('composeParents', () => {
  const a: Bundle = {
    version: 2,
    exportedAt: 'x',
    portable: true,
    contentTypes: [
      {
        id: null,
        identifier: 'Image',
        name: 'Image',
        description: null,
        fields: [],
      },
    ],
    entries: [],
  };
  const b: Bundle = {
    version: 2,
    exportedAt: 'x',
    portable: true,
    contentTypes: [
      {
        id: null,
        identifier: 'Tag',
        name: 'Tag',
        description: null,
        fields: [],
      },
    ],
    entries: [],
  };

  it('unions content types from all parents', () => {
    const out = composeParents([a, b]);
    expect(out.contentTypes!.map((c) => c.identifier)).toEqual([
      'Image',
      'Tag',
    ]);
  });
  it('throws on a duplicate identifier across parents', () => {
    expect(() => composeParents([a, a])).toThrow(
      /Duplicate content type "Image"/
    );
  });
  it('returns an empty v2 bundle for no parents', () => {
    const out = composeParents([]);
    expect(out.contentTypes).toEqual([]);
    expect(out.version).toBe(2);
  });
});
