import type { BasicComponentProps } from '~/types/basicComponentProps';

/** A legal stored JSON field value (#497), or `null` for "no value". */
export type JsonFieldValue = Record<string, unknown> | unknown[] | null;

export type JsonFieldProps = BasicComponentProps & {
  /** The stored value; anything that isn't an object/array is shown as-is. */
  modelValue?: unknown;
  /** Accessible name for the editor's content area. */
  label?: string;
  /** Sets `aria-required` on the editor. Enforcement lives in the form. */
  required?: boolean;
};
