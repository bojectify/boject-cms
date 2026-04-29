import type { BasicComponentProps } from '~/types/basicComponentProps';

export type LinkOptions = {
  label: string;
  target: '_self' | '_blank' | null;
  rel: 'nofollow' | null;
};

export type LinkOptionsFormProps = BasicComponentProps & {
  modelValue: LinkOptions;
  labelPlaceholder?: string;
};
