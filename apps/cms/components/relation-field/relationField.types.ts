import type { BasicComponentProps } from '~/types/basicComponentProps';

export type RelationFieldProps = BasicComponentProps & {
  value: { contentTypeId: string; entryId: string } | null;
  entryTitle: string | null;
  contentTypeName: string | null;
};
