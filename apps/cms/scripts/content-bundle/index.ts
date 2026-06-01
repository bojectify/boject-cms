import 'dotenv/config';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { applySchema } from './applySchema';
import {
  DEFAULT_ASSET_CAPS,
  assertAssetsComplete,
  buildImageFieldsFromContentTypes,
  collectImageStorageKeys,
  createBundleStorage,
  exportAssets,
  importAssets,
  listAssetKeys,
  type AssetCaps,
  type ImageFieldsByType,
} from './assets';
import { exportBundle } from './export';
import { importBundle } from './import';
import { validateBundle } from './validate';
import type { Bundle, BundleMode, OnConflict } from './types';
import { ON_CONFLICT_VALUES } from './types';

const DEFAULT_OUT_DIR = './generated';

const HELP = `content-bundle — dynamic content types & entries as JSON bundles

Usage:
  pnpm content:export   [--schema|--entries|--all] [--portable]
                        [--out <path>] [--no-assets]
                        [--max-asset-size <MB>] [--max-bundle-size <MB>]
  pnpm content:import   <path> [--schema|--entries|--all] [--author <s>]
                              [--on-conflict <fail|skip|replace>] [--dry-run]
                              [--apply [--allow-destructive]]
  pnpm content:validate <path>

Commands:
  export     Export content types and/or entries to a JSON bundle.
             Defaults to ./generated/content-bundle-<mode>.json.
  import     Import a JSON bundle into the CMS.
  validate   Validate a JSON bundle's shape without touching the DB.

Flags:
  --schema       Only content types (default for export)
  --entries      Only entries
  --all          Both content types and entries
  --portable     Rewrite UUID references to identifier/slug keys (export only)
  --out <path>   Write export to a custom path
  --no-assets    With a directory --out, write bundle.json only (no asset
                 bytes). Use when source and target share one storage bucket.
  --max-asset-size <MB>   Per-asset size cap (default 25).
  --max-bundle-size <MB>  Per-bundle total asset cap (default 1024).
  --author <s>   Attribute imported entries to this user (import only)
  --apply        Apply schema diff idempotently via applySchema (import --schema only)
  --allow-destructive
                 With --apply, allow content-type and field removals
  --on-conflict <m>
                 Entry-collision behaviour (default: fail). skip leaves the
                 existing entry alone; replace wholesale-overwrites it
                 (preserves id + entryKey + createdAt).
  --dry-run      Run the import planner, print the would-do counts, do not
                 write. Conflicts with --apply.
  --help, -h     Show this help message

Examples:
  pnpm content:export --all --portable
  pnpm content:export --entries --out ./generated/entries.json
  pnpm content:export --all --out ./my-bundle/        # bundle.json + assets/
  pnpm content:import ./generated/content-bundle-all.json --all
  pnpm content:import ./my-bundle/                    # restores entries + bytes
  pnpm content:validate ./starters/base.boject.json
`;

function parseMode(
  args: string[],
  hasDefault: BundleMode | null = 'schema'
): BundleMode {
  if (args.includes('--all')) return 'all';
  if (args.includes('--entries')) return 'entries';
  if (args.includes('--schema')) return 'schema';
  if (hasDefault) return hasDefault;
  throw new Error('Missing --schema, --entries, or --all');
}

function flagValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function wantsHelp(args: string[]): boolean {
  return args.includes('--help') || args.includes('-h');
}

function writeBundle(out: string, bundle: unknown) {
  const abs = resolve(out);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(bundle, null, 2));
}

const MB = 1024 * 1024;

/** A directory target = trailing slash, or an existing directory. */
function isDirectoryTarget(out: string): boolean {
  if (out.endsWith('/')) return true;
  try {
    return statSync(out).isDirectory();
  } catch {
    return false;
  }
}

function parseCaps(args: string[]): AssetCaps {
  const asset = flagValue(args, '--max-asset-size');
  const bundle = flagValue(args, '--max-bundle-size');
  return {
    perAsset: asset ? Number(asset) * MB : DEFAULT_ASSET_CAPS.perAsset,
    perBundle: bundle ? Number(bundle) * MB : DEFAULT_ASSET_CAPS.perBundle,
  };
}

/** Build the IMAGE-field map straight from the DB (mode-independent). */
async function imageFieldsFromDb(
  prisma: import('#prisma').PrismaClient
): Promise<ImageFieldsByType> {
  const cts = await prisma.contentType.findMany({ include: { fields: true } });
  return buildImageFieldsFromContentTypes(cts);
}

