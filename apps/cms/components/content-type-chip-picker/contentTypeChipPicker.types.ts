import type { BasicComponentProps } from '~/types/basicComponentProps';

export type ContentTypeChipPickerProps = BasicComponentProps & {
  modelValue: string[];
  options: { label: string; value: string }[] | null | undefined;
  addPlaceholder?: string;
  emptyHint?: string;
};
