// apps/cms/scripts/manage-search/reindex.ts
//
// Backfill / reindex command (`pnpm search:reindex`). Rebuilds the Meilisearch
// entries index from current Postgres state — first-time adoption + disaster
// recovery. Walks every ContentEntry that has a PUBLISHED version, runs
// toSearchDocument() per entry, and upserts to Meili in batches.
//
// Upsert-only (no clear-first): documents only ever move toward current state,
// never blanked, so the command is safe to run while the app is live (search
// stays up) and concurrent edits are reconciled by the sync worker. Trade-off:
// a document for an entry that lost its PUBLISHED version *before* this runs is
// not pruned here — the sync worker handles deletions going forward. A future
// --prune flag could diff index ids vs. current PUBLISHED ids if needed.
//
// Scale note: the matching entries are loaded into memory in one findMany
// before batching (batchSize chunks only the Meili write, not the DB read), so
// peak memory scales with the corpus. Fine for first-adoption/recovery; a
// keyset-paginated DB read is the follow-up if this is run on a very large set.

import 'dotenv/config';
import { parseArgs } from 'node:util';
import type { Index } from 'meilisearch';
import type { PrismaClient } from '../../generated/prisma/client';
import {
  toSearchDocument,
  type SearchableFieldDef,
  type SearchDocument,
} from '../../server/utils/searchDocument';
import { CONTENT_STATUSES } from '../../utils/contentStatus';

const DEFAULT_BATCH_SIZE = 1000;

const HELP = `search:reindex — rebuild the Meilisearch index from Postgres

Usage:
  pnpm search:reindex [flags]

Flags:
  --content-type <Identifier>   Reindex only this content type (PascalCase identifier).
  --dry-run                     Count what would be indexed; write nothing.
  --batch-size <n>              Documents per Meilisearch batch (default ${DEFAULT_BATCH_SIZE}).
  --help, -h                    Show this help.

Notes:
  - Upsert-only: safe to run while the app is live (search stays up). Idempotent.
  - Requires DATABASE_URL and (in production) MEILI_MASTER_KEY in the environment.
`;

export interface ReindexLogger {
  info: (msg: string) => void;
}

export interface ReindexDeps {
  prisma: PrismaClient;
  /** Meilisearch index handle the documents are upserted into. Caller ensures it exists. */
  index: Index<SearchDocument>;
  logger: ReindexLogger;
}

export interface ReindexOptions {
  /** Restrict to one ContentType by its PascalCase identifier. */
  contentType?: string;
  /** Count only; perform no writes. */
  dryRun?: boolean;
  /** Documents per Meilisearch batch (default 1000). */
  batchSize?: number;
}

export interface ReindexSummary {
  dryRun: boolean;
  /** Entries that were (or, in dry-run, would be) indexed. */
  total: number;
  /** Per-content-type identifier counts. */
  byContentType: Record<string, number>;
}

/**
 * Rebuild the search index from current DB state. Free of process concerns
 * (argv, env, client construction) — those live in the CLI entry below — so the
 * core is integration-testable against the entries_test index.
 */
export async function runReindex(
  deps: ReindexDeps,
  options: ReindexOptions = {}
): Promise<ReindexSummary> {
  const { prisma, index, logger } = deps;
  const {
    contentType,
    dryRun = false,
    batchSize = DEFAULT_BATCH_SIZE,
  } = options;

  const entries = await prisma.contentEntry.findMany({
    where: {
      versions: { some: { status: CONTENT_STATUSES.PUBLISHED } },
      ...(contentType ? { contentType: { identifier: contentType } } : {}),
    },
    include: {
      contentType: { include: { fields: true } },
      versions: { where: { status: CONTENT_STATUSES.PUBLISHED }, take: 1 },
    },
    orderBy: { createdAt: 'asc' },
  });

  const scope = contentType ?? 'all types';
  const total = entries.length;
  const byContentType: Record<string, number> = {};

  const documents: SearchDocument[] = entries.map((entry) => {
    const version = entry.versions[0]!; // guaranteed by the `some` filter
    const identifier = entry.contentType.identifier;
    byContentType[identifier] = (byContentType[identifier] ?? 0) + 1;

    const fields: SearchableFieldDef[] = entry.contentType.fields.map(
      (field) => ({ identifier: field.identifier, type: field.type })
    );

    return toSearchDocument(
      {
        id: entry.id,
        entryKey: entry.entryKey,
        contentType: identifier,
        entryTitle: version.entryTitle,
        publishedAt: version.publishedAt
          ? version.publishedAt.toISOString()
          : null,
        data: version.data,
      },
      fields
    );
  });

  if (dryRun) {
    logger.info(
      `[search:reindex] DRY RUN — ${total} entries would be indexed (${scope})`
    );
    for (const [type, count] of Object.entries(byContentType)) {
      logger.info(`[search:reindex]   ${type}: ${count}`);
    }
    return { dryRun: true, total, byContentType };
  }

  if (total === 0) {
    logger.info(`[search:reindex] no published entries to index (${scope})`);
    return { dryRun: false, total: 0, byContentType };
  }

  let indexed = 0;
  for (let start = 0; start < documents.length; start += batchSize) {
    const batch = documents.slice(start, start + batchSize);
    await index.addDocuments(batch).waitTask();
    indexed += batch.length;
    const pct = Math.round((indexed / total) * 100);
    logger.info(
      `[search:reindex] ${indexed} / ${total} entries indexed (${scope}, ${pct}% complete)`
    );
  }

  return { dryRun: false, total: indexed, byContentType };
}

// CLI entry — runs only when invoked directly (`tsx scripts/manage-search/reindex.ts`).
if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'content-type': { type: 'string' },
      'dry-run': { type: 'boolean' },
      'batch-size': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[search:reindex] DATABASE_URL must be set');
    process.exit(1);
  }

  let batchSize: number | undefined;
  if (values['batch-size'] !== undefined) {
    batchSize = Number(values['batch-size']);
    if (!Number.isInteger(batchSize) || batchSize <= 0) {
      console.error('[search:reindex] --batch-size must be a positive integer');
      process.exit(1);
    }
  }

  const { PrismaClient } = await import('../../generated/prisma/client');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const { meili } = await import('../../server/utils/meili');
  const { ensureEntriesIndex, resolveEntriesIndex } =
    await import('../../server/utils/searchIndex');

  const dryRun = values['dry-run'] ?? false;
  const indexName = resolveEntriesIndex();
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    if (!dryRun) {
      await ensureEntriesIndex(meili, indexName);
    }
    const summary = await runReindex(
      {
        prisma,
        index: meili.index<SearchDocument>(indexName),
        logger: { info: (msg) => console.log(msg) },
      },
      { contentType: values['content-type'], dryRun, batchSize }
    );
    console.log(
      `[search:reindex] done — ${summary.total} entries ${summary.dryRun ? 'would be indexed' : 'indexed'} into "${indexName}"`
    );
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}
