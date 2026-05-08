import { assertAllowedDatabase } from './allowedDatabase.js';

/**
 * Truncates the perf-specific entry tables in the target database.
 * Refuses any URL whose database name doesn't end in `_perf` or
 * `_staging` (or appear in `allowDatabase`) — defence against
 * accidentally truncating production content.
 *
 * Data-only reset: truncates ContentEntryVersion + ContentEntry, but
 * preserves ContentType + ContentTypeField rows so a subsequent seed
 * run does not need to re-apply schema. Operators who want to wipe
 * the schema entirely should use `boject schema apply` against an
 * empty bundle (or run prisma migrate reset on the perf DB).
 *
 * Order matches FK dependencies: child rows first, parents last. CASCADE
 * means the order isn't strictly required for correctness, but it's
 * belt-and-braces against subtle FK timing issues.
 */
export async function resetPerfDb(opts: {
  databaseUrl: string;
  runQuery: (sql: string) => Promise<void>;
  allowDatabase?: string[];
}): Promise<void> {
  assertAllowedDatabase(opts.databaseUrl, opts.allowDatabase ?? []);
  await opts.runQuery(
    `TRUNCATE TABLE "ContentEntryVersion" RESTART IDENTITY CASCADE`
  );
  await opts.runQuery(`TRUNCATE TABLE "ContentEntry" RESTART IDENTITY CASCADE`);
}
