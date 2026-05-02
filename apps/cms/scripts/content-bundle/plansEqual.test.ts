import { describe, expect, it } from 'vitest';
import { plansEqual } from './plansEqual';
import type { SchemaPlan } from './schemaPlan.types';

const empty = (): SchemaPlan => ({
  contentTypes: { create: [], update: [], remove: [] },
  fields: { create: [], update: [], remove: [] },
  warnings: [],
  blockers: [],
});

describe('plansEqual', () => {
  it('returns true for two empty plans', () => {
    expect(plansEqual(empty(), empty())).toBe(true);
  });

  it('returns true for plans with identical contents in identical order', () => {
    const a = empty();
    const b = empty();
    a.contentTypes.update.push({
      id: 'ct-1',
      identifier: 'Article',
      changes: { name: 'Renamed' },
    });
    b.contentTypes.update.push({
      id: 'ct-1',
      identifier: 'Article',
      changes: { name: 'Renamed' },
    });
    expect(plansEqual(a, b)).toBe(true);
  });

  it('returns true regardless of insertion order (sorts by identifier)', () => {
    const a = empty();
    const b = empty();
    a.contentTypes.update.push(
      { id: 'ct-1', identifier: 'Article', changes: { name: 'A' } },
      { id: 'ct-2', identifier: 'Author', changes: { name: 'B' } }
    );
    b.contentTypes.update.push(
      { id: 'ct-2', identifier: 'Author', changes: { name: 'B' } },
      { id: 'ct-1', identifier: 'Article', changes: { name: 'A' } }
    );
    expect(plansEqual(a, b)).toBe(true);
  });

  it('returns false when one plan has a different update', () => {
    const a = empty();
    const b = empty();
    a.contentTypes.update.push({
      id: 'ct-1',
      identifier: 'Article',
      changes: { name: 'A' },
    });
    b.contentTypes.update.push({
      id: 'ct-1',
      identifier: 'Article',
      changes: { name: 'B' },
    });
    expect(plansEqual(a, b)).toBe(false);
  });

  it('returns false when one plan has an extra blocker', () => {
    const a = empty();
    const b = empty();
    b.blockers.push({
      code: 'CONTENT_TYPE_REMOVAL_NEEDS_FLAG',
      message: 'x',
      path: 'contentTypes.X',
    });
    expect(plansEqual(a, b)).toBe(false);
  });

  it('sorts field-level operations by contentTypeIdentifier:fieldIdentifier', () => {
    const a = empty();
    const b = empty();
    a.fields.update.push(
      {
        id: 'f-1',
        contentTypeIdentifier: 'Article',
        fieldIdentifier: 'title',
        changes: { name: 'T' },
      },
      {
        id: 'f-2',
        contentTypeIdentifier: 'Article',
        fieldIdentifier: 'body',
        changes: { name: 'B' },
      }
    );
    b.fields.update.push(
      {
        id: 'f-2',
        contentTypeIdentifier: 'Article',
        fieldIdentifier: 'body',
        changes: { name: 'B' },
      },
      {
        id: 'f-1',
        contentTypeIdentifier: 'Article',
        fieldIdentifier: 'title',
        changes: { name: 'T' },
      }
    );
    expect(plansEqual(a, b)).toBe(true);
  });
});
