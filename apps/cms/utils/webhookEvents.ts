// Pure registry mirroring the WebhookEvent enum in
// apps/cms/prisma/schema/webhook.prisma. Zero Nuxt / Prisma deps — drives the
// webhook UI's subscribable-event list. Keep the values in sync with the enum.

export const WEBHOOK_EVENT_NAMES = [
  'ENTRY_PUBLISHED',
  'ENTRY_UNPUBLISHED',
  'ENTRY_DELETED',
  'CONTENT_TYPE_SCHEMA_CHANGED',
] as const;

export type WebhookEventName = (typeof WEBHOOK_EVENT_NAMES)[number];

export interface WebhookEventOption {
  value: WebhookEventName;
  label: string;
  description: string;
}

// Display order in the UI (published / deleted / unpublished mirrors the prior
// inline ordering; schema-changed appended last).
export const WEBHOOK_EVENT_OPTIONS: WebhookEventOption[] = [
  {
    value: 'ENTRY_PUBLISHED',
    label: 'Entry published',
    description:
      'Fires whenever an entry is first published or a change is republished.',
  },
  {
    value: 'ENTRY_DELETED',
    label: 'Entry deleted',
    description: 'Fires when a previously-published entry is deleted.',
  },
  {
    value: 'ENTRY_UNPUBLISHED',
    label: 'Entry unpublished',
    description:
      'Fires when an entry is demoted from published (via Unpublish or Archive).',
  },
  {
    value: 'CONTENT_TYPE_SCHEMA_CHANGED',
    label: 'Content type schema changed',
    description:
      "Fires when a content type's fields are added, updated, deleted, or reordered.",
  },
];
