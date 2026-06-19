import { describe, it, expect } from 'vitest';
import {
  RESERVED_FIELD_IDENTIFIERS,
  isReservedFieldIdentifier,
} from './reservedFieldIdentifiers';

describe('reservedFieldIdentifiers', () => {
  it('reserves exactly the seven GraphQL envelope identifiers', () => {
    expect([...RESERVED_FIELD_IDENTIFIERS].sort()).toEqual(
      [
        'contentType',
        'createdAt',
        'entryKey',
        'id',
        'publishedAt',
        'status',
        'updatedAt',
      ].sort()
    );
  });

  it('isReservedFieldIdentifier is true for every reserved name', () => {
    for (const id of RESERVED_FIELD_IDENTIFIERS) {
      expect(isReservedFieldIdentifier(id)).toBe(true);
    }
  });

  it('is false for non-envelope identifiers (incl. entryTitle / slug)', () => {
    for (const id of ['entryTitle', 'slug', 'title', 'author', 'publishDate']) {
      expect(isReservedFieldIdentifier(id)).toBe(false);
    }
  });
});
