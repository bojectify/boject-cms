import { describe, it, expect } from 'vitest';
import {
  buildEntryListWhere,
  parseArchiveFilter,
  resolveDisplayVersion,
} from './listEntries';
import type { ContentStatus } from '#prisma';

const v = (status: ContentStatus) => ({ status });

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

describe('resolveDisplayVersion', () => {
  it('CMS draft-priority: CHANGED > DRAFT > PUBLISHED', () => {
    expect(
      resolveDisplayVersion([v('PUBLISHED'), v('CHANGED')], {
        isCms: true,
        archiveFilter: 'active',
      })
    ).toEqual(v('CHANGED'));
  });

  it('API key: PUBLISHED only', () => {
    expect(
      resolveDisplayVersion([v('CHANGED'), v('PUBLISHED')], {
        isCms: false,
        archiveFilter: 'active',
      })
    ).toEqual(v('PUBLISHED'));
  });

  it('CMS archived branch: picks an ARCHIVED version', () => {
    expect(
      resolveDisplayVersion([v('PUBLISHED'), v('ARCHIVED')], {
        isCms: true,
        archiveFilter: 'archived',
      })
    ).toEqual(v('ARCHIVED'));
  });

  it('CMS all: falls back to ARCHIVED only when no draft/published', () => {
    expect(
      resolveDisplayVersion([v('ARCHIVED')], {
        isCms: true,
        archiveFilter: 'all',
      })
    ).toEqual(v('ARCHIVED'));
    expect(
      resolveDisplayVersion([v('ARCHIVED'), v('PUBLISHED')], {
        isCms: true,
        archiveFilter: 'all',
      })
    ).toEqual(v('PUBLISHED'));
  });

  it('returns null when nothing resolves', () => {
    expect(
      resolveDisplayVersion([v('ARCHIVED')], {
        isCms: true,
        archiveFilter: 'active',
      })
    ).toBeNull();
  });
});
