import { describe, it, expect } from 'vitest';
import { resolvePublicHost, WebhookDnsError } from './resolvePublicHost';

type DnsLike = {
  resolve4: (hostname: string) => Promise<string[]>;
  resolve6: (hostname: string) => Promise<string[]>;
};

function fakeDns(
  map: Record<
    string,
    {
      v4?: string[];
      v6?: string[];
      v4err?: Error;
      v6err?: Error;
      v4delayMs?: number;
      v6delayMs?: number;
    }
  >
): DnsLike {
  return {
    resolve4: async (h) => {
      const e = map[h];
      if (!e || e.v4err)
        throw (
          e?.v4err ??
          Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })
        );
      if (e.v4delayMs) await new Promise((r) => setTimeout(r, e.v4delayMs));
      return e.v4 ?? [];
    },
    resolve6: async (h) => {
      const e = map[h];
      if (!e || e.v6err)
        throw (
          e?.v6err ??
          Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })
        );
      if (e.v6delayMs) await new Promise((r) => setTimeout(r, e.v6delayMs));
      return e.v6 ?? [];
    },
  };
}

describe('resolvePublicHost', () => {
  it('short-circuits IPv4 literal without calling DNS', async () => {
    let called = false;
    const dns = {
      resolve4: async () => {
        called = true;
        return [];
      },
      resolve6: async () => {
        called = true;
        return [];
      },
    };
    const result = await resolvePublicHost('203.0.113.5', { dns });
    expect(result.addresses).toEqual(['203.0.113.5']);
    expect(called).toBe(false);
  });

  it('short-circuits IPv6 literal without calling DNS', async () => {
    let called = false;
    const dns = {
      resolve4: async () => {
        called = true;
        return [];
      },
      resolve6: async () => {
        called = true;
        return [];
      },
    };
    const result = await resolvePublicHost('2606:4700::1', { dns });
    expect(result.addresses).toEqual(['2606:4700::1']);
    expect(called).toBe(false);
  });

  it('returns A-only public addresses', async () => {
    const dns = fakeDns({ 'example.com': { v4: ['203.0.113.5'] } });
    const result = await resolvePublicHost('example.com', { dns });
    expect(result.addresses).toEqual(['203.0.113.5']);
  });

  it('returns AAAA-only public addresses', async () => {
    const dns = fakeDns({ 'example.com': { v6: ['2606:4700::1'] } });
    const result = await resolvePublicHost('example.com', { dns });
    expect(result.addresses).toEqual(['2606:4700::1']);
  });

  it('unions A + AAAA when both resolve, preserving order', async () => {
    const dns = fakeDns({
      'example.com': { v4: ['203.0.113.5'], v6: ['2606:4700::1'] },
    });
    const result = await resolvePublicHost('example.com', { dns });
    expect(result.addresses).toEqual(['203.0.113.5', '2606:4700::1']);
  });

  it('throws PRIVATE_IP if any A is private', async () => {
    const dns = fakeDns({
      'evil.com': { v4: ['203.0.113.5', '127.0.0.1'] },
    });
    await expect(resolvePublicHost('evil.com', { dns })).rejects.toMatchObject({
      reason: 'PRIVATE_IP',
      hostname: 'evil.com',
      offending: '127.0.0.1',
    });
  });

  it('throws PRIVATE_IP if AAAA is private (::1)', async () => {
    const dns = fakeDns({ 'evil.com': { v6: ['::1'] } });
    await expect(resolvePublicHost('evil.com', { dns })).rejects.toMatchObject({
      reason: 'PRIVATE_IP',
    });
  });

  it('throws PRIVATE_IP for IPv4-mapped IPv6 of a private v4', async () => {
    const dns = fakeDns({ 'evil.com': { v6: ['::ffff:127.0.0.1'] } });
    await expect(resolvePublicHost('evil.com', { dns })).rejects.toMatchObject({
      reason: 'PRIVATE_IP',
    });
  });

  it('throws NXDOMAIN when both queries fail', async () => {
    const dns = fakeDns({
      'nope.example': {
        v4err: Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }),
        v6err: Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }),
      },
    });
    await expect(
      resolvePublicHost('nope.example', { dns })
    ).rejects.toMatchObject({
      reason: 'NXDOMAIN',
      hostname: 'nope.example',
    });
  });

  it('succeeds when one family resolves and the other rejects', async () => {
    const dns = fakeDns({
      'half.example': {
        v4: ['203.0.113.5'],
        v6err: Object.assign(new Error('ENODATA'), { code: 'ENODATA' }),
      },
    });
    const result = await resolvePublicHost('half.example', { dns });
    expect(result.addresses).toEqual(['203.0.113.5']);
  });

  it('throws TIMEOUT when resolution exceeds timeoutMs', async () => {
    const dns = fakeDns({
      'slow.example': { v4delayMs: 50, v6delayMs: 50, v4: ['203.0.113.5'] },
    });
    await expect(
      resolvePublicHost('slow.example', { dns, timeoutMs: 5 })
    ).rejects.toMatchObject({ reason: 'TIMEOUT' });
  });

  it('exports WebhookDnsError as the thrown class', async () => {
    const dns = fakeDns({ 'evil.com': { v4: ['127.0.0.1'] } });
    await expect(resolvePublicHost('evil.com', { dns })).rejects.toBeInstanceOf(
      WebhookDnsError
    );
  });
});
