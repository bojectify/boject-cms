import { createError } from 'h3';
import type { FieldType } from '#prisma';
import { isUuid } from './validation';

interface FieldDef {
  identifier: string;
  name: string;
  type: FieldType;
  required: boolean;
  options: unknown;
}

/**
 * Validate entry data against field definitions.
 * Returns the validated/cleaned data object.
 * Throws 400 on validation failure.
 */
export async function validateEntryData(
  data: Record<string, unknown>,
  fields: FieldDef[]
): Promise<Record<string, unknown>> {
  const validated: Record<string, unknown> = {};

  for (const field of fields) {
    const value = data[field.identifier];
    const isEmpty = value === undefined || value === null || value === '';

    if (field.required && isEmpty) {
      throw createError({
        statusCode: 400,
        statusMessage: `${field.name} is required`,
      });
    }

    if (isEmpty) {
      validated[field.identifier] = null;
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
            statusMessage: `${field.name} must be a string`,
          });
        }
        validated[field.identifier] = value;
        break;

      case 'NUMBER':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.name} must be a number`,
          });
        }
        validated[field.identifier] = value;
        break;

      case 'BOOLEAN':
        if (typeof value !== 'boolean') {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.name} must be a boolean`,
          });
        }
        validated[field.identifier] = value;
        break;

      case 'DATETIME':
        if (typeof value !== 'string' || isNaN(Date.parse(value))) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.name} must be a valid ISO-8601 date string`,
          });
        }
        validated[field.identifier] = value;
        break;

      case 'SELECT': {
        if (typeof value !== 'string') {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.name} must be a string`,
          });
        }
        const opts = field.options as { choices?: string[] } | null;
        const choices = opts?.choices ?? [];
        if (choices.length > 0 && !choices.includes(value)) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.name} must be one of: ${choices.join(', ')}`,
          });
        }
        validated[field.identifier] = value;
        break;
      }

      case 'RICHTEXT': {
        if (
          typeof value !== 'object' ||
          value === null ||
          Array.isArray(value)
        ) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.name} must be a JSON object`,
          });
        }
        const rtOpts = field.options as {
          targetContentTypeIds?: string[];
        } | null;
        const allowedEmbedTypes = rtOpts?.targetContentTypeIds ?? [];
        validateRichtextEmbeds(value, allowedEmbedTypes, field.name);
        validated[field.identifier] = value;
        break;
      }

      case 'RELATION': {
        if (
          typeof value !== 'object' ||
          value === null ||
          Array.isArray(value)
        ) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.name} must be an object with contentTypeId and entryId`,
          });
        }
        const rel = value as Record<string, unknown>;
        if (!isUuid(rel.contentTypeId) || !isUuid(rel.entryId)) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.name} must have valid contentTypeId and entryId UUIDs`,
          });
        }
        const opts = field.options as {
          targetContentTypeIds?: string[];
        } | null;
        const allowedTypes = opts?.targetContentTypeIds ?? [];
        if (
          allowedTypes.length > 0 &&
          !allowedTypes.includes(rel.contentTypeId as string)
        ) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.name} references a content type that is not allowed for this field`,
          });
        }
        const entryExists = await prisma.contentEntry.findFirst({
          where: {
            id: rel.entryId as string,
            contentTypeId: rel.contentTypeId as string,
          },
          select: { id: true },
        });
        if (!entryExists) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.name} references an entry that does not exist`,
          });
        }
        validated[field.identifier] = {
          contentTypeId: rel.contentTypeId,
          entryId: rel.entryId,
        };
        break;
      }

      case 'MULTIRELATION': {
        if (!Array.isArray(value)) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.name} must be an array`,
          });
        }
        const opts = field.options as {
          targetContentTypeIds?: string[];
        } | null;
        const allowedTypes = opts?.targetContentTypeIds ?? [];
        const seenEntryIds = new Set<string>();
        const validatedRefs: Array<{
          contentTypeId: string;
          entryId: string;
        }> = [];

        for (const item of value) {
          if (
            typeof item !== 'object' ||
            item === null ||
            Array.isArray(item)
          ) {
            throw createError({
              statusCode: 400,
              statusMessage: `${field.name} items must be objects with contentTypeId and entryId`,
            });
          }
          const rel = item as Record<string, unknown>;
          if (!isUuid(rel.contentTypeId) || !isUuid(rel.entryId)) {
            throw createError({
              statusCode: 400,
              statusMessage: `${field.name} items must have valid contentTypeId and entryId UUIDs`,
            });
          }
          if (
            allowedTypes.length > 0 &&
            !allowedTypes.includes(rel.contentTypeId as string)
          ) {
            throw createError({
              statusCode: 400,
              statusMessage: `${field.name} references a content type that is not allowed for this field`,
            });
          }
          if (seenEntryIds.has(rel.entryId as string)) {
            throw createError({
              statusCode: 400,
              statusMessage: `${field.name} contains duplicate entry references`,
            });
          }
          seenEntryIds.add(rel.entryId as string);
          const entryExists = await prisma.contentEntry.findFirst({
            where: {
              id: rel.entryId as string,
              contentTypeId: rel.contentTypeId as string,
            },
            select: { id: true },
          });
          if (!entryExists) {
            throw createError({
              statusCode: 400,
              statusMessage: `${field.name} references an entry that does not exist`,
            });
          }
          validatedRefs.push({
            contentTypeId: rel.contentTypeId as string,
            entryId: rel.entryId as string,
          });
        }
        validated[field.identifier] = validatedRefs;
        break;
      }

      case 'IMAGE': {
        if (
          typeof value !== 'object' ||
          value === null ||
          Array.isArray(value)
        ) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.name} must be an object`,
          });
        }
        const img = value as Record<string, unknown>;

        if (typeof img.storageKey !== 'string' || !img.storageKey) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.name} must have a storageKey`,
          });
        }
        if (typeof img.mimeType !== 'string' || !img.mimeType) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.name} must have a mimeType`,
          });
        }
        if (typeof img.width !== 'number' || !Number.isFinite(img.width)) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.name} must have a numeric width`,
          });
        }
        if (typeof img.height !== 'number' || !Number.isFinite(img.height)) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.name} must have a numeric height`,
          });
        }
        if (
          typeof img.fileSize !== 'number' ||
          !Number.isFinite(img.fileSize)
        ) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.name} must have a numeric fileSize`,
          });
        }

        const originalName =
          typeof img.originalName === 'string' ? img.originalName : null;
        const focalPointX =
          typeof img.focalPointX === 'number' &&
          img.focalPointX >= 0 &&
          img.focalPointX <= 1
            ? img.focalPointX
            : 0.5;
        const focalPointY =
          typeof img.focalPointY === 'number' &&
          img.focalPointY >= 0 &&
          img.focalPointY <= 1
            ? img.focalPointY
            : 0.5;

        validated[field.identifier] = {
          storageKey: img.storageKey,
          mimeType: img.mimeType,
          width: img.width,
          height: img.height,
          fileSize: img.fileSize,
          originalName,
          focalPointX,
          focalPointY,
        };
        break;
      }

      default:
        validated[field.identifier] = value;
    }
  }

  // Strip unknown keys (only return validated field values)
  return validated;
}

/**
 * Walk a ProseMirror JSON document, asserting every `cmsEmbed` node's
 * `contentTypeId` is in the allow-list. Empty allow-list means no embeds
 * are allowed at all.
 */
function validateRichtextEmbeds(
  doc: unknown,
  allowedContentTypeIds: string[],
  fieldName: string
): void {
  function walk(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: unknown; attrs?: unknown; content?: unknown };
    if (n.type === 'cmsEmbed') {
      const attrs = (n.attrs ?? {}) as Record<string, unknown>;
      if (
        typeof attrs.contentTypeId !== 'string' ||
        typeof attrs.entryId !== 'string'
      ) {
        throw createError({
          statusCode: 400,
          statusMessage: `${fieldName}: Invalid inline embed (missing contentTypeId or entryId).`,
        });
      }
      if (allowedContentTypeIds.length === 0) {
        throw createError({
          statusCode: 400,
          statusMessage: `${fieldName}: Inline embeds are not allowed in this field.`,
        });
      }
      if (!allowedContentTypeIds.includes(attrs.contentTypeId)) {
        throw createError({
          statusCode: 400,
          statusMessage: `${fieldName}: Inline embed references a content type that is not allowed for this field.`,
        });
      }
    }
    // Marks (e.g. bold, link) are flat on text nodes and never carry embeds; only `content` recurses.
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child);
    }
  }
  walk(doc);
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
  const val = data[slugField.identifier];
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
  const val = data[titleField.identifier];
  return typeof val === 'string' && val.trim() ? val.trim() : 'Untitled';
}
