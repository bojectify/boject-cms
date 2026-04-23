export const MAX_ATTEMPTS = 6;

const SCHEDULE_MS = [
  1_000, // 1s
  10_000, // 10s
  60_000, // 1m
  600_000, // 10m
  3_600_000, // 1h
  21_600_000, // 6h
];

/**
 * Milliseconds to wait before attempt N (1-indexed). Returns null when
 * attempts has exceeded MAX_ATTEMPTS — caller should dead-letter.
 */
export function backoffMs(attempts: number): number | null {
  if (attempts < 1 || attempts > MAX_ATTEMPTS) return null;
  return SCHEDULE_MS[attempts - 1]!;
}
