import { readFile, writeFile } from 'node:fs/promises';
import {
  migrate,
  BundleMigrationError,
  MIGRATIONS as DEFAULT_MIGRATIONS,
  type Migration,
} from '../../vendor/migrate.js';
import { BUNDLE_VERSION } from '../../vendor/contentBundleTypes.js';
import type { Bundle } from '../../vendor/contentBundleTypes.js';

export interface BundleMigrateFlags {
  dryRun?: boolean;
}

export interface BundleMigrateParams {
  path: string;
  flags?: BundleMigrateFlags;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  /** Internal test hook — not part of the public CLI surface. */
  _testHook?: { migrations?: Migration[] };
}

export interface BundleMigrateResult {
  exitCode: 0 | 1;
}

export async function runBundleMigrate(
  params: BundleMigrateParams
): Promise<BundleMigrateResult> {
  const flags = params.flags ?? {};
  const migrations = params._testHook?.migrations ?? DEFAULT_MIGRATIONS;

  let raw: string;
  try {
    raw = await readFile(params.path, 'utf8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    params.stderr(`Could not read ${params.path}: ${msg}`);
    return { exitCode: 1 };
  }

  let bundle: Bundle;
  try {
    bundle = JSON.parse(raw) as Bundle;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    params.stderr(`Could not parse JSON in ${params.path}: ${msg}`);
    return { exitCode: 1 };
  }

  if (bundle.version === BUNDLE_VERSION) {
    params.stdout(`already at version ${BUNDLE_VERSION}, nothing to do`);
    return { exitCode: 0 };
  }

  let migrated: Bundle;
  try {
    migrated = migrate(bundle, BUNDLE_VERSION, migrations);
  } catch (e) {
    if (e instanceof BundleMigrationError) {
      params.stderr(e.message);
      return { exitCode: 1 };
    }
    throw e;
  }

  const fromVersion = bundle.version;

  if (flags.dryRun) {
    params.stdout(`would migrate v${fromVersion} → v${BUNDLE_VERSION}`);
    return { exitCode: 0 };
  }

  const output = JSON.stringify(migrated, null, 2) + '\n';
  await writeFile(params.path, output, 'utf8');
  params.stdout(`migrated v${fromVersion} → v${BUNDLE_VERSION}`);
  return { exitCode: 0 };
}
