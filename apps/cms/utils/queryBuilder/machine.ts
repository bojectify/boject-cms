import type { QueryContentType, QueryField, SearchQuery } from './types';
import {
  availableOperators,
  defaultOperator,
  valueInputKind,
} from './operators';
import { addFilter, removeFilter } from './query';
import { resolveQueryField } from './systemFields';

// Object-const source of truth for the builder step; `Step` is derived from it
// (mirrors the FIELD_TYPES / WEBHOOK_EVENTS / CONTENT_STATUSES convention). Note
// the editFilter action's `segment` ('field' | 'operator' | 'value') is a
// SEPARATE concept (a ChipSegment), not a Step, despite overlapping values.
export const STEPS = {
  CONTENT_TYPE: 'contentType',
  FIELD: 'field',
  OPERATOR: 'operator',
  VALUE: 'value',
} as const;
export type Step = (typeof STEPS)[keyof typeof STEPS];

export interface DraftFilter {
  field: QueryField;
  op: string;
  value: unknown;
}

export interface BuilderState {
  contentTypes: QueryContentType[];
  locked: boolean; // lockedContentType (route scope)
  rich: boolean; // enableRichOperators
  multiValue: boolean; // enableMultiValueOperators (arity-many list ops: in/containsAny/containsAll)
  range: boolean; // enableRangeOperators (arity-two range ops: between; date follow-up)
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
  range?: boolean;
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
    range: opts.range ?? false,
    step: query.contentType ? STEPS.FIELD : STEPS.CONTENT_TYPE,
    query,
    draft: null,
    editingIndex: null,
    text: '',
    intent: null,
  };
}

/**
 * Look up a committed filter's field definition: the scoped content type's
 * fields first, falling back to the system-field registry (so `editFilter`
 * works for committed/URL-prefilled `$entryKey` chips).
 */
function findField(
  s: BuilderState,
  identifier: string
): QueryField | undefined {
  const ct = s.contentTypes.find((c) => c.identifier === s.query.contentType);
  return resolveQueryField(ct, identifier);
}

export type Action =
  | { kind: 'setFreeText'; q: string }
  | { kind: 'pickContentType'; contentType: QueryContentType }
  | { kind: 'removeContentType' }
  | { kind: 'pickField'; field: QueryField }
  | { kind: 'pickOperator'; op: string }
  | { kind: 'setValue'; value: unknown }
  | { kind: 'toggleValue'; value: string }
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
          s.step === STEPS.VALUE
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
        step: STEPS.FIELD,
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
        step: STEPS.CONTENT_TYPE,
        draft: null,
        editingIndex: null,
        text: '',
        query: { contentType: undefined, q: s.query.q, filters: [] },
      };

    case 'pickField': {
      const ops = availableOperators(action.field.type, {
        rich: s.rich,
        multiValue: s.multiValue,
        range: s.range,
      });
      const op = ops[0] ?? defaultOperator(action.field.type);
      return {
        ...s,
        draft: { field: action.field, op: op.id, value: null },
        text: '',
        // One operator → skip the operator step; otherwise pick an operator.
        step: ops.length <= 1 ? STEPS.VALUE : STEPS.OPERATOR,
      };
    }

    case 'pickOperator': {
      if (!s.draft) return s;
      // Carry the draft's value into the value step. A fresh filter has value
      // null (→ empty input); re-editing an operator prefills the typed value so
      // e.g. is → is not on "three" keeps "three". Entry / select / boolean are
      // re-picked from the dropdown, so their input starts empty.
      const kind = valueInputKind(s.draft.field.type, action.op);
      const prefill =
        kind === 'text' || kind === 'number' ? String(s.draft.value ?? '') : '';
      return {
        ...s,
        draft: { ...s.draft, op: action.op },
        step: STEPS.VALUE,
        text: prefill,
      };
    }

    case 'setValue':
      return s.draft
        ? {
            ...s,
            draft: { ...s.draft, value: action.value },
            text: String(action.value ?? ''),
          }
        : s;

    case 'toggleValue': {
      if (!s.draft) return s;
      // Multi-value (list) ops accumulate a string[] without touching `text`
      // (text is the multi-entry search query, not the value). Null → [].
      const arr = (
        Array.isArray(s.draft.value) ? s.draft.value : []
      ) as string[];
      const next = arr.includes(action.value)
        ? arr.filter((v) => v !== action.value)
        : [...arr, action.value];
      return { ...s, draft: { ...s.draft, value: next } };
    }

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
        // Unscoped → back to contentType (offers system fields + content types);
        // scoped → back to field. Mirrors the backspace empty-draft logic.
        step: s.query.contentType ? STEPS.FIELD : STEPS.CONTENT_TYPE,
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
      const draft = { field, op: filter.op, value: filter.value };
      // Operator segment → re-open the operator step with a CLEAR input. The value
      // stays on the draft and is re-prefilled at the value step (pickOperator),
      // so changing e.g. is → is not keeps the value without showing it here.
      if (action.segment === 'operator') {
        return {
          ...s,
          draft,
          editingIndex: action.index,
          step: STEPS.OPERATOR,
          text: '',
        };
      }
      // value / field → value step with a kind-aware prefill so a typed value is
      // editable; entry / select / boolean are re-picked, so start empty. Field
      // re-pick is deferred, so the `field` segment falls through here too.
      const kind = valueInputKind(field.type, filter.op);
      const prefill =
        kind === 'text' || kind === 'number' ? String(filter.value ?? '') : '';
      return {
        ...s,
        draft,
        editingIndex: action.index,
        step: STEPS.VALUE,
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
          step: s.query.contentType ? STEPS.FIELD : STEPS.CONTENT_TYPE,
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
