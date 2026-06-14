import { describe, it, expect } from 'vitest';
import { initState, reduce, STEPS } from './machine';
import { CONTENT_TYPES, ARTICLE_CT } from './fixtures';
import { getSystemField, toQueryField } from './systemFields';
import type { QueryContentType, QueryField } from './types';

const article: QueryContentType = {
  id: 'a1',
  identifier: 'Article',
  name: 'Article',
  fields: [
    { identifier: 'summary', name: 'Summary', type: 'TEXT' },
    {
      identifier: 'status',
      name: 'Status',
      type: 'SELECT',
      choices: [{ label: 'Active', value: 'Active' }],
    },
  ],
};

describe('builder machine', () => {
  it('starts in the content-type step when unscoped', () => {
    const s = initState({ contentTypes: [article] });
    expect(s.step).toBe(STEPS.CONTENT_TYPE);
    expect(s.query.contentType).toBeUndefined();
  });

  it('locks a content type and advances to the field step', () => {
    let s = initState({ contentTypes: [article] });
    s = reduce(s, { kind: 'pickContentType', contentType: article });
    expect(s.query.contentType).toBe('Article');
    expect(s.step).toBe(STEPS.FIELD);
  });

  it('pre-scopes via lockedContentType and starts in the field step', () => {
    const s = initState({
      contentTypes: [article],
      lockedContentType: article,
    });
    expect(s.query.contentType).toBe('Article');
    expect(s.step).toBe(STEPS.FIELD);
    expect(s.locked).toBe(true);
  });

  it('builds a filter: field -> operator -> value -> commit', () => {
    let s = initState({ contentTypes: [article], lockedContentType: article });
    s = reduce(s, { kind: 'pickField', field: article.fields[0]! }); // summary
    expect(s.step).toBe(STEPS.VALUE); // v1: operator auto-locked to eq, skip to value
    expect(s.draft?.op).toBe('eq');
    s = reduce(s, { kind: 'setValue', value: 'final' });
    s = reduce(s, { kind: 'commitValue' });
    expect(s.query.filters).toEqual([
      { field: 'summary', op: 'eq', value: 'final' },
    ]);
    expect(s.step).toBe(STEPS.FIELD); // back to field step, ready for the next filter
  });

  it('editFilter re-opens a committed filter at the value step (free-entry value pre-filled)', () => {
    let s = initState({ contentTypes: [article], lockedContentType: article });
    s = reduce(s, { kind: 'pickField', field: article.fields[0]! }); // summary (TEXT)
    s = reduce(s, { kind: 'setValue', value: 'first' });
    s = reduce(s, { kind: 'commitValue' });
    expect(s.query.filters).toHaveLength(1);
    s = reduce(s, { kind: 'editFilter', index: 0, segment: 'value' });
    expect(s.step).toBe(STEPS.VALUE);
    expect(s.editingIndex).toBe(0);
    expect(s.draft).toEqual({
      field: article.fields[0],
      op: 'eq',
      value: 'first',
    });
    expect(s.text).toBe('first'); // free-entry value pre-filled for editing
    // original filter untouched until commit
    expect(s.query.filters).toEqual([
      { field: 'summary', op: 'eq', value: 'first' },
    ]);
  });

  it('committing a re-edit replaces the filter in place (no duplicate, same index)', () => {
    let s = initState({ contentTypes: [article], lockedContentType: article });
    s = reduce(s, { kind: 'pickField', field: article.fields[0]! }); // summary
    s = reduce(s, { kind: 'setValue', value: 'first' });
    s = reduce(s, { kind: 'commitValue' });
    s = reduce(s, { kind: 'pickField', field: article.fields[1]! }); // status
    s = reduce(s, { kind: 'setValue', value: 'Active' });
    s = reduce(s, { kind: 'commitValue' });
    expect(s.query.filters).toHaveLength(2);
    s = reduce(s, { kind: 'editFilter', index: 0, segment: 'value' });
    s = reduce(s, { kind: 'setValue', value: 'changed' });
    s = reduce(s, { kind: 'commitValue' });
    expect(s.query.filters).toEqual([
      { field: 'summary', op: 'eq', value: 'changed' },
      { field: 'status', op: 'eq', value: 'Active' },
    ]);
    expect(s.editingIndex).toBeNull();
    expect(s.step).toBe(STEPS.FIELD);
  });

  it('cancelling a re-edit (backspace on empty) leaves the original filter untouched', () => {
    let s = initState({ contentTypes: [article], lockedContentType: article });
    s = reduce(s, { kind: 'pickField', field: article.fields[0]! });
    s = reduce(s, { kind: 'setValue', value: 'keep' });
    s = reduce(s, { kind: 'commitValue' });
    s = reduce(s, { kind: 'editFilter', index: 0, segment: 'value' });
    s = reduce(s, { kind: 'setFreeText', q: '' }); // clear the input
    s = reduce(s, { kind: 'backspace' }); // cancel
    expect(s.draft).toBeNull();
    expect(s.editingIndex).toBeNull();
    expect(s.query.filters).toEqual([
      { field: 'summary', op: 'eq', value: 'keep' },
    ]);
  });

  it('removeFilter shifts editingIndex when an earlier filter is removed', () => {
    let s = initState({ contentTypes: [article], lockedContentType: article });
    s = reduce(s, { kind: 'pickField', field: article.fields[0]! }); // filter 0
    s = reduce(s, { kind: 'setValue', value: 'a' });
    s = reduce(s, { kind: 'commitValue' });
    s = reduce(s, { kind: 'pickField', field: article.fields[1]! }); // filter 1
    s = reduce(s, { kind: 'setValue', value: 'Active' });
    s = reduce(s, { kind: 'commitValue' });
    s = reduce(s, { kind: 'editFilter', index: 1, segment: 'value' });
    expect(s.editingIndex).toBe(1);
    s = reduce(s, { kind: 'removeFilter', index: 0 });
    expect(s.editingIndex).toBe(0); // followed the filter down
    expect(s.query.filters).toHaveLength(1);
  });

  it('editDraft(operator) re-opens the operator step keeping the draft; value survives a re-pick', () => {
    // Rich TEXT has multiple operators, so the operator step is reachable.
    let s = initState({
      contentTypes: [article],
      lockedContentType: article,
      rich: true,
    });
    s = reduce(s, { kind: 'pickField', field: article.fields[0]! }); // summary (TEXT)
    expect(s.step).toBe(STEPS.OPERATOR); // 4 rich TEXT ops → operator step
    s = reduce(s, { kind: 'pickOperator', op: 'contains' });
    s = reduce(s, { kind: 'setValue', value: 'playoff' });
    expect(s.step).toBe(STEPS.VALUE);

    // Re-edit the draft's operator: back to the operator step, draft preserved,
    // input cleared. No editingIndex — this is the draft, not a committed filter.
    s = reduce(s, { kind: 'editDraft', segment: 'operator' });
    expect(s.step).toBe(STEPS.OPERATOR);
    expect(s.draft).toEqual({
      field: article.fields[0],
      op: 'contains',
      value: 'playoff',
    });
    expect(s.text).toBe('');
    expect(s.editingIndex).toBeNull();

    // Pick a different operator → value step, value preserved + re-prefilled.
    s = reduce(s, { kind: 'pickOperator', op: 'eq' });
    expect(s.step).toBe(STEPS.VALUE);
    expect(s.draft).toEqual({
      field: article.fields[0],
      op: 'eq',
      value: 'playoff',
    });
    expect(s.text).toBe('playoff');
  });

  it('editDraft is a no-op when there is no draft', () => {
    const s = initState({
      contentTypes: [article],
      lockedContentType: article,
      rich: true,
    });
    expect(s.draft).toBeNull();
    const after = reduce(s, { kind: 'editDraft', segment: 'operator' });
    expect(after.draft).toBeNull();
    expect(after.step).toBe(s.step);
  });

  it('setFreeText at the value step updates text but not query.q (no free-text pollution)', () => {
    let s = initState({ contentTypes: [article], lockedContentType: article });
    s = reduce(s, { kind: 'pickField', field: article.fields[0]! }); // TEXT -> value step (eq auto-locked)
    expect(s.step).toBe(STEPS.VALUE);
    s = reduce(s, { kind: 'setFreeText', q: 'playoff' });
    expect(s.text).toBe('playoff');
    expect(s.query.q).toBeUndefined();
  });

  it('backspace on an empty value input cancels the draft, back to field step', () => {
    let s = initState({ contentTypes: [article], lockedContentType: article });
    s = reduce(s, { kind: 'pickField', field: article.fields[0]! }); // -> value step, draft set
    expect(s.step).toBe(STEPS.VALUE);
    expect(s.draft).not.toBeNull();
    s = reduce(s, { kind: 'backspace' }); // empty input, draft present -> cancel
    expect(s.draft).toBeNull();
    expect(s.step).toBe(STEPS.FIELD);
    expect(s.query.filters).toHaveLength(0); // no committed chip touched
  });

  it('removes the last chip with backspace on an empty input', () => {
    let s = initState({ contentTypes: [article], lockedContentType: article });
    s = reduce(s, { kind: 'pickField', field: article.fields[0]! });
    s = reduce(s, { kind: 'setValue', value: 'x' });
    s = reduce(s, { kind: 'commitValue' });
    s = reduce(s, { kind: 'backspace' }); // empty input -> delete last filter
    expect(s.query.filters).toHaveLength(0);
  });

  it('clearing a locked content type emits a broaden intent (query keeps q)', () => {
    let s = initState({ contentTypes: [article], lockedContentType: article });
    s = reduce(s, { kind: 'setFreeText', q: 'keep me' });
    const out = reduce(s, { kind: 'removeContentType' });
    expect(out.intent).toEqual({ kind: 'broaden', q: 'keep me' });
  });

  it('run emits a one-shot run intent', () => {
    const s = initState({
      contentTypes: [article],
      lockedContentType: article,
    });
    const ran = reduce(s, { kind: 'run' });
    expect(ran.intent).toEqual({ kind: 'run' });
    // one-shot: the next dispatch clears it
    expect(reduce(ran, { kind: 'setFreeText', q: 'x' }).intent).toBeNull();
  });

  it('picking a content type clears the type-search text from query.q', () => {
    let s = initState({ contentTypes: [article] });
    s = reduce(s, { kind: 'setFreeText', q: 'art' });
    expect(s.query.q).toBe('art');
    s = reduce(s, { kind: 'pickContentType', contentType: article });
    expect(s.text).toBe('');
    expect(s.query.q).toBeUndefined();
    expect(s.query.contentType).toBe(article.identifier);
  });

  it('removing an unlocked content type resets the step and clears draft/filters', () => {
    let s = initState({ contentTypes: [article] });
    s = reduce(s, { kind: 'pickContentType', contentType: article });
    s = reduce(s, { kind: 'pickField', field: article.fields[0]! });
    s = reduce(s, { kind: 'removeContentType' });
    expect(s.step).toBe(STEPS.CONTENT_TYPE);
    expect(s.query.contentType).toBeUndefined();
    expect(s.draft).toBeNull();
    expect(s.text).toBe('');
    expect(s.intent).toBeNull();
  });

  it('rich + multiValue:false: picking a single-value TEXT field goes to the operator step', () => {
    const s0 = initState({
      contentTypes: CONTENT_TYPES,
      lockedContentType: ARTICLE_CT,
      rich: true,
      multiValue: false,
    });
    const summary = ARTICLE_CT.fields.find((f) => f.identifier === 'summary')!;
    const s1 = reduce(s0, { kind: 'pickField', field: summary });
    expect(s1.step).toBe(STEPS.OPERATOR);
    expect(s1.draft?.field.identifier).toBe('summary');
  });

  it('rich: picking a single-operator field (BOOLEAN) skips straight to the value step', () => {
    const s0 = initState({
      contentTypes: CONTENT_TYPES,
      lockedContentType: ARTICLE_CT,
      rich: true,
      multiValue: false,
    });
    const featured = ARTICLE_CT.fields.find(
      (f) => f.identifier === 'featured'
    )!;
    const s1 = reduce(s0, { kind: 'pickField', field: featured });
    expect(s1.step).toBe(STEPS.VALUE); // BOOLEAN has only `eq` → no operator step
  });

  it('editFilter on the operator segment re-opens the operator step with a clear input; the value carries to the value step on pickOperator', () => {
    let s = initState({
      contentTypes: CONTENT_TYPES,
      lockedContentType: ARTICLE_CT,
      rich: true,
      multiValue: false,
    });
    const summary = ARTICLE_CT.fields.find((f) => f.identifier === 'summary')!;
    s = reduce(s, { kind: 'pickField', field: summary });
    s = reduce(s, { kind: 'pickOperator', op: 'contains' });
    s = reduce(s, { kind: 'setValue', value: 'x' });
    s = reduce(s, { kind: 'commitValue' });
    expect(s.query.filters).toHaveLength(1);
    const s2 = reduce(s, { kind: 'editFilter', index: 0, segment: 'operator' });
    expect(s2.step).toBe(STEPS.OPERATOR);
    expect(s2.editingIndex).toBe(0);
    expect(s2.draft?.value).toBe('x'); // value preserved on the draft
    expect(s2.text).toBe(''); // operator step shows a CLEAR input
    // Picking a new operator carries the value to the value step (prefilled).
    const s3 = reduce(s2, { kind: 'pickOperator', op: 'neq' });
    expect(s3.step).toBe(STEPS.VALUE);
    expect(s3.text).toBe('x');
  });

  it('committing a re-edited operator replaces the filter in place (contains → is not)', () => {
    let s = initState({
      contentTypes: CONTENT_TYPES,
      lockedContentType: ARTICLE_CT,
      rich: true,
      multiValue: false,
    });
    const summary = ARTICLE_CT.fields.find((f) => f.identifier === 'summary')!;
    s = reduce(s, { kind: 'pickField', field: summary });
    s = reduce(s, { kind: 'pickOperator', op: 'contains' });
    s = reduce(s, { kind: 'setValue', value: 'x' });
    s = reduce(s, { kind: 'commitValue' });
    // Re-edit the operator segment, pick a different operator, re-commit.
    s = reduce(s, { kind: 'editFilter', index: 0, segment: 'operator' });
    s = reduce(s, { kind: 'pickOperator', op: 'neq' });
    s = reduce(s, { kind: 'commitValue' });
    // In-place replace via editingIndex — not an append; value carried over.
    expect(s.query.filters).toHaveLength(1);
    expect(s.query.filters[0]).toMatchObject({
      field: 'summary',
      op: 'neq',
      value: 'x',
    });
    expect(s.editingIndex).toBeNull();
  });

  it('toggleValue accumulates an array value (add / remove), normalising null', () => {
    let s = initState({
      contentTypes: CONTENT_TYPES,
      lockedContentType: ARTICLE_CT,
      rich: true,
      multiValue: true,
    });
    const status = ARTICLE_CT.fields.find((f) => f.identifier === 'status')!;
    s = reduce(s, { kind: 'pickField', field: status });
    s = reduce(s, { kind: 'pickOperator', op: 'in' });
    expect(s.step).toBe(STEPS.VALUE);
    s = reduce(s, { kind: 'toggleValue', value: 'a' }); // null → ['a']
    s = reduce(s, { kind: 'toggleValue', value: 'b' }); // ['a','b']
    s = reduce(s, { kind: 'toggleValue', value: 'a' }); // remove → ['b']
    expect(s.draft?.value).toEqual(['b']);
    expect(s.text).toBe(''); // search text untouched by toggling
    s = reduce(s, { kind: 'commitValue' });
    expect(s.query.filters).toEqual([
      { field: 'status', op: 'in', value: ['b'] },
    ]);
  });

  it('rich: picking the $entryKey system field lands on the operator step (SLUG has 2 ops)', () => {
    const entryKey: QueryField = {
      identifier: '$entryKey',
      name: 'Entry key',
      type: 'SLUG',
    };
    let s = initState({
      contentTypes: [article],
      lockedContentType: article,
      rich: true,
    });
    s = reduce(s, { kind: 'pickField', field: entryKey });
    expect(s.step).toBe(STEPS.OPERATOR);
    s = reduce(s, { kind: 'pickOperator', op: 'startsWith' });
    expect(s.step).toBe(STEPS.VALUE);
    s = reduce(s, { kind: 'setValue', value: 'about' });
    s = reduce(s, { kind: 'commitValue' });
    expect(s.query.filters).toEqual([
      { field: '$entryKey', op: 'startsWith', value: 'about' },
    ]);
  });

  it('rich off: picking the $entryKey system field auto-locks eq and lands on the value step', () => {
    const entryKey: QueryField = {
      identifier: '$entryKey',
      name: 'Entry key',
      type: 'SLUG',
    };
    let s = initState({ contentTypes: [article], lockedContentType: article });
    s = reduce(s, { kind: 'pickField', field: entryKey });
    expect(s.step).toBe(STEPS.VALUE);
    expect(s.draft?.op).toBe('eq');
  });

  it('editFilter resolves a committed $entryKey filter via the system registry (URL-prefilled chip)', () => {
    // The scoped content type has no `$entryKey` field — the system registry
    // must back the lookup, or the chip would be uneditable.
    let s = initState({
      contentTypes: [article],
      lockedContentType: article,
      initialQuery: {
        contentType: 'Article',
        filters: [{ field: '$entryKey', op: 'eq', value: 'x' }],
      },
    });
    s = reduce(s, { kind: 'editFilter', index: 0, segment: 'value' });
    expect(s.step).toBe(STEPS.VALUE);
    expect(s.editingIndex).toBe(0);
    expect(s.draft).toEqual({
      field: { identifier: '$entryKey', name: 'Entry key', type: 'SLUG' },
      op: 'eq',
      value: 'x',
    });
    expect(s.text).toBe('x'); // free-entry value pre-filled for editing
  });

  it('pickField gate plumbs range: a DATETIME field with range:false lands on the operator step (between gated out)', () => {
    const s0 = initState({
      contentTypes: CONTENT_TYPES,
      lockedContentType: ARTICLE_CT,
      rich: true,
      multiValue: true,
      range: false,
    });
    // DATETIME with range:false → is/before/after (3 arity-one ops, `between`
    // gated out) → operator step. Proves `range` reaches pickField's gate.
    const dateField = ARTICLE_CT.fields.find((f) => f.type === 'DATETIME')!;
    const s1 = reduce(s0, { kind: 'pickField', field: dateField });
    expect(s1.step).toBe(STEPS.OPERATOR);
  });
});

