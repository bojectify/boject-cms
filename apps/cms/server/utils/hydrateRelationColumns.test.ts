import { describe, it, expect, vi } from 'vitest';
import { FIELD_TYPES } from '../../utils/fieldTypes';
import type { SearchHit } from './searchEntries';
import {
  collectRelationColumnIds,
  hydrateRelationColumns,
} from './hydrateRelationColumns';

function hit(over: Partial<SearchHit>): SearchHit {
  return {
    id: 'e',
    entryKey: 'e',
    contentType: 'Article',
    entryTitle: 'E',
    status: 'PUBLISHED',
    snippet: null,
    publishedAt: null,
    ...over,
  };
}

const fieldTypes = {
  author: FIELD_TYPES.RELATION,
  tags: FIELD_TYPES.MULTIRELATION,
  title: FIELD_TYPES.TEXT,
};

describe('collectRelationColumnIds', () => {
  it('collects + dedupes relation/multirelation ids, ignoring scalar columns', () => {
    const hits = [
      hit({ fields: { author: 'a1', tags: ['t1', 't2'], title: 'x' } }),
      hit({ fields: { author: 'a1', tags: ['t2', 't3'], title: 'y' } }),
    ];
    expect(
      collectRelationColumnIds(
        hits,
        ['author', 'tags', 'title'],
        fieldTypes
      ).sort()
    ).toEqual(['a1', 't1', 't2', 't3']);
  });

  it('returns [] when no relation columns are present', () => {
    const hits = [hit({ fields: { title: 'x' } })];
    expect(collectRelationColumnIds(hits, ['title'], fieldTypes)).toEqual([]);
  });
});

describe('hydrateRelationColumns', () => {
  it('replaces relation cells with { entryId, entryTitle }, leaving scalars untouched', async () => {
    const hits = [
      hit({ fields: { author: 'a1', tags: ['t1', 't2'], title: 'x' } }),
    ];
    const fetcher = vi.fn(
      async () =>
        new Map([
          ['a1', 'Author One'],
          ['t1', 'Tag One'],
        ])
    );
    await hydrateRelationColumns(
      hits,
      ['author', 'tags', 'title'],
      fieldTypes,
      fetcher
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(hits[0]!.fields).toEqual({
      author: { entryId: 'a1', entryTitle: 'Author One' },
      tags: [
        { entryId: 't1', entryTitle: 'Tag One' },
        { entryId: 't2', entryTitle: null },
      ],
      title: 'x',
    });
  });

  it('does not call the fetcher when there are no relation columns', async () => {
    const hits = [hit({ fields: { title: 'x' } })];
    const fetcher = vi.fn(async () => new Map<string, string>());
    await hydrateRelationColumns(hits, ['title'], fieldTypes, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(hits[0]!.fields).toEqual({ title: 'x' });
  });
});
