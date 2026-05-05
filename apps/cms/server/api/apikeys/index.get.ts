import { defineEventHandler } from 'h3';
import { assertApiKeyScope } from '../../utils/assertApiKeyScope';

export default defineEventHandler(async (event) => {
  assertApiKeyScope(event, 'apikey:read');

  const rows = await prisma.apiKey.findMany({
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      scopes: true,
      revokedAt: true,
      lastUsedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return {
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      prefix: r.keyPrefix,
      scopes: r.scopes,
      revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
      lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    })),
  };
});
