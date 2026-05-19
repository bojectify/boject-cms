import type { FieldType } from '#prisma';
import { createError } from 'h3';
import { FIELD_TYPES } from '../../utils/fieldTypes';

const USER_CONFIGURABLE_UNIQUE_TYPES = new Set<FieldType>([
  FIELD_TYPES.TEXT,
  FIELD_TYPES.NUMBER,
]);
const IMPLICIT_UNIQUE_TYPES = new Set<FieldType>([
  FIELD_TYPES.ENTRY_TITLE,
  FIELD_TYPES.SLUG,
]);

export function isUniqueAllowedForType(type: FieldType): boolean {
  return (
    USER_CONFIGURABLE_UNIQUE_TYPES.has(type) || IMPLICIT_UNIQUE_TYPES.has(type)
  );
}

export function resolveUniqueFlag(
  type: FieldType,
  requested: boolean | undefined
): boolean {
  if (IMPLICIT_UNIQUE_TYPES.has(type)) return true;
  const value = requested === true;
  if (value && !USER_CONFIGURABLE_UNIQUE_TYPES.has(type)) {
    throw createError({
      statusCode: 400,
      statusMessage: `unique is not supported for fields of type ${type}`,
    });
  }
  return value;
}
