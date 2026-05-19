import type { FieldConfig } from '~/types/contentEditor';
import { FIELD_TYPES } from './fieldTypes';

export function mapFieldToConfig(field: {
  identifier: string;
  name: string;
  type: string;
  required: boolean;
  options: unknown;
}): FieldConfig {
  switch (field.type) {
    case FIELD_TYPES.ENTRY_TITLE:
    case FIELD_TYPES.SLUG:
    case FIELD_TYPES.TEXT:
      return {
        type: 'text',
        key: field.identifier,
        label: field.name,
        required: field.required,
      };
    case FIELD_TYPES.TEXTAREA:
      return {
        type: 'textarea',
        key: field.identifier,
        label: field.name,
        required: field.required,
      };
    case FIELD_TYPES.NUMBER:
      return {
        type: 'number',
        key: field.identifier,
        label: field.name,
        required: field.required,
      };
    case FIELD_TYPES.BOOLEAN:
      return {
        type: 'boolean',
        key: field.identifier,
        label: field.name,
      };
    case FIELD_TYPES.DATETIME:
      return {
        type: 'datetime',
        key: field.identifier,
        label: field.name,
        required: field.required,
      };
    case FIELD_TYPES.SELECT: {
      const opts = parseFieldOptions(field);
      const choices = opts.type === FIELD_TYPES.SELECT ? opts.choices : [];
      return {
        type: 'select',
        key: field.identifier,
        label: field.name,
        required: field.required,
        options: choices.map((c) => ({ label: c, value: c })),
      };
    }
    case FIELD_TYPES.RICHTEXT: {
      const opts = parseFieldOptions(field);
      const targetIds =
        opts.type === FIELD_TYPES.RICHTEXT ? opts.targetContentTypeIds : [];
      const linkTargetIds =
        opts.type === FIELD_TYPES.RICHTEXT ? opts.linkTargetContentTypeIds : [];
      return {
        type: 'richtext',
        key: field.identifier,
        label: field.name,
        targetContentTypeIds: targetIds,
        linkTargetContentTypeIds: linkTargetIds,
      };
    }
    case FIELD_TYPES.RELATION: {
      const opts = parseFieldOptions(field);
      const targetContentTypeIds =
        opts.type === FIELD_TYPES.RELATION ? opts.targetContentTypeIds : [];
      return {
        type: 'dynamic-relation' as const,
        key: field.identifier,
        label: field.name,
        required: field.required,
        targetContentTypeIds,
      };
    }
    case FIELD_TYPES.MULTIRELATION: {
      const opts = parseFieldOptions(field);
      const targetContentTypeIds =
        opts.type === FIELD_TYPES.MULTIRELATION
          ? opts.targetContentTypeIds
          : [];
      return {
        type: 'dynamic-multirelation' as const,
        key: field.identifier,
        label: field.name,
        targetContentTypeIds,
      };
    }
    case FIELD_TYPES.IMAGE:
      return {
        type: 'image' as const,
        key: field.identifier,
        label: field.name,
        required: field.required,
      };
    default:
      return {
        type: 'text',
        key: field.identifier,
        label: field.name,
        required: field.required,
      };
  }
}
