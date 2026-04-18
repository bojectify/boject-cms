import type { BasicComponentProps } from '~/types/basicComponentProps';

export interface FieldData {
  id?: string;
  identifier: string;
  name: string;
  type: string;
  required: boolean;
  unique: boolean;
  options: unknown;
}

export interface FieldFormData {
  identifier: string;
  name: string;
  type: string;
  required: boolean;
  unique: boolean;
  options: unknown;
}

export type FieldModalProps = BasicComponentProps & {
  open: boolean;
  mode: 'add' | 'edit';
  field: FieldData | null;
  fieldTypeOptions: Array<{ label: string; value: string }>;
  entryCount?: number;
  conflictAlert?: {
    message: string;
    conflicts: Array<{ value: unknown; entryIds: string[] }>;
  } | null;
};
