export interface ProseMirrorNode {
  type: string;
  content?: ProseMirrorNode[];
  text?: string;
  marks?: { type: string }[];
  attrs?: Record<string, unknown>;
}

const LOREM = (
  'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod ' +
  'tempor incididunt ut labore et dolore magna aliqua Ut enim ad minim ' +
  'veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea ' +
  'commodo consequat Duis aute irure dolor in reprehenderit in voluptate ' +
  'velit esse cillum dolore eu fugiat nulla pariatur Excepteur sint ' +
  'occaecat cupidatat non proident sunt in culpa qui officia deserunt ' +
  'mollit anim id est laborum Sed ut perspiciatis unde omnis iste natus ' +
  'error sit voluptatem accusantium doloremque laudantium totam rem aperiam'
).split(' ');

// Simple seeded xorshift PRNG for determinism across runtimes
function rng(seed: number): () => number {
  let state = seed | 0;
  if (state === 0) state = 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1000) / 1000;
  };
}

function pickN<T>(arr: T[], n: number, rand: () => number): T[] {
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    out.push(arr[Math.floor(rand() * arr.length)]!);
  }
  return out;
}

function paragraph(rand: () => number): ProseMirrorNode {
  const wordCount = 40 + Math.floor(rand() * 40);
  return {
    type: 'paragraph',
    content: [{ type: 'text', text: pickN(LOREM, wordCount, rand).join(' ') }],
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
  const count = 3 + Math.floor(rand() * 3);
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

export function generateRichtext(seed: number): ProseMirrorNode {
  const rand = rng(seed);
  const content: ProseMirrorNode[] = [
    heading(1, rand),
    paragraph(rand),
    paragraph(rand),
    heading(2, rand),
    paragraph(rand),
    bulletList(rand),
    paragraph(rand),
    heading(2, rand),
    paragraph(rand),
    paragraph(rand),
  ];
  return { type: 'doc', content };
}
