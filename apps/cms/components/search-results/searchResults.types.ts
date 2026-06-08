import type { BasicComponentProps } from '~/types/basicComponentProps';
import type { SearchQuery } from '~/utils/queryBuilder/types';

export interface SearchResultHit {
  id: string;
  entryTitle: string;
  snippet: string | null;
  publishedAt: string | null;
}

export type SearchResultsProps = BasicComponentProps & {
  query: SearchQuery;
  /** Display name of the scoped content type (undefined for cross-type / All Content). */
  contentTypeName?: string;
  hits: SearchResultHit[];
  total: number;
  page: number;
  loading?: boolean;
  unavailable?: boolean;
};

export interface SearchResultsEmits {
  (e: 'update:page' | 'removeFilter', value: number): void;
  (e: 'edit' | 'clear'): void;
}
