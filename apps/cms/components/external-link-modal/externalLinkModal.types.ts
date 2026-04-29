import type { BasicComponentProps } from '~/types/basicComponentProps';
import type { LinkOptions } from '~/components/link-options-form/linkOptionsForm.types';

export type ExternalLinkSavePayload = {
  href: string;
} & LinkOptions;

export type ExternalLinkModalProps = BasicComponentProps & {
  open: boolean;
  initialHref?: string;
  initialOptions?: LinkOptions;
  mode: 'insert' | 'edit';
};
