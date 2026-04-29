import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import RichTextEditor from './RichTextEditor.vue';

const meta: Meta<typeof RichTextEditor> = {
  title: 'Components/RichTextEditor',
  component: RichTextEditor,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof RichTextEditor>;

const sampleDoc = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Heading level 1' }],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Heading level 2' }],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Heading level 3' }],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Suspendisse fermentum, justo ac molestie pulvinar.',
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'A paragraph with an ' },
        {
          type: 'externalLink',
          attrs: { href: 'https://example.com' },
        },
        { type: 'text', text: ' and a ' },
        {
          type: 'cmsLink',
          attrs: {
            contentTypeId: 'ct-author',
            entryId: 'a1',
            contentTypeIdentifier: 'Author',
          },
        },
        { type: 'text', text: '.' },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'And here is an embed: ' },
        {
          type: 'cmsEmbed',
          attrs: {
            contentTypeId: 'ct-author',
            entryId: 'a1',
            contentTypeIdentifier: 'Author',
          },
        },
        { type: 'text', text: '.' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Bullet item one' }],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Bullet item two' }],
            },
          ],
        },
      ],
    },
    {
      type: 'orderedList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Numbered item one' }],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Numbered item two' }],
            },
          ],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'A blockquote line — used for callouts and pull quotes.',
            },
          ],
        },
      ],
    },
    {
      type: 'codeBlock',
      content: [{ type: 'text', text: 'const x = 1;\nconsole.log(x);' }],
    },
  ],
};

export const AllStyledNodes: Story = {
  args: {
    modelValue: sampleDoc,
    targetContentTypeIds: ['ct-author'],
    linkTargetContentTypeIds: ['ct-author'],
  },
};

// Verifies the full Storybook plumbing end-to-end: MSW fixtures resolve the
// chip's referenced entry, the auto-imported `useRelationResolver` composable
// fetches it, and clicking the rendered chip opens the entry picker modal
// (which itself uses `useAuthedFetch` + `$fetch` shims).
export const ChipClickEdit: Story = {
  args: {
    modelValue: sampleDoc,
    targetContentTypeIds: ['ct-author'],
    linkTargetContentTypeIds: ['ct-author'],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const chip = await canvas.findByText(
      'Ada Lovelace',
      {
        selector: '.rich-text-editor__chip--link .rich-text-editor__chip-label',
      },
      { timeout: 5000 }
    );
    await userEvent.click(chip);

    // The modal renders via Teleport, so query the document body, not the canvas.
    const body = within(document.body);
    await waitFor(
      () => expect(body.getByText(/edit link/i)).toBeInTheDocument(),
      { timeout: 5000 }
    );
  },
};
