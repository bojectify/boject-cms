import { describe, expect, it } from 'vitest';
import { slugify } from './slugify';

describe('slugify', () => {
  it('lowercases and replaces non-alphanumeric runs with single dashes', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('collapses runs of non-alphanum to a single dash', () => {
    expect(slugify('Hello   World!!! ---')).toBe('hello-world');
  });

  it('trims leading and trailing dashes', () => {
    expect(slugify('---Hello---')).toBe('hello');
  });

  it('strips non-ASCII characters (documented quirk)', () => {
    expect(slugify('Café')).toBe('caf');
  });

  it('returns empty string for input with no slug-safe characters', () => {
    expect(slugify('!!!')).toBe('');
    expect(slugify('   ')).toBe('');
  });

  it('passes through alphanumeric input unchanged', () => {
    expect(slugify('helloworld')).toBe('helloworld');
  });

  it('is byte-identical to the legacy useContentEntryEditor generateSlug', () => {
    const samples = [
      'Hello World',
      '---hello---',
      'Hello-World',
      'Hello World 123',
      'café',
      '!!! ??? ',
      'A',
      '',
    ];
    for (const s of samples) {
      const expected = s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      expect(slugify(s)).toBe(expected);
    }
  });
});
