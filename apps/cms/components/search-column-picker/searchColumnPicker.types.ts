import type { BasicComponentProps } from '~/types/basicComponentProps';
import type { QueryField } from '~/utils/queryBuilder/types';

export type SearchColumnPickerProps = BasicComponentProps & {
  /** The scoped content type's PascalCase identifier (shown in the panel header). */
  contentTypeIdentifier: string;
  /** The scoped type's fields (already columnable — the picker filters defensively too). */
  fields: QueryField[];
  /** Active column identifiers (URL-driven). */
  modelValue: string[];
};
