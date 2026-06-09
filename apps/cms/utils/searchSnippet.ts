/**
 * Meili snippets arrive as raw field text with <em>…</em> around matches. Escape
 * all HTML, then restore only the highlight tags — safe for v-html (admin tool,
 * but content is author-supplied, so never trust it raw).
 */
export function highlightToSafeHtml(
  snippet: string | null | undefined
): string {
  if (!snippet) return '';
  const escaped = snippet
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/&lt;em&gt;/g, '<em>')
    .replace(/&lt;\/em&gt;/g, '</em>');
}
