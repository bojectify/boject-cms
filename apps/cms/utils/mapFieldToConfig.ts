import type { FieldConfig } from '~/types/contentEditor';

export function mapFieldToConfig(field: {
  identifier: string;
  name: string;
  type: string;
  required: boolean;
  options: unknown;
}): FieldConfig {
  switch (field.type) {
    case 'ENTRY_TITLE':
    case 'SLUG':
    case 'TEXT':
      return {
        type: 'text',
        key: field.identifier,
        label: field.name,
        required: field.required,
      };
    case 'TEXTAREA':
      return {
        type: 'textarea',
        key: field.identifier,
        label: field.name,
        required: field.required,
      };
    case 'NUMBER':
      return {
        type: 'number',
        key: field.identifier,
        label: field.name,
        required: field.required,
      };
    case 'BOOLEAN':
      return {
        type: 'boolean',
        key: field.identifier,
        label: field.name,
      };
    case 'DATETIME':
      return {
        type: 'datetime',
        key: field.identifier,
        label: field.name,
        required: field.required,
      };
    case 'SELECT': {
      const opts = parseFieldOptions(field);
      const choices = opts.type === 'SELECT' ? opts.choices : [];
      return {
        type: 'select',
        key: field.identifier,
        label: field.name,
        required: field.required,
        options: choices.map((c) => ({ label: c, value: c })),
      };
    }
    case 'RICHTEXT': {
      const opts = parseFieldOptions(field);
      const targetIds =
        opts.type === 'RICHTEXT' ? opts.targetContentTypeIds : [];
      const linkTargetIds =
        opts.type === 'RICHTEXT' ? opts.linkTargetContentTypeIds : [];
      return {
        type: 'richtext',
        key: field.identifier,
        label: field.name,
        targetContentTypeIds: targetIds,
        linkTargetContentTypeIds: linkTargetIds,
      };
    }
    case 'RELATION': {
      const opts = parseFieldOptions(field);
      const targetContentTypeIds =
        opts.type === 'RELATION' ? opts.targetContentTypeIds : [];
      return {
        type: 'dynamic-relation' as const,
        key: field.identifier,
        label: field.name,
        required: field.required,
        targetContentTypeIds,
      };
    }
    case 'MULTIRELATION': {
      const opts = parseFieldOptions(field);
      const targetContentTypeIds =
        opts.type === 'MULTIRELATION' ? opts.targetContentTypeIds : [];
      return {
        type: 'dynamic-multirelation' as const,
        key: field.identifier,
        label: field.name,
        targetContentTypeIds,
      };
    }
    case 'IMAGE':
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
