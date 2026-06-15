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

// The full string-field VALUE operators, shared by TEXT and ENTRY_TITLE (a
// single const so the two can never silently de-mirror). TEXT additionally gets
// the nullary ops below; ENTRY_TITLE does not (an entry always has a title).
const TEXT_OPERATORS: Operator[] = [
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
];

// Nullary operators (#359) — take NO value (arity 'zero'): they filter on a
// field's presence. Offered for every field type that can be unset/empty so an
// editor can find e.g. "Articles with no Author" or "entries missing an Image".
// NOT offered for ENTRY_TITLE (an entry always has a title). `is not set` is
// listed first — it's the primary use case.
const IS_NOT_SET: Operator = {
  id: 'isNotSet',
  label: 'is not set',
  description: 'Empty or missing',
  rich: true,
};
const IS_SET: Operator = {
  id: 'isSet',
  label: 'is set',
  description: 'Has any value',
  rich: true,
};
const NULLARY_OPS: Operator[] = [IS_NOT_SET, IS_SET];

// Operators per field type. `eq` is first (the locked default) for every type
// except DATETIME, which is range-only (before/after/between) — equality on a
// timestamp is rarely what an editor wants, so `eq` is intentionally omitted.
const REGISTRY: Partial<Record<FieldTypeName, Operator[]>> = {
  TEXT: [...TEXT_OPERATORS, ...NULLARY_OPS],
  TEXTAREA: [
    EQ,
    {
      id: 'contains',
      label: 'contains',
      description: 'Matches part of the value',
      rich: true,
    },
    ...NULLARY_OPS,
  ],
  SLUG: [
    EQ,
    {
      id: 'startsWith',
      label: 'starts with',
      description: 'Matches the beginning',
      rich: true,
    },
    ...NULLARY_OPS,
  ],
  // ENTRY_TITLE mirrors TEXT's value operators, but its filters compile to the
  // index envelope path `entryTitle` (not `fields.<id>`) — see
  // compileSearchFilter. It deliberately omits the nullary ops: an entry always
  // has a title, so "is not set" would never match.
  ENTRY_TITLE: TEXT_OPERATORS,
  NUMBER: [
    { id: 'eq', label: '=', description: 'Equals', rich: false },
    { id: 'neq', label: '≠', description: 'Not equal', rich: true },
    { id: 'gt', label: '>', description: 'Greater than', rich: true },
    { id: 'gte', label: '≥', description: 'At least', rich: true },
    { id: 'lt', label: '<', description: 'Less than', rich: true },
    { id: 'lte', label: '≤', description: 'At most', rich: true },
    ...NULLARY_OPS,
  ],
  BOOLEAN: [EQ, ...NULLARY_OPS],
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
    ...NULLARY_OPS,
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
    ...NULLARY_OPS,
  ],
  RELATION: [
    EQ,
    {
      id: 'neq',
      label: 'is not',
      description: 'Excludes the entry',
      rich: true,
    },
    ...NULLARY_OPS,
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
    ...NULLARY_OPS,
  ],
};

export const FILTERABLE_FIELD_TYPES = Object.keys(REGISTRY) as FieldTypeName[];

// Value cardinality is a pure function of the operator id (ids don't collide
// across types with different cardinalities), so arity is type-independent.
const NULLARY_OP_IDS: ReadonlySet<string> = new Set(['isSet', 'isNotSet']);
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

/** Value cardinality the operator expects: none / scalar / range pair / list. */
export function operatorArity(opId: string): 'zero' | 'one' | 'two' | 'many' {
  if (NULLARY_OP_IDS.has(opId)) return 'zero';
  if (RANGE_OPS.has(opId)) return 'two';
  if (LIST_OPS.has(opId)) return 'many';
  return 'one';
}

/**
 * Operators offered for `type`. `rich: false` returns equality-only (v1).
 * `multiValue: false` hides arity-many (list) ops (in / containsAny / containsAll).
 * `range: false` hides arity-two (range) ops (between). `nullary: false` hides
 * arity-zero presence ops (is set / is not set) — passed for system envelope
 * fields ($entryKey / $status / $id), which are always set (#359). All default on.
 */
export function availableOperators(
  type: FieldTypeName,
  {
    rich,
    multiValue = true,
    range = true,
    nullary = true,
  }: { rich: boolean; multiValue?: boolean; range?: boolean; nullary?: boolean }
): Operator[] {
  const all = REGISTRY[type] ?? [EQ];
  const richFiltered = rich ? all : all.filter((o) => !o.rich);
  return richFiltered.filter((o) => {
    const arity = operatorArity(o.id);
    if (arity === 'many') return multiValue;
    if (arity === 'two') return range;
    if (arity === 'zero') return nullary;
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
  ENTRY_TITLE: 'text',
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
