import type { BasicComponentProps } from '~/types/basicComponentProps';

export type EntryActionMenuProps = BasicComponentProps & {
  hasPublishedVersion: boolean;
  hasArchivedVersion: boolean;
};

export type EntryAction =
  | 'unpublish'
  | 'republish'
  | 'archive'
  | 'unarchive'
  | 'delete';
