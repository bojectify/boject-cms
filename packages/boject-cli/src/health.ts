export interface PollHealthOptions {
  timeoutMs: number;
  intervalMs: number;
}

export async function pollHealth(
  url: string,
  { timeoutMs, intervalMs }: PollHealthOptions
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // connection refused / DNS flake while container still booting
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Health check at ${url} timed out after ${timeoutMs}ms`);
}
