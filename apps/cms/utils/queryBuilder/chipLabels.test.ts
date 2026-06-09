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
});
