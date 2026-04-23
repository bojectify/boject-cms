import type { BasicComponentProps } from '~/types/basicComponentProps';
import type { EntryAction } from '~/components/entry-action-menu/entryActionMenu.types';

export type EntryStatus = 'DRAFT' | 'PUBLISHED' | 'CHANGED' | 'ARCHIVED';

export type EntrySidebarProps = BasicComponentProps & {
  status: EntryStatus;
  isDirty: boolean;
  saving: boolean;
  hasPublishedVersion: boolean;
  hasArchivedVersion: boolean;
  isNew: boolean;
  entryId: string | null;
  contentTypeName: string;
  contentTypeId: string;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
  publishedAt: string | Date | null;
  onSaveDraft: () => void;
  onPublish: () => void;
  onDiscardChanges?: () => void;
  onDelete?: () => void;
  onAction?: (action: EntryAction) => void | Promise<void>;
};
