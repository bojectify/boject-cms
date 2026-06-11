import { describe, it, expect } from 'vitest';
import { FIELD_TYPES, type FieldTypeName } from '../../utils/fieldTypes';
import { compileSearchFilter, SearchInputError } from './compileSearchFilter';

const types: Record<string, FieldTypeName> = {
  title: FIELD_TYPES.TEXT,
  summary: FIELD_TYPES.TEXTAREA,
  slug: FIELD_TYPES.SLUG,
  views: FIELD_TYPES.NUMBER,
  featured: FIELD_TYPES.BOOLEAN,
  publishedAt: FIELD_TYPES.DATETIME,
  status: FIELD_TYPES.SELECT,
  author: FIELD_TYPES.RELATION,
  tags: FIELD_TYPES.MULTIRELATION,
  body: FIELD_TYPES.RICHTEXT,
};

const epoch = (iso: string) => Date.parse(iso);

describe('compileSearchFilter — text family', () => {
  it('TEXT: eq/neq/contains/startsWith', () => {
    expect(
      compileSearchFilter({ field: 'title', op: 'eq', values: ['Hi'] }, types)
    ).toBe('fields.title = "Hi"');
    expect(
      compileSearchFilter({ field: 'title', op: 'neq', values: ['Hi'] }, types)
    ).toBe('fields.title != "Hi"');
    expect(
      compileSearchFilter(
        { field: 'title', op: 'contains', values: ['Hi'] },
        types
      )
    ).toBe('fields.title CONTAINS "Hi"');
    expect(
      compileSearchFilter(
        { field: 'title', op: 'startsWith', values: ['Hi'] },
        types
      )
    ).toBe('fields.title STARTS WITH "Hi"');
  });

  it('escapes quotes and backslashes in string literals', () => {
    expect(
      compileSearchFilter(
        { field: 'title', op: 'eq', values: ['a"b\\c'] },
        types
      )
    ).toBe('fields.title = "a\\"b\\\\c"');
  });

  it('curated restrictions: startsWith on TEXTAREA and contains on SLUG reject', () => {
    expect(() =>
      compileSearchFilter(
        { field: 'summary', op: 'startsWith', values: ['x'] },
        types
      )
    ).toThrow(SearchInputError);
    expect(() =>
      compileSearchFilter(
        { field: 'slug', op: 'contains', values: ['x'] },
        types
      )
    ).toThrow(SearchInputError);
  });
});

describe('compileSearchFilter — number', () => {
  it('renders unquoted comparisons', () => {
    expect(
      compileSearchFilter({ field: 'views', op: 'eq', values: ['5'] }, types)
    ).toBe('fields.views = 5');
    expect(
      compileSearchFilter({ field: 'views', op: 'gt', values: ['5'] }, types)
    ).toBe('fields.views > 5');
    expect(
      compileSearchFilter({ field: 'views', op: 'lte', values: ['5'] }, types)
    ).toBe('fields.views <= 5');
  });

  it('rejects a non-numeric value', () => {
    expect(() =>
      compileSearchFilter({ field: 'views', op: 'gt', values: ['abc'] }, types)
    ).toThrow(SearchInputError);
  });
});

describe('compileSearchFilter — datetime', () => {
  it('compiles to epoch comparisons and a TO range', () => {
    expect(
      compileSearchFilter(
        {
          field: 'publishedAt',
          op: 'before',
          values: ['2026-05-01T00:00:00Z'],
        },
        types
      )
    ).toBe(`fields.publishedAt < ${epoch('2026-05-01T00:00:00Z')}`);
    expect(
      compileSearchFilter(
        { field: 'publishedAt', op: 'after', values: ['2026-05-01T00:00:00Z'] },
        types
      )
    ).toBe(`fields.publishedAt > ${epoch('2026-05-01T00:00:00Z')}`);
    expect(
      compileSearchFilter(
        {
          field: 'publishedAt',
          op: 'between',
          values: ['2026-01-01T00:00:00Z', '2026-12-31T00:00:00Z'],
        },
        types
      )
    ).toBe(
      `fields.publishedAt ${epoch('2026-01-01T00:00:00Z')} TO ${epoch('2026-12-31T00:00:00Z')}`
    );
  });

  it('rejects between without exactly 2 values, and an unparseable date', () => {
    expect(() =>
      compileSearchFilter(
        {
          field: 'publishedAt',
          op: 'between',
          values: ['2026-01-01T00:00:00Z'],
        },
        types
      )
    ).toThrow(SearchInputError);
    expect(() =>
      compileSearchFilter(
        { field: 'publishedAt', op: 'before', values: ['nope'] },
        types
      )
    ).toThrow(SearchInputError);
  });
});

