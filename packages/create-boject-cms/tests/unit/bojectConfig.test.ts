import { describe, expect, it } from 'vitest';
import { renderBojectConfig } from '../../src/templates/bojectConfig.js';

describe('renderBojectConfig', () => {
  it('emits cms.url=http://localhost:4000 by default', () => {
    const out = renderBojectConfig();
    const parsed = JSON.parse(out);
    expect(parsed.cms.url).toBe('http://localhost:4000');
  });
  it('emits schema.path=content-types/schema.boject.json', () => {
    const parsed = JSON.parse(renderBojectConfig());
    expect(parsed.schema.path).toBe('content-types/schema.boject.json');
  });
  it('ends with a trailing newline', () => {
    expect(renderBojectConfig().endsWith('\n')).toBe(true);
  });
});
