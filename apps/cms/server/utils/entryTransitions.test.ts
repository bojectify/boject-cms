import { describe, it, expect } from 'vitest';
import type { ContentEntryVersion } from '#prisma';
import { planTransition } from './entryTransitions';
import { CONTENT_STATUSES } from '../../utils/contentStatus';

type VersionFixture = Pick<
  ContentEntryVersion,
  'id' | 'status' | 'data' | 'entryTitle' | 'publishedAt'
>;

function v(
  id: string,
  status: VersionFixture['status'],
  extras: Partial<VersionFixture> = {}
): VersionFixture {
  return {
    id,
    status,
    data: { title: id },
    entryTitle: id,
    publishedAt:
      status === CONTENT_STATUSES.PUBLISHED
        ? new Date('2026-04-22T10:00:00Z')
        : null,
    ...extras,
  };
}

function makeEntry(
  id: string,
  versions: VersionFixture[],
  extras: { slug?: string | null; createdAt?: Date; updatedAt?: Date } = {}
): {
  id: string;
  slug: string | null;
  createdAt: Date;
  updatedAt: Date;
  versions: VersionFixture[];
} {
  return {
    id,
    slug: 'slug' in extras ? (extras.slug ?? null) : `${id}-slug`,
    createdAt: extras.createdAt ?? new Date('2026-04-22T09:00:00Z'),
    updatedAt: extras.updatedAt ?? new Date('2026-04-22T10:30:00Z'),
    versions,
  };
}

