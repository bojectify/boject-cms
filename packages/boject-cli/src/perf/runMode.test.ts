import { describe, expect, it } from 'vitest';
import { deriveMode } from './runMode.js';

describe('deriveMode', () => {
  it('returns read-only when readOnly is true', () => {
    expect(deriveMode({ readOnly: true })).toBe('read-only');
  });

  it('returns seed-direct when databaseUrl is provided', () => {
    expect(deriveMode({ databaseUrl: 'postgresql://u:p@h/foo_perf' })).toBe(
      'seed-direct'
    );
  });

  it('returns seed-direct when readOnly is not set (typecheck fallthrough)', () => {
    expect(deriveMode({})).toBe('seed-direct');
  });
});
