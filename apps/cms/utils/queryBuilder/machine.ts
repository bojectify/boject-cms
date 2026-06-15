import type {
  QueryContentType,
  QueryField,
  SearchFilter,
  SearchQuery,
} from './types';
import {
  ARITY,
  availableOperators,
  defaultOperator,
  operatorArity,
  valueInputKind,
} from './operators';
import { addFilter, removeFilter } from './query';
import { isSystemFieldId, resolveQueryField } from './systemFields';

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

/**
 * Commit `filter` into the query — replace in place when re-editing a committed
 * filter (editingIndex), otherwise append — then clear the draft and return to
 * the field step (scoped) / content-type step (unscoped). Shared by the
 * value-step commit and the nullary operator commit (#359).
 */
function commitDraftFilter(
  s: BuilderState,
  filter: SearchFilter
): BuilderState {
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
    step: s.query.contentType ? STEPS.FIELD : STEPS.CONTENT_TYPE,
  };
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
  | { kind: 'editDraft'; segment: 'operator' }
  | { kind: 'commitFreeText' }
  | { kind: 'editFreeText' }
  | { kind: 'removeFreeText' }
  | { kind: 'backspace' }
  | { kind: 'run' };

export function reduce(prev: BuilderState, action: Action): BuilderState {
  const s = { ...prev, intent: null };
  switch (action.kind) {
    case 'setFreeText':
      // `text` is the transient list-finder / free-text *candidate* — it never
      // live-mutates the committed free-text `query.q` (the FreeTextChip). The
      // candidate is promoted to `query.q` explicitly via `commitFreeText` (the
      // "Search for …" path / Enter), mirroring how the value step commits.
      return { ...s, text: action.q };

    case 'pickContentType':
      // The text typed at the contentType step was a type-finder, not a
      // free-text query for the now-scoped search — drop it from the input. A
      // *committed* `query.q` (the chip) survives scoping: the per-type route
      // carries it (planNavigation/compileQuery), so it is preserved here.
      return {
        ...s,
        step: STEPS.FIELD,
        text: '',
        draft: null,
        editingIndex: null,
        query: {
          ...s.query,
          contentType: action.contentType.identifier,
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
        // System fields ($entryKey / $status / $id) are always set → no nullary
        // ops, so the offered set matches the dropdown's (#359).
        nullary: !isSystemFieldId(action.field.identifier),
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
      // Nullary operators (is set / is not set) take no value — commit the chip
      // straight after the operator, skipping the value step entirely (#359).
      if (operatorArity(action.op) === ARITY.ZERO) {
        return commitDraftFilter(s, {
          field: s.draft.field.identifier,
          op: action.op,
          value: undefined,
        });
      }
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

    case 'commitValue':
      if (!s.draft) return s;
      return commitDraftFilter(s, {
        field: s.draft.field.identifier,
        op: s.draft.op,
        value: s.draft.value,
      });

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

    case 'editDraft': {
      // Re-open the IN-PROGRESS draft's operator step (vs editFilter, which
      // re-opens a committed filter by index). The field + value stay on the
      // draft; the value is re-prefilled at the value step by pickOperator, so
      // e.g. is → is not keeps a typed value. No editingIndex — it's the draft.
      if (!s.draft) return s;
      return { ...s, step: STEPS.OPERATOR, text: '' };
    }

    case 'commitFreeText':
      // Promote the transient `text` candidate to the committed free-text
      // `query.q` (rendered as the FreeTextChip) and clear the input. Empty
      // text clears the chip. The host follows this with a `run`.
      return { ...s, text: '', query: { ...s.query, q: s.text || undefined } };

    case 'editFreeText':
      // Move the committed `query.q` back into the input for editing (chip →
      // input) and clear the chip; re-commit via the "Search for …" path. Land
      // on the field step (scoped) / content-type step (unscoped) so the
      // type/field list stays offered while editing.
      return {
        ...s,
        text: s.query.q ?? '',
        query: { ...s.query, q: undefined },
        step: s.query.contentType ? STEPS.FIELD : STEPS.CONTENT_TYPE,
      };

    case 'removeFreeText':
      // The chip's ✕ — drop the committed free-text query.
      return { ...s, query: { ...s.query, q: undefined } };

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
      // An empty input backs out the rightmost thing first, matching the chip
      // row's visual order: the in-progress draft (cancel it — whether a new add
      // or an in-place edit — and return to field selection; a re-edit leaves the
      // original committed filter untouched), then the free-text `q` chip (which
      // renders LAST, after the filter chips), then the last committed filter.
      if (s.text === '' && s.draft) {
        return {
          ...s,
          draft: null,
          editingIndex: null,
          step: s.query.contentType ? STEPS.FIELD : STEPS.CONTENT_TYPE,
        };
      }
      if (s.text === '' && !s.draft && s.query.q) {
        return { ...s, query: { ...s.query, q: undefined } };
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
