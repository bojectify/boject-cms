// apps/cms/scripts/docker-entrypoint/import-starter.ts
//
// FIRST-BOOT seed. Imports BOJECT_INITIAL_STARTER (a single bundle file
// path) into an empty CMS — both schema and entries (e.g. SiteSettings).
// Gated by "ContentType table is empty"; on every subsequent boot this
// script is a no-op and apply-schema.ts (every-boot, schema-only,
// idempotent) takes over. See `apply-schema.ts` for the long-lived
// schema-as-code lifecycle.

import type { PrismaClient } from '../../generated/prisma/client';
import type { Bundle, ImportResult } from '../content-bundle/types';

export interface ImportStarterInput {
  bundlePath: string;
  importBundle: (
    prisma: PrismaClient,
    bundle: Bundle,
    opts: { mode: 'all'; author: string }
  ) => Promise<ImportResult>;
  readBundle?: (path: string) => Promise<Bundle>;
}

export interface ImportStarterResult {
  imported: boolean;
  reason:
    | 'imported'
    | 'content-types-already-exist'
    | 'no-bundle-path'
    | 'bundle-missing';
  stats?: ImportResult;
}

async function defaultReadBundle(path: string): Promise<Bundle> {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as Bundle;
}

export async function importStarterIfEmpty(
  prisma: Pick<PrismaClient, 'contentType'>,
  input: ImportStarterInput
): Promise<ImportStarterResult> {
  const existing = await prisma.contentType.count();
  if (existing > 0) {
    return { imported: false, reason: 'content-types-already-exist' };
  }

  const read = input.readBundle ?? defaultReadBundle;
  const bundle = await read(input.bundlePath);
  const stats = await input.importBundle(prisma as PrismaClient, bundle, {
    mode: 'all',
    author: 'system',
  });

  return { imported: true, reason: 'imported', stats };
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const bundlePath = process.env.BOJECT_INITIAL_STARTER;
  if (!bundlePath) {
    console.log('[import-starter] BOJECT_INITIAL_STARTER not set — skipping');
    process.exit(0);
  }

  const { existsSync } = await import('node:fs');
  if (!existsSync(bundlePath)) {
    console.log(
      `[import-starter] bundle not found at ${bundlePath} — skipping`
    );
    process.exit(0);
  }

  const { PrismaClient } = await import('../../generated/prisma/client');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const { importBundle } = await import('../content-bundle/import');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[import-starter] DATABASE_URL must be set');
    process.exit(1);
  }
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    const result = await importStarterIfEmpty(prisma, {
      bundlePath,
      importBundle,
    });
    if (result.imported) {
      console.log(
        `[import-starter] imported ${result.stats?.contentTypesCreated ?? 0} content types, ${result.stats?.entriesCreated ?? 0} entries from ${bundlePath}`
      );
    } else {
      console.log(`[import-starter] skipped — ${result.reason}`);
    }
  } catch (err) {
    console.error(
      `[import-starter] ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}
