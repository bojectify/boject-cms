import { describe, it, expect } from 'vitest';
import { toQueryContentTypes } from './toQueryContentTypes';

// parseFieldOptions UUID-validates RELATION/MULTIRELATION targetContentTypeIds,
// so the fixture must use real UUIDs or the parse would throw and the mapper
// would silently fall back to a bare field.
const UUID_AUTHOR = '11111111-1111-4111-8111-111111111111';

describe('toQueryContentTypes', () => {
  it('maps rows to QueryContentType, expanding SELECT choices and RELATION targets', () => {
    const rows = [
      {
        id: 'a1',
        identifier: 'Article',
        name: 'Article',
        fields: [
          {
            identifier: 'summary',
            name: 'Summary',
            type: 'TEXT',
            options: null,
          },
          {
            identifier: 'status',
            name: 'Status',
            type: 'SELECT',
            options: { choices: ['Draft', 'Active'] },
          },
          {
            identifier: 'author',
            name: 'Author',
            type: 'RELATION',
            options: { targetContentTypeIds: [UUID_AUTHOR] },
          },
        ],
      },
    ];
    const out = toQueryContentTypes(rows);
    expect(out[0]!.id).toBe('a1');
    expect(out[0]!.identifier).toBe('Article');
    expect(out[0]!.name).toBe('Article');
    expect(out[0]!.fields[0]).toEqual({
      identifier: 'summary',
      name: 'Summary',
      type: 'TEXT',
    });
    expect(out[0]!.fields[1]).toEqual({
      identifier: 'status',
      name: 'Status',
      type: 'SELECT',
      choices: [
        { label: 'Draft', value: 'Draft' },
        { label: 'Active', value: 'Active' },
      ],
    });
    expect(out[0]!.fields[2]).toEqual({
      identifier: 'author',
      name: 'Author',
      type: 'RELATION',
      targetContentTypeIds: [UUID_AUTHOR],
    });
  });

  it('expands MULTIRELATION targets the same way as RELATION', () => {
    const out = toQueryContentTypes([
      {
        id: 'b1',
        identifier: 'Page',
        name: 'Page',
        fields: [
          {
            identifier: 'related',
            name: 'Related',
            type: 'MULTIRELATION',
            options: { targetContentTypeIds: [UUID_AUTHOR] },
          },
        ],
      },
    ]);
    expect(out[0]!.fields[0]).toEqual({
      identifier: 'related',
      name: 'Related',
      type: 'MULTIRELATION',
      targetContentTypeIds: [UUID_AUTHOR],
    });
  });

  it('falls back to a bare field when options are corrupt rather than throwing', () => {
    const out = toQueryContentTypes([
      {
        id: 'c1',
        identifier: 'Broken',
        name: 'Broken',
        fields: [
          {
            identifier: 'author',
            name: 'Author',
            type: 'RELATION',
            // not a UUID — parseFieldOptions throws; mapper must degrade.
            options: { targetContentTypeIds: ['not-a-uuid'] },
          },
        ],
      },
    ]);
    expect(out[0]!.fields[0]).toEqual({
      identifier: 'author',
      name: 'Author',
      type: 'RELATION',
    });
  });

  it('returns an empty array for no rows', () => {
    expect(toQueryContentTypes([])).toEqual([]);
  });
});
