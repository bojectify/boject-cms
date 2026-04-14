import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { exportBundle } from './export';
import { importBundle } from './import';
import { validateBundle } from './validate';
import type { BundleMode } from './types';

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

async function main() {
  const [command, ...args] = process.argv.slice(2);

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  try {
    if (command === 'export') {
      const mode = parseMode(args, 'schema');
      const portable = args.includes('--portable');
      const out =
        flagValue(args, '--out') ??
        `./content-bundle${mode === 'all' ? '' : `-${mode}`}.json`;

      const bundle = await exportBundle(prisma, { mode, portable });
      writeFileSync(resolve(out), JSON.stringify(bundle, null, 2));
      console.log(`Wrote bundle to ${out}`);
      process.exit(0);
    }

    if (command === 'import') {
      const path = args[0];
      if (!path) throw new Error('Usage: content-bundle import <path>');
      const raw = readFileSync(resolve(path), 'utf8');
      const bundle = JSON.parse(raw);
      const defaultMode: BundleMode =
        bundle.contentTypes && bundle.entries
          ? 'all'
          : bundle.entries
            ? 'entries'
            : 'schema';
      const mode = parseMode(args.slice(1), defaultMode);
      const author = flagValue(args, '--author');
      const result = await importBundle(prisma, bundle, { mode, author });
      console.log(
        `Imported ${result.contentTypesCreated} content type(s) and ${result.entriesCreated} entry/entries`
      );
      process.exit(0);
    }

    if (command === 'validate') {
      const path = args[0];
      if (!path) throw new Error('Usage: content-bundle validate <path>');
      const raw = readFileSync(resolve(path), 'utf8');
      const bundle = JSON.parse(raw);
      const result = validateBundle(bundle);
      if (result.ok) {
        console.log('Bundle is valid');
        process.exit(0);
      }
      console.error('Bundle failed validation:');
      for (const err of result.errors) {
        console.error(`  ${err.path}: ${err.message}`);
      }
      process.exit(1);
    }

    console.error('Unknown command. Expected: export | import | validate');
    process.exit(1);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
