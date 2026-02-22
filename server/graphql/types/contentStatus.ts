import { builder } from '../builder';

export const ContentStatusEnum = builder.enumType('ContentStatus', {
  values: ['DRAFT', 'PUBLISHED', 'CHANGED', 'ARCHIVED'] as const,
});
