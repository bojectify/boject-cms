import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { PrismaClient, Prisma } from '../../apps/cms/generated/prisma/client';
import { loadNodeConfig } from '../lib/config-node';
import { PERF_CONTENT_TYPES } from './contentTypes';
import { generateRichtext } from './richtext-fixture';
import { resetPerfDb } from './reset';
import { ensurePerfDbBootstrap } from './bootstrap';

export interface SeedRowOptions {
  articleCount: number;
  authorCount: number;
  seed: number;
}

export interface SeedRows {
  authors: Array<{
    id: string;
    entryTitle: string;
    data: { name: string; bio: string };
  }>;
  articles: Array<{
    id: string;
    entryTitle: string;
    slug: string;
    authorIndex: number;
    data: {
      title: string;
      slug: string;
      excerpt: string;
      body: ReturnType<typeof generateRichtext>;
      publishDate: string;
      author: {
        contentTypeIdentifier: string;
        entryId: string; // resolved at insert time; placeholder here
      };
    };
  }>;
}

export function buildSeedRows(opts: SeedRowOptions): SeedRows {
  const authors = Array.from({ length: opts.authorCount }).map((_, i) => {
    const id = `perf-author-${opts.seed}-${i}`;
    return {
      id,
      entryTitle: `Perf Author ${opts.seed}-${i}`,
      data: {
        name: `Perf Author ${opts.seed}-${i}`,
        bio: `Bio ${i} generated for perf run seed ${opts.seed}.`,
      },
    };
  });

  const articles = Array.from({ length: opts.articleCount }).map((_, i) => {
    const authorIndex = i % Math.max(authors.length, 1);
    const id = `perf-article-${opts.seed}-${i}`;
    const slug = `perf-article-${opts.seed}-${i}`;
    const title = `Perf Article ${opts.seed}-${i}`;
    const body = generateRichtext(opts.seed * 10000 + i);
    const publishDate = new Date(
      Date.UTC(2020, 0, 1) + i * 60_000
    ).toISOString();
    return {
      id,
      entryTitle: title,
      slug,
      authorIndex,
      data: {
        title,
        slug,
        excerpt: `Excerpt for article ${i}.`,
        body,
        publishDate,
        author: {
          contentTypeIdentifier: 'PerfAuthor',
          entryId: authors[authorIndex]!.id,
        },
      },
    };
  });

  return { authors, articles };
}

export interface SeedExecOptions {
  prisma: PrismaClient;
  articleCount: number;
  authorCount?: number;
  seed?: number;
}

// Caller contract: run `resetPerfDb` before `seedPerfData` whenever you need
// schema agreement. We upsert content types by identifier but do NOT reconcile
// fields if the type already exists, so a previous run with different
// `PERF_CONTENT_TYPES` would leak its schema into k6 scenarios. Sweep flow
// (Task 13+) always resets first; ad hoc callers must do the same.
export async function seedPerfData(opts: SeedExecOptions): Promise<void> {
  const authorCount = opts.authorCount ?? 50;
  const seed = opts.seed ?? 1;
  const { prisma } = opts;

  // 1. Ensure content types exist (idempotent — upsert by identifier).
  // Depends on PERF_CONTENT_TYPES ordering: PerfAuthor must be inserted
  // before PerfArticle so resolveFieldOptions can map the RELATION target
  // identifier to a real UUID.
  const typeIds = new Map<string, string>();
  for (const ct of PERF_CONTENT_TYPES) {
    const existing = await prisma.contentType.findUnique({
      where: { identifier: ct.identifier },
      include: { fields: true },
    });
    if (existing) {
      typeIds.set(ct.identifier, existing.id);
      continue;
    }
    const created = await prisma.contentType.create({
      data: {
        identifier: ct.identifier,
        name: ct.name,
        description: ct.description,
        fields: {
          create: ct.fields.map((f, order) => ({
            identifier: f.identifier,
            name: f.name,
            type: f.type,
            required: f.required ?? false,
            unique:
              f.type === 'ENTRY_TITLE' ||
              f.type === 'SLUG' ||
              f.identifier === 'slug',
            order,
            options: resolveFieldOptions(f, typeIds),
          })),
        },
      },
    });
    typeIds.set(ct.identifier, created.id);
  }

  const authorTypeId = typeIds.get('PerfAuthor')!;
  const articleTypeId = typeIds.get('PerfArticle')!;

  const rows = buildSeedRows({
    articleCount: opts.articleCount,
    authorCount,
    seed,
  });

  // 2. Insert authors — envelope + published version.
  const authorEntryIds: string[] = [];
  for (const a of rows.authors) {
    const entry = await prisma.contentEntry.create({
      data: {
        id: randomUUID(),
        contentTypeId: authorTypeId,
        entryTitle: a.entryTitle,
        versions: {
          create: {
            id: randomUUID(),
            status: 'PUBLISHED',
            entryTitle: a.entryTitle,
            data: a.data as object,
            publishedAt: new Date(),
          },
        },
      },
    });
    authorEntryIds.push(entry.id);
  }

  // 3. Insert articles in batches via createMany (envelope), then
  //    createMany for their PUBLISHED versions. ~4× faster than per-row creates.
  const BATCH = 500;
  for (let start = 0; start < rows.articles.length; start += BATCH) {
    const slice = rows.articles.slice(start, start + BATCH);
    const envelopeIds = slice.map(() => randomUUID());
    await prisma.contentEntry.createMany({
      data: slice.map((art, j) => ({
        id: envelopeIds[j]!,
        contentTypeId: articleTypeId,
        entryTitle: art.entryTitle,
        slug: art.slug,
      })),
    });
    await prisma.contentEntryVersion.createMany({
      data: slice.map((art, j) => ({
        id: randomUUID(),
        entryId: envelopeIds[j]!,
        status: 'PUBLISHED',
        entryTitle: art.entryTitle,
        data: {
          ...art.data,
          author: {
            contentTypeIdentifier: 'PerfAuthor',
            entryId: authorEntryIds[art.authorIndex]!,
          },
        } as object,
        publishedAt: new Date(),
      })),
    });
  }
}

