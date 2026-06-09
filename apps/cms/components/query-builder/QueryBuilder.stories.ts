import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import QueryBuilder from './QueryBuilder.vue';
import { CONTENT_TYPES, ARTICLE_CT } from '~/utils/queryBuilder/fixtures';
import { ContainerDecorator } from '../../.storybook/decorators';
import { QA_QUERY_BUILDER } from './queryBuilder.config.js';
import { QA_QUERY_DROPDOWN } from '../query-dropdown/queryDropdown.config.js';
import { QA_FILTER_CHIP } from '../filter-chip/filterChip.config.js';
import { QA_VALUE_EDITOR } from '../value-editor/valueEditor.config.js';
import { QA_CONTENT_TYPE_CHIP } from '../content-type-chip/contentTypeChip.config.js';

const meta: Meta<typeof QueryBuilder> = {
  title: 'Search/QueryBuilder',
  component: QueryBuilder,
  parameters: { layout: 'centered' },
  // The palette fills its container; bound it to a realistic width in isolation.
  decorators: [ContainerDecorator(700)],
  args: {
    contentTypes: CONTENT_TYPES,
    searchEntries: fn(async () => [
      { id: 'e1', entryTitle: 'Jamie Rivera', contentTypeName: 'Author' },
    ]),
    'onUpdate:modelValue': fn(),
    onRun: fn(),
    onBroaden: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof QueryBuilder>;

export const Initial: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId(QA_QUERY_BUILDER.INPUT);
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute('placeholder', 'Search everything…');
  },
};

export const FreeTextTyped: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId(QA_QUERY_BUILDER.INPUT), 'art');
    // free-text action + matching content types appear
    await expect(
      canvas.getByTestId(QA_QUERY_DROPDOWN.FREE_TEXT_ACTION)
    ).toBeVisible();
    await expect(
      canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))
    ).toHaveTextContent('Article');
    await userEvent.keyboard('{Enter}'); // runs free-text q
    await expect(args.onRun).toHaveBeenCalled();
  },
};

export const PickContentType: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId(QA_QUERY_BUILDER.INPUT), 'art');
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Article
    // chip appears; dropdown now lists Article's fields
    await expect(
      canvas.getByTestId(QA_QUERY_BUILDER.CONTENT_TYPE_CHIP)
    ).toHaveTextContent('Article');
    await expect(
      canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))
    ).toHaveTextContent('Summary');
    await expect(
      canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(1))
    ).toHaveTextContent('Status');
  },
};

export const BooleanValue: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId(QA_QUERY_BUILDER.INPUT), 'art');
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Article
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(4))); // Featured (BOOLEAN)
    await userEvent.click(canvas.getByTestId(QA_VALUE_EDITOR.OPTION(0))); // True
    // chip committed: the value segment renders "true" (a real boolean, not the string)
    await expect(
      canvas.getByTestId(QA_FILTER_CHIP.VALUE_SEGMENT)
    ).toHaveTextContent('true');
    expect(args['onUpdate:modelValue']).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: [expect.objectContaining({ field: 'featured', value: true })],
      })
    );
  },
};

export const SelectValue: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId(QA_QUERY_BUILDER.INPUT), 'art');
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Article
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(1))); // Status (SELECT)
    await userEvent.click(canvas.getByTestId(QA_VALUE_EDITOR.OPTION(1))); // Active (2nd choice)
    await expect(
      canvas.getByTestId(QA_FILTER_CHIP.VALUE_SEGMENT)
    ).toHaveTextContent('Active');
  },
};

// Picking a field drops a draft chip into the bar with the cursor on its value
// segment — the core of the search interaction.
export const DraftChipFocusOnFieldSelect: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId(QA_QUERY_BUILDER.INPUT), 'art');
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Article
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Summary (TEXT)
    const chip = await canvas.findByTestId(QA_QUERY_BUILDER.DRAFT_CHIP);
    await expect(chip).toHaveTextContent('Summary'); // field display name
    await expect(chip).toHaveTextContent('is'); // operator label (eq -> "is")
    const valueInput = canvas.getByTestId(QA_QUERY_BUILDER.VALUE_INPUT);
    await waitFor(() => expect(valueInput).toHaveFocus());
  },
};

