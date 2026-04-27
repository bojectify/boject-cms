import { describe, expect, it } from 'vitest';
import { PERF_CONTENT_TYPES } from './contentTypes';

describe('PERF_CONTENT_TYPES', () => {
  it('defines PerfArticle and PerfAuthor', () => {
    const idents = PERF_CONTENT_TYPES.map((c) => c.identifier);
    expect(idents).toEqual(['PerfAuthor', 'PerfArticle']);
  });

  it('PerfArticle has exactly one ENTRY_TITLE and one SLUG', () => {
    const article = PERF_CONTENT_TYPES.find(
      (c) => c.identifier === 'PerfArticle'
    )!;
    const titles = article.fields.filter((f) => f.type === 'ENTRY_TITLE');
    const slugs = article.fields.filter((f) => f.type === 'SLUG');
    expect(titles).toHaveLength(1);
    expect(slugs).toHaveLength(1);
  });

  it('PerfArticle has author RELATION field targeting PerfAuthor', () => {
    const article = PERF_CONTENT_TYPES.find(
      (c) => c.identifier === 'PerfArticle'
    )!;
    const author = article.fields.find((f) => f.identifier === 'author');
    expect(author?.type).toBe('RELATION');
    expect(
      (author as { options?: { targetContentTypeIdentifiers?: string[] } })
        .options?.targetContentTypeIdentifiers
    ).toEqual(['PerfAuthor']);
  });
});
