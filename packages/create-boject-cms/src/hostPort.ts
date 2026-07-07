export const DEFAULT_HOST_PORT = 4000;

/**
 * Resolve the host port the scaffolded CMS is published on, from the optional
 * `--port` flag. Defaults to {@link DEFAULT_HOST_PORT}; throws on a non-integer
 * or out-of-range value.
 */
export function resolveHostPort(flag: string | undefined): number {
  if (flag === undefined) {
    return DEFAULT_HOST_PORT;
  }
  const port = Number(flag);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid --port "${flag}": expected an integer between 1 and 65535.`
    );
  }
  return port;
}