export const TextValueCommitsWithArrow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId(QA_QUERY_BUILDER.INPUT), 'art');
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Article
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Summary (TEXT)
    // the value is typed into the draft chip's value segment, not the main input
    const valueInput = canvas.getByTestId(QA_QUERY_BUILDER.VALUE_INPUT);
    await userEvent.type(valueInput, 'playoff');
    await userEvent.keyboard('{ArrowRight}'); // → commits the value
    await expect(
      canvas.getByTestId(QA_FILTER_CHIP.VALUE_SEGMENT)
    ).toHaveTextContent('playoff');
  },
};

export const RelationValue: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId(QA_QUERY_BUILDER.INPUT), 'art');
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Article
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(2))); // Author (RELATION)
    // entries load on open; typing into the value segment narrows
    await userEvent.type(
      canvas.getByTestId(QA_QUERY_BUILDER.VALUE_INPUT),
      'ja'
    );
    expect(args.searchEntries).toHaveBeenCalledWith(['au1'], 'ja');
    await userEvent.click(await canvas.findByTestId(QA_VALUE_EDITOR.OPTION(0))); // Jamie Rivera (async result)
    // the chip shows the captured title, not the stored entry id
    await expect(
      canvas.getByTestId(QA_FILTER_CHIP.VALUE_SEGMENT)
    ).toHaveTextContent('Jamie Rivera');
  },
};

export const FullQueryRun: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId(QA_QUERY_BUILDER.INPUT);
    await userEvent.type(input, 'art');
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Article
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(1))); // Status
    await userEvent.click(canvas.getByTestId(QA_VALUE_EDITOR.OPTION(1))); // Active (2nd choice)
    // refocus the input (clicking the Active option moved focus off it) so the
    // {Enter} keydown reaches the combobox's run handler
    await userEvent.click(input);
    await userEvent.keyboard('{Enter}'); // run
    // exact match: no leftover free-text q from typing "art" to find the type
    expect(args.onRun).toHaveBeenLastCalledWith({
      contentType: 'Article',
      filters: [{ field: 'status', op: 'eq', value: 'Active' }],
    });
  },
};

export const BackspaceDeletesChip: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId(QA_QUERY_BUILDER.INPUT);
    await userEvent.type(input, 'art');
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Article
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(1))); // Status
    await userEvent.click(canvas.getByTestId(QA_VALUE_EDITOR.OPTION(1))); // Active (2nd choice)
    await expect(
      canvas.getByTestId(QA_QUERY_BUILDER.FILTER_CHIP(0))
    ).toBeVisible();
    await userEvent.click(input);
    await userEvent.keyboard('{Backspace}'); // empty input -> delete the Status chip
    await expect(
      canvas.queryByTestId(QA_QUERY_BUILDER.FILTER_CHIP(0))
    ).toBeNull();
  },
};

export const Locked: Story = {
  args: { lockedContentType: ARTICLE_CT },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // pre-scoped: chip present, dropdown already on fields
    await expect(
      canvas.getByTestId(QA_QUERY_BUILDER.CONTENT_TYPE_CHIP)
    ).toHaveTextContent('Article');
    await expect(
      canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))
    ).toHaveTextContent('Summary');
    // ✕ on the pinned chip broadens, keeping q
    await userEvent.type(canvas.getByTestId(QA_QUERY_BUILDER.INPUT), 'goal');
    await userEvent.click(
      canvas.getByTestId(QA_CONTENT_TYPE_CHIP.REMOVE_BUTTON)
    );
    expect(args.onBroaden).toHaveBeenCalledWith({ q: 'goal' });
  },
};
