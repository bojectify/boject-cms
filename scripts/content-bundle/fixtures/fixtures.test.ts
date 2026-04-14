import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateBundle } from '../validate';

const here = new URL('.', import.meta.url).pathname;

describe('fixtures', () => {
  it.each(['minimal', 'with-relations', 'with-richtext'])(
    '%s.boject.json passes validateBundle',
    (name) => {
      const raw = readFileSync(join(here, `${name}.boject.json`), 'utf8');
      const bundle = JSON.parse(raw);
      expect(validateBundle(bundle)).toEqual({ ok: true, errors: [] });
    }
  );
});
