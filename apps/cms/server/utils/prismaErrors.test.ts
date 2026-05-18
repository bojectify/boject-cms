import { describe, it, expect } from 'vitest';
import { translatePrismaError, withPrismaErrors } from './prismaErrors';

function fakePrismaError(code: string, message: string, meta?: unknown) {
  const err = new Error(message) as Error & { code: string; meta?: unknown };
  err.code = code;
  err.meta = meta;
  err.name = 'PrismaClientKnownRequestError';
  return err;
}

describe('translatePrismaError', () => {
  it('maps P2002 (unique) to 409', () => {
    const err = translatePrismaError(
      fakePrismaError('P2002', 'Unique constraint failed', {
        target: ['name'],
      }),
      { uniqueMessage: 'A navigation with this name already exists' }
    );
    expect((err as { statusCode: number }).statusCode).toBe(409);
  });

  it('maps P2003 (foreign key) to 400', () => {
    const err = translatePrismaError(
      fakePrismaError('P2003', 'Foreign key constraint failed')
    );
    expect((err as { statusCode: number }).statusCode).toBe(400);
  });

  it('maps P2025 (record not found) to 404', () => {
    const err = translatePrismaError(
      fakePrismaError('P2025', 'Record not found')
    );
    expect((err as { statusCode: number }).statusCode).toBe(404);
  });

  it('returns original error for unknown Prisma codes', () => {
    const original = fakePrismaError('P9999', 'Something weird');
    const err = translatePrismaError(original);
    expect(err).toBe(original);
  });

  it('returns original error for non-Prisma errors', () => {
    const original = new Error('Plain error');
    const err = translatePrismaError(original);
    expect(err).toBe(original);
  });
});

describe('withPrismaErrors', () => {
  it('re-throws translated H3 error for P2002', async () => {
    await expect(
      withPrismaErrors(
        () => Promise.reject(fakePrismaError('P2002', 'Unique constraint')),
        { uniqueMessage: 'Already exists' }
      )
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('passes through non-object thrown values', async () => {
    await expect(
      withPrismaErrors(() => Promise.reject('plain string'))
    ).rejects.toBe('plain string');
  });
});
