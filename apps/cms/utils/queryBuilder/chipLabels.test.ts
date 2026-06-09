import { describe, it, expect } from 'vitest';
import {
  chipFieldName,
  chipOperatorLabel,
  chipValueDisplay,
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
