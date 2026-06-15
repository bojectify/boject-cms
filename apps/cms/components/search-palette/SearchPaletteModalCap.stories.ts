import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn, waitFor } from 'storybook/test';
import Harness from './SearchPaletteModalCapHarness.vue';
import type { QueryContentType } from '~/utils/queryBuilder/types';
import { QUERY_LISTBOX_ID } from '../query-dropdown/queryDropdown.config';

// A long content-type list so the palette's option list far exceeds 80dvh — the
// condition under which #364 reproduced. Each type is field-less; the unscoped
// content-type step lists every one (plus the System group), so the dropdown is
// tall regardless of the Storybook window height.
const MANY_TYPES: QueryContentType[] = Array.from({ length: 50 }, (_, i) => ({
  id: `ct-${i}`,
  identifier: `Type${i}`,
  name: `Content Type ${i}`,
  fields: [],
}));

// Regression guard for #364: the palette is mounted in the REAL Nuxt UI UModal
// with the SAME `:ui.content` override the app uses, so the live modal theme's
// `sm:max-h-[calc(100dvh-4rem)]` default participates in the twMerge. The
// QueryBuilder-only `ScrollsInBoundedViewport` story supplied its own height
// bound and so could NOT catch the modal-theme override winning at ≥sm widths —
// this one does: it asserts the dialog content element actually caps at 80dvh on
// a desktop-width window, and that the option list (not the modal) scrolls.
const meta: Meta<typeof Harness> = {
  title: 'Search/SearchPaletteModalCap',
  component: Harness,
  parameters: { layout: 'fullscreen' },
  args: {
    contentTypes: MANY_TYPES,
    searchEntries: fn(async () => []),
  },
};
export default meta;
type Story = StoryObj<typeof Harness>;

export const CapsAtViewportAndScrolls: Story = {
  play: async () => {
    // The modal content teleports to <body>; Reka's DialogContent carries the
    // `:ui.content` classes and advertises role="dialog".
    const dialog = (await waitFor(() => {
      const els = document.querySelectorAll<HTMLElement>('[role="dialog"]');
      const el = els[els.length - 1];
      if (!el) throw new Error('modal not mounted');
      return el;
    })) as HTMLElement;

    const innerH = window.innerHeight;
    const dialogH = dialog.getBoundingClientRect().height;

    // The window must be tall enough for 80dvh to sit meaningfully below the
    // buggy ~(100dvh - 4rem) cap, or the assertion can't distinguish them.
    expect(innerH).toBeGreaterThan(400);

    // THE #364 ASSERTION: the dialog caps at 80dvh, NOT ~full viewport. Pre-fix
    // (only the unprefixed override) this was ~innerH-64 at ≥sm widths.
    expect(dialogH).toBeLessThanOrEqual(innerH * 0.8 + 2);
    // …and it really is filled to ~80dvh (the 50-type list wants far more), so
    // this proves the cap bound, not merely a short list that fit.
    expect(dialogH).toBeGreaterThan(innerH * 0.7);

    // The option list — not the modal — is the scroll region, and it overflows.
    const listbox = document.getElementById(QUERY_LISTBOX_ID)!;
    expect(getComputedStyle(listbox).overflowY).toBe('auto');
    expect(listbox.scrollHeight).toBeGreaterThan(listbox.clientHeight + 20);

    // The rows hold their height (h-11 ≈ 44px) — they do NOT shrink to fit; the
    // list scrolls instead. Without `shrink-0` on the rows, 50 options in 80dvh
    // compress toward text-height (#364 follow-up).
    const firstRow = document.getElementById('qb-opt-ct-0')!;
    expect(firstRow.getBoundingClientRect().height).toBeGreaterThanOrEqual(40);

    // The footer (keyboard hints) stays inside the capped dialog — not pushed
    // off-screen below it.
    const footer = dialog.querySelector<HTMLElement>(
      '[data-testid="query-builder__footer"]'
    )!;
    expect(footer.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      dialog.getBoundingClientRect().bottom + 1
    );
  },
};
