import { describe, it, expect } from 'vitest';
import {
  availableOperators,
  defaultOperator,
  valueInputKind,
  FILTERABLE_FIELD_TYPES,
  isOperatorAllowed,
  operatorArity,
  isOperatorId,
  operatorLabel,
} from './operators';

describe('operators registry', () => {
  it('exposes the equality op as the default for filterable types (DATETIME excepted)', () => {
    for (const t of FILTERABLE_FIELD_TYPES) {
      if (t === 'DATETIME') continue; // DATETIME dropped `eq`; its default is `before`
      expect(defaultOperator(t).id).toBe('eq');
    }
    expect(defaultOperator('DATETIME').id).toBe('before');
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
    expect(valueInputKind('DATETIME', 'before')).toBe('date');
    expect(valueInputKind('DATETIME', 'after')).toBe('date');
    expect(valueInputKind('DATETIME', 'between')).toBe('dateRange');
    expect(valueInputKind('RELATION', 'eq')).toBe('entry');
    expect(valueInputKind('MULTIRELATION', 'eq')).toBe('entry');
    expect(valueInputKind('TEXT', 'eq')).toBe('text');
  });

  it('excludes RICHTEXT and IMAGE from filterable types; includes ENTRY_TITLE', () => {
    expect(FILTERABLE_FIELD_TYPES).not.toContain('RICHTEXT');
    expect(FILTERABLE_FIELD_TYPES).not.toContain('IMAGE');
    // ENTRY_TITLE is filterable — its filters compile to the index envelope
    // path `entryTitle` (see compileSearchFilter), not `fields.<id>`.
    expect(FILTERABLE_FIELD_TYPES).toContain('ENTRY_TITLE');
  });

  it('ENTRY_TITLE mirrors TEXT: eq/neq/contains/startsWith, eq-only without rich', () => {
    const rich = availableOperators('ENTRY_TITLE', { rich: true });
    expect(rich.map((o) => o.id)).toEqual([
      'eq',
      'neq',
      'contains',
      'startsWith',
    ]);
    const v1 = availableOperators('ENTRY_TITLE', { rich: false });
    expect(v1.map((o) => o.id)).toEqual(['eq']);
    expect(valueInputKind('ENTRY_TITLE', 'eq')).toBe('text');
    expect(operatorLabel('ENTRY_TITLE', 'eq')).toBe('is');
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
    expect(isOperatorAllowed('ENTRY_TITLE', 'eq')).toBe(true);
    // Non-filterable types have no operators at all.
    expect(isOperatorAllowed('RICHTEXT', 'eq')).toBe(false);
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
    // only the single-value `contains` (eq) survives multiValue:false — plus the
    // arity-zero nullary ops, which multiValue does not gate (#359).
    expect(mr({ multiValue: false })).toEqual(['eq', 'isNotSet', 'isSet']);
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

  it('DATETIME offers before/after/between (no eq) and gates between behind range', () => {
    expect(isOperatorAllowed('DATETIME', 'eq')).toBe(false);
    const ops = availableOperators('DATETIME', { rich: true, range: true }).map(
      (o) => o.id
    );
    // before/after/between, then the nullary presence ops (#359).
    expect(ops).toEqual(['before', 'after', 'between', 'isNotSet', 'isSet']);
  });

  it('nullary presence ops are arity-zero, rich, and offered for every value type except ENTRY_TITLE (#359)', () => {
    expect(operatorArity('isNotSet')).toBe('zero');
    expect(operatorArity('isSet')).toBe('zero');
    expect(isOperatorId('isNotSet')).toBe(true);

    const applicable = [
      'TEXT',
      'TEXTAREA',
      'SLUG',
      'NUMBER',
      'BOOLEAN',
      'SELECT',
      'DATETIME',
      'RELATION',
      'MULTIRELATION',
    ] as const;
    for (const t of applicable) {
      const richIds = availableOperators(t, { rich: true }).map((o) => o.id);
      expect(richIds).toContain('isNotSet');
      expect(richIds).toContain('isSet');
      expect(isOperatorAllowed(t, 'isNotSet')).toBe(true);
      // rich ops → hidden in equality-only (non-rich) mode
      const plainIds = availableOperators(t, { rich: false }).map((o) => o.id);
      expect(plainIds).not.toContain('isNotSet');
    }

    // ENTRY_TITLE is always set → never offers the nullary ops
    expect(
      availableOperators('ENTRY_TITLE', { rich: true }).map((o) => o.id)
    ).not.toContain('isNotSet');
    expect(isOperatorAllowed('ENTRY_TITLE', 'isNotSet')).toBe(false);

    // `nullary: false` suppresses them (used for always-set system envelope
    // fields like $entryKey / $status / $id).
    expect(
      availableOperators('SLUG', { rich: true, nullary: false }).map(
        (o) => o.id
      )
    ).not.toContain('isNotSet');
  });
});
