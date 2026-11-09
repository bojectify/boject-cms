import { createHash, randomBytes } from 'node:crypto';

export function generateSessionPassword(): string {
  return randomBytes(32).toString('base64');
}

export function generateAdminPassword(): string {
  return randomBytes(16).toString('base64');
}

export function generateMeiliMasterKey(): string {
  return randomBytes(32).toString('base64');
}

/**
 * A CLI API key in the CMS's format (apps/cms/server/utils/apiKey.ts): the raw
 * key goes to the project's .env.local; only `prefix` and `hash` are handed to
 * the CMS, which seeds the key on first boot (#510).
 */
export function generateCliApiKey(): {
  raw: string;
  prefix: string;
  hash: string;
} {
  const raw = 'boject_' + randomBytes(32).toString('hex');
  return {
    raw,
    prefix: raw.slice(0, 11),
    hash: createHash('sha256').update(raw).digest('hex'),
  };
}
