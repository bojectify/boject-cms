import { describe, it, expect } from 'vitest';
import { checkFieldDefault, defaultsForFields } from './fieldDefaults';

const f = (o: Record<string, unknown>) => ({
  identifier: 'x',
  type: 'BOOLEAN',
  options: null,
  ...o,
});

describe('defaultsForFields', () => {
  it('returns the default for each supported field that has one', () => {
    expect(
      defaultsForFields([
        f({ identifier: 'flag', type: 'BOOLEAN', options: { default: false } }),
        f({ identifier: 'qty', type: 'NUMBER', options: { default: 0 } }),
        f({
          identifier: 'status',
          type: 'SELECT',
          options: { choices: ['a', 'b'], default: 'b' },
        }),
      ])
    ).toEqual({ flag: false, qty: 0, status: 'b' });
  });

  it('omits fields with no default and unsupported types', () => {
    expect(
      defaultsForFields([
        f({ identifier: 'flag', type: 'BOOLEAN', options: null }),
        f({ identifier: 'body', type: 'TEXT', options: { default: 'hi' } }),
      ])
    ).toEqual({});
  });
});

describe('checkFieldDefault (#344)', () => {
  it('flags a required BOOLEAN with no default', () => {
    expect(checkFieldDefault('BOOLEAN', null, true)).toMatch(
      /required boolean/i
    );
    expect(checkFieldDefault('BOOLEAN', {}, true)).toMatch(/required boolean/i);
    expect(checkFieldDefault('BOOLEAN', { default: undefined }, true)).toMatch(
      /required boolean/i
    );
  });

  it('accepts a required BOOLEAN with an explicit default (incl. false)', () => {
    expect(checkFieldDefault('BOOLEAN', { default: false }, true)).toBeNull();
    expect(checkFieldDefault('BOOLEAN', { default: true }, true)).toBeNull();
  });

  it('accepts an optional BOOLEAN with no default', () => {
    expect(checkFieldDefault('BOOLEAN', null, false)).toBeNull();
    expect(checkFieldDefault('BOOLEAN', {}, false)).toBeNull();
  });

  it('rejects a default on an unsupported field type', () => {
    expect(checkFieldDefault('TEXT', { default: 'x' }, false)).toMatch(
      /not supported/i
    );
  });

  it('rejects a SELECT default outside its configured choices', () => {
    expect(
      checkFieldDefault('SELECT', { choices: ['a'], default: 'z' }, false)
    ).toMatch(/invalid default/i);
  });

  it('accepts valid SELECT and NUMBER defaults', () => {
    expect(
      checkFieldDefault('SELECT', { choices: ['a'], default: 'a' }, false)
    ).toBeNull();
    expect(checkFieldDefault('NUMBER', { default: 3 }, false)).toBeNull();
  });
});
