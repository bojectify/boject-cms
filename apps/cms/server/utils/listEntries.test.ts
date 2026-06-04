import { describe, it, expect } from 'vitest';
import { buildEntryListWhere, parseArchiveFilter } from './listEntries';

describe('parseArchiveFilter', () => {
  it('defaults to active and rejects junk', () => {
    expect(parseArchiveFilter(undefined)).toBe('active');
    expect(parseArchiveFilter('nope')).toBe('active');
    expect(parseArchiveFilter('archived')).toBe('archived');
    expect(parseArchiveFilter('all')).toBe('all');
  });
});

describe('buildEntryListWhere', () => {
  it('API key: only entries with a PUBLISHED version', () => {
    expect(
      buildEntryListWhere({ isCms: false, archiveFilter: 'active' })
    ).toEqual({ versions: { some: { status: 'PUBLISHED' } } });
  });

  it('CMS active: excludes entries with any ARCHIVED version', () => {
    expect(
      buildEntryListWhere({ isCms: true, archiveFilter: 'active' })
    ).toEqual({ versions: { none: { status: 'ARCHIVED' } } });
  });

  it('CMS archived: only entries with an ARCHIVED version', () => {
    expect(
      buildEntryListWhere({ isCms: true, archiveFilter: 'archived' })
    ).toEqual({ versions: { some: { status: 'ARCHIVED' } } });
  });

  it('CMS all: no version constraint', () => {
    expect(buildEntryListWhere({ isCms: true, archiveFilter: 'all' })).toEqual(
      {}
    );
  });

  it('CMS status filter wins over archiveFilter branches', () => {
    expect(
      buildEntryListWhere({
        isCms: true,
        archiveFilter: 'active',
        status: 'PUBLISHED',
      })
    ).toEqual({ versions: { some: { status: 'PUBLISHED' } } });
  });

  it('adds contentTypeId when provided', () => {
    expect(
      buildEntryListWhere({
        isCms: true,
        archiveFilter: 'all',
        contentTypeId: 'ct-1',
      })
    ).toEqual({ contentTypeId: 'ct-1' });
  });
});
