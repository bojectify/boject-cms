import type { BasicComponentProps } from '~/types/basicComponentProps';
import type { LinkOptions } from '~/components/link-options-form/linkOptionsForm.types';

export type EntryPickerMode = 'cmsEmbed' | 'cmsLink';

export type EntryPickerSelection = {
  contentTypeId: string;
  entryId: string;
  entryTitle: string;
};

export type EntryPickerUpdatePayload = EntryPickerSelection & LinkOptions;

export type EntryPickerModalProps = BasicComponentProps & {
  open: boolean;
  targetContentTypeIds: string[];
  mode?: EntryPickerMode;
  selectedEntry?: { contentTypeId: string; entryId: string } | null;
  initialOptions?: LinkOptions;
};
