import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LICENSES = [
  'LICENSE',
  'packages/boject-cli/LICENSE',
  'packages/create-boject-cms/LICENSE',
];

describe('committed LICENSE files stay tokenised (#334 contract)', () => {
  for (const rel of LICENSES) {
    it(`${rel} keeps %%VERSION%% + %%CHANGE_DATE%%`, () => {
      const text = readFileSync(join(process.cwd(), rel), 'utf8');
      expect(text).toContain('%%VERSION%%');
      expect(text).toContain('%%CHANGE_DATE%%');
    });
  }
});
