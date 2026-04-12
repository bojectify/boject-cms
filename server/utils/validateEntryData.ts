import { createError } from 'h3';
import type { FieldType } from '#prisma';

interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: unknown;
}

/**
 * Validate entry data against field definitions.
 * Returns the validated/cleaned data object.
 * Throws 400 on validation failure.
 */
export function validateEntryData(
  data: Record<string, unknown>,
  fields: FieldDef[]
): Record<string, unknown> {
  const validated: Record<string, unknown> = {};

  for (const field of fields) {
    const value = data[field.name];
    const isEmpty = value === undefined || value === null || value === '';

    if (field.required && isEmpty) {
      throw createError({
        statusCode: 400,
        statusMessage: `${field.label} is required`,
      });
    }

    if (isEmpty) {
      validated[field.name] = null;
      continue;
    }

    switch (field.type) {
      case 'ENTRY_TITLE':
      case 'SLUG':
      case 'TEXT':
      case 'TEXTAREA':
        if (typeof value !== 'string') {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.label} must be a string`,
          });
        }
        validated[field.name] = value;
        break;

      case 'NUMBER':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.label} must be a number`,
          });
        }
        validated[field.name] = value;
        break;

      case 'BOOLEAN':
        if (typeof value !== 'boolean') {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.label} must be a boolean`,
          });
        }
        validated[field.name] = value;
        break;

      case 'DATETIME':
        if (typeof value !== 'string' || isNaN(Date.parse(value))) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.label} must be a valid ISO-8601 date string`,
          });
        }
        validated[field.name] = value;
        break;

      case 'SELECT': {
        if (typeof value !== 'string') {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.label} must be a string`,
          });
        }
        const opts = field.options as { choices?: string[] } | null;
        const choices = opts?.choices ?? [];
        if (choices.length > 0 && !choices.includes(value)) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.label} must be one of: ${choices.join(', ')}`,
          });
        }
        validated[field.name] = value;
        break;
      }

      default:
        validated[field.name] = value;
    }
  }

  // Strip unknown keys (only return validated field values)
  return validated;
}

/**
 * Extract slug value from validated data using field definitions.
 * Returns null if no SLUG field defined or value is empty.
 */
export function extractSlug(
  data: Record<string, unknown>,
  fields: FieldDef[]
): string | null {
  const slugField = fields.find((f) => f.type === 'SLUG');
  if (!slugField) return null;
  const val = data[slugField.name];
  return typeof val === 'string' && val.trim() ? val.trim() : null;
}

/**
 * Extract entryTitle value from validated data using field definitions.
 * Returns 'Untitled' if ENTRY_TITLE field value is empty.
 */
export function extractEntryTitle(
  data: Record<string, unknown>,
  fields: FieldDef[]
): string {
  const titleField = fields.find((f) => f.type === 'ENTRY_TITLE');
  if (!titleField) return 'Untitled';
  const val = data[titleField.name];
  return typeof val === 'string' && val.trim() ? val.trim() : 'Untitled';
}
