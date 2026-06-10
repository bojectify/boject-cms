import { describe, it, expect } from 'vitest';
import {
  availableOperators,
  defaultOperator,
  valueInputKind,
  FILTERABLE_FIELD_TYPES,
  isOperatorAllowed,
  operatorArity,
  isOperatorId,
} from './operators';

describe('operators registry', () => {
  it('exposes the equality op as the v1 default for each filterable type', () => {
    for (const t of FILTERABLE_FIELD_TYPES) {
      expect(defaultOperator(t).id).toBe('eq');
    }
  });

  it('returns only the equality op when rich operators are off (v1)', () => {
    const ops = availableOperators('TEXT', { rich: false });
    expect(ops.map((o) => o.id)).toEqual(['eq']);
  });

  it('returns the full set when rich operators are on', () => {
    const ops = availableOperators('TEXT', { rich: true }).map((o) => o.id);
    expect(ops).toContain('eq');
    expect(ops).toContain('contains');
    expect(ops).toContain('startsWith');
  });

  it('maps field types to value-input kinds', () => {
    expect(valueInputKind('BOOLEAN', 'eq')).toBe('boolean');
    expect(valueInputKind('SELECT', 'eq')).toBe('select');
    expect(valueInputKind('NUMBER', 'eq')).toBe('number');
    expect(valueInputKind('DATETIME', 'eq')).toBe('datetime');
    expect(valueInputKind('RELATION', 'eq')).toBe('entry');
    expect(valueInputKind('MULTIRELATION', 'eq')).toBe('entry');
    expect(valueInputKind('TEXT', 'eq')).toBe('text');
  });

  it('excludes RICHTEXT, IMAGE, and ENTRY_TITLE from filterable types', () => {
    expect(FILTERABLE_FIELD_TYPES).not.toContain('RICHTEXT');
    expect(FILTERABLE_FIELD_TYPES).not.toContain('IMAGE');
    // ENTRY_TITLE lives in the index envelope, not under `fields.<id>`, so it
    // is not filterable — title is searched via free-text `q`.
    expect(FILTERABLE_FIELD_TYPES).not.toContain('ENTRY_TITLE');
  });

  it('isOperatorAllowed gates operators per field type', () => {
    expect(isOperatorAllowed('TEXT', 'contains')).toBe(true);
    expect(isOperatorAllowed('TEXT', 'startsWith')).toBe(true);
    expect(isOperatorAllowed('TEXTAREA', 'startsWith')).toBe(false); // curated out
    expect(isOperatorAllowed('SLUG', 'contains')).toBe(false); // curated out
    expect(isOperatorAllowed('NUMBER', 'gte')).toBe(true);
    expect(isOperatorAllowed('NUMBER', 'contains')).toBe(false);
    expect(isOperatorAllowed('BOOLEAN', 'neq')).toBe(false); // BOOLEAN is eq-only
    expect(isOperatorAllowed('MULTIRELATION', 'containsAll')).toBe(true);
    // Non-filterable types have no operators at all.
    expect(isOperatorAllowed('RICHTEXT', 'eq')).toBe(false);
    expect(isOperatorAllowed('ENTRY_TITLE', 'eq')).toBe(false);
    expect(isOperatorAllowed('IMAGE', 'eq')).toBe(false);
    // An unregistered op id on a filterable type is also not allowed.
    expect(isOperatorAllowed('TEXT', 'nope')).toBe(false);
  });

  it('operatorArity classifies value cardinality (type-independent)', () => {
    expect(operatorArity('eq')).toBe('one');
    expect(operatorArity('gt')).toBe('one');
    expect(operatorArity('between')).toBe('two');
    expect(operatorArity('in')).toBe('many');
    expect(operatorArity('containsAny')).toBe('many');
    expect(operatorArity('containsAll')).toBe('many');
    // Unknown / unregistered ids default to the scalar arity (safe fallback).
    expect(operatorArity('nope')).toBe('one');
  });

  it('isOperatorId recognises every registered operator id', () => {
    expect(isOperatorId('eq')).toBe(true);
    expect(isOperatorId('between')).toBe(true);
    expect(isOperatorId('containsAll')).toBe(true);
    expect(isOperatorId('nope')).toBe(false);
    expect(isOperatorId('https')).toBe(false); // a URL scheme is never an op id
  });

  it('multiValue gates arity-many (list) ops; range gates arity-two (between)', () => {
    const select = (o: { multiValue?: boolean; range?: boolean }) =>
      availableOperators('SELECT', { rich: true, ...o }).map((x) => x.id);
    expect(select({ multiValue: false })).not.toContain('in'); // arity many gated
    expect(select({ multiValue: true })).toContain('in');

    const dt = (o: { multiValue?: boolean; range?: boolean }) =>
      availableOperators('DATETIME', { rich: true, ...o }).map((x) => x.id);
    expect(dt({ range: false })).not.toContain('between'); // arity two gated
    expect(dt({ range: true })).toContain('between');
    expect(dt({ range: false })).toContain('before'); // arity one unaffected

    const mr = (o: { multiValue?: boolean }) =>
      availableOperators('MULTIRELATION', { rich: true, ...o }).map(
        (x) => x.id
      );
    expect(mr({ multiValue: false })).toEqual(['eq']); // only single contains
    expect(mr({ multiValue: true })).toEqual(
      expect.arrayContaining(['eq', 'containsAny', 'containsAll'])
    );
  });

  it('valueInputKind is op-aware for list ops', () => {
    expect(valueInputKind('SELECT', 'in')).toBe('multiSelect');
    expect(valueInputKind('SELECT', 'eq')).toBe('select'); // single unchanged
    expect(valueInputKind('MULTIRELATION', 'containsAny')).toBe('multiEntry');
    expect(valueInputKind('MULTIRELATION', 'containsAll')).toBe('multiEntry');
    expect(valueInputKind('MULTIRELATION', 'eq')).toBe('entry'); // single unchanged
    expect(valueInputKind('TEXT', 'contains')).toBe('text'); // unaffected
  });
});
