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

  it('returns true when changes objects have the same content but different key order', () => {
    const a = empty();
    const b = empty();
    // Build the same content with deliberately different key insertion orders.
    const changesA: { name: string; description: string } = {
      name: 'X',
      description: 'Y',
    };
    const changesB: { description: string; name: string } = {
      description: 'Y',
      name: 'X',
    };
    a.contentTypes.update.push({
      id: 'ct-1',
      identifier: 'A',
      changes: changesA,
    });
    b.contentTypes.update.push({
      id: 'ct-1',
      identifier: 'A',
      changes: changesB,
    });
    expect(plansEqual(a, b)).toBe(true);
  });

  it('returns true when field update changes have the same content but different key order', () => {
    const a = empty();
    const b = empty();
    a.fields.update.push({
      id: 'f-1',
      contentTypeIdentifier: 'Article',
      fieldIdentifier: 'title',
      changes: { name: 'T', required: true },
    });
    b.fields.update.push({
      id: 'f-1',
      contentTypeIdentifier: 'Article',
      fieldIdentifier: 'title',
      changes: { required: true, name: 'T' },
    });
    expect(plansEqual(a, b)).toBe(true);
  });

  it('returns true when blockers are pushed in different orders', () => {
    const a = empty();
    const b = empty();
    a.blockers.push(
      {
        code: 'CONTENT_TYPE_REMOVAL_NEEDS_FLAG',
        message: 'x',
        path: 'contentTypes.X',
      },
      {
        code: 'CONTENT_TYPE_REMOVAL_WITH_ENTRIES',
        message: 'y',
        path: 'contentTypes.Y',
      }
    );
    b.blockers.push(
      {
        code: 'CONTENT_TYPE_REMOVAL_WITH_ENTRIES',
        message: 'y',
        path: 'contentTypes.Y',
      },
      {
        code: 'CONTENT_TYPE_REMOVAL_NEEDS_FLAG',
        message: 'x',
        path: 'contentTypes.X',
      }
    );
    expect(plansEqual(a, b)).toBe(true);
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
