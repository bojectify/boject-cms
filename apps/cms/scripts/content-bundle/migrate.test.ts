import { describe, expect, it } from 'vitest';
import { migrate, BundleMigrationError, type Migration } from './migrate';
import { BUNDLE_VERSION } from './types';
import type { Bundle } from './types';

function makeBundle(version: number): Bundle {
  return {
    version,
    exportedAt: '2026-05-28T00:00:00.000Z',
    portable: false,
  };
}

describe('migrate', () => {
  it('returns the input unchanged when version matches the current target', () => {
    const bundle = makeBundle(BUNDLE_VERSION);
    expect(migrate(bundle)).toBe(bundle);
  });

  it('throws BundleMigrationError when the bundle is newer than supported', () => {
    const bundle = makeBundle(BUNDLE_VERSION + 1);
    expect(() => migrate(bundle)).toThrow(BundleMigrationError);
    try {
      migrate(bundle);
    } catch (e) {
      expect(e).toBeInstanceOf(BundleMigrationError);
      const err = e as BundleMigrationError;
      expect(err.fromVersion).toBe(BUNDLE_VERSION + 1);
      expect(err.toVersion).toBe(BUNDLE_VERSION);
      expect(err.message).toMatch(/newer than this CLI supports/);
    }
  });

  it('walks each registered migration in order from the bundle version up to target', () => {
    const calls: Array<{ from: number; to: number }> = [];
    const migrations: Migration[] = [
      {
        from: 1,
        to: 2,
        apply: (b) => {
          calls.push({ from: 1, to: 2 });
          return { ...b, version: 2 };
        },
      },
      {
        from: 2,
        to: 3,
        apply: (b) => {
          calls.push({ from: 2, to: 3 });
          return { ...b, version: 3 };
        },
      },
    ];
    const result = migrate(makeBundle(1), 3, migrations);
    expect(calls).toEqual([
      { from: 1, to: 2 },
      { from: 2, to: 3 },
    ]);
    expect(result.version).toBe(3);
  });

  it('throws when no migration is registered for the current step', () => {
    const migrations: Migration[] = [
      { from: 1, to: 2, apply: (b) => ({ ...b, version: 2 }) },
      // Missing from: 2
    ];
    expect(() => migrate(makeBundle(1), 3, migrations)).toThrow(
      /no migration registered from version 2/
    );
  });

  it('throws when a migration apply produces a version that does not match its declared `to`', () => {
    const migrations: Migration[] = [
      {
        from: 1,
        to: 2,
        apply: (b) => ({ ...b, version: 99 }), // wrong
      },
    ];
    expect(() => migrate(makeBundle(1), 2, migrations)).toThrow(
      /migration 1→2 produced version 99/
    );
  });
});
