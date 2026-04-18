import { describe, it, expect } from 'vitest';
import {
  getDraftVersion,
  getPublishedVersion,
  getVersionForContext,
} from './resolveVersion';

const makeVersion = (
  status: string,
  overrides: Record<string, unknown> = {}
) => ({
  id: `v-${status.toLowerCase()}`,
  entryId: 'entry-1',
  data: {},
  entryTitle: 'Test',
  status: status as 'DRAFT' | 'PUBLISHED' | 'CHANGED' | 'ARCHIVED',
  publishedAt: status === 'PUBLISHED' ? new Date() : null,
  createdBy: null,
  updatedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('getDraftVersion', () => {
  it('returns CHANGED over DRAFT', () => {
    const versions = [makeVersion('DRAFT'), makeVersion('CHANGED')];
    expect(getDraftVersion(versions)?.status).toBe('CHANGED');
  });

  it('returns DRAFT when no CHANGED', () => {
    const versions = [makeVersion('DRAFT'), makeVersion('PUBLISHED')];
    expect(getDraftVersion(versions)?.status).toBe('DRAFT');
  });

  it('returns null when no draft versions', () => {
    const versions = [makeVersion('PUBLISHED')];
    expect(getDraftVersion(versions)).toBeNull();
  });
});

describe('getPublishedVersion', () => {
  it('returns PUBLISHED version', () => {
    const versions = [makeVersion('DRAFT'), makeVersion('PUBLISHED')];
    expect(getPublishedVersion(versions)?.status).toBe('PUBLISHED');
  });

  it('returns null when no PUBLISHED', () => {
    const versions = [makeVersion('DRAFT')];
    expect(getPublishedVersion(versions)).toBeNull();
  });
});

describe('getVersionForContext', () => {
  it('CMS: returns draft version, fallback to published', () => {
    const versions = [makeVersion('CHANGED'), makeVersion('PUBLISHED')];
    expect(getVersionForContext(versions, true)?.status).toBe('CHANGED');
  });

  it('CMS: returns published when no draft', () => {
    const versions = [makeVersion('PUBLISHED')];
    expect(getVersionForContext(versions, true)?.status).toBe('PUBLISHED');
  });

  it('external: returns published only', () => {
    const versions = [makeVersion('CHANGED'), makeVersion('PUBLISHED')];
    expect(getVersionForContext(versions, false)?.status).toBe('PUBLISHED');
  });

  it('external: returns null when no published', () => {
    const versions = [makeVersion('DRAFT')];
    expect(getVersionForContext(versions, false)).toBeNull();
  });
});
