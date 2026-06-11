import { FIELD_TYPES, type FieldTypeName } from '../../utils/fieldTypes';
import {
  isOperatorAllowed,
  operatorArity,
} from '../../utils/queryBuilder/operators';
import {
  getSystemField,
  isSystemFieldId,
} from '../../utils/queryBuilder/systemFields';
import { datetimeToEpoch } from './searchDocument';

// Content-type field identifiers are camelCase; reject anything else so a
// malformed field 400s rather than silently matching nothing / injecting.
const FIELD_ID = /^[a-z][a-zA-Z0-9]*$/;

/** Thrown on an invalid field / operator / value combination → 400 (REST) / BAD_USER_INPUT (GraphQL). */
export class SearchInputError extends Error {}

/**
 * One AND-ed filter as the compiler consumes it. `op` defaults to 'eq'.
 * Scalar ops read `value` (or the single element of `values`); multi-value ops
 * (in / containsAny / containsAll / between) read `values`.
 */
export interface SearchFilter {
  field: string;
  op?: string;
  value?: string;
  values?: string[];
}

/** Quote + escape a value for a Meili string filter literal. */
function meiliLiteral(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function valueList(filter: SearchFilter): string[] {
  if (filter.values !== undefined) return filter.values;
  if (filter.value !== undefined) return [filter.value];
  return [];
}

// `Number(raw)` normalises (`'5.0'`→`5`, `'1e3'`→`1000`); harmless — NUMBER
// fields are indexed via the same numeric coercion, so any normalised form
// compiles to a semantically-equal comparison against the stored value.
function numberLiteral(raw: string, field: string): string {
  const n = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(n)) {
    throw new SearchInputError(
      `Filter "${field}" expects a number, got "${raw}"`
    );
  }
  return String(n);
}

function epochLiteral(raw: string, field: string): string {
  const t = datetimeToEpoch(raw);
  if (t === null) {
    throw new SearchInputError(
      `Filter "${field}" expects a date, got "${raw}"`
    );
  }
  return String(t);
}

function booleanLiteral(raw: string, field: string): string {
  if (raw !== 'true' && raw !== 'false') {
    throw new SearchInputError(
      `Filter "${field}" expects true or false, got "${raw}"`
    );
  }
  return raw;
}

const NUMBER_SYMBOL: Record<string, string> = {
  eq: '=',
  neq: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};

function notValid(op: string, field: string): SearchInputError {
  return new SearchInputError(
    `Operator "${op}" is not valid for field "${field}"`
  );
}

function textClause(
  path: string,
  op: string,
  v: string,
  field: string
): string {
  switch (op) {
    case 'eq':
      return `${path} = ${meiliLiteral(v)}`;
    case 'neq':
      return `${path} != ${meiliLiteral(v)}`;
    case 'contains':
      return `${path} CONTAINS ${meiliLiteral(v)}`;
    case 'startsWith':
      return `${path} STARTS WITH ${meiliLiteral(v)}`;
    default:
      throw notValid(op, field);
  }
}

function dateClause(
  path: string,
  op: string,
  values: string[],
  field: string
): string {
  switch (op) {
    case 'eq':
      return `${path} = ${epochLiteral(values[0]!, field)}`;
    case 'before':
      return `${path} < ${epochLiteral(values[0]!, field)}`;
    case 'after':
      return `${path} > ${epochLiteral(values[0]!, field)}`;
    case 'between':
      return `${path} ${epochLiteral(values[0]!, field)} TO ${epochLiteral(values[1]!, field)}`;
    default:
      throw notValid(op, field);
  }
}

function enumClause(
  path: string,
  op: string,
  values: string[],
  field: string
): string {
  switch (op) {
    case 'eq':
      return `${path} = ${meiliLiteral(values[0]!)}`;
    case 'neq':
      return `${path} != ${meiliLiteral(values[0]!)}`;
    case 'in':
      return `${path} IN [${values.map(meiliLiteral).join(', ')}]`;
    default:
      throw notValid(op, field);
  }
}

function multirelationClause(
  path: string,
  op: string,
  values: string[],
  field: string
): string {
  switch (op) {
    case 'eq': // "contains" — array membership of a single id
      return `${path} = ${meiliLiteral(values[0]!)}`;
    case 'containsAny':
      return `${path} IN [${values.map(meiliLiteral).join(', ')}]`;
    case 'containsAll':
      return `(${values.map((v) => `${path} = ${meiliLiteral(v)}`).join(' AND ')})`;
    default:
      throw notValid(op, field);
  }
}

