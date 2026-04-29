import type { InjectionKey } from 'vue';

export type ChipEditPayload =
  | {
      kind: 'cmsEmbed' | 'cmsLink';
      pos: number;
      attrs: {
        contentTypeId: string;
        entryId: string;
        label?: string | null;
        target?: '_self' | '_blank' | null;
        rel?: 'nofollow' | string | null;
      };
    }
  | {
      kind: 'externalLink';
      pos: number;
      attrs: {
        href: string;
        label?: string | null;
        target?: '_self' | '_blank' | null;
        rel?: 'nofollow' | string | null;
      };
    };

export type ChipEditOpener = (payload: ChipEditPayload) => void;

export const CHIP_EDIT_KEY: InjectionKey<ChipEditOpener> = Symbol('chip-edit');
