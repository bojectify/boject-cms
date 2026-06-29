import { describe, it, expect } from 'vitest';
import { mergeEntryPatch } from './mergeEntryPatch';

const fields = [
  { identifier: 'title' },
  { identifier: 'summary' },
  { identifier: 'count' },
  { identifier: 'author' }, // RELATION
  { identifier: 'tags' }, // MULTIRELATION
];

describe('mergeEntryPatch', () => {
  it('overlays present keys and leaves absent keys untouched', () => {
    const working = { title: 'Old', summary: 'Keep me', count: 1 };
    const result = mergeEntryPatch(working, { title: 'New' }, fields);
    expect(result).toEqual({ title: 'New', summary: 'Keep me', count: 1 });
  });

  it('does not mutate the working data', () => {
    const working = { title: 'Old' };
    mergeEntryPatch(working, { title: 'New' }, fields);
    expect(working).toEqual({ title: 'Old' });
  });

  it('treats null / empty string / empty array as an explicit clear', () => {
    const working = { title: 'T', summary: 'S', tags: [{ entryId: 'x' }] };
    const result = mergeEntryPatch(
      working,
      { title: '', summary: null, tags: [] },
      fields
    );
    expect(result).toEqual({ title: '', summary: null, tags: [] });
  });

  it('replaces object/array-valued fields wholesale (no deep merge)', () => {
    const working = { author: { contentTypeId: 'c1', entryId: 'a1' } };
    const result = mergeEntryPatch(
      working,
      { author: { entryId: 'a2' } }, // omits contentTypeId
      fields
    );
    // Wholesale replace ⇒ contentTypeId is gone. (Deep merge would keep it.)
    expect(result.author).toEqual({ entryId: 'a2' });
  });

  it('throws 400 UNKNOWN_FIELD for a patch key matching no field', () => {
    expect(() => mergeEntryPatch({}, { nope: 1 }, fields)).toThrow();
    try {
      mergeEntryPatch({}, { nope: 1 }, fields);
    } catch (e) {
      const err = e as {
        statusCode?: number;
        data?: { error?: string; field?: string };
      };
      expect(err.statusCode).toBe(400);
      expect(err.data?.error).toBe('UNKNOWN_FIELD');
      expect(err.data?.field).toBe('nope');
    }
  });
});
