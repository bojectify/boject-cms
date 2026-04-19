import { describe, expect, it } from 'vitest';
import { GITIGNORE } from '../../src/templates/gitignore.js';

describe('GITIGNORE template', () => {
  it('ignores the .env file', () => {
    expect(GITIGNORE).toContain('.env');
  });

  it('ignores the storage directory', () => {
    expect(GITIGNORE).toContain('storage/');
  });

  it('ignores the pgdata directory', () => {
    expect(GITIGNORE).toContain('pgdata/');
  });

  it('ends with a trailing newline', () => {
    expect(GITIGNORE.endsWith('\n')).toBe(true);
  });
});
