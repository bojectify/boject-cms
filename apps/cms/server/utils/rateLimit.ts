interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

const DEFAULT_WINDOW_MS = 60_000; // 60 seconds
const DEFAULT_MAX_REQUESTS = 100;
const CLEANUP_INTERVAL_MS = 300_000; // 5 minutes

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      entry.timestamps = entry.timestamps.filter(
        (t) => now - t < DEFAULT_WINDOW_MS
      );
      if (entry.timestamps.length === 0) {
        store.delete(key);
      }
    }
    if (store.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }, CLEANUP_INTERVAL_MS);
  // Don't prevent process exit
  if (
    cleanupTimer &&
    typeof cleanupTimer === 'object' &&
    'unref' in cleanupTimer
  ) {
    cleanupTimer.unref();
  }
}

export interface RateLimitSnapshot {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  retryAfterMs: number;
}

export function rateLimit(
  key: string,
  maxRequests = DEFAULT_MAX_REQUESTS,
  windowMs = DEFAULT_WINDOW_MS
): RateLimitSnapshot {
  ensureCleanup();

  const now = Date.now();
  let entry = store.get(key);

  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

  if (entry.timestamps.length >= maxRequests) {
    const oldest = entry.timestamps[0]!;
    const retryAfterMs = oldest + windowMs - now;
    return {
      allowed: false,
      limit: maxRequests,
      remaining: 0,
      resetSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      retryAfterMs,
    };
  }

  entry.timestamps.push(now);
  const oldest = entry.timestamps[0]!;
  const resetSeconds =
    entry.timestamps.length === 0
      ? 0
      : Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
  return {
    allowed: true,
    limit: maxRequests,
    remaining: Math.max(0, maxRequests - entry.timestamps.length),
    resetSeconds,
    retryAfterMs: 0,
  };
}

/** Reset rate limit store (for testing) */
export function resetRateLimitStore() {
  store.clear();
}
