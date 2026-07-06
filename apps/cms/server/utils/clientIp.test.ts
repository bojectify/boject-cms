import { describe, it, expect, afterEach } from 'vitest';
import type { H3Event } from 'h3';
import { getClientIp } from './clientIp';

/**
 * Minimal H3Event mock exposing only what h3's getRequestIP/getRequestHeader
 * read: event.node.req.socket.remoteAddress and
 * event.node.req.headers['x-forwarded-for'].
 */
function makeMockEvent(opts: { socketIp?: string; xff?: string }): H3Event {
  return {
    context: {},
    node: {
      req: {
        socket: { remoteAddress: opts.socketIp },
        headers: opts.xff !== undefined ? { 'x-forwarded-for': opts.xff } : {},
      },
    },
  } as H3Event;
}

describe('getClientIp', () => {
  afterEach(() => {
    delete process.env.BOJECT_TRUSTED_PROXY_HOPS;
  });

  it('returns the socket IP and ignores a spoofed XFF when hops is unset', () => {
    delete process.env.BOJECT_TRUSTED_PROXY_HOPS;
    const event = makeMockEvent({
      socketIp: '10.0.0.1',
      xff: '1.2.3.4, 5.6.7.8',
    });
    expect(getClientIp(event)).toBe('10.0.0.1');
  });

  it('returns the socket IP and ignores a spoofed XFF when hops is 0', () => {
    process.env.BOJECT_TRUSTED_PROXY_HOPS = '0';
    const event = makeMockEvent({
      socketIp: '10.0.0.1',
      xff: '1.2.3.4, 5.6.7.8',
    });
    expect(getClientIp(event)).toBe('10.0.0.1');
  });

  it('falls back to "unknown" when there is no socket IP and hops is unset', () => {
    delete process.env.BOJECT_TRUSTED_PROXY_HOPS;
    const event = makeMockEvent({ xff: '1.2.3.4' });
    expect(getClientIp(event)).toBe('unknown');
  });

  it('with hops=1, returns the rightmost XFF entry (nearest trusted proxy), not the spoofed leftmost', () => {
    process.env.BOJECT_TRUSTED_PROXY_HOPS = '1';
    // Chain (nearest hop first): [socketIp, ...xff.reverse()]
    // xff = "client-spoofed, real-client-seen-by-proxy"
    // reversed xff = [real-client-seen-by-proxy, client-spoofed]
    // chain = [socketIp(proxy), real-client-seen-by-proxy, client-spoofed]
    // hop 1 => chain[1] = real-client-seen-by-proxy
    const event = makeMockEvent({
      socketIp: '10.0.0.1', // the trusted proxy itself
      xff: '1.2.3.4, 203.0.113.9', // 1.2.3.4 = spoofed leftmost, 203.0.113.9 = what the proxy actually saw
    });
    expect(getClientIp(event)).toBe('203.0.113.9');
  });

  it('with hops=2 over a two-proxy chain, returns the original client IP', () => {
    process.env.BOJECT_TRUSTED_PROXY_HOPS = '2';
    // xff appended left-to-right by each hop: client -> proxy1 -> proxy2 (socket)
    // xff header as seen at proxy2: "client, proxy1"
    // reversed: [proxy1, client]; chain = [proxy2(socket), proxy1, client]
    // hop 2 => chain[2] = client
    const event = makeMockEvent({
      socketIp: 'proxy2-ip',
      xff: 'client-ip, proxy1-ip',
    });
    expect(getClientIp(event)).toBe('client-ip');
  });

  it('clamps hops greater than the chain length to the last entry rather than throwing/undefined', () => {
    process.env.BOJECT_TRUSTED_PROXY_HOPS = '10';
    const event = makeMockEvent({
      socketIp: '10.0.0.1',
      xff: 'a, b',
    });
    // chain = [10.0.0.1, b, a] (length 3) -> clamp to index 2 -> 'a'
    expect(getClientIp(event)).toBe('a');
  });

  it('clamps safely even with no XFF header present (hops > chain length 1)', () => {
    process.env.BOJECT_TRUSTED_PROXY_HOPS = '5';
    const event = makeMockEvent({ socketIp: '10.0.0.1' });
    expect(getClientIp(event)).toBe('10.0.0.1');
  });

  it('ignores a non-integer or negative hops value (falls back to socket IP)', () => {
    process.env.BOJECT_TRUSTED_PROXY_HOPS = '-1';
    const event1 = makeMockEvent({ socketIp: '10.0.0.1', xff: '1.2.3.4' });
    expect(getClientIp(event1)).toBe('10.0.0.1');

    process.env.BOJECT_TRUSTED_PROXY_HOPS = 'abc';
    const event2 = makeMockEvent({ socketIp: '10.0.0.1', xff: '1.2.3.4' });
    expect(getClientIp(event2)).toBe('10.0.0.1');

    process.env.BOJECT_TRUSTED_PROXY_HOPS = '1.5';
    const event3 = makeMockEvent({ socketIp: '10.0.0.1', xff: '1.2.3.4' });
    expect(getClientIp(event3)).toBe('10.0.0.1');
  });
});
