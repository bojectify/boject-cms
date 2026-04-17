import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FieldType } from '#prisma';
import { assertUniqueFieldValues } from './assertUniqueFieldValues';

type FakeRow = { entryId: string; value: unknown };

const { fakePrisma } = vi.hoisted(() => {
  const fp: {
    rows: FakeRow[];
    $queryRaw: ReturnType<typeof vi.fn>;
  } = {
    rows: [],
    $queryRaw: vi.fn(async () => fp.rows),
  };
  return { fakePrisma: fp };
});

vi.mock('./prisma', () => ({ prisma: fakePrisma }));

const fieldBase = {
  id: 'f1',
  contentTypeId: 'ct1',
  name: 'SKU',
  identifier: 'sku',
  required: false,
  unique: true,
  options: null,
  order: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('assertUniqueFieldValues', () => {
  beforeEach(() => {
    fakePrisma.rows = [];
    fakePrisma.$queryRaw.mockClear();
  });

  it('skips fields with unique=false', async () => {
    await assertUniqueFieldValues(
      { sku: 'ABC' },
      [{ ...fieldBase, unique: false, type: 'TEXT' as FieldType }],
      'ct1'
    );
    expect(fakePrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('skips fields of unsupported types even when unique=true', async () => {
    await assertUniqueFieldValues(
      { sku: 'ABC' },
      [{ ...fieldBase, unique: true, type: 'ENTRY_TITLE' as FieldType }],
      'ct1'
    );
    expect(fakePrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('skips when value is null, undefined, or empty string', async () => {
    await assertUniqueFieldValues(
      { sku: null, issue: undefined, code: '' },
      [
        { ...fieldBase, identifier: 'sku', type: 'TEXT' as FieldType },
        { ...fieldBase, identifier: 'issue', type: 'NUMBER' as FieldType },
        { ...fieldBase, identifier: 'code', type: 'TEXT' as FieldType },
      ],
      'ct1'
    );
    expect(fakePrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('throws 409 when a duplicate TEXT value exists on another entry', async () => {
    fakePrisma.rows = [{ entryId: 'e2', value: 'ABC' }];
    await expect(
      assertUniqueFieldValues(
        { sku: 'ABC' },
        [{ ...fieldBase, identifier: 'sku', type: 'TEXT' as FieldType }],
        'ct1'
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      data: { error: 'UNIQUE_CONFLICT', field: 'sku', value: 'ABC' },
    });
  });

  it('throws 409 when a duplicate NUMBER value exists', async () => {
    fakePrisma.rows = [{ entryId: 'e2', value: 42 }];
    await expect(
      assertUniqueFieldValues(
        { issue: 42 },
        [{ ...fieldBase, identifier: 'issue', type: 'NUMBER' as FieldType }],
        'ct1'
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      data: { error: 'UNIQUE_CONFLICT', field: 'issue', value: 42 },
    });
  });

  it('passes when the only match is the excluded entry', async () => {
    fakePrisma.rows = [{ entryId: 'e1', value: 'ABC' }];
    await expect(
      assertUniqueFieldValues(
        { sku: 'ABC' },
        [{ ...fieldBase, identifier: 'sku', type: 'TEXT' as FieldType }],
        'ct1',
        'e1'
      )
    ).resolves.toBeUndefined();
  });

  it('does case-sensitive comparison for TEXT', async () => {
    // DB doesn't match 'ABC' against 'abc' — we rely on the raw SQL's `=` operator.
    fakePrisma.rows = [];
    await expect(
      assertUniqueFieldValues(
        { sku: 'abc' },
        [{ ...fieldBase, identifier: 'sku', type: 'TEXT' as FieldType }],
        'ct1'
      )
    ).resolves.toBeUndefined();
  });
});
