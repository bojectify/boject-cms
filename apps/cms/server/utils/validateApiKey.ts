import type { H3Event } from 'h3';
import { getRequestHeader } from 'h3';
import { prisma } from './prisma';
import { hashApiKey } from './apiKey';

export type ValidateApiKeyResult =
  | { valid: true; apiKeyId: string; keyPrefix: string }
  | { valid: false; message: string };

/**
 * Minimal Prisma surface needed by resolveApiKey — kept narrow on
 * purpose so unit tests can pass a hand-rolled fake.
 */
export type ApiKeyClient = {
  apiKey: {
    findUnique: (args: { where: { keyHash: string } }) => Promise<{
      id: string;
      keyPrefix: string;
      revokedAt: Date | null;
    } | null>;
    update: (args: {
      where: { id: string };
      data: { lastUsedAt: Date };
    }) => Promise<unknown>;
  };
};

export async function resolveApiKey(
  client: ApiKeyClient,
  header: string | undefined
): Promise<ValidateApiKeyResult> {
  if (!header) {
    return { valid: false, message: 'Missing Authorization header' };
  }

  const match = header.match(/^Bearer (boject_.+)$/);
  if (!match) {
    return { valid: false, message: 'Invalid Authorization format' };
  }

  const keyHash = hashApiKey(match[1]!);
  const apiKey = await client.apiKey.findUnique({ where: { keyHash } });

  if (!apiKey) {
    return { valid: false, message: 'Invalid API key' };
  }

  if (apiKey.revokedAt) {
    return { valid: false, message: 'API key has been revoked' };
  }

  // Fire-and-forget lastUsedAt update
  client.apiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { valid: true, apiKeyId: apiKey.id, keyPrefix: apiKey.keyPrefix };
}

export async function validateApiKey(
  event: H3Event
): Promise<ValidateApiKeyResult> {
  const header = getRequestHeader(event, 'authorization');
  return resolveApiKey(prisma, header);
}
