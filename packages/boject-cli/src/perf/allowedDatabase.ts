export class DisallowedDatabaseError extends Error {
  constructor(
    public databaseUrl: string,
    public dbName: string
  ) {
    super(
      `Refusing to operate on database "${dbName}" (${redact(databaseUrl)}): ` +
        `name must end in "_perf" or "_staging". ` +
        `Pass --allow-database ${dbName} to override.`
    );
    this.name = 'DisallowedDatabaseError';
  }
}

export class UnparseableDatabaseUrlError extends Error {
  constructor(public databaseUrl: string) {
    super(
      `Could not parse database name from URL (${redact(databaseUrl)}): ` +
        `expected a connection string of the form ` +
        `postgres://user:pass@host/<dbname>.`
    );
    this.name = 'UnparseableDatabaseUrlError';
  }
}

export function extractDatabaseName(databaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new UnparseableDatabaseUrlError(databaseUrl);
  }
  const name = url.pathname.replace(/^\//, '');
  if (!name) throw new UnparseableDatabaseUrlError(databaseUrl);
  return name;
}

export function assertAllowedDatabase(
  databaseUrl: string,
  allowDatabase: string[]
): void {
  const dbName = extractDatabaseName(databaseUrl);
  if (/_perf$/.test(dbName) || /_staging$/.test(dbName)) return;
  if (allowDatabase.includes(dbName)) return;
  throw new DisallowedDatabaseError(databaseUrl, dbName);
}

function redact(url: string): string {
  return url.replace(/\/\/[^@]*@/, '//<redacted>@');
}
