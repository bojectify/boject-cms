import { createError } from 'h3';
import { isIP } from 'node:net';

const PRIVATE_V4_PREFIXES: Array<[number, number, number]> = [
  [10, 0, 0],
  [127, 0, 0],
  [169, 254, 0],
  [192, 168, 0],
];

function isPrivateV4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p))) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (PRIVATE_V4_PREFIXES.some(([p0]) => p0 === a)) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function isPrivateHost(host: string): boolean {
  const normalised = host.toLowerCase();
  if (normalised === 'localhost') return true;
  if (isIP(normalised) === 4) return isPrivateV4(normalised);
  if (isIP(normalised) === 6) {
    if (normalised === '::1') return true;
    if (normalised.startsWith('fc') || normalised.startsWith('fd')) return true;
    if (normalised.startsWith('fe80')) return true;
    return false;
  }
  return false;
}

export function assertWebhookUrl(input: string): URL {
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
  return url;
}
