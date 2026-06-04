import { describe, it, expect } from 'vitest';
import {
  getDraftVersion,
  getPublishedVersion,
  getVersionForContext,
} from './resolveVersion';
import type { ContentStatusName } from '../../utils/contentStatus';
import { CONTENT_STATUSES } from '../../utils/contentStatus';
import type { ContentStatus } from '#prisma';

const makeVersion = (
  status: string,
  overrides: Record<string, unknown> = {}
) => ({
  id: `v-${status.toLowerCase()}`,
  entryId: 'entry-1',
  data: {},
  entryTitle: 'Test',
  status: status as ContentStatusName,
  publishedAt: status === CONTENT_STATUSES.PUBLISHED ? new Date() : null,
  createdBy: null,
  updatedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('getDraftVersion', () => {
  it('returns CHANGED over DRAFT', () => {
    const versions = [
      makeVersion(CONTENT_STATUSES.DRAFT),
      makeVersion(CONTENT_STATUSES.CHANGED),
    ];
    expect(getDraftVersion(versions)?.status).toBe(CONTENT_STATUSES.CHANGED);
  });

  it('returns DRAFT when no CHANGED', () => {
    const versions = [
      makeVersion(CONTENT_STATUSES.DRAFT),
      makeVersion(CONTENT_STATUSES.PUBLISHED),
    ];
    expect(getDraftVersion(versions)?.status).toBe(CONTENT_STATUSES.DRAFT);
  });

  it('returns null when no draft versions', () => {
    const versions = [makeVersion(CONTENT_STATUSES.PUBLISHED)];
    expect(getDraftVersion(versions)).toBeNull();
  });
});

describe('getPublishedVersion', () => {
  it('returns PUBLISHED version', () => {
    const versions = [
      makeVersion(CONTENT_STATUSES.DRAFT),
      makeVersion(CONTENT_STATUSES.PUBLISHED),
    ];
    expect(getPublishedVersion(versions)?.status).toBe(
      CONTENT_STATUSES.PUBLISHED
    );
  });

  it('returns null when no PUBLISHED', () => {
    const versions = [makeVersion(CONTENT_STATUSES.DRAFT)];
    expect(getPublishedVersion(versions)).toBeNull();
  });
});

describe('getVersionForContext', () => {
  it('CMS: returns draft version, fallback to published', () => {
    const versions = [
      makeVersion(CONTENT_STATUSES.CHANGED),
      makeVersion(CONTENT_STATUSES.PUBLISHED),
    ];
    expect(getVersionForContext(versions, true)?.status).toBe(
      CONTENT_STATUSES.CHANGED
    );
  });

  it('CMS: returns published when no draft', () => {
    const versions = [makeVersion(CONTENT_STATUSES.PUBLISHED)];
    expect(getVersionForContext(versions, true)?.status).toBe(
      CONTENT_STATUSES.PUBLISHED
    );
  });

  it('external: returns published only', () => {
    const versions = [
      makeVersion(CONTENT_STATUSES.CHANGED),
      makeVersion(CONTENT_STATUSES.PUBLISHED),
    ];
    expect(getVersionForContext(versions, false)?.status).toBe(
      CONTENT_STATUSES.PUBLISHED
    );
  });

  it('external: returns null when no published', () => {
    const versions = [makeVersion(CONTENT_STATUSES.DRAFT)];
    expect(getVersionForContext(versions, false)).toBeNull();
  });
});

describe('getVersionForContext (generic over { status })', () => {
  it('accepts and returns minimal status-only rows', () => {
    const rows = [
      { status: 'PUBLISHED' as ContentStatus },
      { status: 'CHANGED' as ContentStatus },
    ];
    expect(getVersionForContext(rows, true)).toEqual({ status: 'CHANGED' });
    expect(getVersionForContext(rows, false)).toEqual({ status: 'PUBLISHED' });
  });
});
