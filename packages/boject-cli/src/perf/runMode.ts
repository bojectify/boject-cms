export type RunMode = 'seed-direct' | 'seed-http' | 'read-only';

export interface RunModeFlags {
  readOnly?: boolean;
  httpSeed?: boolean;
  databaseUrl?: string;
}

/**
 * Derive the run's mode from already-validated CLI flags.
 *
 * Pre-flight (scenario.ts:204 / sweep.ts:131) enforces "exactly one of
 * readOnly | databaseUrl | httpSeed". This function does not re-validate;
 * it is a flat switch.
 */
export function deriveMode(flags: RunModeFlags): RunMode {
  if (flags.readOnly) return 'read-only';
  if (flags.httpSeed) return 'seed-http';
  return 'seed-direct';
}
