import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { h, provide, ref } from 'vue';
import {
  paneOrchestratorKey,
  type PaneOrchestrator,
} from '~/composables/paneOrchestrator';
import EntryEditorPane from './EntryEditorPane.vue';
import { FIELD_TYPES } from '../../utils/fieldTypes';

// Story fixtures use real UUIDs because parseFieldOptions validates via zod
const CT_AUTHOR_UUID = '11111111-1111-4111-8111-111111111111';
const CT_ORG_UUID = '22222222-2222-4222-8222-222222222222';
const CT_ARTICLE_UUID = '33333333-3333-4333-8333-333333333333';
const CT_TAG_UUID = '44444444-4444-4444-8444-444444444444';

const fakeOrchestrator = {
  openPicker: () => {},
  openPane: () => {},
};

const meta: Meta<typeof EntryEditorPane> = {
  title: 'Components/EntryEditorPane',
  component: EntryEditorPane,
  tags: ['autodocs'],
  decorators: [
    (story) => ({
      setup() {
        provide(paneOrchestratorKey, fakeOrchestrator);
        return () => h(story());
      },
    }),
  ],
  parameters: {
    layout: 'fullscreen',
    msw: {
      handlers: [
        http.get('/api/content-entries/:id', ({ params }) =>
          HttpResponse.json({
            id: params.id,
            contentTypeId: CT_AUTHOR_UUID,
            contentType: {
              id: CT_AUTHOR_UUID,
              name: 'Author',
              identifier: 'Author',
              fields: [
                {
                  identifier: 'title',
                  name: 'Title',
                  type: FIELD_TYPES.ENTRY_TITLE,
                  required: true,
                  options: null,
                },
              ],
            },
            status: 'DRAFT',
            data: { title: 'Ada Lovelace' },
            publishedAt: null,
            createdAt: '2026-04-21T00:00:00.000Z',
            updatedAt: '2026-04-21T00:00:00.000Z',
            hasPublishedVersion: false,
          })
        ),
      ],
    },
  },
};

export default meta;

type Story = StoryObj<typeof EntryEditorPane>;

export const EditExisting: Story = {
  args: {
    open: true,
    entryId: 'e1',
    depth: 1,
  },
};

export const A11yDialogSemantics: Story = {
  args: {
    open: true,
    entryId: 'e1',
    depth: 1,
  },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement);
    // Wait until the form has loaded so focusable inputs exist.
    await waitFor(() => screen.getByLabelText(/title/i), { timeout: 3000 });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');

    const labelledBy = dialog.getAttribute('aria-labelledby')!;
    const titleEl = canvasElement.ownerDocument.getElementById(labelledBy);
    expect(titleEl).not.toBeNull();
    expect(titleEl!.textContent).toMatch(/Ada Lovelace|Author/);

    // Sliver backdrop is a real button with an accessible name and lives
    // INSIDE the dialog so it falls within the focus trap.
    const closeButtons = screen.getAllByRole('button', { name: /close pane/i });
    expect(closeButtons.length).toBeGreaterThanOrEqual(2);
    const sliverButton = closeButtons.find((b) =>
      b.className.includes('backdrop-blur-sm')
    );
    expect(sliverButton).toBeTruthy();
    expect(dialog.contains(sliverButton!)).toBe(true);
    sliverButton!.focus();
    expect(canvasElement.ownerDocument.activeElement).toBe(sliverButton);
  },
};

export const EscapeClosesPane: Story = {
  render: (args) => ({
    components: { EntryEditorPane },
    setup() {
      const onClose = fn();
      (
        window as Window &
          typeof globalThis & { __close__: ReturnType<typeof fn> }
      ).__close__ = onClose;
      return () => h(EntryEditorPane, { ...args, onClose });
    },
  }),
  args: {
    open: true,
    entryId: 'e1',
    depth: 1,
  },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement);
    const titleInput = await waitFor(
      () => screen.getByLabelText(/title/i) as HTMLInputElement,
      { timeout: 3000 }
    );
    titleInput.focus();
    await waitFor(() =>
      expect(canvasElement.ownerDocument.activeElement).toBe(titleInput)
    );
    titleInput.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    );
    const close = (
      window as Window &
        typeof globalThis & { __close__: ReturnType<typeof fn> }
    ).__close__;
    await waitFor(() => expect(close).toHaveBeenCalled(), { timeout: 1000 });
  },
};

