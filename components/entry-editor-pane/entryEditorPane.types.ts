import type { BasicComponentProps } from '~/types/basicComponentProps';

export type EntryEditorPaneProps = BasicComponentProps & {
  open: boolean;
  contentTypeId?: string;
  entryId: string | null;
};
