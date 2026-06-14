import type { BasicComponentProps } from '~/types/basicComponentProps';
import type { FieldTypeName } from '~/utils/fieldTypes';

export type SearchFieldCellProps = BasicComponentProps & {
  /** The raw `fields.<id>` value (scalar / epoch-ms / { entryId, entryTitle } cell). */
  value: unknown;
  /** The column's field type (drives formatting). */
  fieldType: FieldTypeName;
};
