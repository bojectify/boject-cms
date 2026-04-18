import type { BasicComponentProps } from '~/types/basicComponentProps';

export interface RelationItem {
  contentTypeId: string;
  entryId: string;
  entryTitle: string;
  contentTypeName: string;
}

export type MultiRelationFieldProps = BasicComponentProps & {
  label: string;
  items: RelationItem[];
};
