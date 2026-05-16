import { isIP } from 'node:net';

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
 *
 * Lives in its own file (rather than alongside `assertWebhookUrl` in
 * `webhookUrl.ts`) so that `resolvePublicHost.ts` can import it without
 * creating a circular dependency — `webhookUrl.ts` itself imports
 * `resolvePublicHost` for the validate-time SSRF check.
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
