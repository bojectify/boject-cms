import type {
  ContentEntry,
  ContentEntryVersion,
  Prisma,
  WebhookEvent,
} from '#prisma';
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
      publishedAt?: Date | null;
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

type EntryShape = Pick<
  ContentEntry,
  'id' | 'slug' | 'createdAt' | 'updatedAt'
> & {
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
    slug: entry.slug,
    status: 'PUBLISHED',
    publishedAt: published.publishedAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
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
  // Two-slot invariant: at most one of DRAFT / CHANGED exists at any time.
  // getDraftVersion prefers CHANGED > DRAFT, returning null if neither exists.
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
            {
              kind: 'update-status',
              versionId: draft.id,
              status: 'DRAFT',
              publishedAt: null,
            },
          ],
          webhookEvent: 'ENTRY_UNPUBLISHED',
          snapshot: snapshotFromPublished(entry, published),
        };
      }
      return {
        kind: 'ok',
        mutations: [
          {
            kind: 'update-status',
            versionId: published.id,
            status: 'DRAFT',
            publishedAt: null,
          },
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
          {
            kind: 'update-status',
            versionId: archived.id,
            status: 'DRAFT',
            publishedAt: null,
          },
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

/**
 * Execute a mutation plan against a Prisma transaction client.
 *
 * `update-status` mutations write `status`, and if the mutation includes
 * `publishedAt` (including `null`), also write `publishedAt`. If the key
 * is absent, the existing DB value is preserved.
 */
export async function applyTransitionMutations(
  tx: Prisma.TransactionClient,
  mutations: VersionMutation[]
): Promise<void> {
  for (const m of mutations) {
    if (m.kind === 'delete') {
      await tx.contentEntryVersion.delete({ where: { id: m.versionId } });
    } else {
      const data: { status: typeof m.status; publishedAt?: Date | null } = {
        status: m.status,
      };
      if ('publishedAt' in m) {
        data.publishedAt = m.publishedAt;
      }
      await tx.contentEntryVersion.update({
        where: { id: m.versionId },
        data,
      });
    }
  }
}
