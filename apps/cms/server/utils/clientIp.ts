import type { H3Event } from 'h3';
import { getRequestIP, getRequestHeader } from 'h3';

/**
 * Rate-limit-safe client IP. Defaults to the socket peer address (the direct
 * TCP peer) — the X-Forwarded-For header is client-controlled and MUST NOT be
 * trusted for rate-limit keys by default. If the app runs behind N trusted
 * reverse proxies, set BOJECT_TRUSTED_PROXY_HOPS=N; the client IP is then read
 * N hops out along [socketPeer, ...reverse(X-Forwarded-For)].
 */
export function getClientIp(event: H3Event): string {
  const socketIp = getRequestIP(event) ?? 'unknown'; // h3: socket peer, NOT xff
  const hops = trustedProxyHops();
  if (hops <= 0) return socketIp;
  const xff = (getRequestHeader(event, 'x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const chain = [socketIp, ...xff.reverse()]; // nearest hop first
  return chain[Math.min(hops, chain.length - 1)] ?? socketIp;
}

function trustedProxyHops(): number {
  const n = Number(process.env.BOJECT_TRUSTED_PROXY_HOPS);
  return Number.isInteger(n) && n > 0 ? n : 0;
}
