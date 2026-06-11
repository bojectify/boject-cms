import { describe, it, expect } from 'vitest';
import {
  chipFieldName,
  chipOperatorLabel,
  chipValueDisplay,
  isRelationFieldType,
  collectRelationFilterIds,
  type ChipLabelField,
} from './chipLabels';

const fields: ChipLabelField[] = [
  { identifier: 'summary', name: 'Summary', type: 'TEXT' },
  { identifier: 'status', name: 'Status', type: 'SELECT' },
  { identifier: 'author', name: 'Author', type: 'RELATION' },
];

describe('chipLabels', () => {
  it('maps a field identifier to its display name (else the identifier)', () => {
    expect(chipFieldName(fields, 'summary')).toBe('Summary');
    expect(chipFieldName(fields, 'unknown')).toBe('unknown');
  });

  it('maps an operator id to its display label for the field type', () => {
    expect(
      chipOperatorLabel(fields, { field: 'summary', op: 'eq', value: 'x' })
    ).toBe('is');
    // unknown field → falls back to the raw op id
    expect(
      chipOperatorLabel(fields, { field: 'nope', op: 'eq', value: 'x' })
    ).toBe('eq');
  });

  it('displays a value, resolving relation ids via the labels map', () => {
    expect(chipValueDisplay('plain')).toBe('plain');
    expect(chipValueDisplay(null)).toBeNull();
    expect(chipValueDisplay('id-1', { 'id-1': 'Jamie Rivera' })).toBe(
      'Jamie Rivera'
    );
    expect(chipValueDisplay('id-2', { 'id-1': 'Jamie Rivera' })).toBe('id-2');
  });

  it('chipValueDisplay joins an array value (relation ids → titles, else strings)', () => {
    expect(chipValueDisplay(['t1', 't2'], { t1: 'News', t2: 'Sport' })).toBe(
      'News, Sport'
    );
    expect(chipValueDisplay(['active', 'ended'])).toBe('active, ended');
    expect(chipValueDisplay(['t1', 'tX'], { t1: 'News' })).toBe('News, tX'); // unresolved → id
    expect(chipValueDisplay([])).toBeNull(); // empty array → no value segment
  });

  it('chipFieldName resolves $entryKey via the system registry', () => {
    expect(chipFieldName(fields, '$entryKey')).toBe('Entry key');
  });

  it('chipFieldName falls back to the identifier for an unknown $-token', () => {
    expect(chipFieldName(fields, '$bogus')).toBe('$bogus');
  });

  it('chipOperatorLabel uses the donor type for $entryKey operators', () => {
    expect(
      chipOperatorLabel(fields, { field: '$entryKey', op: 'eq', value: 'x' })
    ).toBe('is');
    expect(
      chipOperatorLabel(fields, {
        field: '$entryKey',
        op: 'startsWith',
        value: 'x',
      })
    ).toBe('starts with');
  });

  it('chipOperatorLabel falls back to the raw op id for an unknown $-token', () => {
    expect(
      chipOperatorLabel(fields, { field: '$bogus', op: 'eq', value: 'x' })
    ).toBe('eq');
  });
});

const relFields: ChipLabelField[] = [
  { identifier: 'summary', name: 'Summary', type: 'TEXT' },
  { identifier: 'author', name: 'Author', type: 'RELATION' },
  { identifier: 'tags', name: 'Tags', type: 'MULTIRELATION' },
];

describe('isRelationFieldType', () => {
  it('is true for RELATION and MULTIRELATION only', () => {
    expect(isRelationFieldType('RELATION')).toBe(true);
    expect(isRelationFieldType('MULTIRELATION')).toBe(true);
    expect(isRelationFieldType('TEXT')).toBe(false);
    expect(isRelationFieldType('SELECT')).toBe(false);
  });
});

describe('collectRelationFilterIds', () => {
  it('returns ids from RELATION/MULTIRELATION filters with non-empty string values', () => {
    const ids = collectRelationFilterIds(
      {
        filters: [
          { field: 'author', op: 'eq', value: 'a1' },
          { field: 'tags', op: 'eq', value: 't1' },
          { field: 'summary', op: 'eq', value: 'ignored' },
        ],
      },
      relFields
    );
    expect(ids).toEqual(['a1', 't1']);
  });

  it('dedupes repeated ids and skips empty/non-string/unknown-field values', () => {
    const ids = collectRelationFilterIds(
      {
        filters: [
          { field: 'author', op: 'eq', value: 'a1' },
          { field: 'author', op: 'eq', value: 'a1' },
          { field: 'author', op: 'eq', value: '' },
          { field: 'tags', op: 'eq', value: 123 },
          { field: 'nope', op: 'eq', value: 'x' },
        ],
      },
      relFields
    );
    expect(ids).toEqual(['a1']);
  });

  it('returns [] for an undefined query', () => {
    expect(collectRelationFilterIds(undefined, relFields)).toEqual([]);
  });

  it('collectRelationFilterIds collects ids from array (containsAny/All) values', () => {
    const fields: ChipLabelField[] = [
      { identifier: 'tags', name: 'Tags', type: 'MULTIRELATION' },
    ];
    const ids = collectRelationFilterIds(
      { filters: [{ field: 'tags', op: 'containsAny', value: ['t1', 't2'] }] },
      fields
    );
    expect(ids.sort()).toEqual(['t1', 't2']);
  });

  it('a $entryKey filter contributes no relation ids (system field, no relation type)', () => {
    const ids = collectRelationFilterIds(
      {
        filters: [
          { field: '$entryKey', op: 'eq', value: 'about-us' },
          { field: 'author', op: 'eq', value: 'a1' },
        ],
      },
      relFields
    );
    expect(ids).toEqual(['a1']);
  });
});
