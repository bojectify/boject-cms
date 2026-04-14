import type { Builder } from '../builder';

export function registerContentStatusEnum(builder: Builder) {
  return builder.enumType('ContentStatus', {
    values: ['DRAFT', 'PUBLISHED', 'CHANGED', 'ARCHIVED'] as const,
  });
}

export type ContentStatusEnumRef = ReturnType<typeof registerContentStatusEnum>;
