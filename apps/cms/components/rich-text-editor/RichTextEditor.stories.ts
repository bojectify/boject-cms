import type { Meta, StoryObj } from '@storybook/vue3-vite';
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
          type: 'text',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
          text: 'external URL link',
        },
        { type: 'text', text: ' and a ' },
        {
          type: 'text',
          marks: [
            {
              type: 'cmsLink',
              attrs: {
                contentTypeId: 'ct-author',
                entryId: 'a1',
                contentTypeIdentifier: 'Author',
              },
            },
          ],
          text: 'CMS entry link',
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
