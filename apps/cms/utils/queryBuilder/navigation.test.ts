import { describe, it, expect } from 'vitest';
import { planNavigation } from './navigation';
import type { QueryContentType } from './types';

const CTS: QueryContentType[] = [
  { id: 'a1', identifier: 'Article', name: 'Article', fields: [] },
];

describe('planNavigation', () => {
  it('routes an unscoped query to All Content with q only', () => {
    expect(planNavigation({ q: 'goal', filters: [] }, CTS)).toEqual({
      path: '/',
      query: { q: 'goal' },
    });
  });

  it('routes an empty query to All Content with no query (clear/browse)', () => {
    expect(planNavigation({ filters: [] }, CTS)).toEqual({
      path: '/',
      query: {},
    });
  });

  it('routes a scoped query to the per-type path with q + filters', () => {
    const plan = planNavigation(
      {
        contentType: 'Article',
        q: 'playoff',
        filters: [{ field: 'status', op: 'eq', value: 'Active' }],
      },
      CTS
    );
    expect(plan).toEqual({
      path: '/content-types/a1/entries',
      query: { q: 'playoff', filter: ['status:eq:Active'] },
    });
  });

  it('falls back to All Content if the scoped identifier is unknown', () => {
    expect(
      planNavigation({ contentType: 'Ghost', q: 'x', filters: [] }, CTS)
    ).toEqual({
      path: '/',
      query: { q: 'x' },
    });
  });
});
