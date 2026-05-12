export type RunMode = 'seed-direct' | 'read-only';

export interface RunModeFlags {
  readOnly?: boolean;
  databaseUrl?: string;
}

/**
 * Derive the run's mode from already-validated CLI flags.
 *
 * Pre-flight (scenario.ts / sweep.ts) enforces "exactly one of
 * readOnly | databaseUrl". This function does not re-validate;
 * it is a flat switch.
 */
export function deriveMode(flags: RunModeFlags): RunMode {
  if (flags.readOnly) return 'read-only';
  return 'seed-direct';
}
