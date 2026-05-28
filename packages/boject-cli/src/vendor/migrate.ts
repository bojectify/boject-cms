// VENDORED from apps/cms/scripts/content-bundle/migrate.ts.
// The CLI is published standalone and cannot import from apps/cms/.
// Keep this file in sync when the canonical version changes.

import { BUNDLE_VERSION } from './contentBundleTypes.js';
import type { Bundle } from './contentBundleTypes.js';

export interface Migration {
  from: number;
  to: number;
  apply: (bundle: Bundle) => Bundle;
}

// Append-only. Each entry takes a bundle at version `from` and returns
// a bundle at version `to`. Migrations stay forever — they're pure,
// only invoked on demand by `boject bundle migrate`.
export const MIGRATIONS: Migration[] = [];

export class BundleMigrationError extends Error {
  constructor(
    message: string,
    readonly fromVersion: number,
    readonly toVersion: number
  ) {
    super(message);
    this.name = 'BundleMigrationError';
  }
}

/**
 * Walk a bundle through registered migrations until it reaches the current
 * target version. Pure function. The optional `target` and `migrations`
 * parameters exist for testing — production callers pass only the bundle.
 */
export function migrate(
  bundle: Bundle,
  target: number = BUNDLE_VERSION,
  migrations: Migration[] = MIGRATIONS
): Bundle {
  if (bundle.version === target) return bundle;
  if (bundle.version > target) {
    throw new BundleMigrationError(
      `bundle version ${bundle.version} is newer than this CLI supports (${target}); upgrade the CLI`,
      bundle.version,
      target
    );
  }
  let current = bundle;
  while (current.version < target) {
    const step = migrations.find((m) => m.from === current.version);
    if (!step) {
      throw new BundleMigrationError(
        `no migration registered from version ${current.version}`,
        current.version,
        target
      );
    }
    current = step.apply(current);
    if (current.version !== step.to) {
      throw new BundleMigrationError(
        `migration ${step.from}→${step.to} produced version ${current.version}`,
        step.from,
        step.to
      );
    }
  }
  return current;
}
