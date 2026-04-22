import { describe, it, expect } from 'vitest';
import type { ContentEntryVersion } from '#prisma';
import { planTransition } from './entryTransitions';

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
      status === 'PUBLISHED' ? new Date('2026-04-22T10:00:00Z') : null,
    ...extras,
  };
}

describe('planTransition', () => {
  describe('unpublish', () => {
    it('demotes PUBLISHED to DRAFT when no CHANGED exists', () => {
      const plan = planTransition(
        { id: 'e1', versions: [v('pub', 'PUBLISHED')] },
        'unpublish'
      );
      expect(plan.kind).toBe('ok');
      if (plan.kind !== 'ok') return;
      expect(plan.mutations).toEqual([
        { kind: 'update-status', versionId: 'pub', status: 'DRAFT' },
      ]);
      expect(plan.webhookEvent).toBe('ENTRY_UNPUBLISHED');
      expect(plan.snapshot?.status).toBe('PUBLISHED');
      expect(plan.snapshot?.data).toEqual({ title: 'pub' });
    });

    it('drops PUBLISHED and flips CHANGED → DRAFT when CHANGED exists', () => {
      const plan = planTransition(
        {
          id: 'e1',
          versions: [v('pub', 'PUBLISHED'), v('ch', 'CHANGED')],
        },
        'unpublish'
      );
      expect(plan.kind).toBe('ok');
      if (plan.kind !== 'ok') return;
      expect(plan.mutations).toEqual([
        { kind: 'delete', versionId: 'pub' },
        { kind: 'update-status', versionId: 'ch', status: 'DRAFT' },
      ]);
      expect(plan.webhookEvent).toBe('ENTRY_UNPUBLISHED');
      expect(plan.snapshot?.data).toEqual({ title: 'pub' });
    });

    it('rejects when entry has no PUBLISHED version', () => {
      const plan = planTransition(
        { id: 'e1', versions: [v('dr', 'DRAFT')] },
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
        { id: 'e1', versions: [v('pub', 'PUBLISHED')] },
        'archive'
      );
      expect(plan.kind).toBe('ok');
      if (plan.kind !== 'ok') return;
      expect(plan.mutations).toEqual([
        { kind: 'update-status', versionId: 'pub', status: 'ARCHIVED' },
      ]);
      expect(plan.webhookEvent).toBe('ENTRY_UNPUBLISHED');
    });

    it('blocks when CHANGED draft exists', () => {
      const plan = planTransition(
        {
          id: 'e1',
          versions: [v('pub', 'PUBLISHED'), v('ch', 'CHANGED')],
        },
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
        { id: 'e1', versions: [v('dr', 'DRAFT')] },
        'archive'
      );
      expect(plan).toEqual({
        kind: 'error',
        error: 'WRONG_STATE',
        message: 'Only published entries can be archived',
      });
    });
  });

  describe('unarchive', () => {
    it('flips ARCHIVED → DRAFT with no webhook', () => {
      const plan = planTransition(
        { id: 'e1', versions: [v('arc', 'ARCHIVED')] },
        'unarchive'
      );
      expect(plan.kind).toBe('ok');
      if (plan.kind !== 'ok') return;
      expect(plan.mutations).toEqual([
        { kind: 'update-status', versionId: 'arc', status: 'DRAFT' },
      ]);
      expect(plan.webhookEvent).toBeNull();
      expect(plan.snapshot).toBeNull();
    });

    it('rejects when no ARCHIVED version exists', () => {
      const plan = planTransition(
        { id: 'e1', versions: [v('dr', 'DRAFT')] },
        'unarchive'
      );
      expect(plan.kind).toBe('error');
    });
  });

  describe('republish', () => {
    it('no mutations, refires ENTRY_PUBLISHED with current PUBLISHED snapshot', () => {
      const plan = planTransition(
        { id: 'e1', versions: [v('pub', 'PUBLISHED')] },
        'republish'
      );
      expect(plan.kind).toBe('ok');
      if (plan.kind !== 'ok') return;
      expect(plan.mutations).toEqual([]);
      expect(plan.webhookEvent).toBe('ENTRY_PUBLISHED');
      expect(plan.snapshot?.data).toEqual({ title: 'pub' });
    });

    it('is unaffected by a CHANGED draft (always targets PUBLISHED)', () => {
      const plan = planTransition(
        {
          id: 'e1',
          versions: [v('pub', 'PUBLISHED'), v('ch', 'CHANGED')],
        },
        'republish'
      );
      expect(plan.kind).toBe('ok');
      if (plan.kind !== 'ok') return;
      expect(plan.snapshot?.data).toEqual({ title: 'pub' });
    });

    it('rejects when no PUBLISHED version exists', () => {
      const plan = planTransition(
        { id: 'e1', versions: [v('dr', 'DRAFT')] },
        'republish'
      );
      expect(plan).toEqual({
        kind: 'error',
        error: 'NOT_PUBLISHED',
        message: 'Entry has no published version to republish',
      });
    });
  });
});
