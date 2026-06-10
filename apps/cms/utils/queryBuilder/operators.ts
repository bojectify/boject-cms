import { FIELD_TYPES, type FieldTypeName } from '../fieldTypes';
import type { ValueInputKind } from './types';

export interface Operator {
  id: string;
  label: string; // shown in the operator chip segment + dropdown
  description: string; // dropdown helper line
  /** true once #301 lands; v1 only renders `eq`. */
  rich: boolean;
}

const EQ: Operator = {
  id: 'eq',
  label: 'is',
  description: 'Exact match',
  rich: false,
};

// Operators per field type. `eq` is first (the locked default) for every type
// except DATETIME, which is range-only (before/after/between) — equality on a
// timestamp is rarely what an editor wants, so `eq` is intentionally omitted.
const REGISTRY: Partial<Record<FieldTypeName, Operator[]>> = {
  TEXT: [
    EQ,
    { id: 'neq', label: 'is not', description: 'Excludes matches', rich: true },
    {
      id: 'contains',
      label: 'contains',
      description: 'Matches part of the value',
      rich: true,
    },
    {
      id: 'startsWith',
      label: 'starts with',
      description: 'Matches the beginning',
      rich: true,
    },
  ],
  TEXTAREA: [
    EQ,
    {
      id: 'contains',
      label: 'contains',
      description: 'Matches part of the value',
      rich: true,
    },
  ],
  SLUG: [
    EQ,
    {
      id: 'startsWith',
      label: 'starts with',
      description: 'Matches the beginning',
      rich: true,
    },
  ],
  // ENTRY_TITLE is intentionally absent: its value is folded into the search
  // index envelope (`entryTitle`), never under `fields.<id>`, so a structured
  // `fields.title = …` filter matches nothing. Title is searched via free-text
  // `q` (the index ranks `entryTitle` highest). Filtering by envelope/system
  // fields (id, entryKey, entryTitle) is a deferred follow-up.
  NUMBER: [
    { id: 'eq', label: '=', description: 'Equals', rich: false },
    { id: 'neq', label: '≠', description: 'Not equal', rich: true },
    { id: 'gt', label: '>', description: 'Greater than', rich: true },
    { id: 'gte', label: '≥', description: 'At least', rich: true },
    { id: 'lt', label: '<', description: 'Less than', rich: true },
    { id: 'lte', label: '≤', description: 'At most', rich: true },
  ],
  BOOLEAN: [EQ],
  DATETIME: [
    {
      id: 'before',
      label: 'before',
      description: 'Before the date',
      rich: true,
    },
    { id: 'after', label: 'after', description: 'After the date', rich: true },
    {
      id: 'between',
      label: 'is between',
      description: 'Within a range',
      rich: true,
    },
  ],
  SELECT: [
    EQ,
    {
      id: 'neq',
      label: 'is not',
      description: 'Excludes the choice',
      rich: true,
    },
    {
      id: 'in',
      label: 'is any of',
      description: 'Matches any selected',
      rich: true,
    },
  ],
  RELATION: [
    EQ,
    {
      id: 'neq',
      label: 'is not',
      description: 'Excludes the entry',
      rich: true,
    },
  ],
  MULTIRELATION: [
    {
      id: 'eq',
      label: 'contains',
      description: 'Contains the entry',
      rich: false,
    },
    {
      id: 'containsAny',
      label: 'contains any',
      description: 'Contains any selected',
      rich: true,
    },
    {
      id: 'containsAll',
      label: 'contains all',
      description: 'Contains all selected',
      rich: true,
    },
  ],
};

export const FILTERABLE_FIELD_TYPES = Object.keys(REGISTRY) as FieldTypeName[];

// Value cardinality is a pure function of the operator id (ids don't collide
// across types with different cardinalities), so arity is type-independent.
const RANGE_OPS: ReadonlySet<string> = new Set(['between']);
const LIST_OPS: ReadonlySet<string> = new Set([
  'in',
  'containsAny',
  'containsAll',
]);

/** Every operator id that appears anywhere in the registry. */
export const OPERATOR_IDS: ReadonlySet<string> = new Set(
  Object.values(REGISTRY)
    .filter((ops): ops is Operator[] => ops !== undefined)
    .flat()
    .map((o) => o.id)
);

/**
 * True when `id` is a registered operator id (used to disambiguate the URL wire
 * form, where the middle `field:op:value` segment is untrusted input). Accepts
 * `unknown` and narrows, mirroring `isFieldTypeName` in fieldTypes.ts.
 */
export function isOperatorId(id: unknown): id is string {
  return typeof id === 'string' && OPERATOR_IDS.has(id);
}

/** Whether `opId` is a valid operator for `type` (per the registry). */
export function isOperatorAllowed(type: FieldTypeName, opId: string): boolean {
  return (REGISTRY[type] ?? []).some((o) => o.id === opId);
}

/** Value cardinality the operator expects: scalar / range pair / list. */
export function operatorArity(opId: string): 'one' | 'two' | 'many' {
  if (RANGE_OPS.has(opId)) return 'two';
  if (LIST_OPS.has(opId)) return 'many';
  return 'one';
}

/**
 * Operators offered for `type`. `rich: false` returns equality-only (v1).
 * `multiValue: false` hides arity-many (list) ops (in / containsAny / containsAll).
 * `range: false` hides arity-two (range) ops (between). Both default to "on".
 */
export function availableOperators(
  type: FieldTypeName,
  {
    rich,
    multiValue = true,
    range = true,
  }: { rich: boolean; multiValue?: boolean; range?: boolean }
): Operator[] {
  const all = REGISTRY[type] ?? [EQ];
  const richFiltered = rich ? all : all.filter((o) => !o.rich);
  return richFiltered.filter((o) => {
    const arity = operatorArity(o.id);
    if (arity === 'many') return multiValue;
    if (arity === 'two') return range;
    return true; // 'one'
  });
}

export function defaultOperator(type: FieldTypeName): Operator {
  return (REGISTRY[type] ?? [EQ])[0] ?? EQ;
}

/** The display label for an operator id within a field type (e.g. eq -> "is"). */
export function operatorLabel(type: FieldTypeName, id: string): string {
  return (REGISTRY[type] ?? [EQ]).find((o) => o.id === id)?.label ?? id;
}

const VALUE_KIND: Partial<Record<FieldTypeName, ValueInputKind>> = {
  TEXT: 'text',
  TEXTAREA: 'text',
  SLUG: 'text',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  SELECT: 'select',
  RELATION: 'entry',
  MULTIRELATION: 'entry',
};

export function valueInputKind(
  type: FieldTypeName,
  op: string
): ValueInputKind {
  if (type === FIELD_TYPES.SELECT && op === 'in') return 'multiSelect';
  if (
    type === FIELD_TYPES.MULTIRELATION &&
    (op === 'containsAny' || op === 'containsAll')
  )
    return 'multiEntry';
  if (type === FIELD_TYPES.DATETIME)
    return op === 'between' ? 'dateRange' : 'date';
  return VALUE_KIND[type] ?? 'text';
}
