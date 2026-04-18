import type { BasicComponentProps } from '~/types/basicComponentProps';

export type EntryPickerModalProps = BasicComponentProps & {
  open: boolean;
  targetContentTypeIds: string[];
};
