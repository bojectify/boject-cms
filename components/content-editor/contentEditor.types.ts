import type { BasicComponentProps } from '~/types/basicComponentProps';
import type { FieldConfig } from '~/types/contentEditor';

export type ContentEditorProps = BasicComponentProps & {
  title: string;
  fields: FieldConfig[];
  loading?: boolean;
  saving?: boolean;
  error?: string | null;
  showSlug?: boolean;
  status?: 'DRAFT' | 'PUBLISHED' | 'CHANGED' | 'ARCHIVED';
  hasPublishedVersion?: boolean;
  isDirty?: boolean;
  onSaveDraft: () => void;
  onPublish: () => void;
  onDiscardChanges?: () => void;
};
