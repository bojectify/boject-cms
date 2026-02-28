import { randomBytes, createHash } from 'node:crypto';

const PREFIX = 'boject_';

export function generateApiKey() {
  const raw = PREFIX + randomBytes(32).toString('hex');
  const hash = hashApiKey(raw);
  const prefix = raw.slice(0, 11); // "boject_" + 4 hex chars
  return { raw, hash, prefix };
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
