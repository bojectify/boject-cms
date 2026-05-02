// apps/cms/scripts/docker-entrypoint/apply-schema.ts
//
// Every-boot schema apply. Reads each *.boject.json file in
// BOJECT_SCHEMA_DIR (alphabetical order), runs the Spec 3 applier
// against each, and aggregates per-file results into a grand total.
//
// Lifecycle distinction:
// - import-starter.ts runs ONCE on first boot when ContentType is empty;
//   it imports both schema and entries (e.g. SiteSettings seed).
// - apply-schema.ts (this file) runs on EVERY boot, idempotent,
//   schema-only, and is gated by the planner refusing destructive ops
//   without BOJECT_ALLOW_DESTRUCTIVE_SCHEMA=true.

import type { PrismaClient } from '../../generated/prisma/client';
import type {
  ApplySchemaOptions,
  ApplySchemaResult,
} from '../content-bundle/applySchema';
import { SchemaApplyBlockedError } from '../content-bundle/applySchemaErrors';
import type { Bundle } from '../content-bundle/types';

export type ApplySchemaFn = (
  prisma: PrismaClient,
  bundle: Bundle,
  options?: ApplySchemaOptions
) => Promise<ApplySchemaResult>;

export interface ApplySchemaLogger {
  info: (msg: string) => void;
  error: (msg: string) => void;
}

export interface ApplySchemaIfConfiguredInput {
  /** Bundle directory path. Undefined = env var unset = skip. */
  dirPath: string | undefined;
  /** Forwarded to each applySchema call. */
  allowDestructive: boolean;
  /** Injected applier (real applySchema in production, mock in tests). */
  applySchemaFn: ApplySchemaFn;
  /** Directory listing (defaults to fs.readdir). */
  readDir: (path: string) => Promise<string[]>;
  /** File read (defaults to fs.readFile UTF-8). */
  readFile: (path: string) => Promise<string>;
  /** Logger surface; production uses console. */
  logger: ApplySchemaLogger;
}

export interface ApplySchemaIfConfiguredResult {
  applied: boolean;
  reason: 'no-dir' | 'no-bundles' | 'applied';
  files: number;
  totalChanges: number;
}

export async function applySchemaIfConfigured(
  prisma: PrismaClient,
  input: ApplySchemaIfConfiguredInput
): Promise<ApplySchemaIfConfiguredResult> {
  if (!input.dirPath) {
    input.logger.info('[apply-schema] BOJECT_SCHEMA_DIR not set — skipping');
    return { applied: false, reason: 'no-dir', files: 0, totalChanges: 0 };
  }

  input.logger.info(`[apply-schema] BOJECT_SCHEMA_DIR=${input.dirPath}`);

  const entries = await input.readDir(input.dirPath);
  const bundles = entries
    .filter((name) => name.endsWith('.boject.json'))
    .sort();

  if (bundles.length === 0) {
    input.logger.info(
      `[apply-schema] no .boject.json files in ${input.dirPath} — skipping`
    );
    return { applied: false, reason: 'no-bundles', files: 0, totalChanges: 0 };
  }

  input.logger.info(
    `[apply-schema] reading ${bundles.length} ${bundles.length === 1 ? 'file' : 'files'}: ${bundles.join(', ')}`
  );

  let totalChanges = 0;
  for (const name of bundles) {
    const fullPath = `${input.dirPath}/${name}`;
    const raw = await input.readFile(fullPath);
    const bundle = JSON.parse(raw) as Bundle;
    let result: ApplySchemaResult;
    try {
      result = await input.applySchemaFn(prisma, bundle, {
        allowDestructive: input.allowDestructive,
      });
    } catch (err) {
      if (err instanceof SchemaApplyBlockedError) {
        input.logger.error(`[apply-schema] ${name}: BLOCKED`);
        for (const b of err.blockers) {
          input.logger.error(`  - ${b.code} at ${b.path}: ${b.message}`);
        }
      } else {
        input.logger.error(
          `[apply-schema] ${name}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      throw err;
    }
    totalChanges += sumApplied(result.applied);
    if (result.changed) {
      const created =
        result.applied.contentTypesCreated + result.applied.fieldsCreated;
      const updated =
        result.applied.contentTypesUpdated + result.applied.fieldsUpdated;
      const removed =
        result.applied.contentTypesRemoved + result.applied.fieldsRemoved;
      input.logger.info(
        `[apply-schema] ${name}: ${created} created, ${updated} updated, ${removed} removed`
      );
    } else {
      input.logger.info(`[apply-schema] ${name}: (no-op)`);
    }
  }

  input.logger.info(
    `[apply-schema] done — ${bundles.length} ${bundles.length === 1 ? 'file' : 'files'} applied, ${totalChanges} total changes`
  );

  return {
    applied: true,
    reason: 'applied',
    files: bundles.length,
    totalChanges,
  };
}

function sumApplied(applied: ApplySchemaResult['applied']): number {
  return (
    applied.contentTypesCreated +
    applied.contentTypesUpdated +
    applied.contentTypesRemoved +
    applied.fieldsCreated +
    applied.fieldsUpdated +
    applied.fieldsRemoved
  );
}
