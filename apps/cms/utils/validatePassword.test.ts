import { describe, expect, it } from 'vitest';
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_RULES,
  validatePassword,
} from './validatePassword';

describe('validatePassword', () => {
  const email = 'admin@example.com';

  it('accepts a strong password', () => {
    expect(validatePassword('R8#fT2!qwLpZ', { email })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it('rejects passwords shorter than the minimum length', () => {
    const result = validatePassword('short1!', { email });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain('length');
  });

  it.each([
    'password',
    'PASSWORD',
    'changeme',
    'admin',
    'qwertyuiop',
    '123456789',
  ])('rejects blocklisted password %s (case-insensitive)', (pw) => {
    const result = validatePassword(pw, { email });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain('blocklist');
  });

  it('rejects passwords matching the email local-part', () => {
    const result = validatePassword('verylongusername', {
      email: 'verylongusername@example.com',
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain('localPart');
  });

  it('is case-insensitive against the email local-part', () => {
    const result = validatePassword('VeryLongUsername', {
      email: 'verylongusername@example.com',
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain('localPart');
  });

  it('returns all failure ids when multiple rules fail', () => {
    // 'admin' is short AND blocklisted AND matches local-part of admin@x.com
    const result = validatePassword('admin', { email: 'admin@example.com' });
    expect(result.ok).toBe(false);
    expect(result.failures.sort()).toEqual(
      ['blocklist', 'length', 'localPart'].sort()
    );
  });

  it('exposes MIN_PASSWORD_LENGTH constant', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
  });

  it('exposes PASSWORD_RULES registry with stable ids', () => {
    expect(PASSWORD_RULES.map((r) => r.id).sort()).toEqual(
      ['blocklist', 'length', 'localPart'].sort()
    );
  });
});
