/**
 * Gate a destructive operation behind a TTY prompt unless `yes` is set.
 *
 * Behaviour:
 *   - `yes: true`   → always confirm (CI mode)
 *   - `isTty: false` → always confirm (non-interactive CI without --yes)
 *   - `isTty: true`  → prompt; only "yes" (case-insensitive) confirms
 */
export interface ConfirmResetOptions {
  databaseUrl: string;
  yes: boolean;
  readLine?: () => Promise<string>;
  isTty?: boolean;
}

export async function confirmReset(
  opts: ConfirmResetOptions
): Promise<boolean> {
  if (opts.yes) return true;
  const isTty = opts.isTty ?? process.stdin.isTTY === true;
  if (!isTty) return true; // CI mode: assume confirmed
  const url = redactCredentials(opts.databaseUrl);
  process.stderr.write(
    `About to TRUNCATE ALL content entries (not just perf-seeded rows) in ${url}. Type "yes" to proceed: `
  );
  const answer = (await (opts.readLine ?? readStdinLine)())
    .trim()
    .toLowerCase();
  return answer === 'yes';
}

function redactCredentials(url: string): string {
  return url.replace(/\/\/[^@]*@/, '//<redacted>@');
}

async function readStdinLine(): Promise<string> {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (chunk: string) => {
      process.stdin.pause();
      resolve(chunk);
    });
  });
}
