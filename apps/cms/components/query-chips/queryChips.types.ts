import type { SearchFilter } from '~/utils/queryBuilder/types';
import type { ChipLabelField } from '~/utils/queryBuilder/chipLabels';

export type QueryChipsProps = {
  /** Leading content-type chip label; the chip is hidden when falsy (cross-type / unscoped). */
  contentTypeName?: string;
  /** Render the pin on the content-type chip (a locked / pre-scoped type). */
  locked?: boolean;
  /** The committed AND-ed filters. */
  filters: SearchFilter[];
  /** Field defs that drive chip field/operator/value display labels. */
  fields: ChipLabelField[];
  /** entryId → title map for relation-valued chips (falls back to the id when absent). */
  relationLabels?: Record<string, string>;
  /**
   * The filter being re-edited in place — its committed chip is NOT rendered here
   * (the consumer renders it as the editable draft chip instead). Omitted / null
   * renders all chips.
   */
  editingIndex?: number | null;
};
