import { describe, expect, it } from 'vitest';
import { renderBojectConfig } from '../../src/templates/bojectConfig.js';

describe('renderBojectConfig', () => {
  it('emits cms.url=http://localhost:4000 for the default port', () => {
    const parsed = JSON.parse(renderBojectConfig({ hostPort: 4000 }));
    expect(parsed.cms.url).toBe('http://localhost:4000');
  });
  it('uses the chosen host port in cms.url (#511)', () => {
    const parsed = JSON.parse(renderBojectConfig({ hostPort: 4100 }));
    expect(parsed.cms.url).toBe('http://localhost:4100');
  });
  it('emits schema.path=content-types/schema.boject.json', () => {
    const parsed = JSON.parse(renderBojectConfig({ hostPort: 4000 }));
    expect(parsed.schema.path).toBe('content-types/schema.boject.json');
  });
  it('ends with a trailing newline', () => {
    expect(renderBojectConfig({ hostPort: 4000 }).endsWith('\n')).toBe(true);
  });
});
