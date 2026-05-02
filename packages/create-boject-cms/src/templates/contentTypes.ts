import type { StarterChoice } from './envFile.js';

export interface ContentTypesBundleParams {
  starter: StarterChoice;
}

export type ContentTypesBundleResult =
  | { kind: 'content'; content: string }
  | { kind: 'copy'; sourceFilename: string };

export function renderContentTypesBundle({
  starter,
}: ContentTypesBundleParams): ContentTypesBundleResult {
  if (starter === 'none') {
    const stub = {
      version: 2,
      exportedAt: new Date().toISOString(),
      portable: true,
      contentTypes: [],
    };
    return { kind: 'content', content: JSON.stringify(stub, null, 2) + '\n' };
  }
  return { kind: 'copy', sourceFilename: `${starter}.boject.json` };
}
