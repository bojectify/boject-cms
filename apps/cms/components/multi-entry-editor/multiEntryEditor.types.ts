import type { BasicComponentProps } from '~/types/basicComponentProps';
import type { DraftFilter } from '~/utils/queryBuilder/machine';
import type { EntryOption } from '~/components/query-builder/queryBuilder.types';

export interface MultiEntryEditorProps extends BasicComponentProps {
  draft: DraftFilter;
  /** Current search text (the chip value input). */
  text: string;
  activeId?: string | null;
  searchEntries?: (
    targetContentTypeIds: string[],
    q: string
  ) => Promise<EntryOption[]>;
}