describe('planTransition', () => {
  describe('unpublish', () => {
    it('demotes PUBLISHED to DRAFT when no CHANGED exists', () => {
      const plan = planTransition(
        makeEntry('e1', [v('pub', CONTENT_STATUSES.PUBLISHED)]),
        'unpublish'
      );
      expect(plan.kind).toBe('ok');
      if (plan.kind !== 'ok') return;
      expect(plan.mutations).toEqual([
        {
          kind: 'update-status',
          versionId: 'pub',
          status: CONTENT_STATUSES.DRAFT,
          publishedAt: null,
        },
      ]);
      expect(plan.webhookEvent).toBe('ENTRY_UNPUBLISHED');
      expect(plan.snapshot?.status).toBe(CONTENT_STATUSES.PUBLISHED);
      expect(plan.snapshot?.data).toEqual({ title: 'pub' });
      expect(plan.snapshot?.slug).toBe('e1-slug');
      expect(plan.snapshot?.createdAt).toEqual(
        new Date('2026-04-22T09:00:00Z')
      );
      expect(plan.snapshot?.updatedAt).toEqual(
        new Date('2026-04-22T10:30:00Z')
      );
    });

    it('drops PUBLISHED and flips CHANGED → DRAFT when CHANGED exists', () => {
      const plan = planTransition(
        makeEntry('e1', [
          v('pub', CONTENT_STATUSES.PUBLISHED),
          v('ch', CONTENT_STATUSES.CHANGED),
        ]),
        'unpublish'
      );
      expect(plan.kind).toBe('ok');
      if (plan.kind !== 'ok') return;
      expect(plan.mutations).toEqual([
        { kind: 'delete', versionId: 'pub' },
        {
          kind: 'update-status',
          versionId: 'ch',
          status: CONTENT_STATUSES.DRAFT,
          publishedAt: null,
        },
      ]);
      expect(plan.webhookEvent).toBe('ENTRY_UNPUBLISHED');
      expect(plan.snapshot?.data).toEqual({ title: 'pub' });
    });

    it('rejects when entry has no PUBLISHED version', () => {
      const plan = planTransition(
        makeEntry('e1', [v('dr', CONTENT_STATUSES.DRAFT)]),
        'unpublish'
      );
      expect(plan).toEqual({
        kind: 'error',
        error: 'WRONG_STATE',
        message: 'Entry is not published',
      });
    });
  });

  describe('archive', () => {
    it('flips PUBLISHED → ARCHIVED', () => {
      const plan = planTransition(
        makeEntry('e1', [v('pub', CONTENT_STATUSES.PUBLISHED)]),
        'archive'
      );
      expect(plan.kind).toBe('ok');
      if (plan.kind !== 'ok') return;
      expect(plan.mutations).toEqual([
        {
          kind: 'update-status',
          versionId: 'pub',
          status: CONTENT_STATUSES.ARCHIVED,
        },
      ]);
      expect(plan.webhookEvent).toBe('ENTRY_UNPUBLISHED');
    });

    it('blocks when CHANGED draft exists', () => {
      const plan = planTransition(
        makeEntry('e1', [
          v('pub', CONTENT_STATUSES.PUBLISHED),
          v('ch', CONTENT_STATUSES.CHANGED),
        ]),
        'archive'
      );
      expect(plan).toEqual({
        kind: 'error',
        error: 'DRAFT_PRESENT',
        message: 'Publish or discard your draft before archiving',
      });
    });

    it('rejects when no PUBLISHED version exists', () => {
      const plan = planTransition(
        makeEntry('e1', [v('dr', CONTENT_STATUSES.DRAFT)]),
        'archive'
      );
      expect(plan).toEqual({
        kind: 'error',
        error: 'WRONG_STATE',
        message: 'Only published entries can be archived',
      });
    });

    it('archive preserves publishedAt by omitting it from the mutation', () => {
      const plan = planTransition(
        makeEntry('e1', [v('pub', CONTENT_STATUSES.PUBLISHED)]),
        'archive'
      );
      expect(plan.kind).toBe('ok');
      if (plan.kind !== 'ok') return;
      expect(plan.mutations).toHaveLength(1);
      const m = plan.mutations[0];
      if (!m || m.kind !== 'update-status') throw new Error('unexpected kind');
      expect(m).not.toHaveProperty('publishedAt');
    });
  });

  describe('unarchive', () => {
    it('flips ARCHIVED → DRAFT with no webhook', () => {
      const plan = planTransition(
        makeEntry('e1', [v('arc', CONTENT_STATUSES.ARCHIVED)]),
        'unarchive'
      );
      expect(plan.kind).toBe('ok');
      if (plan.kind !== 'ok') return;
      expect(plan.mutations).toEqual([
        {
          kind: 'update-status',
          versionId: 'arc',
          status: CONTENT_STATUSES.DRAFT,
          publishedAt: null,
        },
      ]);
      expect(plan.webhookEvent).toBeNull();
      expect(plan.snapshot).toBeNull();
    });

    it('rejects when no ARCHIVED version exists', () => {
      const plan = planTransition(
        makeEntry('e1', [v('dr', CONTENT_STATUSES.DRAFT)]),
        'unarchive'
      );
      expect(plan.kind).toBe('error');
    });
  });

  describe('republish', () => {
    it('no mutations, refires ENTRY_PUBLISHED with current PUBLISHED snapshot', () => {
      const plan = planTransition(
        makeEntry('e1', [v('pub', CONTENT_STATUSES.PUBLISHED)]),
        'republish'
      );
      expect(plan.kind).toBe('ok');
      if (plan.kind !== 'ok') return;
      expect(plan.mutations).toEqual([]);
      expect(plan.webhookEvent).toBe('ENTRY_PUBLISHED');
      expect(plan.snapshot?.data).toEqual({ title: 'pub' });
      expect(plan.snapshot?.slug).toBe('e1-slug');
      expect(plan.snapshot?.createdAt).toEqual(
        new Date('2026-04-22T09:00:00Z')
      );
      expect(plan.snapshot?.updatedAt).toEqual(
        new Date('2026-04-22T10:30:00Z')
      );
    });

    it('is unaffected by a CHANGED draft (always targets PUBLISHED)', () => {
      const plan = planTransition(
        makeEntry('e1', [
          v('pub', CONTENT_STATUSES.PUBLISHED),
          v('ch', CONTENT_STATUSES.CHANGED),
        ]),
        'republish'
      );
      expect(plan.kind).toBe('ok');
      if (plan.kind !== 'ok') return;
      expect(plan.snapshot?.data).toEqual({ title: 'pub' });
    });

    it('rejects when no PUBLISHED version exists', () => {
      const plan = planTransition(
        makeEntry('e1', [v('dr', CONTENT_STATUSES.DRAFT)]),
        'republish'
      );
      expect(plan).toEqual({
        kind: 'error',
        error: 'NOT_PUBLISHED',
        message: 'Entry has no published version to republish',
      });
    });

    it('preserves a null slug in the snapshot', () => {
      const plan = planTransition(
        makeEntry('e1', [v('pub', CONTENT_STATUSES.PUBLISHED)], { slug: null }),
        'republish'
      );
      expect(plan.kind).toBe('ok');
      if (plan.kind !== 'ok') return;
      expect(plan.snapshot?.slug).toBeNull();
    });
  });
});
