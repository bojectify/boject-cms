import { describe, it, expect } from 'vitest';
import { highlightToSafeHtml } from './searchSnippet';

describe('highlightToSafeHtml', () => {
  it('returns empty string for null', () => {
    expect(highlightToSafeHtml(null)).toBe('');
  });

  it('keeps <em> highlights but escapes everything else', () => {
    expect(highlightToSafeHtml('a <em>goal</em> & <b>x</b>')).toBe(
      'a <em>goal</em> &amp; &lt;b&gt;x&lt;/b&gt;'
    );
  });

  it('neutralises an injected </em><script> break-out', () => {
    expect(highlightToSafeHtml('<em>x</em><script>alert(1)</script>')).toBe(
      '<em>x</em>&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });
});
