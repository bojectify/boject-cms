/**
 * Shared lorem ipsum corpus for synthetic value generators.
 * Used by both `scalars.ts` (TEXT, TEXTAREA, ENTRY_TITLE) and `richtext.ts`.
 *
 * 67 distinct words is enough for varied output up to ~120-word paragraphs
 * via pickN-with-replacement. If you need a richer corpus, extend this list
 * rather than introducing a parallel one.
 */
export const LOREM = (
  'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod ' +
  'tempor incididunt ut labore et dolore magna aliqua Ut enim ad minim ' +
  'veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea ' +
  'commodo consequat Duis aute irure dolor in reprehenderit in voluptate ' +
  'velit esse cillum dolore eu fugiat nulla pariatur Excepteur sint ' +
  'occaecat cupidatat non proident sunt in culpa qui officia deserunt ' +
  'mollit anim id est laborum Sed ut perspiciatis unde omnis iste natus ' +
  'error sit voluptatem accusantium doloremque laudantium totam rem aperiam'
).split(' ');