/**
 * Compile one filter to a Meilisearch filter clause. Content-type fields
 * compile over `fields.<id>` — except ENTRY_TITLE, which targets the envelope
 * attribute `entryTitle`. System fields (`$`-prefixed, e.g. `$entryKey`)
 * resolve via the closed systemFields registry to an envelope attribute and a
 * "donor" field type, then flow through the same operator/arity/clause
 * machinery as a typed field.
 * `fieldTypes` maps a field identifier to its FieldType (resolved from the
 * scoped content type). An absent entry = unknown type (no content-type scope):
 * only `eq` is allowed there and renders as a quoted string — the #227
 * back-compat behaviour. System fields need NO scope (envelope attributes
 * exist on every document), so they compile with empty `fieldTypes`.
 * Throws SearchInputError on any bad combination.
 */
export function compileSearchFilter(
  filter: SearchFilter,
  fieldTypes: Record<string, FieldTypeName>
): string {
  const { field } = filter;

  // Resolve the compile target (type + engine path). System branch: registry
  // lookup — a miss ($bogus, bare '$') is a 400, a hit borrows the donor type.
  // Typed branch: validate the identifier shape, then look up the scoped type.
  let type: FieldTypeName | undefined;
  let path: string;
  if (isSystemFieldId(field)) {
    const sys = getSystemField(field);
    if (!sys) {
      throw new SearchInputError(`Unknown system field "${field}"`);
    }
    type = sys.type;
    path = sys.enginePath;
  } else {
    if (!FIELD_ID.test(field)) {
      throw new SearchInputError(`Invalid filter field "${field}"`);
    }
    type = fieldTypes[field];
    path = type === FIELD_TYPES.ENTRY_TITLE ? 'entryTitle' : `fields.${field}`;
  }

  const op = filter.op ?? 'eq';
  const values = valueList(filter);

  // Unknown field type (no content-type scope): equality-as-quoted-string only.
  if (!type) {
    if (op !== 'eq') {
      throw new SearchInputError(
        `Operator "${op}" on "${field}" requires a content type scope`
      );
    }
    if (values.length !== 1) {
      throw new SearchInputError(`Filter "${field}" needs exactly 1 value`);
    }
    return `${path} = ${meiliLiteral(values[0]!)}`;
  }

  if (!isOperatorAllowed(type, op)) {
    throw notValid(op, field);
  }

  // Arity check (cardinality is type-independent).
  const arity = operatorArity(op);
  if (arity === 'two' && values.length !== 2) {
    throw new SearchInputError(
      `Operator "${op}" on "${field}" needs exactly 2 values`
    );
  }
  if (arity === 'many' && values.length === 0) {
    throw new SearchInputError(
      `Operator "${op}" on "${field}" needs at least 1 value`
    );
  }
  if (arity === 'one' && values.length !== 1) {
    throw new SearchInputError(
      `Operator "${op}" on "${field}" needs exactly 1 value`
    );
  }

  switch (type) {
    case FIELD_TYPES.TEXT:
    case FIELD_TYPES.TEXTAREA:
    case FIELD_TYPES.SLUG:
    case FIELD_TYPES.ENTRY_TITLE: // string-shaped; path is `entryTitle`
      return textClause(path, op, values[0]!, field);

    case FIELD_TYPES.NUMBER:
      return `${path} ${NUMBER_SYMBOL[op]!} ${numberLiteral(values[0]!, field)}`;

    case FIELD_TYPES.DATETIME:
      return dateClause(path, op, values, field);

    case FIELD_TYPES.SELECT:
      return enumClause(path, op, values, field);

    case FIELD_TYPES.RELATION:
      return op === 'neq'
        ? `${path} != ${meiliLiteral(values[0]!)}`
        : `${path} = ${meiliLiteral(values[0]!)}`;

    case FIELD_TYPES.MULTIRELATION:
      return multirelationClause(path, op, values, field);

    case FIELD_TYPES.BOOLEAN:
      return `${path} = ${booleanLiteral(values[0]!, field)}`;

    default:
      // RICHTEXT / IMAGE are not in the registry, so isOperatorAllowed
      // already threw; this is a defensive backstop.
      throw new SearchInputError(`Field "${field}" is not filterable`);
  }
}
