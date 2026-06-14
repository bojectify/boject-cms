import { describe, it, expect } from 'vitest';
import { FIELD_TYPES } from '../../utils/fieldTypes';
import { projectEntryDataColumns } from './projectEntryColumns';
import { toSearchDocument, type SearchableFieldDef } from './searchDocument';

describe('projectEntryDataColumns', () => {
  const fieldTypes = {
    name: FIELD_TYPES.TEXT,
    views: FIELD_TYPES.NUMBER,
    featured: FIELD_TYPES.BOOLEAN,
    publishedAt: FIELD_TYPES.DATETIME,
    author: FIELD_TYPES.RELATION,
    tags: FIELD_TYPES.MULTIRELATION,
  };

  it('maps raw JSONB entry data to the search-index field representation', () => {
    const data = {
      name: 'Hello',
      views: 7,
      featured: true,
      publishedAt: '2023-11-14T22:13:20.000Z',
      author: { contentTypeId: 'ct-a', entryId: 'a1' },
      tags: [
        { contentTypeId: 'ct-t', entryId: 't1' },
        { contentTypeId: 'ct-t', entryId: 't2' },
      ],
    };
    expect(
      projectEntryDataColumns(
        data,
        ['name', 'views', 'featured', 'publishedAt', 'author', 'tags'],
        fieldTypes
      )
    ).toEqual({
      name: 'Hello',
      views: 7,
      featured: true,
      publishedAt: Date.parse('2023-11-14T22:13:20.000Z'),
      author: 'a1',
      tags: ['t1', 't2'],
    });
  });

  it('degrades missing / malformed values (null relation, null date, missing scalar)', () => {
    expect(
      projectEntryDataColumns(
        { author: null, publishedAt: 'not-a-date' },
        ['author', 'publishedAt', 'views'],
        fieldTypes
      )
    ).toEqual({ author: null, publishedAt: null, views: null });
  });

  it('stays in lockstep with toSearchDocument for columnable fields (incl. malformed values)', () => {
    const fieldDefs: SearchableFieldDef[] = [
      { identifier: 'name', type: FIELD_TYPES.TEXT },
      { identifier: 'views', type: FIELD_TYPES.NUMBER },
      { identifier: 'featured', type: FIELD_TYPES.BOOLEAN },
      { identifier: 'publishedAt', type: FIELD_TYPES.DATETIME },
      { identifier: 'author', type: FIELD_TYPES.RELATION },
      { identifier: 'tags', type: FIELD_TYPES.MULTIRELATION },
    ];
    // Deliberately malformed: a number in TEXT, a string in NUMBER, a string in
    // BOOLEAN, an unparseable date, a non-object relation, string multirelation
    // entries — the index transformer degrades all of these to null/[].
    const data = {
      name: 42,
      views: '7',
      featured: 'true',
      publishedAt: 'not-a-date',
      author: 'bad-shape',
      tags: ['ok'],
    };
    const columns = fieldDefs.map((f) => f.identifier);
    const fieldTypes = Object.fromEntries(
      fieldDefs.map((f) => [f.identifier, f.type])
    );

    const indexDoc = toSearchDocument(
      {
        id: 'e',
        entryKey: 'e',
        contentType: 'CT',
        entryTitle: 'E',
        publishedAt: null,
        status: 'PUBLISHED',
        isWorkingVersion: true,
        data,
      },
      fieldDefs
    );

    expect(projectEntryDataColumns(data, columns, fieldTypes)).toEqual(
      indexDoc.fields
    );
  });
});
