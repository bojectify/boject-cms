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
      const opts = field.options as { choices?: string[] } | null;
      const choices = opts?.choices ?? [];
      return {
        type: 'select',
        key: field.identifier,
        label: field.name,
        required: field.required,
        options: choices.map((c) => ({ label: c, value: c })),
      };
    }
    case 'RICHTEXT': {
      const opts = field.options as {
        targetContentTypeIds?: string[];
      } | null;
      return {
        type: 'richtext',
        key: field.identifier,
        label: field.name,
        targetContentTypeIds: opts?.targetContentTypeIds ?? [],
      };
    }
    case 'RELATION': {
      const opts = field.options as {
        targetContentTypeIds?: string[];
      } | null;
      return {
        type: 'dynamic-relation' as const,
        key: field.identifier,
        label: field.name,
        required: field.required,
        targetContentTypeIds: opts?.targetContentTypeIds ?? [],
      };
    }
    case 'MULTIRELATION': {
      const opts = field.options as {
        targetContentTypeIds?: string[];
      } | null;
      return {
        type: 'dynamic-multirelation' as const,
        key: field.identifier,
        label: field.name,
        targetContentTypeIds: opts?.targetContentTypeIds ?? [],
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
