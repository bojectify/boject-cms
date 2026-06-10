import type { BasicComponentProps } from '~/types/basicComponentProps';
import type { DraftFilter } from '~/utils/queryBuilder/machine';

export interface DateRangeEditorProps extends BasicComponentProps {
  draft: DraftFilter;
}
