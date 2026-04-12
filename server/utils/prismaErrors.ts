import { createError } from 'h3';

type PrismaLikeError = {
  code?: string;
  meta?: unknown;
  message?: string;
};

const PRISMA_CODE_RE = /^P\d{4}$/;

function isPrismaError(err: unknown): err is PrismaLikeError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string' &&
    PRISMA_CODE_RE.test((err as { code: string }).code)
  );
}

export interface TranslateOptions {
  uniqueMessage?: string;
  notFoundMessage?: string;
  foreignKeyMessage?: string;
}

export function translatePrismaError(
  err: unknown,
  options: TranslateOptions = {}
): unknown {
  if (!isPrismaError(err)) return err;

  switch (err.code) {
    case 'P2002':
      return createError({
        statusCode: 409,
        statusMessage: options.uniqueMessage ?? 'Resource already exists',
      });
    case 'P2003':
      return createError({
        statusCode: 400,
        statusMessage:
          options.foreignKeyMessage ?? 'Referenced resource does not exist',
      });
    case 'P2025':
      return createError({
        statusCode: 404,
        statusMessage: options.notFoundMessage ?? 'Resource not found',
      });
    default:
      return err;
  }
}

/**
 * Run a Prisma call and re-throw any known error codes as clean HTTP errors.
 * Unknown errors pass through unchanged.
 */
export async function withPrismaErrors<T>(
  fn: () => Promise<T>,
  options: TranslateOptions = {}
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw translatePrismaError(err, options);
  }
}
