import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { assertWebhookUrl, isPrivateHost } from './webhookUrl';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ALLOW = process.env.WEBHOOK_ALLOW_PRIVATE_URLS;

beforeEach(() => {
  process.env.NODE_ENV = 'production';
  delete process.env.WEBHOOK_ALLOW_PRIVATE_URLS;
});

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_ALLOW !== undefined) {
    process.env.WEBHOOK_ALLOW_PRIVATE_URLS = ORIGINAL_ALLOW;
  } else {
    delete process.env.WEBHOOK_ALLOW_PRIVATE_URLS;
  }
});

describe('isPrivateHost', () => {
  it.each([
    ['localhost', true],
    ['127.0.0.1', true],
    ['10.0.0.5', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['192.168.1.1', true],
    ['169.254.169.254', true],
    ['203.0.113.5', false],
    ['example.com', false],
    ['0.0.0.0', true],
    ['169.1.1.1', false],
    ['::ffff:127.0.0.1', true],
    ['::ffff:10.0.0.1', true],
    ['::ffff:8.8.8.8', false],
    ['2130706433', true],
    ['0x7f000001', true],
  ])('classifies %s as private=%s', (host, expected) => {
    expect(isPrivateHost(host)).toBe(expected);
  });
});

describe('assertWebhookUrl', () => {
  it('accepts a public https URL', () => {
    expect(() => assertWebhookUrl('https://example.com/hook')).not.toThrow();
  });

  it('accepts a public http URL', () => {
    expect(() => assertWebhookUrl('http://example.com/hook')).not.toThrow();
  });

  it('rejects non-http schemes', () => {
    expect(() => assertWebhookUrl('file:///etc/passwd')).toThrow(/http\(s\)/);
    expect(() => assertWebhookUrl('javascript:alert(1)')).toThrow(/http\(s\)/);
  });

  it('rejects garbage input', () => {
    expect(() => assertWebhookUrl('not a url')).toThrow(/valid URL/);
    expect(() => assertWebhookUrl('')).toThrow(/valid URL/);
  });

  it('rejects localhost in production', () => {
    expect(() => assertWebhookUrl('http://localhost:3000/x')).toThrow(
      /private/
    );
  });

  it('rejects RFC1918 ranges in production', () => {
    expect(() => assertWebhookUrl('http://10.0.0.1/x')).toThrow(/private/);
    expect(() => assertWebhookUrl('http://192.168.1.1/x')).toThrow(/private/);
  });

  it('allows localhost in development', () => {
    process.env.NODE_ENV = 'development';
    expect(() => assertWebhookUrl('http://localhost:3000/x')).not.toThrow();
  });

  it('allows private hosts when WEBHOOK_ALLOW_PRIVATE_URLS=true', () => {
    process.env.WEBHOOK_ALLOW_PRIVATE_URLS = 'true';
    expect(() => assertWebhookUrl('http://10.0.0.1/x')).not.toThrow();
  });

  it('rejects IPv4-mapped IPv6 of a private v4', () => {
    expect(() => assertWebhookUrl('http://[::ffff:127.0.0.1]/x')).toThrow(
      /private/
    );
  });

  it('rejects decimal IPv4 literal that resolves to a private address', () => {
    expect(() => assertWebhookUrl('http://2130706433/x')).toThrow(/private/);
  });

  it('does not treat WEBHOOK_ALLOW_PRIVATE_URLS="false" as an override', () => {
    process.env.WEBHOOK_ALLOW_PRIVATE_URLS = 'false';
    expect(() => assertWebhookUrl('http://10.0.0.1/x')).toThrow(/private/);
  });

  it('returns the parsed URL object on success', () => {
    const url = assertWebhookUrl('https://example.com/hook');
    expect(url).toBeInstanceOf(URL);
    expect(url.hostname).toBe('example.com');
    expect(url.pathname).toBe('/hook');
  });
});
