import { describe, it, expect } from 'vitest';
import { applyFieldDefaults } from './applyFieldDefaults';

const f = (over: Record<string, unknown>) => ({
  identifier: 'x',
  name: 'X',
  type: 'BOOLEAN',
  required: false,
  options: null,
  ...over,
});

describe('applyFieldDefaults', () => {
  it('seeds a supported field absent from data', () => {
    const fields = [
      f({
        identifier: 'noIndex',
        type: 'BOOLEAN',
        options: { default: false },
      }),
    ];
    expect(applyFieldDefaults({}, fields)).toEqual({ noIndex: false });
  });

  it('seeds NUMBER 0 and SELECT choice when absent', () => {
    const fields = [
      f({ identifier: 'qty', type: 'NUMBER', options: { default: 0 } }),
      f({
        identifier: 'status',
        type: 'SELECT',
        options: { choices: ['a', 'b'], default: 'a' },
      }),
    ];
    expect(applyFieldDefaults({}, fields)).toEqual({ qty: 0, status: 'a' });
  });

  it('leaves a present-but-empty value untouched (explicit clear)', () => {
    const fields = [
      f({ identifier: 'qty', type: 'NUMBER', options: { default: 0 } }),
    ];
    expect(applyFieldDefaults({ qty: null }, fields)).toEqual({ qty: null });
    expect(applyFieldDefaults({ qty: 5 }, fields)).toEqual({ qty: 5 });
  });

  it('only treats undefined / missing key as absent', () => {
    const fields = [
      f({ identifier: 'flag', type: 'BOOLEAN', options: { default: true } }),
    ];
    expect(applyFieldDefaults({ flag: undefined }, fields)).toEqual({
      flag: true,
    });
  });

  it('ignores fields with no configured default', () => {
    const fields = [f({ identifier: 'flag', type: 'BOOLEAN', options: null })];
    expect(applyFieldDefaults({}, fields)).toEqual({});
  });

  it('ignores unsupported field types even if options carries a default', () => {
    const fields = [
      f({ identifier: 'body', type: 'TEXT', options: { default: 'hi' } }),
    ];
    expect(applyFieldDefaults({}, fields)).toEqual({});
  });

  it('does not mutate the input object', () => {
    const fields = [
      f({ identifier: 'flag', type: 'BOOLEAN', options: { default: false } }),
    ];
    const input = {};
    applyFieldDefaults(input, fields);
    expect(input).toEqual({});
  });
});
