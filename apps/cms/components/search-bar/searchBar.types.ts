import type { BasicComponentProps } from '~/types/basicComponentProps';
import type { SearchQuery } from '~/utils/queryBuilder/types';
import type { ChipLabelField } from '~/utils/queryBuilder/chipLabels';

export type SearchBarProps = BasicComponentProps & {
  /** Launcher placeholder (browse mode), e.g. "Search Articles…". */
  placeholder?: string;
  /**
   * When provided, the bar renders the read-only active-query summary (content-
   * type chip + filter chips + free text + Edit/Clear) instead of the launcher.
   */
  query?: SearchQuery;
  /** Scoped content type's display name (the leading chip; undefined cross-type). */
  contentTypeName?: string;
  /** Scoped content type's fields, for chip field/operator display labels. */
  fields?: ChipLabelField[];
};
