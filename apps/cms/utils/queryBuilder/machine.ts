import type { QueryContentType, QueryField, SearchQuery } from './types';
import {
  availableOperators,
  defaultOperator,
  valueInputKind,
} from './operators';
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
  multiValue: boolean; // enableMultiValueOperators (arity two/many ops; editors land in #333)
  step: Step;
  query: SearchQuery;
  draft: DraftFilter | null;
  /**
   * Index of the committed filter being re-edited, or null when the draft is a
   * brand-new filter being added. Drives in-place replacement on commit.
   */
  editingIndex: number | null;
  text: string; // current free-text in the input
  /** One-shot side-effect for the host (consumed + cleared each dispatch). */
  intent: { kind: 'run' } | { kind: 'broaden'; q?: string } | null;
}

export interface InitOptions {
  contentTypes: QueryContentType[];
  lockedContentType?: QueryContentType;
  rich?: boolean;
  multiValue?: boolean;
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
    multiValue: opts.multiValue ?? false,
    step: query.contentType ? 'field' : 'contentType',
    query,
    draft: null,
    editingIndex: null,
    text: '',
    intent: null,
  };
}

/** Look up a committed filter's field definition in the scoped content type. */
function findField(
  s: BuilderState,
  identifier: string
): QueryField | undefined {
  const ct = s.contentTypes.find((c) => c.identifier === s.query.contentType);
  return ct?.fields.find((f) => f.identifier === identifier);
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
  | {
      kind: 'editFilter';
      index: number;
      segment: 'field' | 'operator' | 'value';
    }
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
        draft: null,
        editingIndex: null,
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
        editingIndex: null,
        text: '',
        query: { contentType: undefined, q: s.query.q, filters: [] },
      };

    case 'pickField': {
      const ops = availableOperators(action.field.type, {
        rich: s.rich,
        multiValue: s.multiValue,
      });
      const op = ops[0] ?? defaultOperator(action.field.type);
      return {
        ...s,
        draft: { field: action.field, op: op.id, value: null },
        text: '',
        // One operator → skip the operator step; otherwise pick an operator.
        step: ops.length <= 1 ? 'value' : 'operator',
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
      // Re-editing an existing filter replaces it in place; a new draft appends.
      const query =
        s.editingIndex !== null
          ? {
              ...s.query,
              filters: s.query.filters.map((f, i) =>
                i === s.editingIndex ? filter : f
              ),
            }
          : addFilter(s.query, filter);
      return {
        ...s,
        query,
        draft: null,
        editingIndex: null,
        text: '',
        step: 'field',
      };
    }

    case 'editFilter': {
      // Re-open a committed filter for editing. The original filter stays in
      // `query.filters` and is replaced in place on commit (or left untouched on
      // cancel). Field re-pick is deferred, so the `field` segment falls through
      // to the value step alongside `value`.
      const filter = s.query.filters[action.index];
      if (!filter) return s;
      const field = findField(s, filter.field);
      if (!field) return s;
      const kind = valueInputKind(field.type, filter.op);
      // Pre-fill free-entry values so a typed value survives the re-edit; entry /
      // select / boolean are re-picked from the dropdown, so start empty.
      const prefill =
        kind === 'text' || kind === 'number' || kind === 'datetime'
          ? String(filter.value ?? '')
          : '';
      // Operator segment → re-open the operator step (change is → is not, …);
      // the picked operator then routes to the value step (pickOperator), where
      // the prefilled text lets a typed value carry over. value / field re-open
      // the value step directly (field re-pick is deferred).
      return {
        ...s,
        draft: { field, op: filter.op, value: filter.value },
        editingIndex: action.index,
        step: action.segment === 'operator' ? 'operator' : 'value',
        text: prefill,
      };
    }

    case 'removeFilter': {
      const query = removeFilter(s.query, action.index);
      // Keep editingIndex pointing at the same filter if an earlier one is removed.
      const editingIndex =
        s.editingIndex !== null && action.index < s.editingIndex
          ? s.editingIndex - 1
          : s.editingIndex;
      return { ...s, query, editingIndex };
    }

    case 'backspace':
      // An empty input backs out the current draft first (cancel the in-progress
      // filter — whether a new add or an in-place edit — and return to field
      // selection; a re-edit leaves the original committed filter untouched),
      // then deletes the last committed chip.
      if (s.text === '' && s.draft) {
        return {
          ...s,
          draft: null,
          editingIndex: null,
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
