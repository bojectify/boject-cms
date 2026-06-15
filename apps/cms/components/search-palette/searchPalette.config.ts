import { testIds } from '~/utils/test-config/testConfig.utils';

export const QA_SEARCH_PALETTE = {
  ...testIds('SEARCH_PALETTE', { MODAL: 'modal' }),
};

/**
 * The `:ui.content` override for the ⌘K palette's `UModal`. Kept here (not inline
 * in the template) so the regression story can feed the EXACT string to a real
 * `UModal` and prove the cap against Nuxt UI's live theme.
 *
 * The palette is top-anchored (`top-[10dvh]`, not the modal's default centred
 * position) and capped to `80dvh` so it never runs past the bottom of the
 * viewport on short screens. `dvh` (dynamic viewport height) keeps the cap honest
 * as mobile browser chrome shows/hides — no JS resize watcher needed.
 *
 * `sm:max-h-[80dvh]` is LOAD-BEARING: the Nuxt UI modal `content` theme default
 * carries `sm:max-h-[calc(100dvh-4rem)]`, a `sm:`-scoped token that twMerge keeps
 * ALONGSIDE our unprefixed `max-h-[80dvh]` (different modifier scope). Without the
 * `sm:` override the effective cap reverts to ~full-viewport at ≥sm (desktop)
 * widths and the palette runs past 80dvh on longer lists (#364). Override BOTH
 * scopes.
 */
export const SEARCH_PALETTE_MODAL_CONTENT_UI =
  'top-[10dvh] sm:top-[10dvh] translate-y-0 bg-transparent ring-0 shadow-none rounded-none divide-y-0 overflow-visible w-[calc(100vw-2rem)] max-w-[1080px] max-h-[80dvh] sm:max-h-[80dvh] flex flex-col';
