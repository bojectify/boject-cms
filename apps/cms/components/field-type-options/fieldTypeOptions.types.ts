import type { BasicComponentProps } from '~/types/basicComponentProps';

export type FieldTypeOptionsProps = BasicComponentProps & {
  type: string;
  options: unknown;
  /** The field's `required` flag — gates the BOOLEAN default's "None" option. */
  required?: boolean;
  contentTypeOptions: Array<{ label: string; value: string }>;
  updateOptions: (value: unknown) => void;
};
