import { describe, it, expect } from 'vitest';
import { toFieldTypeMap } from './searchFieldTypes';

describe('toFieldTypeMap', () => {
  it('maps field identifiers to their types', () => {
    expect(
      toFieldTypeMap([
        { identifier: 'views', type: 'NUMBER' },
        { identifier: 'author', type: 'RELATION' },
      ])
    ).toEqual({ views: 'NUMBER', author: 'RELATION' });
  });

  it('returns an empty map for no fields', () => {
    expect(toFieldTypeMap([])).toEqual({});
  });
});
