import { intInRange, pickN, pickOne } from '../prng.js';
import { LOREM } from './lorem.js';

/** Probability that any given paragraph wraps a span in a cmsLink mark, when the link allow-list is non-empty. */
const LINK_INSERTION_PROBABILITY = 0.4;

/** Maximum number of cmsEmbed atom nodes inserted into a single doc. */
const MAX_EMBEDS_PER_DOC = 2;

export interface ProseMirrorMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface ProseMirrorNode {
  type: string;
  content?: ProseMirrorNode[];
  text?: string;
  marks?: ProseMirrorMark[];
  attrs?: Record<string, unknown>;
}

export interface RichtextRefTarget {
  contentTypeId: string;
  contentTypeIdentifier: string;
  entryIds: string[];
}

export interface RichtextRefPool {
  embed: RichtextRefTarget[];
  link: RichtextRefTarget[];
}

function paragraph(
  rand: () => number,
  linkPool: RichtextRefTarget[]
): ProseMirrorNode {
  const wordCount = intInRange(70, 110, rand);
  const text = pickN(LOREM, wordCount, rand).join(' ');
  const usableLinkPool = linkPool.filter((p) => p.entryIds.length > 0);
  const words = text.split(' ');

  // Conditions for inserting a cmsLink mark in this paragraph.
  // The 13-word floor ensures linkStart (>=2) + linkLen (3-7) leaves room
  // for a non-empty suffix; below that, fall back to a plain paragraph.
  const canInsertLink =
    usableLinkPool.length > 0 &&
    words.length >= 13 &&
    rand() < LINK_INSERTION_PROBABILITY;

  if (!canInsertLink) {
    return {
      type: 'paragraph',
      content: [{ type: 'text', text }],
    };
  }

  // Split the paragraph into [prefix, linked, suffix]. Linked = 3-7 mid words.
  // linkStart >= 2 preserves at least one prefix word; words.length - 10 caps
  // the start so suffix has room for at least 3-4 trailing words.
  const linkStart = intInRange(2, words.length - 10, rand);
  const linkLen = intInRange(3, 7, rand);
  const prefix = words.slice(0, linkStart).join(' ');
  const linked = words.slice(linkStart, linkStart + linkLen).join(' ');
  const suffix = words.slice(linkStart + linkLen).join(' ');
  const target = pickOne(usableLinkPool, rand);
  const mark: ProseMirrorMark = {
    type: 'cmsLink',
    attrs: {
      contentTypeId: target.contentTypeId,
      contentTypeIdentifier: target.contentTypeIdentifier,
      entryId: pickOne(target.entryIds, rand),
    },
  };
  return {
    type: 'paragraph',
    content: [
      { type: 'text', text: prefix + ' ' },
      { type: 'text', text: linked, marks: [mark] },
      { type: 'text', text: ' ' + suffix },
    ],
  };
}

function heading(level: number, rand: () => number): ProseMirrorNode {
  return {
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text: pickN(LOREM, 5, rand).join(' ') }],
  };
}

function bulletList(rand: () => number): ProseMirrorNode {
  const items: ProseMirrorNode[] = [];
  const count = intInRange(3, 5, rand);
  for (let i = 0; i < count; i++) {
    items.push({
      type: 'listItem',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: pickN(LOREM, 8, rand).join(' ') }],
        },
      ],
    });
  }
  return { type: 'bulletList', content: items };
}

function embedNode(
  rand: () => number,
  pool: RichtextRefTarget[]
): ProseMirrorNode | null {
  const usable = pool.filter((p) => p.entryIds.length > 0);
  if (usable.length === 0) return null;
  const target = pickOne(usable, rand);
  return {
    type: 'cmsEmbed',
    attrs: {
      contentTypeId: target.contentTypeId,
      contentTypeIdentifier: target.contentTypeIdentifier,
      entryId: pickOne(target.entryIds, rand),
    },
  };
}

export function generateRichtext(opts: {
  rand: () => number;
  refPool: RichtextRefPool | null;
}): ProseMirrorNode {
  const { rand, refPool } = opts;
  const linkPool = refPool?.link ?? [];
  const embedPool = refPool?.embed ?? [];

  const content: ProseMirrorNode[] = [
    heading(1, rand),
    paragraph(rand, linkPool),
    paragraph(rand, linkPool),
  ];

  // 0-2 embed nodes scattered through the doc
  const embedCount = intInRange(0, MAX_EMBEDS_PER_DOC, rand);
  for (let i = 0; i < embedCount; i++) {
    const node = embedNode(rand, embedPool);
    if (node) content.push(node);
  }

  content.push(
    heading(2, rand),
    paragraph(rand, linkPool),
    bulletList(rand),
    paragraph(rand, linkPool),
    heading(2, rand),
    paragraph(rand, linkPool)
  );

  return { type: 'doc', content };
}
