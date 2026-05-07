import { describe, expect, it } from 'vitest';
import { rng } from '../prng.js';
import {
  generateRichtext,
  type ProseMirrorNode,
  type ProseMirrorMark,
  type RichtextRefPool,
} from './richtext.js';

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

  it('inserts cmsEmbed nodes for at least some seeds when embed allow-list is populated', () => {
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
    let totalEmbeds = 0;
    let docsWithEmbeds = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const doc = generateRichtext({ rand: rng(seed), refPool });
      const embeds = collectNodes(doc, 'cmsEmbed');
      if (embeds.length > 0) {
        docsWithEmbeds++;
        totalEmbeds += embeds.length;
        for (const e of embeds) {
          expect(e.attrs?.contentTypeId).toBe('ct-page');
          expect(e.attrs?.contentTypeIdentifier).toBe('Page');
          expect(['e1', 'e2', 'e3']).toContain(e.attrs?.entryId);
        }
      }
    }
    // With ~67% of seeds producing 1-2 embeds via intInRange(0, 2),
    // 30 seeds should reliably produce at least 5 embed-bearing docs.
    expect(docsWithEmbeds).toBeGreaterThan(5);
    expect(totalEmbeds).toBeGreaterThan(0);
  });

  it('inserts cmsLink marks for at least some seeds when link allow-list is populated', () => {
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
    let totalLinks = 0;
    let docsWithLinks = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const doc = generateRichtext({ rand: rng(seed), refPool });
      const linkMarks = collectMarks(doc, 'cmsLink');
      if (linkMarks.length > 0) {
        docsWithLinks++;
        totalLinks += linkMarks.length;
        for (const m of linkMarks) {
          expect(m.attrs?.contentTypeId).toBe('ct-author');
          expect(m.attrs?.contentTypeIdentifier).toBe('Author');
          expect(m.attrs?.entryId).toBe('a1');
        }
      }
    }
    // With 40% per-paragraph probability across ~6 paragraphs and 50 seeds,
    // at least 10 docs must show a cmsLink mark.
    expect(docsWithLinks).toBeGreaterThan(10);
    expect(totalLinks).toBeGreaterThan(0);
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

function collectNodes(doc: ProseMirrorNode, type: string): ProseMirrorNode[] {
  const out: ProseMirrorNode[] = [];
  function walk(n: ProseMirrorNode) {
    if (n?.type === type) out.push(n);
    if (Array.isArray(n?.content)) n.content.forEach(walk);
  }
  walk(doc);
  return out;
}

function collectMarks(doc: ProseMirrorNode, type: string): ProseMirrorMark[] {
  const out: ProseMirrorMark[] = [];
  function walk(n: ProseMirrorNode) {
    if (Array.isArray(n?.marks)) {
      for (const m of n.marks) if (m.type === type) out.push(m);
    }
    if (Array.isArray(n?.content)) n.content.forEach(walk);
  }
  walk(doc);
  return out;
}
