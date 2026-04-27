import { describe, expect, it, vi } from 'vitest';
import { buildSeedRows } from './bulk-insert';

describe('buildSeedRows', () => {
  it('produces N articles + 50 authors with distinct slugs and titles', () => {
    const rows = buildSeedRows({ articleCount: 10, authorCount: 5, seed: 1 });
    expect(rows.authors).toHaveLength(5);
    expect(rows.articles).toHaveLength(10);
    const slugs = new Set(rows.articles.map((a) => a.slug));
    const titles = new Set(rows.articles.map((a) => a.entryTitle));
    expect(slugs.size).toBe(10);
    expect(titles.size).toBe(10);
  });

  it('article data has required fields', () => {
    const rows = buildSeedRows({ articleCount: 1, authorCount: 1, seed: 1 });
    const article = rows.articles[0]!;
    expect(article.data.title).toBeDefined();
    expect(article.data.slug).toBeDefined();
    expect(article.data.body).toMatchObject({ type: 'doc' });
    expect(article.data.author).toMatchObject({
      contentTypeIdentifier: 'PerfAuthor',
    });
  });

  it('articles round-robin over authors', () => {
    const rows = buildSeedRows({ articleCount: 6, authorCount: 3, seed: 1 });
    const indexes = rows.articles.map((a) => a.authorIndex);
    expect(indexes).toEqual([0, 1, 2, 0, 1, 2]);
  });
});
