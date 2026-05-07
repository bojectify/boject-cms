export class NonPerfDatabaseError extends Error {
  constructor(public databaseUrl: string) {
    super(
      `Refusing to truncate ${redact(databaseUrl)}: URL does not end in /boject_perf. ` +
        `Pass --allow-non-perf-db to override.`
    );
    this.name = 'NonPerfDatabaseError';
  }
}

/**
 * Truncates the perf-specific entry tables in the target database.
 * Refuses any URL that doesn't end in `/boject_perf` unless
 * `allowNonPerfDb` is set — defence against accidentally truncating
 * production content.
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
  allowNonPerfDb?: boolean;
}): Promise<void> {
  if (!opts.allowNonPerfDb && !/\/boject_perf(\?|$)/.test(opts.databaseUrl)) {
    throw new NonPerfDatabaseError(opts.databaseUrl);
  }
  await opts.runQuery(
    `TRUNCATE TABLE "ContentEntryVersion" RESTART IDENTITY CASCADE`
  );
  await opts.runQuery(`TRUNCATE TABLE "ContentEntry" RESTART IDENTITY CASCADE`);
}

function redact(url: string): string {
  return url.replace(/\/\/[^@]*@/, '//<redacted>@');
}
