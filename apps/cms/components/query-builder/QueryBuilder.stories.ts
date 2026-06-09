import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import QueryBuilder from './QueryBuilder.vue';
import { CONTENT_TYPES, ARTICLE_CT } from '~/utils/queryBuilder/fixtures';
import { ContainerDecorator } from '../../.storybook/decorators';
import { QA_QUERY_BUILDER } from './queryBuilder.config.js';
import { QA_QUERY_CHIPS } from '../query-chips/queryChips.config.js';
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
      canvas.getByTestId(QA_QUERY_CHIPS.CONTENT_TYPE_CHIP)
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
    await userEvent.keyboard('{ArrowRight}'); // → at end of text commits the value
    await expect(
      canvas.getByTestId(QA_FILTER_CHIP.VALUE_SEGMENT)
    ).toHaveTextContent('playoff');
  },
};

// → only commits when the caret is at the end — mid-text it just moves the
// cursor, so editing a multi-word value doesn't fight the lock gesture.
export const ArrowRightMidTextDoesNotCommit: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId(QA_QUERY_BUILDER.INPUT), 'art');
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Article
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Summary (TEXT)
    const valueInput = canvas.getByTestId(
      QA_QUERY_BUILDER.VALUE_INPUT
    ) as HTMLInputElement;
    await userEvent.type(valueInput, 'playoff');
    valueInput.setSelectionRange(3, 3); // caret mid-text
    await userEvent.keyboard('{ArrowRight}');
    // no filter committed; still editing the draft chip
    await expect(canvas.queryByTestId(QA_FILTER_CHIP.VALUE_SEGMENT)).toBeNull();
    await expect(canvas.getByTestId(QA_QUERY_BUILDER.DRAFT_CHIP)).toBeVisible();
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

// Clicking a committed chip's segment re-opens it for editing in place;
// committing replaces it (no duplicate, same position).
export const ReEditCommittedChipValue: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // build: Summary = "first"
    await userEvent.type(canvas.getByTestId(QA_QUERY_BUILDER.INPUT), 'art');
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Article
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Summary (TEXT)
    await userEvent.type(
      canvas.getByTestId(QA_QUERY_BUILDER.VALUE_INPUT),
      'first'
    );
    await userEvent.keyboard('{ArrowRight}'); // commit
    const valueSeg = canvas.getByTestId(QA_FILTER_CHIP.VALUE_SEGMENT);
    await expect(valueSeg).toHaveTextContent('first');

    // click the value segment to re-open the filter; it becomes the editable
    // draft chip in place, pre-filled with the value
    await userEvent.click(valueSeg);
    const valueInput = (await canvas.findByTestId(
      QA_QUERY_BUILDER.VALUE_INPUT
    )) as HTMLInputElement;
    await waitFor(() => expect(valueInput).toHaveValue('first'));

    // edit and re-commit
    await userEvent.clear(valueInput);
    await userEvent.type(valueInput, 'second');
    await userEvent.keyboard('{ArrowRight}');

    // replaced in place — one chip, new value, no duplicate
    const segs = canvas.getAllByTestId(QA_FILTER_CHIP.VALUE_SEGMENT);
    expect(segs).toHaveLength(1);
    await expect(segs[0]!).toHaveTextContent('second');
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
      canvas.getByTestId(QA_QUERY_CHIPS.FILTER_CHIP(0))
    ).toBeVisible();
    await userEvent.click(input);
    await userEvent.keyboard('{Backspace}'); // empty input -> delete the Status chip
    await expect(
      canvas.queryByTestId(QA_QUERY_CHIPS.FILTER_CHIP(0))
    ).toBeNull();
  },
};

export const Locked: Story = {
  args: { lockedContentType: ARTICLE_CT },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // pre-scoped: chip present, dropdown already on fields
    await expect(
      canvas.getByTestId(QA_QUERY_CHIPS.CONTENT_TYPE_CHIP)
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

// Scoped to a type, typing free text offers a "Search <Type> for 'X'" run
// action — the full-text path (incl. searching by entry title) from a per-type
// page, since envelope fields aren't structured filters.
export const ScopedFieldStepFreeText: Story = {
  args: { lockedContentType: ARTICLE_CT },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId(QA_QUERY_BUILDER.INPUT), 'goal');
    const action = canvas.getByTestId(QA_QUERY_DROPDOWN.FREE_TEXT_ACTION);
    await expect(action).toHaveTextContent('Article'); // "Search Article for …"
    await expect(action).toHaveTextContent('goal');
    await userEvent.keyboard('{Enter}'); // runs free text within the scope
    expect(args.onRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ contentType: 'Article', q: 'goal' })
    );
  },
};

// Keyboard-only: ↓ highlights options, Space opens a type/field, Enter picks a
// value — no mouse, no manual re-focus.
export const KeyboardNavigation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId(QA_QUERY_BUILDER.INPUT);
    await userEvent.click(input);
    // ↓ highlights the first content type; Space opens it
    await userEvent.keyboard('{ArrowDown}'); // Article
    await userEvent.keyboard(' ');
    await expect(
      canvas.getByTestId(QA_QUERY_CHIPS.CONTENT_TYPE_CHIP)
    ).toHaveTextContent('Article');
    // field step: ↓↓ to Status, Space opens it
    await waitFor(() => expect(input).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}{ArrowDown}'); // Summary, Status
    await userEvent.keyboard(' ');
    // value step: ↓↓ to Active, Enter picks the highlighted value
    const valueInput = await canvas.findByTestId(QA_QUERY_BUILDER.VALUE_INPUT);
    await waitFor(() => expect(valueInput).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}{ArrowDown}'); // Draft, Active
    await userEvent.keyboard('{Enter}');
    await expect(
      canvas.getByTestId(QA_FILTER_CHIP.VALUE_SEGMENT)
    ).toHaveTextContent('Active');
  },
};

// Removing a chip with the mouse keeps focus on the input, so Enter still runs.
export const MouseRemoveKeepsFocus: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId(QA_QUERY_BUILDER.INPUT);
    await userEvent.type(input, 'art');
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Article
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(1))); // Status
    await userEvent.click(canvas.getByTestId(QA_VALUE_EDITOR.OPTION(1))); // Active → committed chip
    // click the committed chip's ✕ with the mouse
    const chip = within(canvas.getByTestId(QA_QUERY_CHIPS.FILTER_CHIP(0)));
    await userEvent.click(chip.getByTestId(QA_FILTER_CHIP.REMOVE_BUTTON));
    await expect(
      canvas.queryByTestId(QA_QUERY_CHIPS.FILTER_CHIP(0))
    ).toBeNull();
    // focus returned to the input → Enter runs the search
    await waitFor(() => expect(input).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    expect(args.onRun).toHaveBeenCalled();
  },
};