describe('builder machine — pre-scope system fields', () => {
  const articleCt = {
    id: 'a1',
    identifier: 'Article',
    name: 'Article',
    fields: [{ identifier: 'summary', name: 'Summary', type: 'TEXT' as const }],
  };

  it('picks a system field while unscoped and advances past the field step', () => {
    let s = initState({
      contentTypes: [articleCt],
      rich: true,
      multiValue: true,
    });
    expect(s.step).toBe(STEPS.CONTENT_TYPE);
    const status = toQueryField(getSystemField('$status')!);
    s = reduce(s, { kind: 'pickField', field: status });
    // SELECT has >1 operator (is / is not / is any of) → operator step.
    expect(s.step).toBe(STEPS.OPERATOR);
    expect(s.draft?.field.identifier).toBe('$status');
  });

  it('committing an unscoped system filter returns to the contentType step', () => {
    let s = initState({
      contentTypes: [articleCt],
      rich: true,
      multiValue: true,
    });
    const status = toQueryField(getSystemField('$status')!);
    s = reduce(s, { kind: 'pickField', field: status });
    s = reduce(s, { kind: 'pickOperator', op: 'eq' });
    s = reduce(s, { kind: 'setValue', value: 'DRAFT' });
    s = reduce(s, { kind: 'commitValue' });
    expect(s.query.filters).toEqual([
      { field: '$status', op: 'eq', value: 'DRAFT' },
    ]);
    expect(s.step).toBe(STEPS.CONTENT_TYPE); // unscoped → back to contentType, not field
  });
});
