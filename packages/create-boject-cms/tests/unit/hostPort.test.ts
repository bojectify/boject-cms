import { describe, expect, it } from 'vitest';
import { DEFAULT_HOST_PORT, resolveHostPort } from '../../src/hostPort.js';

describe('resolveHostPort', () => {
  it('defaults to 4000 when no flag is given', () => {
    expect(DEFAULT_HOST_PORT).toBe(4000);
    expect(resolveHostPort(undefined)).toBe(DEFAULT_HOST_PORT);
  });

  it('parses a valid port within range', () => {
    expect(resolveHostPort('4100')).toBe(4100);
    expect(resolveHostPort('1')).toBe(1);
    expect(resolveHostPort('65535')).toBe(65535);
  });

  it('throws on a non-integer', () => {
    expect(() => resolveHostPort('abc')).toThrow(/Invalid --port/);
    expect(() => resolveHostPort('40.5')).toThrow(/Invalid --port/);
  });

  it('throws on an out-of-range port', () => {
    expect(() => resolveHostPort('0')).toThrow(/between 1 and 65535/);
    expect(() => resolveHostPort('70000')).toThrow(/between 1 and 65535/);
  });
});
