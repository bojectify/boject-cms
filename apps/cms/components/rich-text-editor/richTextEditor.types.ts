import type { BasicComponentProps } from '~/types/basicComponentProps';

export type RichTextEditorProps = BasicComponentProps & {
  modelValue: unknown;
  targetContentTypeIds?: string[];
  linkTargetContentTypeIds?: string[];
};
