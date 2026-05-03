import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { assertWebhookUrl, isPrivateHost } from './webhookUrl';
import { WebhookDnsError } from './resolvePublicHost';

vi.mock('./resolvePublicHost', async (importOriginal) => {
  const original = await importOriginal<typeof import('./resolvePublicHost')>();
  return {
    ...original,
    resolvePublicHost: vi.fn(),
  };
});

const { resolvePublicHost } = await import('./resolvePublicHost');
const mockResolve = resolvePublicHost as unknown as ReturnType<typeof vi.fn>;

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ALLOW = process.env.WEBHOOK_ALLOW_PRIVATE_URLS;

beforeEach(() => {
  process.env.NODE_ENV = 'production';
  delete process.env.WEBHOOK_ALLOW_PRIVATE_URLS;
  mockResolve.mockReset();
  // Default: hostname resolves to a public address
  mockResolve.mockResolvedValue({ addresses: ['203.0.113.5'] });
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
  it('accepts a public https URL', async () => {
    await expect(
      assertWebhookUrl('https://example.com/hook')
    ).resolves.toBeInstanceOf(URL);
  });

  it('accepts a public http URL', async () => {
    await expect(
      assertWebhookUrl('http://example.com/hook')
    ).resolves.toBeInstanceOf(URL);
  });

  it('rejects non-http schemes', async () => {
    await expect(assertWebhookUrl('file:///etc/passwd')).rejects.toThrow(
      /http\(s\)/
    );
    await expect(assertWebhookUrl('javascript:alert(1)')).rejects.toThrow(
      /http\(s\)/
    );
  });

  it('rejects garbage input', async () => {
    await expect(assertWebhookUrl('not a url')).rejects.toThrow(/valid URL/);
    await expect(assertWebhookUrl('')).rejects.toThrow(/valid URL/);
  });

  it('rejects localhost in production via the literal check (no DNS call)', async () => {
    await expect(assertWebhookUrl('http://localhost:3000/x')).rejects.toThrow(
      /private/
    );
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('rejects RFC1918 ranges in production via the literal check (no DNS call)', async () => {
    await expect(assertWebhookUrl('http://10.0.0.1/x')).rejects.toThrow(
      /private/
    );
    await expect(assertWebhookUrl('http://192.168.1.1/x')).rejects.toThrow(
      /private/
    );
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('allows localhost in development without calling DNS', async () => {
    process.env.NODE_ENV = 'development';
    await expect(
      assertWebhookUrl('http://localhost:3000/x')
    ).resolves.toBeInstanceOf(URL);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('allows private hosts when WEBHOOK_ALLOW_PRIVATE_URLS=true (no DNS call)', async () => {
    process.env.WEBHOOK_ALLOW_PRIVATE_URLS = 'true';
    await expect(assertWebhookUrl('http://10.0.0.1/x')).resolves.toBeInstanceOf(
      URL
    );
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('rejects IPv4-mapped IPv6 of a private v4 (literal check, no DNS)', async () => {
    await expect(
      assertWebhookUrl('http://[::ffff:127.0.0.1]/x')
    ).rejects.toThrow(/private/);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('rejects decimal IPv4 literal that resolves to a private address', async () => {
    await expect(assertWebhookUrl('http://2130706433/x')).rejects.toThrow(
      /private/
    );
  });

  it('does not treat WEBHOOK_ALLOW_PRIVATE_URLS="false" as an override', async () => {
    process.env.WEBHOOK_ALLOW_PRIVATE_URLS = 'false';
    await expect(assertWebhookUrl('http://10.0.0.1/x')).rejects.toThrow(
      /private/
    );
  });

  it('returns the parsed URL object on success', async () => {
    const url = await assertWebhookUrl('https://example.com/hook');
    expect(url).toBeInstanceOf(URL);
    expect(url.hostname).toBe('example.com');
    expect(url.pathname).toBe('/hook');
  });

  it('calls resolvePublicHost in production for non-IP hostnames', async () => {
    await assertWebhookUrl('https://example.com/hook');
    expect(mockResolve).toHaveBeenCalledWith('example.com');
  });

  it('rejects 400 with PRIVATE_IP wording when resolver finds a private IP', async () => {
    mockResolve.mockRejectedValue(
      new WebhookDnsError('PRIVATE_IP', 'localtest.me', '127.0.0.1')
    );
    await expect(assertWebhookUrl('https://localtest.me/x')).rejects.toThrow(
      /private/
    );
  });

  it('rejects 400 with NXDOMAIN wording when resolver cannot resolve', async () => {
    mockResolve.mockRejectedValue(
      new WebhookDnsError('NXDOMAIN', 'nope.example')
    );
    await expect(assertWebhookUrl('https://nope.example/x')).rejects.toThrow(
      /could not be resolved/
    );
  });

  it('rejects 400 with TIMEOUT wording when resolver times out', async () => {
    mockResolve.mockRejectedValue(
      new WebhookDnsError('TIMEOUT', 'slow.example')
    );
    await expect(assertWebhookUrl('https://slow.example/x')).rejects.toThrow(
      /timed out/
    );
  });

  it('rethrows non-WebhookDnsError errors unchanged (not wrapped as 400)', async () => {
    mockResolve.mockRejectedValue(new Error('unexpected boom'));
    await expect(assertWebhookUrl('https://example.com/x')).rejects.toThrow(
      /unexpected boom/
    );
  });

  it('skips resolver for IP literal URLs (already covered by literal check)', async () => {
    await expect(
      assertWebhookUrl('https://203.0.113.5/x')
    ).resolves.toBeInstanceOf(URL);
    expect(mockResolve).not.toHaveBeenCalled();
  });
});
