import type { BasicComponentProps } from '~/types/basicComponentProps';
import type { QueryContentType, SearchQuery } from '~/utils/queryBuilder/types';

export interface EntryOption {
  id: string;
  entryTitle: string;
  contentTypeName: string;
}

export interface QueryBuilderProps extends BasicComponentProps {
  contentTypes: QueryContentType[];
  modelValue?: SearchQuery;
  lockedContentType?: QueryContentType;
  enableRichOperators?: boolean;
  /** Relation value lookup. Injected so the component never fetches (Storybook passes a fixture). */
  searchEntries?: (
    targetContentTypeIds: string[],
    q: string
  ) => Promise<EntryOption[]>;
}

export interface QueryBuilderEmits {
  (e: 'update:modelValue' | 'run', value: SearchQuery): void;
  (e: 'broaden', payload: { q?: string }): void;
}
