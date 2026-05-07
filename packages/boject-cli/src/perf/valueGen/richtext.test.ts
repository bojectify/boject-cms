import { describe, expect, it } from 'vitest';
import { rng } from '../prng.js';
import { generateRichtext, type RichtextRefPool } from './richtext.js';

describe('generateRichtext', () => {
  it('returns a ProseMirror doc with paragraphs and headings', () => {
    const doc = generateRichtext({ rand: rng(1), refPool: null });
    expect(doc.type).toBe('doc');
    expect(Array.isArray(doc.content)).toBe(true);
    const types = new Set(doc.content!.map((n) => n.type));
    expect(types.has('paragraph')).toBe(true);
    expect(types.has('heading')).toBe(true);
  });

  it('produces deterministic output for the same seed', () => {
    const a = generateRichtext({ rand: rng(42), refPool: null });
    const b = generateRichtext({ rand: rng(42), refPool: null });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('inserts cmsEmbed nodes when an embed allow-list is populated', () => {
    const refPool: RichtextRefPool = {
      embed: [
        {
          contentTypeId: 'ct-page',
          contentTypeIdentifier: 'Page',
          entryIds: ['e1', 'e2', 'e3'],
        },
      ],
      link: [],
    };
    const doc = generateRichtext({ rand: rng(1), refPool });
    const embeds = collectNodes(doc, 'cmsEmbed');
    expect(embeds.length).toBeGreaterThan(0);
    for (const e of embeds) {
      expect(e.attrs?.contentTypeId).toBe('ct-page');
      expect(e.attrs?.contentTypeIdentifier).toBe('Page');
      expect(['e1', 'e2', 'e3']).toContain(e.attrs?.entryId);
    }
  });

  it('inserts cmsLink marks when a link allow-list is populated', () => {
    const refPool: RichtextRefPool = {
      embed: [],
      link: [
        {
          contentTypeId: 'ct-author',
          contentTypeIdentifier: 'Author',
          entryIds: ['a1'],
        },
      ],
    };
    const doc = generateRichtext({ rand: rng(7), refPool });
    const linkMarks = collectMarks(doc, 'cmsLink');
    expect(linkMarks.length).toBeGreaterThan(0);
    for (const m of linkMarks) {
      expect(m.attrs?.contentTypeId).toBe('ct-author');
      expect(m.attrs?.contentTypeIdentifier).toBe('Author');
      expect(m.attrs?.entryId).toBe('a1');
    }
  });

  it('skips reference insertion when allow-list target has zero entries', () => {
    const refPool: RichtextRefPool = {
      embed: [
        {
          contentTypeId: 'ct-page',
          contentTypeIdentifier: 'Page',
          entryIds: [],
        },
      ],
      link: [],
    };
    const doc = generateRichtext({ rand: rng(7), refPool });
    expect(collectNodes(doc, 'cmsEmbed')).toHaveLength(0);
  });
});

interface Node {
  type: string;
  content?: Node[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  attrs?: Record<string, unknown>;
}

function collectNodes(doc: Node, type: string): Node[] {
  const out: Node[] = [];
  function walk(n: Node) {
    if (n?.type === type) out.push(n);
    if (Array.isArray(n?.content)) n.content.forEach(walk);
  }
  walk(doc);
  return out;
}

function collectMarks(
  doc: Node,
  type: string
): Array<{ type: string; attrs?: Record<string, unknown> }> {
  const out: Array<{ type: string; attrs?: Record<string, unknown> }> = [];
  function walk(n: Node) {
    if (Array.isArray(n?.marks)) {
      for (const m of n.marks) if (m.type === type) out.push(m);
    }
    if (Array.isArray(n?.content)) n.content.forEach(walk);
  }
  walk(doc);
  return out;
}
