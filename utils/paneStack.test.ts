import { describe, expect, it } from 'vitest';
import {
  parseStack,
  encodeStack,
  stackHref,
  type PaneSegment,
} from './paneStack';

describe('parseStack', () => {
  it('parses a single entry', () => {
    expect(parseStack(['abc'])).toEqual([{ kind: 'entry', entryId: 'abc' }]);
  });

  it('parses an entry + pane', () => {
    expect(parseStack(['a', '~', 'b'])).toEqual([
      { kind: 'entry', entryId: 'a' },
      { kind: 'entry', entryId: 'b' },
    ]);
  });

  it('parses a new-entry sentinel', () => {
    expect(parseStack(['a', '~', 'new:type-uuid'])).toEqual([
      { kind: 'entry', entryId: 'a' },
      { kind: 'new', contentTypeId: 'type-uuid' },
    ]);
  });

  it('parses a deep stack', () => {
    expect(parseStack(['a', '~', 'b', '~', 'new:t', '~', 'c'])).toEqual([
      { kind: 'entry', entryId: 'a' },
      { kind: 'entry', entryId: 'b' },
      { kind: 'new', contentTypeId: 't' },
      { kind: 'entry', entryId: 'c' },
    ]);
  });

  it('rejects empty input', () => {
    expect(() => parseStack([])).toThrow();
  });

  it('rejects leading separator', () => {
    expect(() => parseStack(['~', 'a'])).toThrow();
  });

  it('rejects trailing separator', () => {
    expect(() => parseStack(['a', '~'])).toThrow();
  });

  it('rejects double separator', () => {
    expect(() => parseStack(['a', '~', '~', 'b'])).toThrow();
  });

  it('rejects new sentinel without content type id', () => {
    expect(() => parseStack(['new:'])).toThrow();
  });
});

describe('encodeStack', () => {
  it('encodes a single entry', () => {
    expect(encodeStack([{ kind: 'entry', entryId: 'abc' }])).toBe('abc');
  });

  it('encodes an entry + pane', () => {
    expect(
      encodeStack([
        { kind: 'entry', entryId: 'a' },
        { kind: 'entry', entryId: 'b' },
      ])
    ).toBe('a/~/b');
  });

  it('encodes a new-entry sentinel', () => {
    expect(
      encodeStack([
        { kind: 'entry', entryId: 'a' },
        { kind: 'new', contentTypeId: 't' },
      ])
    ).toBe('a/~/new:t');
  });

  it('rejects empty stack', () => {
    expect(() => encodeStack([])).toThrow();
  });
});

describe('stackHref', () => {
  it('prepends /entries/', () => {
    expect(stackHref([{ kind: 'entry', entryId: 'a' }])).toBe('/entries/a');
  });
});

describe('round-trip', () => {
  const fixtures: PaneSegment[][] = [
    [{ kind: 'entry', entryId: 'a' }],
    [
      { kind: 'entry', entryId: 'a' },
      { kind: 'entry', entryId: 'b' },
    ],
    [
      { kind: 'entry', entryId: 'root' },
      { kind: 'new', contentTypeId: 'type-uuid' },
      { kind: 'entry', entryId: 'leaf' },
    ],
  ];

  for (const fixture of fixtures) {
    it(`round-trips: ${JSON.stringify(fixture)}`, () => {
      const encoded = encodeStack(fixture);
      const segments = encoded.split('/');
      expect(parseStack(segments)).toEqual(fixture);
    });
  }
});
