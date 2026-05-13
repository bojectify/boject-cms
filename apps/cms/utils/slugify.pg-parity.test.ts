import { describe, expect, it } from 'vitest';
import { prisma } from '../server/utils/prisma';
import { slugify } from './slugify';

// Mirror of the migration's regex pair (apps/cms/prisma/migrations/
// 20260513120000_add_entry_key/migration.sql:5-9). Kept here so the parity
// test fails loudly if either side drifts.
const PG_EXPR = `
  regexp_replace(
    regexp_replace(lower($1::text), '[^a-z0-9]+', '-', 'g'),
    '^-|-$', '', 'g'
  )
`;

const SAMPLES = [
  'Hello World',
  '---hello---',
  'Hello-World',
  'Hello World 123',
  'café',
  '!!! ??? ',
  'A',
  'hero banner',
  'hero - banner',
  'A B C 1 2 3',
];

describe('slugify Postgres parity', () => {
  for (const sample of SAMPLES) {
    it(`matches Postgres for ${JSON.stringify(sample)}`, async () => {
      const rows = (await prisma.$queryRawUnsafe(
        `SELECT ${PG_EXPR} AS slug`,
        sample
      )) as Array<{ slug: string }>;
      expect(rows[0]!.slug).toBe(slugify(sample));
    });
  }
});
