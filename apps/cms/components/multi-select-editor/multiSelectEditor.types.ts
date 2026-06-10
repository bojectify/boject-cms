import type { BasicComponentProps } from '~/types/basicComponentProps';
import type { DraftFilter } from '~/utils/queryBuilder/machine';

export interface MultiSelectEditorProps extends BasicComponentProps {
  draft: DraftFilter;
  /** The keyboard-highlighted option id (for the highlight styling). */
  activeId?: string | null;
}
