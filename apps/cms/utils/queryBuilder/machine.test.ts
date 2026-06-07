import { describe, it, expect } from 'vitest';
import { initState, reduce } from './machine';
import type { QueryContentType } from './types';

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
    expect(s.step).toBe('contentType');
    expect(s.query.contentType).toBeUndefined();
  });

  it('locks a content type and advances to the field step', () => {
    let s = initState({ contentTypes: [article] });
    s = reduce(s, { kind: 'pickContentType', contentType: article });
    expect(s.query.contentType).toBe('Article');
    expect(s.step).toBe('field');
  });

  it('pre-scopes via lockedContentType and starts in the field step', () => {
    const s = initState({
      contentTypes: [article],
      lockedContentType: article,
    });
    expect(s.query.contentType).toBe('Article');
    expect(s.step).toBe('field');
    expect(s.locked).toBe(true);
  });

  it('builds a filter: field -> operator -> value -> commit', () => {
    let s = initState({ contentTypes: [article], lockedContentType: article });
    s = reduce(s, { kind: 'pickField', field: article.fields[0]! }); // summary
    expect(s.step).toBe('value'); // v1: operator auto-locked to eq, skip to value
    expect(s.draft?.op).toBe('eq');
    s = reduce(s, { kind: 'setValue', value: 'final' });
    s = reduce(s, { kind: 'commitValue' });
    expect(s.query.filters).toEqual([
      { field: 'summary', op: 'eq', value: 'final' },
    ]);
    expect(s.step).toBe('field'); // back to field step, ready for the next filter
  });

  it('setFreeText at the value step updates text but not query.q (no free-text pollution)', () => {
    let s = initState({ contentTypes: [article], lockedContentType: article });
    s = reduce(s, { kind: 'pickField', field: article.fields[0]! }); // TEXT -> value step (eq auto-locked)
    expect(s.step).toBe('value');
    s = reduce(s, { kind: 'setFreeText', q: 'playoff' });
    expect(s.text).toBe('playoff');
    expect(s.query.q).toBeUndefined();
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

  it('removing an unlocked content type resets the step and clears draft/filters', () => {
    let s = initState({ contentTypes: [article] });
    s = reduce(s, { kind: 'pickContentType', contentType: article });
    s = reduce(s, { kind: 'pickField', field: article.fields[0]! });
    s = reduce(s, { kind: 'removeContentType' });
    expect(s.step).toBe('contentType');
    expect(s.query.contentType).toBeUndefined();
    expect(s.draft).toBeNull();
    expect(s.text).toBe('');
    expect(s.intent).toBeNull();
  });
});