function resolveFieldOptions(
  f: (typeof PERF_CONTENT_TYPES)[number]['fields'][number],
  typeIds: Map<string, string>
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const opts = f.options;
  if (!opts) return Prisma.JsonNull;
  const targets = (opts as { targetContentTypeIdentifiers?: string[] })
    .targetContentTypeIdentifiers;
  if (!targets) return opts as Prisma.InputJsonValue;
  const targetContentTypeIds = targets
    .map((ident) => typeIds.get(ident))
    .filter((id): id is string => Boolean(id));
  return { targetContentTypeIds };
}

// CLI entry — pathToFileURL handles symlinks, spaces in paths, and
// platform path separators. The naked `file://${argv[1]}` form silently
// no-ops in those cases.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values } = parseArgs({
    options: {
      size: { type: 'string', default: '10000' },
      'no-reset': { type: 'boolean', default: false },
    },
  });
  const articleCount = Number(values.size);
  if (!Number.isFinite(articleCount) || articleCount < 1) {
    console.error(`Invalid --size: ${values.size}`);
    process.exit(1);
  }

  const cfg = loadNodeConfig();

  // Reset by default — the perf DB is disposable, and resetPerfDb already
  // refuses any URL that doesn't end in /boject_perf, so this is safe. Pass
  // --no-reset to layer on top of an existing dataset.
  if (!values['no-reset']) {
    const pg = new Client({ connectionString: cfg.perfDatabaseUrl });
    await pg.connect();
    try {
      await resetPerfDb({
        databaseUrl: cfg.perfDatabaseUrl,
        runQuery: async (sql) => {
          await pg.query(sql);
        },
      });
      console.log(`[perf:seed] reset ${cfg.perfDatabaseUrl}`);
    } finally {
      await pg.end();
    }
  }

  // Prisma v7 with driver adapters requires PrismaPg (see CLAUDE.md).
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const adapter = new PrismaPg({ connectionString: cfg.perfDatabaseUrl });
  const prisma = new PrismaClient({ adapter });

  const started = Date.now();
  try {
    // Make sure the admin user (rest-crud-cycle session login) and perf API
    // key (sitemap/flat scenarios) exist before the workload kicks off.
    // Both upserts are idempotent.
    await ensurePerfDbBootstrap({
      prisma,
      adminEmail: cfg.adminEmail,
      adminPassword: cfg.adminPassword,
    });

    await seedPerfData({ prisma, articleCount });
    console.log(
      `[perf:seed] inserted ${articleCount} articles in ${(
        (Date.now() - started) /
        1000
      ).toFixed(1)}s`
    );
  } finally {
    await prisma.$disconnect();
  }
}
