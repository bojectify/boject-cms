import type { FieldTypeName } from '../fieldTypes';

/** A content-type field as the builder consumes it (mapped from ContentTypeField by the parent). */
export interface QueryField {
  identifier: string; // camelCase, e.g. "summary"
  name: string; // display, e.g. "Summary"
  type: FieldTypeName;
  /** SELECT choices, when type === 'SELECT'. */
  choices?: { label: string; value: string }[];
  /** RELATION / MULTIRELATION target content-type ids. */
  targetContentTypeIds?: string[];
}

export interface QueryContentType {
  id: string; // uuid (route param)
  identifier: string; // PascalCase, e.g. "Article" (the /api/search contentType value)
  name: string; // display, e.g. "Article"
  fields: QueryField[];
}

/** One AND-ed filter. `op` is an operator id from operators.ts; v1 always emits the equality op. */
export interface SearchFilter {
  field: string; // QueryField.identifier
  op: string; // operator id, e.g. 'eq'
  value: unknown; // typed per field/operator
}

/** Engine-agnostic query the component emits. */
export interface SearchQuery {
  /** Content-type identifier (the leading chip). Undefined = unscoped / cross-type. */
  contentType?: string;
  /** Free text. */
  q?: string;
  /** AND-ed field filters (always empty when contentType is undefined). */
  filters: SearchFilter[];
}

/** The value-input kind the dropdown renders for a (field, operator) pair. */
export type ValueInputKind =
  | 'text'
  | 'number'
  | 'boolean'
  | 'select'
  | 'datetime'
  | 'entry';
