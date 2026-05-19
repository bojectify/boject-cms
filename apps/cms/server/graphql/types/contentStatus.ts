import type { Builder } from '../builder';
import { CONTENT_STATUS_NAMES } from '../../../utils/contentStatus';

export function registerContentStatusEnum(builder: Builder) {
  return builder.enumType('ContentStatus', {
    values: CONTENT_STATUS_NAMES,
  });
}

export type ContentStatusEnumRef = ReturnType<typeof registerContentStatusEnum>;
