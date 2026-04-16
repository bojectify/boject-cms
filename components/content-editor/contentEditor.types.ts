import type { BasicComponentProps } from '~/types/basicComponentProps';
import type { FieldConfig } from '~/types/contentEditor';

export type ContentEditorProps = BasicComponentProps & {
  title: string;
  fields: FieldConfig[];
  loading?: boolean;
  saving?: boolean;
  error?: string | null;
  showSlug?: boolean;
  onSave: () => void;
};
