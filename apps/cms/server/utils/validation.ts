import { createError } from 'h3';
import { isReservedFieldIdentifier } from '../../utils/reservedFieldIdentifiers';

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

/**
 * Convert a display name to PascalCase identifier.
 * "Blog Post" → "BlogPost", "my cool type" → "MyCoolType"
 */
export function toPascalCase(str: string): string {
  return str
    .trim()
    .split(/[\s_-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/**
 * Convert a display name to camelCase identifier.
 * "Publish Date" → "publishDate", "My Field" → "myField"
 */
export function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

const FIELD_IDENTIFIER_RE = /^[a-z][a-zA-Z0-9]*$/;

export function assertFieldIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !FIELD_IDENTIFIER_RE.test(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be camelCase (start with lowercase, alphanumeric only)`,
    });
  }
  if (isReservedFieldIdentifier(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} '${value}' is reserved (it collides with a built-in entry field) — choose another name.`,
    });
  }
  return value;
}

const IDENTIFIER_RE = /^[A-Z][a-zA-Z0-9]*$/;

export function assertIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !IDENTIFIER_RE.test(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be PascalCase (start with uppercase, alphanumeric only)`,
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
