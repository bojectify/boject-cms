import { describe, it, expect } from 'vitest';
import { FIELD_TYPES } from './fieldTypes';
import {
  COLUMNABLE_FIELD_TYPES,
  isColumnableFieldType,
  filterColumnableColumns,
  parseColumnsParam,
  serializeColumns,
  formatColumnValue,
} from './searchColumns';

describe('isColumnableFieldType', () => {
  it('accepts the columnable types', () => {
    for (const t of Object.values(COLUMNABLE_FIELD_TYPES)) {
      expect(isColumnableFieldType(t)).toBe(true);
    }
  });
  it('rejects excluded types and junk', () => {
    expect(isColumnableFieldType(FIELD_TYPES.TEXTAREA)).toBe(false);
    expect(isColumnableFieldType(FIELD_TYPES.RICHTEXT)).toBe(false);
    expect(isColumnableFieldType(FIELD_TYPES.IMAGE)).toBe(false);
    expect(isColumnableFieldType(FIELD_TYPES.ENTRY_TITLE)).toBe(false);
    expect(isColumnableFieldType(undefined)).toBe(false);
    expect(isColumnableFieldType('NOPE')).toBe(false);
  });
});

describe('parseColumnsParam / serializeColumns', () => {
  it('parses a comma list, trims, drops empties and non-camelCase ids', () => {
    expect(parseColumnsParam('key, value ,Locale,,$id')).toEqual([
      'key',
      'value',
    ]);
  });
  it('handles array input (repeated query param) and undefined', () => {
    expect(parseColumnsParam(['a', 'b'])).toEqual(['a', 'b']);
    expect(parseColumnsParam(undefined)).toEqual([]);
  });
  it('de-dupes and splits commas inside array elements', () => {
    expect(parseColumnsParam(['a,b', 'a', 'c'])).toEqual(['a', 'b', 'c']);
  });
  it('round-trips via serializeColumns', () => {
    expect(serializeColumns(['key', 'value'])).toBe('key,value');
    expect(serializeColumns([])).toBe('');
  });
});

describe('filterColumnableColumns', () => {
  it('keeps only ids whose resolved type is columnable', () => {
    const fieldTypes = {
      key: FIELD_TYPES.TEXT,
      body: FIELD_TYPES.RICHTEXT,
      author: FIELD_TYPES.RELATION,
    };
    expect(
      filterColumnableColumns(['key', 'body', 'author', 'ghost'], fieldTypes)
    ).toEqual(['key', 'author']);
  });
});

describe('formatColumnValue', () => {
  const fd = (ms: number) => `D:${ms}`;
  it('formats scalars, dates, booleans, relations, multirelations and empties', () => {
    expect(formatColumnValue('hi', FIELD_TYPES.TEXT, fd)).toBe('hi');
    expect(formatColumnValue('', FIELD_TYPES.TEXT, fd)).toBe('—');
    expect(formatColumnValue(42, FIELD_TYPES.NUMBER, fd)).toBe('42');
    expect(formatColumnValue(1700000000000, FIELD_TYPES.DATETIME, fd)).toBe(
      'D:1700000000000'
    );
    expect(formatColumnValue(null, FIELD_TYPES.DATETIME, fd)).toBe('—');
    expect(formatColumnValue(true, FIELD_TYPES.BOOLEAN, fd)).toBe('Yes');
    expect(formatColumnValue(false, FIELD_TYPES.BOOLEAN, fd)).toBe('No');
    expect(
      formatColumnValue(
        { entryId: 'a', entryTitle: 'Acme' },
        FIELD_TYPES.RELATION,
        fd
      )
    ).toBe('Acme');
    expect(
      formatColumnValue(
        { entryId: 'a', entryTitle: null },
        FIELD_TYPES.RELATION,
        fd
      )
    ).toBe('—');
    expect(
      formatColumnValue(
        [
          { entryId: 'a', entryTitle: 'One' },
          { entryId: 'b', entryTitle: 'Two' },
        ],
        FIELD_TYPES.MULTIRELATION,
        fd
      )
    ).toBe('One, Two');
    expect(formatColumnValue([], FIELD_TYPES.MULTIRELATION, fd)).toBe('—');
  });
});
