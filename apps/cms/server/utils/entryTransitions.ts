import type { ContentEntry, ContentEntryVersion, WebhookEvent } from '#prisma';
import type { WebhookEntrySnapshot } from './webhookPayload';
import { getPublishedVersion, getDraftVersion } from './resolveVersion';

export type TransitionAction =
  | 'unpublish'
  | 'archive'
  | 'unarchive'
  | 'republish';

export type VersionMutation =
  | {
      kind: 'update-status';
      versionId: string;
      status: ContentEntryVersion['status'];
    }
  | { kind: 'delete'; versionId: string };

export type TransitionError = 'WRONG_STATE' | 'DRAFT_PRESENT' | 'NOT_PUBLISHED';

export type TransitionPlan =
  | {
      kind: 'ok';
      mutations: VersionMutation[];
      webhookEvent: WebhookEvent | null;
      snapshot: WebhookEntrySnapshot | null;
    }
  | {
      kind: 'error';
      error: TransitionError;
      message: string;
    };

type EntryShape = Pick<ContentEntry, 'id'> & {
  versions: Array<
    Pick<
      ContentEntryVersion,
      'id' | 'status' | 'data' | 'entryTitle' | 'publishedAt'
    >
  >;
};

function snapshotFromPublished(
  entry: EntryShape,
  published: EntryShape['versions'][number]
): WebhookEntrySnapshot {
  return {
    id: entry.id,
    entryTitle: published.entryTitle,
    slug: null,
    status: 'PUBLISHED',
    publishedAt: published.publishedAt,
    createdAt: new Date(),
    updatedAt: new Date(),
    data: published.data,
  };
}

export function planTransition(
  entry: EntryShape,
  action: TransitionAction
): TransitionPlan {
  const published = getPublishedVersion(
    entry.versions as ContentEntryVersion[]
  );
  const draft = getDraftVersion(entry.versions as ContentEntryVersion[]);

  switch (action) {
    case 'unpublish': {
      if (!published) {
        return {
          kind: 'error',
          error: 'WRONG_STATE',
          message: 'Entry is not published',
        };
      }
      if (draft && draft.status === 'CHANGED') {
        return {
          kind: 'ok',
          mutations: [
            { kind: 'delete', versionId: published.id },
            { kind: 'update-status', versionId: draft.id, status: 'DRAFT' },
          ],
          webhookEvent: 'ENTRY_UNPUBLISHED',
          snapshot: snapshotFromPublished(entry, published),
        };
      }
      return {
        kind: 'ok',
        mutations: [
          { kind: 'update-status', versionId: published.id, status: 'DRAFT' },
        ],
        webhookEvent: 'ENTRY_UNPUBLISHED',
        snapshot: snapshotFromPublished(entry, published),
      };
    }
    case 'archive': {
      if (!published) {
        return {
          kind: 'error',
          error: 'WRONG_STATE',
          message: 'Only published entries can be archived',
        };
      }
      if (draft && draft.status === 'CHANGED') {
        return {
          kind: 'error',
          error: 'DRAFT_PRESENT',
          message: 'Publish or discard your draft before archiving',
        };
      }
      return {
        kind: 'ok',
        mutations: [
          {
            kind: 'update-status',
            versionId: published.id,
            status: 'ARCHIVED',
          },
        ],
        webhookEvent: 'ENTRY_UNPUBLISHED',
        snapshot: snapshotFromPublished(entry, published),
      };
    }
    case 'unarchive': {
      const archived = entry.versions.find((v) => v.status === 'ARCHIVED');
      if (!archived) {
        return {
          kind: 'error',
          error: 'WRONG_STATE',
          message: 'Entry is not archived',
        };
      }
      return {
        kind: 'ok',
        mutations: [
          { kind: 'update-status', versionId: archived.id, status: 'DRAFT' },
        ],
        webhookEvent: null,
        snapshot: null,
      };
    }
    case 'republish': {
      if (!published) {
        return {
          kind: 'error',
          error: 'NOT_PUBLISHED',
          message: 'Entry has no published version to republish',
        };
      }
      return {
        kind: 'ok',
        mutations: [],
        webhookEvent: 'ENTRY_PUBLISHED',
        snapshot: snapshotFromPublished(entry, published),
      };
    }
  }
}
