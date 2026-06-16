import { describe, it, expect } from 'vitest';
import {
  SELECT_NONE,
  selectItems,
  selectModelValue,
} from './selectFieldOptions';

const opts = [
  { label: 'Dave', value: 'Dave' },
  { label: 'Peter', value: 'Peter' },
];

describe('selectItems (#374)', () => {
  it('prepends a "— none —" clear option for optional selects', () => {
    const items = selectItems(false, opts);
    expect(items[0]).toEqual({ label: '— none —', value: SELECT_NONE });
    expect(items.slice(1)).toEqual(opts);
  });

  it('omits the clear option for required selects', () => {
    expect(selectItems(true, opts)).toEqual(opts);
  });

  it('treats an undefined required flag as optional', () => {
    expect(selectItems(undefined, opts)[0]).toEqual({
      label: '— none —',
      value: SELECT_NONE,
    });
  });
});

describe('selectModelValue (#374)', () => {
  it('maps an unset optional value to the none sentinel', () => {
    expect(selectModelValue(false, null)).toBe(SELECT_NONE);
    expect(selectModelValue(false, undefined)).toBe(SELECT_NONE);
    expect(selectModelValue(false, '')).toBe(SELECT_NONE);
  });

  it('maps an unset required value to empty string (no sentinel item exists)', () => {
    expect(selectModelValue(true, null)).toBe('');
  });

  it('passes a real value through for both optional and required', () => {
    expect(selectModelValue(false, 'Dave')).toBe('Dave');
    expect(selectModelValue(true, 'Dave')).toBe('Dave');
  });
});
