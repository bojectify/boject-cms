import { createError } from 'h3';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function assertUuid(value: unknown, field: string): string {
  if (!isUuid(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be a valid UUID`,
    });
  }
  return value;
}

export function assertNonNegativeInt(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be a non-negative integer`,
    });
  }
  return value;
}

export function assertStringLength(
  value: unknown,
  field: string,
  max: number
): string {
  if (typeof value !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be a string`,
    });
  }
  if (value.length > max) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} exceeds max length of ${max}`,
    });
  }
  return value;
}
