import type { BasicComponentProps } from '~/types/basicComponentProps';

export type FieldTypeOptionsProps = BasicComponentProps & {
  type: string;
  options: unknown;
  contentTypeOptions: Array<{ label: string; value: string }>;
  updateOptions: (value: unknown) => void;
};