/**
 * Resolve an import source into the bundle JSON path + optional assets dir.
 * A directory source reads `<dir>/bundle.json`; a `.json` file reads directly
 * (references-only, status quo).
 */
function resolveImportSource(path: string): {
  bundlePath: string;
  assetsDir: string | null;
} {
  const abs = resolve(path);
  let isDir = false;
  try {
    isDir = statSync(abs).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) return { bundlePath: abs, assetsDir: null };
  const assetsDir = join(abs, 'assets');
  return {
    bundlePath: join(abs, 'bundle.json'),
    assetsDir: existsSync(assetsDir) ? assetsDir : null,
  };
}

/**
 * Restore sidecar asset bytes into storage before the DB import. Builds the
 * IMAGE-field map from the bundle's own contentTypes unioned with the target
 * DB's (so entries-only bundles are covered), verifies completeness, then
 * writes bytes (skip-if-exists). Dry-run logs the present count without
 * writing.
 */
async function restoreAssets(
  prisma: import('#prisma').PrismaClient,
  bundle: Bundle,
  assetsDir: string,
  opts: { dryRun: boolean }
): Promise<void> {
  if (opts.dryRun) {
    console.log(
      `Assets: ${listAssetKeys(assetsDir).length} present (not written — dry run).`
    );
    return;
  }
  const presentKeys = new Set(listAssetKeys(assetsDir));
  const imageFields = buildImageFieldsFromContentTypes(
    bundle.contentTypes ?? []
  );
  // Union the target DB's IMAGE fields so entries-only bundles (no
  // contentTypes) are still covered.
  for (const [identifier, fields] of await imageFieldsFromDb(prisma)) {
    const existing = imageFields.get(identifier);
    if (existing) for (const f of fields) existing.add(f);
    else imageFields.set(identifier, new Set(fields));
  }
  const referenced = collectImageStorageKeys(bundle, imageFields);
  assertAssetsComplete(referenced, presentKeys);
  const storage = createBundleStorage();
  const { written, skipped } = await importAssets({ storage, assetsDir });
  console.log(`Assets: ${written} written, ${skipped} skipped.`);
}

