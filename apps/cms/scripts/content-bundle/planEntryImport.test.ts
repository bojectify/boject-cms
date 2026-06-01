import { describe, it, expect } from 'vitest';
import { planEntryImport } from './planEntryImport';
import {
  EntryImportConflictError,
  EntryImportReferenceError,
} from './importErrors';
import { BUNDLE_VERSION } from './types';
import type { Bundle, BundleEntry } from './types';
import { CONTENT_STATUSES } from '../../utils/contentStatus';

function entry(overrides: Partial<BundleEntry> = {}): BundleEntry {
  return {
    id: null,
    contentTypeId: null,
    contentTypeIdentifier: 'Page',
    entryTitle: 'Hello',
    entryKey: 'hello',
    slug: null,
    versions: [
      { status: CONTENT_STATUSES.PUBLISHED, data: {}, publishedAt: null },
    ],
    ...overrides,
  };
}

function bundleWith(entries: BundleEntry[]): Bundle {
  return {
    version: BUNDLE_VERSION,
    exportedAt: '2026-05-30T00:00:00.000Z',
    portable: false,
    entries,
  };
}

const identifierToTypeId = new Map([['Page', 'type-page-id']]);

describe('planEntryImport', () => {
  it('plans create for entries with no existing match', () => {
    const existing = new Map<string, Map<string, string>>();
    const result = planEntryImport(
      existing,
      bundleWith([entry()]),
      identifierToTypeId,
      'fail'
    );
    expect(result.plans).toEqual([
      {
        action: 'create',
        bundleEntry: expect.objectContaining({ entryKey: 'hello' }),
      },
    ]);
    expect(result.summary).toEqual({ created: 1, updated: 0, skipped: 0 });
  });

  it('throws on collision in fail mode', () => {
    const existing = new Map([
      ['Page', new Map([['hello', 'existing-entry-id']])],
    ]);
    expect(() =>
      planEntryImport(
        existing,
        bundleWith([entry()]),
        identifierToTypeId,
        'fail'
      )
    ).toThrow(/Page:hello.*already exists/);
  });

  it('plans skip on collision in skip mode and reports existingId', () => {
    const existing = new Map([
      ['Page', new Map([['hello', 'existing-entry-id']])],
    ]);
    const result = planEntryImport(
      existing,
      bundleWith([entry()]),
      identifierToTypeId,
      'skip'
    );
    expect(result.plans).toEqual([
      {
        action: 'skip',
        bundleEntry: expect.objectContaining({ entryKey: 'hello' }),
        existingId: 'existing-entry-id',
      },
    ]);
    expect(result.summary).toEqual({ created: 0, updated: 0, skipped: 1 });
  });

  it('plans update on collision in replace mode and reports existingId', () => {
    const existing = new Map([
      ['Page', new Map([['hello', 'existing-entry-id']])],
    ]);
    const result = planEntryImport(
      existing,
      bundleWith([entry()]),
      identifierToTypeId,
      'replace'
    );
    expect(result.plans).toEqual([
      {
        action: 'update',
        bundleEntry: expect.objectContaining({ entryKey: 'hello' }),
        existingId: 'existing-entry-id',
      },
    ]);
    expect(result.summary).toEqual({ created: 0, updated: 1, skipped: 0 });
  });

  it('throws when an entry references an unknown content type', () => {
    const existing = new Map<string, Map<string, string>>();
    expect(() =>
      planEntryImport(
        existing,
        bundleWith([entry({ contentTypeIdentifier: 'UnknownType' })]),
        identifierToTypeId,
        'skip'
      )
    ).toThrow(/unknown content type "UnknownType"/);
  });

  it('mixes create + update in one plan run (replace mode)', () => {
    const existing = new Map([
      [
        'Page',
        new Map([
          ['hello', 'existing-1'],
          ['world', 'existing-2'],
        ]),
      ],
    ]);
    const result = planEntryImport(
      existing,
      bundleWith([
        entry({ entryKey: 'hello', entryTitle: 'Hello v2' }),
        entry({ entryKey: 'world', entryTitle: 'World v2' }),
        entry({ entryKey: 'new-one', entryTitle: 'New One' }),
      ]),
      identifierToTypeId,
      'replace'
    );
    expect(result.summary).toEqual({ created: 1, updated: 2, skipped: 0 });
    expect(result.plans.map((p) => p.action)).toEqual([
      'update',
      'update',
      'create',
    ]);
  });

  it('returns empty plans when the bundle has no entries', () => {
    const result = planEntryImport(
      new Map(),
      { version: BUNDLE_VERSION, exportedAt: '', portable: false },
      identifierToTypeId,
      'fail'
    );
    expect(result.plans).toEqual([]);
    expect(result.summary).toEqual({ created: 0, updated: 0, skipped: 0 });
  });
});

describe('planEntryImport typed errors', () => {
  const existingWithHome = new Map([
    ['Page', new Map([['home', 'existing-home-id']])],
  ]);
  const identToId = new Map([['Page', 'type-page-id']]);
  const bundleWithHome = bundleWith([
    entry({ entryKey: 'home', entryTitle: 'Home' }),
  ]);
  const bundleUnknownType = bundleWith([
    entry({ contentTypeIdentifier: 'UnknownType', entryTitle: 'Mystery' }),
  ]);

  it('throws EntryImportConflictError on fail-mode collision', () => {
    expect(() =>
      planEntryImport(existingWithHome, bundleWithHome, identToId, 'fail')
    ).toThrow(EntryImportConflictError);
  });

  it('throws EntryImportReferenceError for an unknown content type', () => {
    expect(() =>
      planEntryImport(new Map(), bundleUnknownType, new Map(), 'fail')
    ).toThrow(EntryImportReferenceError);
  });

  it('keeps the conflict message byte-identical to the legacy string', () => {
    try {
      planEntryImport(existingWithHome, bundleWithHome, identToId, 'fail');
    } catch (e) {
      expect((e as Error).message).toBe(
        'Entry "Page:home" already exists on target'
      );
    }
  });
});
