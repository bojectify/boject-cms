import { describe, expect, it } from 'vitest';
import {
  generateAdminPassword,
  generateMeiliMasterKey,
  generateSessionPassword,
} from '../../src/secrets.js';

describe('generateSessionPassword', () => {
  it('returns a 44-char base64 string (32 decoded bytes)', () => {
    const secret = generateSessionPassword();
    expect(secret).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(Buffer.from(secret, 'base64')).toHaveLength(32);
  });

  it('returns unique values across calls', () => {
    const a = generateSessionPassword();
    const b = generateSessionPassword();
    expect(a).not.toBe(b);
  });
});

describe('generateAdminPassword', () => {
  it('returns a 24-char base64 string (16 decoded bytes)', () => {
    const secret = generateAdminPassword();
    expect(secret).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(Buffer.from(secret, 'base64')).toHaveLength(16);
  });

  it('returns unique values across calls', () => {
    const a = generateAdminPassword();
    const b = generateAdminPassword();
    expect(a).not.toBe(b);
  });
});

describe('generateMeiliMasterKey', () => {
  it('returns a 44-char base64 string (32 decoded bytes)', () => {
    const secret = generateMeiliMasterKey();
    expect(secret).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(Buffer.from(secret, 'base64')).toHaveLength(32);
  });

  it('returns unique values across calls', () => {
    const a = generateMeiliMasterKey();
    const b = generateMeiliMasterKey();
    expect(a).not.toBe(b);
  });
});
