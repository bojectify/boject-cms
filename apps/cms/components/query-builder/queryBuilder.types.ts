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
  /** Surface non-equality operators (is not / contains / starts with / >, ≥, <, ≤ / before, after). */
  enableRichOperators?: boolean;
  /** Surface arity-two/many operators (in / containsAny / containsAll / between). Requires their value editors (#333). */
  enableMultiValueOperators?: boolean;
  /** Relation value lookup. Injected so the component never fetches (Storybook passes a fixture). */
  searchEntries?: (
    targetContentTypeIds: string[],
    q: string
  ) => Promise<EntryOption[]>;
  /** Seed of resolved relation entry-id → title (e.g. from a URL-loaded query). */
  relationLabels?: Record<string, string>;
  /** True while the seed relation labels are resolving (drives the chip skeleton). */
  relationLabelsPending?: boolean;
}

export interface QueryBuilderEmits {
  (e: 'update:modelValue' | 'run', value: SearchQuery): void;
  (e: 'broaden', payload: { q?: string }): void;
}