export const OpensRelationAtDepth: Story = {
  decorators: [
    (story) => ({
      setup() {
        const orchestrator = {
          openPicker: fn(),
          openPane: fn(),
        };
        provide(paneOrchestratorKey, orchestrator);
        (
          window as Window &
            typeof globalThis & { __orch__: typeof orchestrator }
        ).__orch__ = orchestrator;
        return () => h(story());
      },
    }),
  ],
  args: {
    open: true,
    entryId: 'e1',
    depth: 1,
  },
  parameters: {
    layout: 'fullscreen',
    msw: {
      handlers: [
        http.get(`/api/content-types/${CT_AUTHOR_UUID}`, () =>
          HttpResponse.json({
            id: CT_AUTHOR_UUID,
            name: 'Author',
            identifier: 'Author',
            fields: [
              {
                identifier: 'title',
                name: 'Title',
                type: FIELD_TYPES.ENTRY_TITLE,
                required: true,
                options: null,
              },
            ],
          })
        ),
        http.get('/api/content-entries/:id', ({ params }) => {
          if (params.id === 'a1') {
            return HttpResponse.json({
              id: 'a1',
              entryTitle: 'Ada Lovelace',
              contentType: {
                name: 'Author',
                fields: [
                  {
                    identifier: 'title',
                    name: 'Title',
                    type: FIELD_TYPES.ENTRY_TITLE,
                    required: true,
                    options: null,
                  },
                ],
              },
              data: { title: 'Ada Lovelace' },
            });
          }
          return HttpResponse.json({
            id: params.id,
            contentTypeId: CT_ARTICLE_UUID,
            contentType: {
              id: CT_ARTICLE_UUID,
              name: 'Article',
              identifier: 'Article',
              fields: [
                {
                  identifier: 'title',
                  name: 'Title',
                  type: FIELD_TYPES.ENTRY_TITLE,
                  required: true,
                  options: null,
                },
                {
                  identifier: 'author',
                  name: 'Author',
                  type: FIELD_TYPES.RELATION,
                  required: false,
                  options: { targetContentTypeIds: [CT_AUTHOR_UUID] },
                },
              ],
            },
            status: 'DRAFT',
            data: {
              title: 'Intro to Vue',
              author: { contentTypeId: CT_AUTHOR_UUID, entryId: 'a1' },
            },
            publishedAt: null,
            createdAt: '2026-04-21T00:00:00.000Z',
            updatedAt: '2026-04-21T00:00:00.000Z',
            hasPublishedVersion: false,
          });
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement);
    const authorCard = await waitFor(() => screen.getByText('Ada Lovelace'), {
      timeout: 3000,
    });
    await userEvent.click(authorCard);
    const orch = (
      window as Window &
        typeof globalThis & { __orch__: { openPane: ReturnType<typeof fn> } }
    ).__orch__;
    expect(orch.openPane).toHaveBeenCalledWith(
      CT_AUTHOR_UUID,
      'a1',
      'author',
      1
    );
  },
};

export const EmitsSavedOnPublish: Story = {
  render: (args) => ({
    components: { EntryEditorPane },
    setup() {
      const saved = fn();
      (
        window as Window &
          typeof globalThis & { __saved__: ReturnType<typeof fn> }
      ).__saved__ = saved;
      return () =>
        h(EntryEditorPane, {
          ...args,
          onSaved: saved,
        });
    },
  }),
  decorators: [
    (story) => ({
      setup() {
        provide(paneOrchestratorKey, { openPicker: fn(), openPane: fn() });
        return () => h(story());
      },
    }),
  ],
  args: {
    open: true,
    entryId: null,
    contentTypeId: CT_TAG_UUID,
    depth: 2,
  },
  parameters: {
    layout: 'fullscreen',
    msw: {
      handlers: [
        http.get(`/api/content-types/${CT_TAG_UUID}`, () =>
          HttpResponse.json({
            id: CT_TAG_UUID,
            name: 'Tag',
            identifier: 'Tag',
            fields: [
              {
                identifier: 'title',
                name: 'Title',
                type: FIELD_TYPES.ENTRY_TITLE,
                required: true,
                options: null,
              },
            ],
          })
        ),
        http.post('/api/content-entries', () =>
          HttpResponse.json({
            id: 'new-tag-1',
            contentTypeId: CT_TAG_UUID,
            status: 'DRAFT',
            data: { title: 'TypeScript' },
          })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement);
    const titleInput = await waitFor(() => screen.getByLabelText(/title/i), {
      timeout: 3000,
    });
    await userEvent.type(titleInput, 'TypeScript');
    const saveBtn = screen.getByRole('button', { name: /save draft/i });
    await userEvent.click(saveBtn);

    const saved = (
      window as Window &
        typeof globalThis & { __saved__: ReturnType<typeof fn> }
    ).__saved__;
    await waitFor(() => expect(saved).toHaveBeenCalled(), { timeout: 3000 });
    expect(saved).toHaveBeenCalledWith({
      contentTypeId: CT_TAG_UUID,
      entryId: 'new-tag-1',
      entryTitle: 'TypeScript',
    });
  },
};

// Demo (not a test): clicking a relation card actually opens the next pane,
// so the three-deep pane-within-pane flow can be exercised without real data.
// Article → Author → Organisation.
const demoContentTypes: Record<string, unknown> = {
  [CT_ARTICLE_UUID]: {
    id: CT_ARTICLE_UUID,
    name: 'Article',
    identifier: 'Article',
    fields: [
      {
        identifier: 'title',
        name: 'Title',
        type: FIELD_TYPES.ENTRY_TITLE,
        required: true,
        options: null,
      },
      {
        identifier: 'author',
        name: 'Author',
        type: FIELD_TYPES.RELATION,
        required: false,
        options: { targetContentTypeIds: [CT_AUTHOR_UUID] },
      },
    ],
  },
  [CT_AUTHOR_UUID]: {
    id: CT_AUTHOR_UUID,
    name: 'Author',
    identifier: 'Author',
    fields: [
      {
        identifier: 'title',
        name: 'Name',
        type: FIELD_TYPES.ENTRY_TITLE,
        required: true,
        options: null,
      },
      {
        identifier: 'organisation',
        name: 'Organisation',
        type: FIELD_TYPES.RELATION,
        required: false,
        options: { targetContentTypeIds: [CT_ORG_UUID] },
      },
    ],
  },
  [CT_ORG_UUID]: {
    id: CT_ORG_UUID,
    name: 'Organisation',
    identifier: 'Organisation',
    fields: [
      {
        identifier: 'title',
        name: 'Name',
        type: FIELD_TYPES.ENTRY_TITLE,
        required: true,
        options: null,
      },
    ],
  },
};

const demoEntries: Record<
  string,
  {
    contentTypeId: string;
    title: string;
    relation?: { ct: string; id: string };
  }
> = {
  'article-1': {
    contentTypeId: CT_ARTICLE_UUID,
    title: 'Intro to Vue',
    relation: { ct: CT_AUTHOR_UUID, id: 'author-1' },
  },
  'author-1': {
    contentTypeId: CT_AUTHOR_UUID,
    title: 'Ada Lovelace',
    relation: { ct: CT_ORG_UUID, id: 'org-1' },
  },
  'org-1': {
    contentTypeId: CT_ORG_UUID,
    title: 'Analytical Engine Co.',
  },
};

function buildDemoEntryResponse(entryId: string) {
  const entry = demoEntries[entryId];
  if (!entry) {
    return new HttpResponse('not found', { status: 404 });
  }
  const contentType = demoContentTypes[entry.contentTypeId] as {
    fields: Array<{ identifier: string; type: string }>;
  };
  const data: Record<string, unknown> = { title: entry.title };
  if (entry.relation) {
    const relationField = contentType.fields.find(
      (f) => f.type === FIELD_TYPES.RELATION
    );
    if (relationField) {
      data[relationField.identifier] = {
        contentTypeId: entry.relation.ct,
        entryId: entry.relation.id,
      };
    }
  }
  return HttpResponse.json({
    id: entryId,
    contentTypeId: entry.contentTypeId,
    contentType,
    entryTitle: entry.title,
    status: 'DRAFT',
    data,
    publishedAt: null,
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z',
    hasPublishedVersion: false,
  });
}

export const StackedPanesDemo: Story = {
  name: 'Stacked panes (demo)',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        story:
          'Clicking a relation card opens the next pane. Starts at Article → Author → Organisation. Not an assertion test — for manual pane-stack exploration without seeding real data.',
      },
    },
    msw: {
      handlers: [
        http.get('/api/content-types/:id', ({ params }) => {
          const ct = demoContentTypes[params.id as string];
          return ct
            ? HttpResponse.json(ct)
            : new HttpResponse('not found', { status: 404 });
        }),
        http.get('/api/content-entries/:id', ({ params }) =>
          buildDemoEntryResponse(params.id as string)
        ),
      ],
    },
  },
  render: () => ({
    setup() {
      type Seg = { contentTypeId: string; entryId: string; key: number };
      let nextKey = 1;
      const stack = ref<Seg[]>([
        {
          contentTypeId: CT_ARTICLE_UUID,
          entryId: 'article-1',
          key: nextKey++,
        },
      ]);

      const orchestrator: PaneOrchestrator = {
        openPicker() {
          // No picker in the demo — open a relation from the card instead.
        },
        openPane(contentTypeId, entryId, _fieldKey, fromDepth) {
          if (!entryId) return;
          stack.value = [
            ...stack.value.slice(0, fromDepth),
            { contentTypeId, entryId, key: nextKey++ },
          ];
        },
      };
      provide(paneOrchestratorKey, orchestrator);

      function closeAt(idx: number) {
        stack.value = stack.value.slice(0, idx);
      }

      return () =>
        h(
          'div',
          { class: 'relative h-screen' },
          stack.value.map((seg, idx) =>
            h(EntryEditorPane, {
              key: seg.key,
              open: true,
              entryId: seg.entryId,
              depth: idx + 1,
              onClose: () => closeAt(idx),
            })
          )
        );
    },
  }),
};
