import type { WebhookEvent } from '#prisma';
import type { CONTENT_STATUSES } from '../../utils/contentStatus';

export interface WebhookEntrySnapshot {
  id: string;
  entryTitle: string;
  slug: string | null;
  status: typeof CONTENT_STATUSES.PUBLISHED;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  data: unknown;
}

export interface WebhookPayloadInput {
  event: WebhookEvent;
  deliveryId: string;
  timestamp: Date;
  contentType: { id: string; identifier: string };
  entry: WebhookEntrySnapshot;
}

export interface WebhookPayload {
  event: WebhookEvent;
  deliveryId: string;
  timestamp: string;
  contentType: { id: string; identifier: string };
  entry: {
    id: string;
    entryTitle: string;
    slug: string | null;
    status: typeof CONTENT_STATUSES.PUBLISHED;
    publishedAt: string | null;
    createdAt: string;
    updatedAt: string;
    data: unknown;
  };
}

export function buildWebhookPayload(
  input: WebhookPayloadInput
): WebhookPayload {
  return {
    event: input.event,
    deliveryId: input.deliveryId,
    timestamp: input.timestamp.toISOString(),
    contentType: input.contentType,
    entry: {
      id: input.entry.id,
      entryTitle: input.entry.entryTitle,
      slug: input.entry.slug,
      status: input.entry.status,
      publishedAt: input.entry.publishedAt?.toISOString() ?? null,
      createdAt: input.entry.createdAt.toISOString(),
      updatedAt: input.entry.updatedAt.toISOString(),
      data: input.entry.data,
    },
  };
}

export interface SchemaChangedPayload {
  event: 'CONTENT_TYPE_SCHEMA_CHANGED';
  deliveryId: string;
  contentTypeId: string;
  contentTypeIdentifier: string;
  occurredAt: string;
}

export function buildSchemaChangedPayload(input: {
  deliveryId: string;
  occurredAt: Date;
  contentType: { id: string; identifier: string };
}): SchemaChangedPayload {
  return {
    event: 'CONTENT_TYPE_SCHEMA_CHANGED',
    deliveryId: input.deliveryId,
    contentTypeId: input.contentType.id,
    contentTypeIdentifier: input.contentType.identifier,
    occurredAt: input.occurredAt.toISOString(),
  };
}

export interface DraftSyncPayload {
  event: 'ENTRY_DRAFT_SYNC';
  deliveryId: string;
  contentTypeId: string;
  entry: { id: string };
  occurredAt: string;
}

export function buildDraftSyncPayload(input: {
  deliveryId: string;
  occurredAt: Date;
  contentTypeId: string;
  entryId: string;
}): DraftSyncPayload {
  return {
    event: 'ENTRY_DRAFT_SYNC',
    deliveryId: input.deliveryId,
    contentTypeId: input.contentTypeId,
    entry: { id: input.entryId },
    occurredAt: input.occurredAt.toISOString(),
  };
}
