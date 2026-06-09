import type { FieldTypeName } from '../fieldTypes';
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

// Operators per field type. `eq` is always first (the v1 locked default).
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
    EQ,
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

export function availableOperators(
  type: FieldTypeName,
  opts: { rich: boolean }
): Operator[] {
  const all = REGISTRY[type] ?? [EQ];
  return opts.rich ? all : all.filter((o) => !o.rich);
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
  DATETIME: 'datetime',
  RELATION: 'entry',
  MULTIRELATION: 'entry',
};

export function valueInputKind(
  type: FieldTypeName,
  _op: string
): ValueInputKind {
  return VALUE_KIND[type] ?? 'text';
}