describe('compileSearchFilter — select / relation / multirelation / boolean', () => {
  it('SELECT eq/neq/in', () => {
    expect(
      compileSearchFilter(
        { field: 'status', op: 'eq', values: ['draft'] },
        types
      )
    ).toBe('fields.status = "draft"');
    expect(
      compileSearchFilter(
        { field: 'status', op: 'neq', values: ['draft'] },
        types
      )
    ).toBe('fields.status != "draft"');
    expect(
      compileSearchFilter(
        { field: 'status', op: 'in', values: ['draft', 'published'] },
        types
      )
    ).toBe('fields.status IN ["draft", "published"]');
  });

  it('RELATION is / is not', () => {
    expect(
      compileSearchFilter({ field: 'author', op: 'eq', values: ['a1'] }, types)
    ).toBe('fields.author = "a1"');
    expect(
      compileSearchFilter({ field: 'author', op: 'neq', values: ['a1'] }, types)
    ).toBe('fields.author != "a1"');
  });

  it('MULTIRELATION contains / any / all', () => {
    expect(
      compileSearchFilter({ field: 'tags', op: 'eq', values: ['t1'] }, types)
    ).toBe('fields.tags = "t1"');
    expect(
      compileSearchFilter(
        { field: 'tags', op: 'containsAny', values: ['t1', 't2'] },
        types
      )
    ).toBe('fields.tags IN ["t1", "t2"]');
    expect(
      compileSearchFilter(
        { field: 'tags', op: 'containsAll', values: ['t1', 't2'] },
        types
      )
    ).toBe('(fields.tags = "t1" AND fields.tags = "t2")');
    // A single-value containsAll is a one-clause group (redundant parens, harmless).
    expect(
      compileSearchFilter(
        { field: 'tags', op: 'containsAll', values: ['t1'] },
        types
      )
    ).toBe('(fields.tags = "t1")');
  });

  it('BOOLEAN renders unquoted true/false and rejects other values', () => {
    expect(
      compileSearchFilter(
        { field: 'featured', op: 'eq', values: ['true'] },
        types
      )
    ).toBe('fields.featured = true');
    expect(() =>
      compileSearchFilter(
        { field: 'featured', op: 'eq', values: ['yes'] },
        types
      )
    ).toThrow(SearchInputError);
  });
});

describe('compileSearchFilter — validation', () => {
  it('rejects an operator not allowed for the field type', () => {
    expect(() =>
      compileSearchFilter({ field: 'title', op: 'gt', values: ['1'] }, types)
    ).toThrow(SearchInputError);
  });

  it('rejects a filter on a non-filterable type (RICHTEXT)', () => {
    expect(() =>
      compileSearchFilter({ field: 'body', op: 'eq', values: ['x'] }, types)
    ).toThrow(SearchInputError);
  });

  it('rejects a malformed field identifier', () => {
    expect(() =>
      compileSearchFilter({ field: 'bad-id', op: 'eq', values: ['x'] }, types)
    ).toThrow(SearchInputError);
  });

  it('rejects a multi-value op with no values', () => {
    expect(() =>
      compileSearchFilter({ field: 'status', op: 'in', values: [] }, types)
    ).toThrow(SearchInputError);
  });

  it('unknown field type (no scope): eq renders a quoted string; other ops reject', () => {
    expect(
      compileSearchFilter({ field: 'author', op: 'eq', values: ['a1'] }, {})
    ).toBe('fields.author = "a1"');
    expect(() =>
      compileSearchFilter({ field: 'author', op: 'gt', values: ['1'] }, {})
    ).toThrow(SearchInputError);
  });

  it('defaults op to eq and reads a single `value`', () => {
    expect(compileSearchFilter({ field: 'author', value: 'a1' }, types)).toBe(
      'fields.author = "a1"'
    );
  });
});

