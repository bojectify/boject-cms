import type { ImageFieldConfig } from '~/types/contentEditor';
import type { BasicComponentProps } from '~/types/basicComponentProps';

export interface ImageFieldValue {
  storageKey: string;
  mimeType: string;
  width: number;
  height: number;
  fileSize: number;
  originalName: string | null;
  focalPointX: number;
  focalPointY: number;
}

export type ImageFieldProps = BasicComponentProps & {
  modelValue: ImageFieldValue | null;
  field: ImageFieldConfig;
};
