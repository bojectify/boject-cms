import { describe, it, expect } from 'vitest';
import { defaultsForFields } from './fieldDefaults';

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
