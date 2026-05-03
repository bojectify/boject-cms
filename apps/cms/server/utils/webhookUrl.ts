import { createError } from 'h3';
import { isIP } from 'node:net';
import {
  resolvePublicHost,
  WebhookDnsError,
  type DnsErrorReason,
} from './resolvePublicHost';

const PRIVATE_V4_PREFIXES: number[] = [10, 127, 192];

function isPrivateV4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p))) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 — routes to localhost on most stacks
  if (PRIVATE_V4_PREFIXES.includes(a)) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/**
 * Classify a host as private (localhost, RFC1918, link-local, etc.).
 * Accepts `URL.hostname` — IPv6 literals may arrive bracketed
 * (Node's WHATWG URL keeps the brackets on `hostname`), so we strip
 * them here.
 */
export function isPrivateHost(host: string): boolean {
  let normalised = host.toLowerCase();
  if (normalised.startsWith('[') && normalised.endsWith(']')) {
    normalised = normalised.slice(1, -1);
  }
  if (normalised === 'localhost') return true;
  if (isIP(normalised) === 4) return isPrivateV4(normalised);
  if (isIP(normalised) === 6) {
    if (normalised === '::1') return true;
    if (normalised.startsWith('fc') || normalised.startsWith('fd')) return true;
    if (normalised.startsWith('fe80')) return true;
    // IPv4-mapped IPv6 — e.g. ::ffff:127.0.0.1 or the node-canonicalised
    // form ::ffff:7f00:1. Extract the embedded v4 and re-classify.
    if (normalised.startsWith('::ffff:')) {
      const tail = normalised.slice('::ffff:'.length);
      // Dotted form: ::ffff:127.0.0.1
      if (isIP(tail) === 4) return isPrivateV4(tail);
      // Hex form: ::ffff:HHHH:HHHH — convert to dotted v4
      const hexMatch = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
      if (hexMatch) {
        const hi = parseInt(hexMatch[1]!, 16);
        const lo = parseInt(hexMatch[2]!, 16);
        const v4 = [
          (hi >> 8) & 0xff,
          hi & 0xff,
          (lo >> 8) & 0xff,
          lo & 0xff,
        ].join('.');
        return isPrivateV4(v4);
      }
    }
    return false;
  }
  // Reject all-numeric or hex-obfuscated hostnames that node.js will connect to
  // but isIP() doesn't recognise. These are rare in legitimate public URLs and
  // a common SSRF probe format.
  if (/^\d+$/.test(normalised)) return true;
  if (/^0x[0-9a-f]+$/i.test(normalised)) return true;
  return false;
}

export async function assertWebhookUrl(input: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'url must be a valid URL',
    });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw createError({
      statusCode: 400,
      statusMessage: 'url must use http(s)',
    });
  }

  const allowPrivate =
    process.env.NODE_ENV !== 'production' ||
    process.env.WEBHOOK_ALLOW_PRIVATE_URLS === 'true';
  if (!allowPrivate && isPrivateHost(url.hostname)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'url must not resolve to a private network host',
    });
  }

  if (allowPrivate || isIP(url.hostname) > 0) {
    return url;
  }

  try {
    await resolvePublicHost(url.hostname);
  } catch (err) {
    if (err instanceof WebhookDnsError) {
      throw createError({
        statusCode: 400,
        statusMessage: messageForDnsError(err.reason),
      });
    }
    throw err;
  }

  return url;
}

function messageForDnsError(reason: DnsErrorReason): string {
  switch (reason) {
    case 'PRIVATE_IP':
      return 'url must not resolve to a private network host';
    case 'NXDOMAIN':
      return 'url hostname could not be resolved';
    case 'TIMEOUT':
      return 'url hostname resolution timed out';
  }
}