describe('compileSearchFilter — system fields ($-prefixed envelope attributes)', () => {
  it('$entryKey compiles to the envelope path with EMPTY fieldTypes (no scope needed)', () => {
    expect(
      compileSearchFilter(
        { field: '$entryKey', op: 'eq', values: ['my-key'] },
        {}
      )
    ).toBe('entryKey = "my-key"');
    expect(
      compileSearchFilter(
        { field: '$entryKey', op: 'startsWith', values: ['my-'] },
        {}
      )
    ).toBe('entryKey STARTS WITH "my-"');
  });

  it('rejects operators outside the SLUG donor set (contains, gt)', () => {
    expect(() =>
      compileSearchFilter(
        { field: '$entryKey', op: 'contains', values: ['x'] },
        {}
      )
    ).toThrow('Operator "contains" is not valid for field "$entryKey"');
    expect(() =>
      compileSearchFilter({ field: '$entryKey', op: 'gt', values: ['1'] }, {})
    ).toThrow(SearchInputError);
  });

  it('rejects unknown system fields ($bogus) and the bare prefix ($)', () => {
    // The class matters as much as the message: SearchInputError maps to 400
    // in search.get.ts; anything else surfaces as a 503 engine failure.
    expect(() =>
      compileSearchFilter({ field: '$bogus', op: 'eq', values: ['x'] }, {})
    ).toThrow(SearchInputError);
    expect(() =>
      compileSearchFilter({ field: '$bogus', op: 'eq', values: ['x'] }, {})
    ).toThrow('Unknown system field "$bogus"');
    expect(() =>
      compileSearchFilter({ field: '$', op: 'eq', values: ['x'] }, {})
    ).toThrow('Unknown system field "$"');
  });

  it('defaults op to eq and reads a single `value` (legacy 2-part wire form)', () => {
    expect(compileSearchFilter({ field: '$entryKey', value: 'x' }, {})).toBe(
      'entryKey = "x"'
    );
  });

  it('escapes values through the shared meiliLiteral path', () => {
    expect(
      compileSearchFilter(
        { field: '$entryKey', op: 'eq', values: ['a"b\\c'] },
        {}
      )
    ).toBe('entryKey = "a\\"b\\\\c"');
  });

  it('reuses the shared arity checks (eq with 2 values rejects)', () => {
    expect(() =>
      compileSearchFilter(
        { field: '$entryKey', op: 'eq', values: ['a', 'b'] },
        {}
      )
    ).toThrow(SearchInputError);
  });
});

describe('compileSearchFilter — ENTRY_TITLE envelope path', () => {
  const titleTypes: Record<string, FieldTypeName> = {
    title: FIELD_TYPES.ENTRY_TITLE,
  };

  it('compiles eq/neq/contains/startsWith to entryTitle, never fields.title', () => {
    expect(
      compileSearchFilter(
        { field: 'title', op: 'eq', values: ['Hi'] },
        titleTypes
      )
    ).toBe('entryTitle = "Hi"');
    expect(
      compileSearchFilter(
        { field: 'title', op: 'neq', values: ['Hi'] },
        titleTypes
      )
    ).toBe('entryTitle != "Hi"');
    expect(
      compileSearchFilter(
        { field: 'title', op: 'contains', values: ['Hi'] },
        titleTypes
      )
    ).toBe('entryTitle CONTAINS "Hi"');
    expect(
      compileSearchFilter(
        { field: 'title', op: 'startsWith', values: ['Hi'] },
        titleTypes
      )
    ).toBe('entryTitle STARTS WITH "Hi"');
  });

  it('reuses the shared arity checks (eq with zero values rejects)', () => {
    expect(() =>
      compileSearchFilter({ field: 'title', op: 'eq', values: [] }, titleTypes)
    ).toThrow('needs exactly 1 value');
  });

  it('back-compat: an UNSCOPED `title` (empty fieldTypes) is not special — still fields.title eq-only', () => {
    expect(
      compileSearchFilter({ field: 'title', op: 'eq', values: ['Hi'] }, {})
    ).toBe('fields.title = "Hi"');
    expect(() =>
      compileSearchFilter({ field: 'title', op: 'contains', values: ['x'] }, {})
    ).toThrow(SearchInputError);
  });
});
