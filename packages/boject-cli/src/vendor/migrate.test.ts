import { describe, expect, it } from 'vitest';
import { migrate, BundleMigrationError, type Migration } from './migrate.js';
import { BUNDLE_VERSION } from './contentBundleTypes.js';
import type { Bundle } from './contentBundleTypes.js';

function makeBundle(version: number): Bundle {
  return {
    version,
    exportedAt: '2026-05-28T00:00:00.000Z',
    portable: false,
  };
}

describe('migrate (vendored)', () => {
  it('returns the input unchanged when version matches the target', () => {
    const bundle = makeBundle(BUNDLE_VERSION);
    expect(migrate(bundle)).toBe(bundle);
  });

  it('throws BundleMigrationError when the bundle is newer than supported', () => {
    expect(() => migrate(makeBundle(BUNDLE_VERSION + 1))).toThrow(
      BundleMigrationError
    );
  });

  it('walks each migration in order from bundle version up to target', () => {
    const migrations: Migration[] = [
      { from: 1, to: 2, apply: (b) => ({ ...b, version: 2 }) },
      { from: 2, to: 3, apply: (b) => ({ ...b, version: 3 }) },
    ];
    expect(migrate(makeBundle(1), 3, migrations).version).toBe(3);
  });

  it('throws when no migration is registered for the current step', () => {
    expect(() => migrate(makeBundle(1), 3, [])).toThrow(
      /no migration registered from version 1/
    );
  });

  it('throws when a migration apply produces a version that does not match its declared `to`', () => {
    const migrations: Migration[] = [
      { from: 1, to: 2, apply: (b) => ({ ...b, version: 99 }) },
    ];
    expect(() => migrate(makeBundle(1), 2, migrations)).toThrow(
      /migration 1→2 produced version 99/
    );
  });
});
