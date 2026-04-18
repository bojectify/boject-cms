import type { BasicComponentProps } from '~/types/basicComponentProps';

export type RelationFieldProps = BasicComponentProps & {
  label: string;
  required?: boolean;
  value: { contentTypeId: string; entryId: string } | null;
  entryTitle: string | null;
  contentTypeName: string | null;
};
