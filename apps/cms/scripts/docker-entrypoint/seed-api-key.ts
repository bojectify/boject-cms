import type { PrismaClient } from '../../generated/prisma/client';
import { isApiKeyScope, type ApiKeyScope } from '../../utils/apiKeyScopes';

/**
 * Bootstrap CLI API key (#510). `create-boject-cms` generates a key, keeps the
 * raw value in the project's `.env.local` (read by the boject CLI), and passes
 * only `BOJECT_BOOTSTRAP_API_KEY=<prefix>:<sha256>` plus
 * `BOJECT_BOOTSTRAP_API_KEY_SCOPES` to the container. This entrypoint step
 * creates the matching `ApiKey` row, so the raw key never reaches the
 * container, the database, or git.
 */

export const BOOTSTRAP_KEY_NAME = 'cli (bootstrap)';

const BOOTSTRAP_KEY_PATTERN = /^(boject_[0-9a-f]{4}):([0-9a-f]{64})$/;

export function parseBootstrapApiKey(value: string): {
  prefix: string;
  hash: string;
} {
  const match = BOOTSTRAP_KEY_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error(
      'BOJECT_BOOTSTRAP_API_KEY must be "boject_<4 hex>:<64 lowercase hex sha256>"'
    );
  }
  return { prefix: match[1]!, hash: match[2]! };
}

export function parseBootstrapScopes(value: string | undefined): ApiKeyScope[] {
  const items = (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (items.length === 0) {
    // Never grant implicitly — a key that can mint keys must be explicit.
    throw new Error(
      'BOJECT_BOOTSTRAP_API_KEY_SCOPES must list at least one scope when BOJECT_BOOTSTRAP_API_KEY is set'
    );
  }
  const unknown = items.filter((item) => !isApiKeyScope(item));
  if (unknown.length > 0) {
    throw new Error(
      `BOJECT_BOOTSTRAP_API_KEY_SCOPES has unknown scope(s): ${unknown.join(', ')}`
    );
  }
  return items as ApiKeyScope[];
}

export type SeedBootstrapApiKeyResult =
  | { seeded: true; reason: 'created' }
  | {
      seeded: false;
      reason: 'already-exists';
      /**
       * Whether the existing key's scopes equal the configured ones. Scopes
       * apply only when the key is created — a later edit to
       * BOJECT_BOOTSTRAP_API_KEY_SCOPES has no effect, so the caller warns.
       */
      scopesMatch: boolean;
    };

/**
 * Creates the bootstrap key unless a row with that hash already exists. Any
 * existing row — active or revoked — is left alone, so restarts are no-ops and
 * a revoked bootstrap key is never resurrected. After a database wipe the row
 * is gone, so the key is recreated and the project's `.env.local` keeps working.
 */
export async function seedBootstrapApiKey(
  prisma: Pick<PrismaClient, 'apiKey'>,
  input: { prefix: string; hash: string; scopes: ApiKeyScope[] }
): Promise<SeedBootstrapApiKeyResult> {
  const existing = await prisma.apiKey.findUnique({
    where: { keyHash: input.hash },
  });
  if (existing) {
    const have = new Set(existing.scopes);
    const want = new Set<string>(input.scopes);
    const scopesMatch =
      have.size === want.size && [...want].every((scope) => have.has(scope));
    return { seeded: false, reason: 'already-exists', scopesMatch };
  }

  await prisma.apiKey.create({
    data: {
      name: BOOTSTRAP_KEY_NAME,
      keyHash: input.hash,
      keyPrefix: input.prefix,
      scopes: input.scopes,
    },
  });
  return { seeded: true, reason: 'created' };
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  let parsed: { prefix: string; hash: string; scopes: ApiKeyScope[] };
  try {
    const { prefix, hash } = parseBootstrapApiKey(
      process.env.BOJECT_BOOTSTRAP_API_KEY ?? ''
    );
    const scopes = parseBootstrapScopes(
      process.env.BOJECT_BOOTSTRAP_API_KEY_SCOPES
    );
    parsed = { prefix, hash, scopes };
  } catch (err) {
    console.error(
      `[seed-api-key] ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[seed-api-key] DATABASE_URL must be set');
    process.exit(1);
  }
  const { PrismaClient } = await import('../../generated/prisma/client');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  try {
    const result = await seedBootstrapApiKey(prisma, parsed);
    if (result.seeded) {
      console.log(
        `[seed-api-key] seeded bootstrap API key ${parsed.prefix} — remove BOJECT_BOOTSTRAP_API_KEY outside local development`
      );
    } else {
      console.log(
        `[seed-api-key] skipped — bootstrap key ${parsed.prefix} already exists`
      );
      if (!result.scopesMatch) {
        console.warn(
          `[seed-api-key] WARNING: BOJECT_BOOTSTRAP_API_KEY_SCOPES differs from the existing key ${parsed.prefix}'s scopes. Scopes apply only when the key is first created, so this edit has no effect — rotate the key to change its scopes.`
        );
      }
    }
  } catch (err) {
    console.error(
      `[seed-api-key] ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}