// Each branch follows process.exit() with `return` so tests that mock
// process.exit don't fall through to the next branch.
export async function runCli(argv: string[]): Promise<void> {
  const [command, ...args] = argv;

  if (!command || command === 'help' || wantsHelp([command ?? ''])) {
    console.log(HELP);
    process.exit(0);
    return;
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  try {
    if (command === 'export') {
      if (wantsHelp(args)) {
        console.log(HELP);
        process.exit(0);
        return;
      }
      const mode = parseMode(args, 'schema');
      const portable = args.includes('--portable');
      const noAssets = args.includes('--no-assets');
      const out =
        flagValue(args, '--out') ??
        `${DEFAULT_OUT_DIR}/content-bundle${mode === 'all' ? '' : `-${mode}`}.json`;

      const bundle = await exportBundle(prisma, { mode, portable });

      const dirTarget = isDirectoryTarget(out);
      if (dirTarget && !noAssets) {
        const dir = resolve(out);
        const imageFields = await imageFieldsFromDb(prisma);
        const storageKeys = collectImageStorageKeys(bundle, imageFields);
        const storage = createBundleStorage();
        const { count, totalBytes } = await exportAssets({
          storage,
          storageKeys,
          assetsDir: resolve(dir, 'assets'),
          caps: parseCaps(args),
        });
        writeBundle(resolve(dir, 'bundle.json'), bundle);
        console.log(
          `Wrote bundle to ${dir}/bundle.json with ${count} asset(s) ` +
            `(${totalBytes} bytes) in ${dir}/assets/`
        );
      } else {
        const target = dirTarget ? resolve(out, 'bundle.json') : out;
        writeBundle(target, bundle);
        console.log(`Wrote bundle to ${target}`);
      }
      process.exit(0);
      return;
    }

    if (command === 'import') {
      if (wantsHelp(args)) {
        console.log(HELP);
        process.exit(0);
        return;
      }
      const path = args[0];
      if (!path) throw new Error('Usage: content-bundle import <path>');
      const { bundlePath, assetsDir } = resolveImportSource(path);
      const raw = readFileSync(bundlePath, 'utf8');
      const bundle = JSON.parse(raw);
      const defaultMode: BundleMode =
        bundle.contentTypes && bundle.entries
          ? 'all'
          : bundle.entries
            ? 'entries'
            : 'schema';
      const mode = parseMode(args.slice(1), defaultMode);
      const apply = args.includes('--apply');
      const dryRun = args.includes('--dry-run');
      const onConflictRaw = flagValue(args, '--on-conflict');
      if (
        onConflictRaw !== undefined &&
        !(ON_CONFLICT_VALUES as readonly string[]).includes(onConflictRaw)
      ) {
        console.error(
          `Invalid --on-conflict value "${onConflictRaw}". Expected one of: ${ON_CONFLICT_VALUES.join(', ')}.`
        );
        process.exit(2);
        return;
      }
      const onConflict: OnConflict =
        (onConflictRaw as OnConflict | undefined) ?? 'fail';

      if (apply && (onConflictRaw !== undefined || dryRun)) {
        console.error(
          `--on-conflict and --dry-run are not valid with --apply. --apply uses applySchema's own idempotent diff.`
        );
        process.exit(2);
        return;
      }

      if (apply && mode !== 'schema') {
        console.error(`--apply is only valid with --schema. Got mode=${mode}.`);
        process.exit(2);
        return;
      }

      if (apply) {
        const allowDestructive = args.includes('--allow-destructive');
        const result = await applySchema(prisma, bundle, { allowDestructive });
        if (result.changed) {
          console.log(
            `Applied: ${result.applied.contentTypesCreated} type(s) created, ` +
              `${result.applied.contentTypesUpdated} updated, ` +
              `${result.applied.contentTypesRemoved} removed; ` +
              `${result.applied.fieldsCreated} field(s) created, ` +
              `${result.applied.fieldsUpdated} updated, ` +
              `${result.applied.fieldsRemoved} removed.`
          );
        } else {
          console.log('No-op (schema already matches bundle).');
        }
        process.exit(0);
        return;
      }

      // Restore asset bytes before the DB import. Storage writes are not
      // transactional with Prisma, so writing first means a DB rollback
      // leaves only unreferenced blobs (harmless, idempotent) rather than
      // entries pointing at missing bytes.
      if (assetsDir) {
        await restoreAssets(prisma, bundle, assetsDir, { dryRun });
      }

      const author = flagValue(args, '--author');
      const result = await importBundle(prisma, bundle, {
        mode,
        author,
        onConflict,
        dryRun,
      });
      const verb = dryRun ? 'Would import' : 'Imported';
      console.log(
        `${verb} ${result.contentTypesCreated} content type(s); ` +
          `${result.entriesCreated} entries created, ` +
          `${result.entriesUpdated} updated, ` +
          `${result.entriesSkipped} skipped.`
      );
      process.exit(0);
      return;
    }

    if (command === 'validate') {
      if (wantsHelp(args)) {
        console.log(HELP);
        process.exit(0);
        return;
      }
      const path = args[0];
      if (!path) throw new Error('Usage: content-bundle validate <path>');
      const { bundlePath, assetsDir } = resolveImportSource(path);
      const raw = readFileSync(bundlePath, 'utf8');
      const bundle = JSON.parse(raw);
      const result = validateBundle(bundle);
      if (!result.ok) {
        console.error('Bundle failed validation:');
        for (const err of result.errors) {
          console.error(`  ${err.path}: ${err.message}`);
        }
        process.exit(1);
        return;
      }

      // Offline asset completeness — only possible when the bundle carries
      // contentTypes (so we know which fields are IMAGE). Entries-only bundles
      // can't be checked without a DB; report and skip.
      if (assetsDir) {
        if (bundle.contentTypes) {
          const imageFields = buildImageFieldsFromContentTypes(
            bundle.contentTypes
          );
          const referenced = collectImageStorageKeys(bundle, imageFields);
          const present = new Set(listAssetKeys(assetsDir));
          try {
            assertAssetsComplete(referenced, present);
            console.log(
              `Bundle is valid (${referenced.length} asset(s) present).`
            );
          } catch (e) {
            console.error(e instanceof Error ? e.message : String(e));
            process.exit(1);
            return;
          }
        } else {
          console.log(
            'Bundle is valid (entries-only: asset completeness not checked offline).'
          );
        }
      } else {
        console.log('Bundle is valid');
      }
      process.exit(0);
      return;
    }

    console.error(
      `Unknown command "${command}". Run with --help to see usage.`
    );
    process.exit(1);
    return;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
    return;
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  await runCli(process.argv.slice(2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
