import type { BasicComponentProps } from '~/types/basicComponentProps';

export type ContentTypeChipProps = BasicComponentProps & {
  name: string;
  locked?: boolean;
};
