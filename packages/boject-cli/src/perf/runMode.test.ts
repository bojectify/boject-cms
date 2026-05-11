import { describe, expect, it } from 'vitest';
import { deriveMode } from './runMode.js';

describe('deriveMode', () => {
  it('returns read-only when readOnly is true', () => {
    expect(deriveMode({ readOnly: true })).toBe('read-only');
  });

  it('returns seed-http when httpSeed is true', () => {
    expect(deriveMode({ httpSeed: true })).toBe('seed-http');
  });

  it('returns seed-direct when databaseUrl is provided', () => {
    expect(deriveMode({ databaseUrl: 'postgresql://u:p@h/foo_perf' })).toBe(
      'seed-direct'
    );
  });

  it('returns seed-direct as the deterministic fallback for empty flags', () => {
    expect(deriveMode({})).toBe('seed-direct');
  });
});
