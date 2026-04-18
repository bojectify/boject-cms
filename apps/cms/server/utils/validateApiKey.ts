import type { H3Event } from 'h3';

export async function validateApiKey(
  event: H3Event
): Promise<{ valid: true } | { valid: false; message: string }> {
  const header = getRequestHeader(event, 'authorization');
  if (!header) {
    return { valid: false, message: 'Missing Authorization header' };
  }

  const match = header.match(/^Bearer (boject_.+)$/);
  if (!match) {
    return { valid: false, message: 'Invalid Authorization format' };
  }

  const keyHash = hashApiKey(match[1]!);
  const apiKey = await prisma.apiKey.findUnique({ where: { keyHash } });

  if (!apiKey) {
    return { valid: false, message: 'Invalid API key' };
  }

  if (apiKey.revokedAt) {
    return { valid: false, message: 'API key has been revoked' };
  }

  // Fire-and-forget lastUsedAt update
  prisma.apiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { valid: true };
}
