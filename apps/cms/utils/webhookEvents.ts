// Pure registry mirroring the WebhookEvent enum in
// apps/cms/prisma/schema/webhook.prisma. Zero Nuxt / Prisma deps — the single
// source of truth for the webhook UI's subscribable-event list and the
// create/update endpoints' event validation. Keep in sync with the enum.

export const WEBHOOK_EVENTS = {
  ENTRY_PUBLISHED: 'ENTRY_PUBLISHED',
  ENTRY_UNPUBLISHED: 'ENTRY_UNPUBLISHED',
  ENTRY_DELETED: 'ENTRY_DELETED',
  CONTENT_TYPE_SCHEMA_CHANGED: 'CONTENT_TYPE_SCHEMA_CHANGED',
} as const;

export type WebhookEventName =
  (typeof WEBHOOK_EVENTS)[keyof typeof WEBHOOK_EVENTS];

export const WEBHOOK_EVENT_NAMES = Object.values(WEBHOOK_EVENTS);

export const WEBHOOK_EVENT_NAMES_SET: ReadonlySet<WebhookEventName> = new Set(
  WEBHOOK_EVENT_NAMES
);

export function isWebhookEventName(value: unknown): value is WebhookEventName {
  return (
    typeof value === 'string' &&
    WEBHOOK_EVENT_NAMES_SET.has(value as WebhookEventName)
  );
}

export interface WebhookEventOption {
  value: WebhookEventName;
  label: string;
  description: string;
}

// Display order in the UI (published / deleted / unpublished mirrors the prior
// inline ordering; schema-changed appended last).
export const WEBHOOK_EVENT_OPTIONS: WebhookEventOption[] = [
  {
    value: WEBHOOK_EVENTS.ENTRY_PUBLISHED,
    label: 'Entry published',
    description:
      'Fires whenever an entry is first published or a change is republished.',
  },
  {
    value: WEBHOOK_EVENTS.ENTRY_DELETED,
    label: 'Entry deleted',
    description: 'Fires when a previously-published entry is deleted.',
  },
  {
    value: WEBHOOK_EVENTS.ENTRY_UNPUBLISHED,
    label: 'Entry unpublished',
    description:
      'Fires when an entry is demoted from published (via Unpublish or Archive).',
  },
  {
    value: WEBHOOK_EVENTS.CONTENT_TYPE_SCHEMA_CHANGED,
    label: 'Content type schema changed',
    description:
      "Fires when a content type's fields are added, updated, deleted, or reordered.",
  },
];
