import { intInRange, pickN, pickOne } from '../prng.js';

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

const LOREM = (
  'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod ' +
  'tempor incididunt ut labore et dolore magna aliqua Ut enim ad minim ' +
  'veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea ' +
  'commodo consequat Duis aute irure dolor in reprehenderit in voluptate ' +
  'velit esse cillum dolore eu fugiat nulla pariatur'
).split(' ');

function paragraph(
  rand: () => number,
  linkPool: RichtextRefTarget[]
): ProseMirrorNode {
  const wordCount = intInRange(70, 110, rand);
  const text = pickN(LOREM, wordCount, rand).join(' ');
  const usableLinkPool = linkPool.filter((p) => p.entryIds.length > 0);

  // Decide whether to wrap a span of this paragraph in a cmsLink mark.
  if (usableLinkPool.length === 0 || rand() > 0.4) {
    return {
      type: 'paragraph',
      content: [{ type: 'text', text }],
    };
  }

  // Split the paragraph into [prefix, linked, suffix]. Linked = 3-7 mid words.
  const words = text.split(' ');
  const linkStart = intInRange(2, Math.max(3, words.length - 10), rand);
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
  const embedCount = intInRange(0, 2, rand);
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
