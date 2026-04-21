import type { InjectionKey } from 'vue';

export type PaneOrchestrator = {
  openPicker: (
    fieldKey: string,
    targetContentTypeIds: string[],
    fromDepth: number
  ) => void;
  openPane: (
    contentTypeId: string,
    entryId: string | null,
    fieldKey: string,
    fromDepth: number
  ) => void;
};

export const paneOrchestratorKey: InjectionKey<PaneOrchestrator> =
  Symbol('paneOrchestrator');
