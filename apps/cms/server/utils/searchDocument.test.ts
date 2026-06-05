import { describe, it, expect } from 'vitest';
import { richtextToPlainText } from './searchDocument';

describe('richtextToPlainText', () => {
  it('returns empty string for null / undefined / non-object input', () => {
    expect(richtextToPlainText(null)).toBe('');
    expect(richtextToPlainText(undefined)).toBe('');
    expect(richtextToPlainText('a string')).toBe('');
    expect(richtextToPlainText(42)).toBe('');
  });

  it('returns empty string for an empty doc', () => {
    expect(richtextToPlainText({ type: 'doc', content: [] })).toBe('');
  });

  it('extracts text from a simple paragraph', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
      ],
    };
    expect(richtextToPlainText(doc)).toBe('Hello world');
  });

  it('separates adjacent blocks with a single space', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body text' }] },
      ],
    };
    expect(richtextToPlainText(doc)).toBe('Title Body text');
  });

  it('keeps mark-wrapped text (cmsLink, bold) but drops the mark structure', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'see ' },
            {
              type: 'text',
              text: 'this article',
              marks: [
                {
                  type: 'cmsLink',
                  attrs: { contentTypeId: 'ct', entryId: 'e1' },
                },
              ],
            },
            { type: 'text', text: ' now', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    };
    expect(richtextToPlainText(doc)).toBe('see this article now');
  });

  it('strips cmsEmbed atom nodes (no text content)', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'before ' },
            { type: 'cmsEmbed', attrs: { contentTypeId: 'ct', entryId: 'e1' } },
            { type: 'text', text: ' after' },
          ],
        },
      ],
    };
    expect(richtextToPlainText(doc)).toBe('before after');
  });

  it('flattens table cells separated by spaces', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'A1' }],
                    },
                  ],
                },
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'B1' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(richtextToPlainText(doc)).toBe('A1 B1');
  });

  it('handles deeply nested lists', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
                {
                  type: 'bulletList',
                  content: [
                    {
                      type: 'listItem',
                      content: [
                        {
                          type: 'paragraph',
                          content: [{ type: 'text', text: 'two' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(richtextToPlainText(doc)).toBe('one two');
  });
});
