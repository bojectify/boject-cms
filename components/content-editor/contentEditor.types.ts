import type { BasicComponentProps } from '~/types/basicComponentProps';
import type { FieldConfig } from '~/types/contentEditor';

export type ContentEditorProps = BasicComponentProps & {
  title: string;
  fields: FieldConfig[];
  loading?: boolean;
  error?: string | null;
  fieldErrors?: Record<string, string>;
};
