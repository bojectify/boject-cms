export const SEED_DUPLICATE_THRESHOLD = 0.5;

export class SeedMostlyDuplicateError extends Error {
  constructor(
    public inserted: number,
    public skipped: number,
    public total: number
  ) {
    const pct = Math.round((skipped / total) * 100);
    super(
      `Seed step skipped ${skipped} of ${total} entries (${pct}%) due to ` +
        `uniqueness conflicts. ` +
        `This likely means the target DB already contains entries with these titles/slugs. ` +
        `Pass --seed <n> for a different deterministic set, or reset the target DB first ` +
        `(SQL: \`boject perf reset --database-url <url>\`; HTTP: no equivalent yet — see #184).`
    );
    this.name = 'SeedMostlyDuplicateError';
  }
}
