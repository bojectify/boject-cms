import { describe, expect, it } from 'vitest';
import { validateBundle } from './validate';
import {
  bundleDuplicateEntryKey,
  bundleEntryEmptyEntryKey,
  bundleEntryMissingEntryKey,
  bundleMissingEntryTitle,
  bundlePortableEmptyEntryTitle,
  bundleRelationMissingTargets,
  bundleSelectWithoutChoices,
  bundleSharedEntryKeyAcrossTypes,
  bundleV1FlatEntry,
  bundleV2VersionedEntry,
  bundleVersionNinetyNine,
  bundleVersionOne,
  bundleWithVersions,
  validBundle,
} from './validate.fixtures';
import { CONTENT_STATUSES } from '../../utils/contentStatus';

describe('validateBundle', () => {
  it('returns ok for a minimal valid bundle', () => {
    expect(validateBundle(validBundle)).toEqual({ ok: true, errors: [] });
  });

  it('rejects missing ENTRY_TITLE field', () => {
    const result = validateBundle(bundleMissingEntryTitle);
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.message).toMatch(/ENTRY_TITLE/);
  });

  it('rejects SELECT field without choices', () => {
    const result = validateBundle(bundleSelectWithoutChoices);
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.path).toMatch(/contentTypes\[0\]\.fields\[1\]/);
  });

  it('rejects RELATION field missing targetContentTypeIds and identifiers', () => {
    const result = validateBundle(bundleRelationMissingTargets);
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.message).toMatch(/target/);
  });

  it('rejects portable bundle with missing entryTitle on entry', () => {
    const result = validateBundle(bundlePortableEmptyEntryTitle);
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.path).toMatch(/entryTitle/);
  });
});

describe('entryKey validation (#205)', () => {
  it('rejects a bundle with an entry missing entryKey', () => {
    const result = validateBundle(bundleEntryMissingEntryKey);
    expect(result.ok).toBe(false);
    expect(
      result.errors.find((e) => e.path === 'entries[0].entryKey')
    ).toBeDefined();
  });

  it('rejects a bundle with an entry whose entryKey is an empty string', () => {
    const result = validateBundle(bundleEntryEmptyEntryKey);
    expect(result.ok).toBe(false);
    expect(
      result.errors.find((e) => e.path === 'entries[0].entryKey')
    ).toBeDefined();
  });

  it('rejects a bundle with duplicate entryKey within a contentTypeIdentifier', () => {
    const result = validateBundle(bundleDuplicateEntryKey);
    expect(result.ok).toBe(false);
    expect(
      result.errors.find((e) => e.message.includes('duplicate entryKey'))
    ).toBeDefined();
  });

  it('allows the same entryKey across different contentTypeIdentifiers', () => {
    const result = validateBundle(bundleSharedEntryKeyAcrossTypes);
    // ContentTypes are absent (this bundle is entries-only and references types
    // by identifier — the validator may surface that as a separate failure
    // unrelated to entryKey). What we care about: NO duplicate-entryKey error.
    expect(
      result.errors.find((e) => e.message.includes('duplicate entryKey'))
    ).toBeUndefined();
  });
});

describe('validateBundle — version tightening', () => {
  it('rejects bundles claiming version 1', () => {
    const result = validateBundle(bundleVersionOne);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatchObject({ path: 'version' });
    expect(result.errors[0]?.message).toMatch(/expected version 2, got 1/);
    expect(result.errors[0]?.message).toMatch(/boject bundle migrate/);
  });

  it('rejects bundles claiming a future version', () => {
    const result = validateBundle(bundleVersionNinetyNine);
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.message).toMatch(/expected version 2, got 99/);
  });

  it('rejects v1-style entries with flat data and no versions array', () => {
    const result = validateBundle(bundleV1FlatEntry);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some(
        (e) => e.path === 'entries[0]' && /versions/.test(e.message)
      )
    ).toBe(true);
  });

  it('accepts v2-style entries with a non-empty versions array', () => {
    const result = validateBundle(bundleV2VersionedEntry);
    expect(result).toEqual({ ok: true, errors: [] });
  });
});

describe('validateBundle two-slot invariant', () => {
  it('rejects two PUBLISHED versions on one entry', () => {
    const result = validateBundle(
      bundleWithVersions([
        { status: CONTENT_STATUSES.PUBLISHED },
        { status: CONTENT_STATUSES.PUBLISHED },
      ])
    );
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => /at most one PUBLISHED/i.test(e.message))
    ).toBe(true);
  });

  it('rejects two draft-slot versions on one entry', () => {
    const result = validateBundle(
      bundleWithVersions([
        { status: CONTENT_STATUSES.DRAFT },
        { status: CONTENT_STATUSES.CHANGED },
      ])
    );
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => /at most one draft/i.test(e.message))
    ).toBe(true);
  });

  it('accepts one PUBLISHED + one DRAFT', () => {
    const result = validateBundle(
      bundleWithVersions([
        { status: CONTENT_STATUSES.PUBLISHED },
        { status: CONTENT_STATUSES.DRAFT },
      ])
    );
    expect(result.ok).toBe(true);
  });

  it('accepts unlimited ARCHIVED versions', () => {
    const result = validateBundle(
      bundleWithVersions([
        { status: CONTENT_STATUSES.PUBLISHED },
        { status: CONTENT_STATUSES.ARCHIVED },
        { status: CONTENT_STATUSES.ARCHIVED },
        { status: CONTENT_STATUSES.ARCHIVED },
      ])
    );
    expect(result.ok).toBe(true);
  });
});
