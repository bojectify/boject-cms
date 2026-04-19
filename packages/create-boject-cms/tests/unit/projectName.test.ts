import { describe, expect, it } from 'vitest';
import { sanitiseProjectName } from '../../src/projectName.js';

describe('sanitiseProjectName', () => {
  it('lowercases the input', () => {
    expect(sanitiseProjectName('MySite')).toBe('mysite');
  });

  it('replaces spaces with hyphens', () => {
    expect(sanitiseProjectName('my great site')).toBe('my-great-site');
  });

  it('collapses runs of non-alphanumerics into a single hyphen', () => {
    expect(sanitiseProjectName('hello  @  world!!')).toBe('hello-world');
  });

  it('strips leading and trailing hyphens', () => {
    expect(sanitiseProjectName('---cool-project---')).toBe('cool-project');
  });

  it('preserves digits, dots, and underscores (valid npm name chars)', () => {
    expect(sanitiseProjectName('site_v2.0')).toBe('site_v2.0');
  });

  it('falls back to "boject-site" when input sanitises to empty', () => {
    expect(sanitiseProjectName('!!!')).toBe('boject-site');
    expect(sanitiseProjectName('')).toBe('boject-site');
  });
});
