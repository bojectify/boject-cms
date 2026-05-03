import type { BasicComponentProps } from '~/types/basicComponentProps';

export type EntryEditorPaneProps = BasicComponentProps & {
  open: boolean;
  contentTypeId?: string;
  entryId: string | null;
  depth: number;
  /**
   * True when this pane is the topmost in the pane stack. Drives focus
   * trap + escape-to-close — only the topmost dialog should capture
   * keyboard interactions.
   */
  isTopmost?: boolean;
};
