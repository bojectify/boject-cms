/**
 * Strip userinfo (user:pass@) from a URL. Used before logging or
 * writing the target host into metadata.json.
 *
 * Returns the input unchanged if it cannot be parsed as a URL — we
 * never crash a perf run on a logging path.
 */
export function sanitiseUrl(input: string): string {
  try {
    const u = new URL(input);
    u.username = '';
    u.password = '';
    return u.toString();
  } catch {
    return input;
  }
}

/**
 * Replace any literal occurrence of `apiKey` in `line` with `[REDACTED]`.
 *
 * We don't try to be clever about boundaries — k6 logs are
 * unstructured and the api key is high-entropy, so a literal-string
 * replace is both safe and complete.
 */
export function sanitiseLogLine(line: string, apiKey: string): string {
  if (!apiKey) return line;
  return line.split(apiKey).join('[REDACTED]');
}
