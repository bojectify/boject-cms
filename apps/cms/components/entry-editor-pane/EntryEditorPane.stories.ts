import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { h, provide } from 'vue';
import { paneOrchestratorKey } from '~/composables/paneOrchestrator';
import EntryEditorPane from './EntryEditorPane.vue';

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
            contentTypeId: 'ct-author',
            contentType: {
              id: 'ct-author',
              name: 'Author',
              identifier: 'Author',
              fields: [
                {
                  identifier: 'title',
                  name: 'Title',
                  type: 'ENTRY_TITLE',
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

export const OpensRelationAtDepth: Story = {
  decorators: [
    (story) => ({
      setup() {
        const orchestrator = {
          openPicker: fn(),
          openPane: fn(),
        };
        provide(paneOrchestratorKey, orchestrator);
        (window as unknown as { __orch__: typeof orchestrator }).__orch__ =
          orchestrator;
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
        http.get('/api/content-types/ct-author', () =>
          HttpResponse.json({
            id: 'ct-author',
            name: 'Author',
            identifier: 'Author',
            fields: [
              {
                identifier: 'title',
                name: 'Title',
                type: 'ENTRY_TITLE',
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
                    type: 'ENTRY_TITLE',
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
            contentTypeId: 'ct-article',
            contentType: {
              id: 'ct-article',
              name: 'Article',
              identifier: 'Article',
              fields: [
                {
                  identifier: 'title',
                  name: 'Title',
                  type: 'ENTRY_TITLE',
                  required: true,
                  options: null,
                },
                {
                  identifier: 'author',
                  name: 'Author',
                  type: 'RELATION',
                  required: false,
                  options: { targetContentTypeIds: ['ct-author'] },
                },
              ],
            },
            status: 'DRAFT',
            data: {
              title: 'Intro to Vue',
              author: { contentTypeId: 'ct-author', entryId: 'a1' },
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
      window as unknown as { __orch__: { openPane: ReturnType<typeof fn> } }
    ).__orch__;
    expect(orch.openPane).toHaveBeenCalledWith('ct-author', 'a1', 'author', 1);
  },
};

export const EmitsSavedOnPublish: Story = {
  render: (args) => ({
    components: { EntryEditorPane },
    setup() {
      const saved = fn();
      (window as unknown as { __saved__: ReturnType<typeof fn> }).__saved__ =
        saved;
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
    contentTypeId: 'ct-tag',
    depth: 2,
  },
  parameters: {
    layout: 'fullscreen',
    msw: {
      handlers: [
        http.get('/api/content-types/ct-tag', () =>
          HttpResponse.json({
            id: 'ct-tag',
            name: 'Tag',
            identifier: 'Tag',
            fields: [
              {
                identifier: 'title',
                name: 'Title',
                type: 'ENTRY_TITLE',
                required: true,
                options: null,
              },
            ],
          })
        ),
        http.post('/api/content-entries', () =>
          HttpResponse.json({
            id: 'new-tag-1',
            contentTypeId: 'ct-tag',
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

    const saved = (window as unknown as { __saved__: ReturnType<typeof fn> })
      .__saved__;
    await waitFor(() => expect(saved).toHaveBeenCalled(), { timeout: 3000 });
    expect(saved).toHaveBeenCalledWith({
      contentTypeId: 'ct-tag',
      entryId: 'new-tag-1',
      entryTitle: 'TypeScript',
    });
  },
};
