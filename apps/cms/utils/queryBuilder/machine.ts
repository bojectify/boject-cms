import type { QueryContentType, QueryField, SearchQuery } from './types';
import { defaultOperator } from './operators';
import { addFilter, removeFilter } from './query';

export type Step = 'contentType' | 'field' | 'operator' | 'value';

export interface DraftFilter {
  field: QueryField;
  op: string;
  value: unknown;
}

export interface BuilderState {
  contentTypes: QueryContentType[];
  locked: boolean; // lockedContentType (route scope)
  rich: boolean; // enableRichOperators
  step: Step;
  query: SearchQuery;
  draft: DraftFilter | null;
  text: string; // current free-text in the input
  /** One-shot side-effect for the host (consumed + cleared each dispatch). */
  intent: { kind: 'run' } | { kind: 'broaden'; q?: string } | null;
}

export interface InitOptions {
  contentTypes: QueryContentType[];
  lockedContentType?: QueryContentType;
  rich?: boolean;
  initialQuery?: SearchQuery;
}

export function initState(opts: InitOptions): BuilderState {
  const locked = !!opts.lockedContentType;
  const query: SearchQuery =
    opts.initialQuery ??
    (locked
      ? { contentType: opts.lockedContentType!.identifier, filters: [] }
      : { filters: [] });
  return {
    contentTypes: opts.contentTypes,
    locked,
    rich: opts.rich ?? false,
    step: query.contentType ? 'field' : 'contentType',
    query,
    draft: null,
    text: '',
    intent: null,
  };
}

export type Action =
  | { kind: 'setFreeText'; q: string }
  | { kind: 'pickContentType'; contentType: QueryContentType }
  | { kind: 'removeContentType' }
  | { kind: 'pickField'; field: QueryField }
  | { kind: 'pickOperator'; op: string }
  | { kind: 'setValue'; value: unknown }
  | { kind: 'commitValue' }
  | { kind: 'removeFilter'; index: number }
  | { kind: 'backspace' }
  | { kind: 'run' };

export function reduce(prev: BuilderState, action: Action): BuilderState {
  const s = { ...prev, intent: null };
  switch (action.kind) {
    case 'setFreeText':
      // At the value step, `text` is the filter value being typed — don't let it
      // leak into the global free-text `query.q`.
      return {
        ...s,
        text: action.q,
        query:
          s.step === 'value'
            ? s.query
            : { ...s.query, q: action.q || undefined },
      };

    case 'pickContentType':
      // The text typed at the contentType step was used to find this type in
      // the list, not as a free-text query for the now-scoped search. Clear it
      // from both the input and query.q so the visible input and the emitted
      // query stay in sync. (Free-text at the field step is unaffected.)
      return {
        ...s,
        step: 'field',
        text: '',
        query: {
          ...s.query,
          contentType: action.contentType.identifier,
          q: undefined,
        },
      };

    case 'removeContentType':
      if (s.locked) return { ...s, intent: { kind: 'broaden', q: s.query.q } };
      return {
        ...s,
        step: 'contentType',
        draft: null,
        text: '',
        query: { contentType: undefined, q: s.query.q, filters: [] },
      };

    case 'pickField': {
      const op = defaultOperator(action.field.type);
      const draft: DraftFilter = {
        field: action.field,
        op: op.id,
        value: null,
      };
      // v1: a single operator -> skip straight to the value step.
      const ops = s.rich ? null : [op];
      return {
        ...s,
        draft,
        text: '',
        step: ops && ops.length === 1 ? 'value' : 'operator',
      };
    }

    case 'pickOperator':
      return s.draft
        ? { ...s, draft: { ...s.draft, op: action.op }, step: 'value' }
        : s;

    case 'setValue':
      return s.draft
        ? {
            ...s,
            draft: { ...s.draft, value: action.value },
            text: String(action.value ?? ''),
          }
        : s;

    case 'commitValue': {
      if (!s.draft) return s;
      const filter = {
        field: s.draft.field.identifier,
        op: s.draft.op,
        value: s.draft.value,
      };
      return {
        ...s,
        query: addFilter(s.query, filter),
        draft: null,
        text: '',
        step: 'field',
      };
    }

    case 'removeFilter':
      return { ...s, query: removeFilter(s.query, action.index) };

    case 'backspace':
      // An empty input backs out the current draft first (cancel the in-progress
      // filter, return to field selection), then deletes the last committed chip.
      if (s.text === '' && s.draft) {
        return {
          ...s,
          draft: null,
          step: s.query.contentType ? 'field' : 'contentType',
        };
      }
      if (s.text === '' && !s.draft && s.query.filters.length) {
        return {
          ...s,
          query: removeFilter(s.query, s.query.filters.length - 1),
        };
      }
      return s;

    case 'run':
      return { ...s, intent: { kind: 'run' } };
  }
}
