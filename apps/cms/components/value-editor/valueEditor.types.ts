import type { BasicComponentProps } from '~/types/basicComponentProps';
import type { DraftFilter } from '~/utils/queryBuilder/machine';
import type { EntryOption } from '../query-builder/queryBuilder.types';

export type ValueEditorProps = BasicComponentProps & {
  draft: DraftFilter;
  text: string;
  /** Relation value lookup. Injected so the component never fetches. */
  searchEntries?: (ids: string[], q: string) => Promise<EntryOption[]>;
};
