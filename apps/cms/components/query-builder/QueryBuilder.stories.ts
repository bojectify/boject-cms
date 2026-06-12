import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import QueryBuilder from './QueryBuilder.vue';
import {
  CONTENT_TYPES,
  ARTICLE_CT,
  REPORT_CT,
} from '~/utils/queryBuilder/fixtures';
import { ContainerDecorator } from '../../.storybook/decorators';
import { QA_QUERY_BUILDER } from './queryBuilder.config.js';
import { QA_QUERY_CHIPS } from '../query-chips/queryChips.config.js';
import { QA_QUERY_DROPDOWN } from '../query-dropdown/queryDropdown.config.js';
import { QA_FILTER_CHIP } from '../filter-chip/filterChip.config.js';
import { QA_VALUE_EDITOR } from '../value-editor/valueEditor.config.js';
import { QA_CONTENT_TYPE_CHIP } from '../content-type-chip/contentTypeChip.config.js';
import { QA_MULTI_SELECT_EDITOR } from '../multi-select-editor/multiSelectEditor.config.js';
import { QA_MULTI_ENTRY_EDITOR } from '../multi-entry-editor/multiEntryEditor.config.js';
import { QA_DATE_RANGE_EDITOR } from '../date-range-editor/dateRangeEditor.config.js';

const meta: Meta<typeof QueryBuilder> = {
  title: 'Search/QueryBuilder',
  component: QueryBuilder,
  parameters: { layout: 'centered' },
  // The palette fills its container; bound it to the card's max width (1080px) in
  // isolation. Dropdown + footer contents self-cap at ~700px inside the card.
  decorators: [ContainerDecorator(1080)],
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

// Re-editing a committed chip's OPERATOR segment opens the operator step with a
// CLEAR input — the value is carried on the draft and re-prefilled only once a
// new operator is picked. Regression guard for the committed value leaking into
// the input at the operator step (#332).
export const ReEditCommittedChipOperator: Story = {
  args: { enableRichOperators: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // build: Summary is "first"
    await userEvent.type(canvas.getByTestId(QA_QUERY_BUILDER.INPUT), 'art');
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Article
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Summary (TEXT)
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // operator: is (eq)
    await userEvent.type(
      canvas.getByTestId(QA_QUERY_BUILDER.VALUE_INPUT),
      'first'
    );
    await userEvent.keyboard('{ArrowRight}'); // commit → "Summary is first"
    await expect(
      canvas.getByTestId(QA_FILTER_CHIP.OPERATOR_SEGMENT)
    ).toHaveTextContent('is');

    // click the operator segment → operator step, with a CLEAR value input
    await userEvent.click(canvas.getByTestId(QA_FILTER_CHIP.OPERATOR_SEGMENT));
    await expect(
      canvas.getByTestId(QA_QUERY_BUILDER.DROPDOWN)
    ).toHaveTextContent('is not'); // operator step is showing
    await expect(canvas.getByTestId(QA_QUERY_BUILDER.VALUE_INPUT)).toHaveValue(
      '' // not "first" — the value must not leak into the operator-step input
    );

    // picking a new operator carries the value back into the value step
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(1))); // is not
    await expect(canvas.getByTestId(QA_QUERY_BUILDER.VALUE_INPUT)).toHaveValue(
      'first'
    );
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
    // Type "art" to filter the content-type list to Article. This also hides the
    // pre-scope "System" group (no system field name contains "art"), so the
    // option list is just [free-text action, Article, …] (#302) — keeping the
    // assertion robust to the system-field registry growing.
    await userEvent.type(input, 'art');
    // ↓↓ skips the free-text action (shown while typing) to highlight the first
    // content type; Space opens it.
    await userEvent.keyboard('{ArrowDown}{ArrowDown}'); // free-text action, Article
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

// Rich operators on: picking a TEXT field opens the operator step (is / is not /
// contains / starts with), and picking a single-value op (contains) routes to
// the value step where a typed value commits the full field·op·value filter.
export const RichOperatorFlow: Story = {
  args: { enableRichOperators: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId(QA_QUERY_BUILDER.INPUT), 'art');
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Article
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Summary (TEXT)
    // Operator step shows TEXT's single-value operators.
    await expect(
      canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))
    ).toHaveTextContent('is');
    await expect(
      canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(1))
    ).toHaveTextContent('is not');
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(2))); // contains
    // Value step: the typed value lives in the draft chip's value segment, and
    // → at the end of the text commits it (mirrors TextValueCommitsWithArrow).
    const valueInput = canvas.getByTestId(QA_QUERY_BUILDER.VALUE_INPUT);
    await userEvent.type(valueInput, 'brew');
    await userEvent.keyboard('{ArrowRight}');
    expect(args['onUpdate:modelValue']).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: [
          expect.objectContaining({
            field: 'summary',
            op: 'contains',
            value: 'brew',
          }),
        ],
      })
    );
  },
};

// Multi-value operators stay gated even with rich operators on: a SELECT field's
// operator step offers "is" / "is not" but NOT the arity-many "is any of" (its
// value editor lands in #333).
export const MultiValueOpsGated: Story = {
  args: { enableRichOperators: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId(QA_QUERY_BUILDER.INPUT), 'art');
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Article
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(1))); // Status (SELECT)
    // The dropdown is rendered with the QueryBuilder's DROPDOWN test id (the
    // parent overrides QueryDropdown's own default testId via :test-id).
    const dropdown = canvas.getByTestId(QA_QUERY_BUILDER.DROPDOWN);
    await expect(dropdown).toHaveTextContent('is not');
    await expect(dropdown).not.toHaveTextContent('is any of');
  },
};

// Multi-value list ops on: picking SELECT's "is any of" opens the multi-select
// editor; toggling two choices accumulates a string[], and Enter commits the
// array + runs the search as a single `in` filter.
export const SelectIsAnyOfFlow: Story = {
  args: { enableRichOperators: true, enableMultiValueOperators: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId(QA_QUERY_BUILDER.INPUT), 'art');
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Article
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(1))); // Status (SELECT)
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(2))); // is any of
    // multi-select editor: toggle two choices (Active, Ended), Enter commits + runs
    await userEvent.click(canvas.getByTestId(QA_MULTI_SELECT_EDITOR.OPTION(1)));
    await userEvent.click(canvas.getByTestId(QA_MULTI_SELECT_EDITOR.OPTION(2)));
    // clicking the rows moved focus off the value input — refocus it so the
    // {Enter} keydown reaches the combobox's commit+run handler
    await userEvent.click(canvas.getByTestId(QA_QUERY_BUILDER.VALUE_INPUT));
    await userEvent.keyboard('{Enter}');
    const lastRun = (args.onRun as ReturnType<typeof fn>).mock.calls.at(-1)![0];
    expect(lastRun.contentType).toBe('Article');
    expect(lastRun.filters[0]).toEqual(
      expect.objectContaining({ field: 'status', op: 'in' })
    );
    expect((lastRun.filters[0].value as string[]).length).toBe(2);
  },
};

// Pointer toggle keeps focus on the value input (bug fix): after clicking option
// rows with a pointer, focus returns to the value input — so ↑/↓ and Enter keep
// working WITHOUT a manual re-focus. Enter then commits the accumulated selection
// + runs (it does NOT re-toggle the last-clicked row).
export const PointerToggleKeepsFocusForEnter: Story = {
  args: { enableRichOperators: true, enableMultiValueOperators: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId(QA_QUERY_BUILDER.INPUT), 'art');
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Article
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(1))); // Status (SELECT)
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(2))); // is any of
    await userEvent.click(canvas.getByTestId(QA_MULTI_SELECT_EDITOR.OPTION(1))); // Active
    await userEvent.click(canvas.getByTestId(QA_MULTI_SELECT_EDITOR.OPTION(2))); // Ended
    // No manual refocus: the value input regains focus after a pointer toggle.
    const valueInput = canvas.getByTestId(QA_QUERY_BUILDER.VALUE_INPUT);
    await waitFor(() => expect(valueInput).toHaveFocus());
    await userEvent.keyboard('{Enter}'); // commit + run (not a re-toggle)
    const lastRun = (args.onRun as ReturnType<typeof fn>).mock.calls.at(-1)![0];
    expect(lastRun.contentType).toBe('Article');
    expect(lastRun.filters[0]).toEqual(
      expect.objectContaining({ field: 'status', op: 'in' })
    );
    expect((lastRun.filters[0].value as string[]).length).toBe(2);
  },
};

// Guard: pressing Enter at a multi-value step with NOTHING toggled must not
// commit a degenerate empty filter (`status:in:` → `IN ['']`). The draft is
// abandoned and the search just runs with no filter — mirroring single-value
// Enter on an empty input.
export const SelectIsAnyOfEmptyEnterCommitsNothing: Story = {
  args: { enableRichOperators: true, enableMultiValueOperators: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId(QA_QUERY_BUILDER.INPUT), 'art');
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Article
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(1))); // Status (SELECT)
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(2))); // is any of
    // toggle nothing; hit Enter from the value input
    await userEvent.click(canvas.getByTestId(QA_QUERY_BUILDER.VALUE_INPUT));
    await userEvent.keyboard('{Enter}');
    // ran, but with no filter committed (no degenerate empty `in`)
    const lastRun = (args.onRun as ReturnType<typeof fn>).mock.calls.at(-1)![0];
    expect(lastRun.contentType).toBe('Article');
    expect(lastRun.filters).toEqual([]);
  },
};

// Multi-value MULTIRELATION: picking Tags → "contains any" opens the searchable
// multi-entry editor; toggling two entries accumulates a string[] of ids and
// captures their titles, and Enter commits the array + runs as one `containsAny`
// filter. The committed chip shows both captured titles (the array fan-out).
export const MultirelationContainsAnyFlow: Story = {
  args: {
    enableRichOperators: true,
    enableMultiValueOperators: true,
    // story-level override: two entries so two can be toggled (meta default returns one)
    searchEntries: fn(async () => [
      { id: 't1', entryTitle: 'News', contentTypeName: 'Tag' },
      { id: 't2', entryTitle: 'Sport', contentTypeName: 'Tag' },
    ]),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId(QA_QUERY_BUILDER.INPUT), 'art');
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Article
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(6))); // Tags (MULTIRELATION) — appended last
    // operator step: [contains (eq), contains any (containsAny), contains all (containsAll)]
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(1))); // contains any
    // multi-entry editor: toggle the first two entries
    await userEvent.click(
      await canvas.findByTestId(QA_MULTI_ENTRY_EDITOR.OPTION(0))
    ); // News
    await userEvent.click(canvas.getByTestId(QA_MULTI_ENTRY_EDITOR.OPTION(1))); // Sport
    // clicking the rows moved focus off the value input — refocus so {Enter}
    // reaches the combobox's commit+run handler (mirrors SelectIsAnyOfFlow)
    await userEvent.click(canvas.getByTestId(QA_QUERY_BUILDER.VALUE_INPUT));
    await userEvent.keyboard('{Enter}');
    // committed + ran as one containsAny filter holding the two ids
    const lastRun = (args.onRun as ReturnType<typeof fn>).mock.calls.at(-1)![0];
    expect(lastRun.filters[0]).toEqual(
      expect.objectContaining({ field: 'tags', op: 'containsAny' })
    );
    expect(lastRun.filters[0].value).toHaveLength(2);
    // the committed chip shows BOTH captured titles (array fan-out via liveLabels)
    const chip = within(canvas.getByTestId(QA_QUERY_CHIPS.FILTER_CHIP(0)));
    const seg = chip.getByTestId(QA_FILTER_CHIP.VALUE_SEGMENT);
    await expect(seg).toHaveTextContent('News');
    await expect(seg).toHaveTextContent('Sport');
  },
};

// DATETIME single-date: picking Published → before opens the single-date calendar;
// selecting a day commits a `before` filter with a UTC start-of-day ISO, and the
// chip renders the formatted date.
export const DatetimeBeforeFlow: Story = {
  args: { enableRichOperators: true, enableRangeOperators: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId(QA_QUERY_BUILDER.INPUT), 'art');
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Article
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(3))); // Published (DATETIME)
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // before
    // single-date calendar (opens on the current month for a fresh draft): pick the
    // 15th — always an in-view cell, never an adjacent-month overflow day. Its
    // accessible name ends "… 15, <year>", so `/\b15,/` matches it uniquely.
    await userEvent.click(await canvas.findByRole('button', { name: /\b15,/ }));
    const lastModel = (
      args['onUpdate:modelValue'] as ReturnType<typeof fn>
    ).mock.calls.at(-1)![0] as {
      filters: { field: string; op: string; value: unknown }[];
    };
    expect(lastModel.filters[0]).toEqual(
      expect.objectContaining({ field: 'published', op: 'before' })
    );
    // start-of-day on the 15th (month/year vary with the test clock)
    expect(lastModel.filters[0]!.value).toMatch(
      /^\d{4}-\d{2}-15T00:00:00\.000Z$/
    );
    // chip shows a formatted date (e.g. "Jun 15, 2026")
    await expect(
      canvas.getByTestId(QA_FILTER_CHIP.VALUE_SEGMENT)
    ).toHaveTextContent(/\w{3} \d{1,2}, \d{4}/);
  },
};

// DATETIME `is between` is now OFFERED (range gate on) and opens the range editor;
// a preset commits a [start, end] pair.
export const DatetimeBetweenPresetFlow: Story = {
  args: { enableRichOperators: true, enableRangeOperators: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId(QA_QUERY_BUILDER.INPUT), 'art');
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Article
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(3))); // Published
    // operator step includes "is between" (range gate on)
    const dropdown = canvas.getByTestId(QA_QUERY_BUILDER.DROPDOWN);
    await expect(dropdown).toHaveTextContent('is between');
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(2))); // is between
    // range editor: click the "Last 7 days" preset
    await userEvent.click(
      canvas.getByTestId(QA_DATE_RANGE_EDITOR.PRESET('last7'))
    );
    const lastModel = (
      args['onUpdate:modelValue'] as ReturnType<typeof fn>
    ).mock.calls.at(-1)![0] as {
      filters: { field: string; op: string; value: unknown }[];
    };
    expect(lastModel.filters[0]).toEqual(
      expect.objectContaining({ field: 'published', op: 'between' })
    );
    expect(lastModel.filters[0]!.value).toHaveLength(2);
    // chip shows a formatted range ("start – end")
    await expect(
      canvas.getByTestId(QA_FILTER_CHIP.VALUE_SEGMENT)
    ).toHaveTextContent('–');
  },
};

// Tab at a multi-value step locks in the selection and continues (it does NOT
// tab out of the palette — a native Tab would move focus off the value input and
// kill ↑/↓ row navigation). The committed chip appears; the draft is cleared.
export const SelectIsAnyOfTabCommitsAndContinues: Story = {
  args: { enableRichOperators: true, enableMultiValueOperators: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId(QA_QUERY_BUILDER.INPUT), 'art');
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // Article
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(1))); // Status (SELECT)
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(2))); // is any of
    await userEvent.click(canvas.getByTestId(QA_MULTI_SELECT_EDITOR.OPTION(1))); // Active
    await userEvent.click(canvas.getByTestId(QA_MULTI_SELECT_EDITOR.OPTION(2))); // Ended
    // refocus the value input (clicking rows moved focus off it), then Tab
    await userEvent.click(canvas.getByTestId(QA_QUERY_BUILDER.VALUE_INPUT));
    await userEvent.keyboard('{Tab}');
    // committed in place (Tab was intercepted, not a native tab-out) + draft gone
    const seg = canvas.getByTestId(QA_FILTER_CHIP.VALUE_SEGMENT);
    await expect(seg).toHaveTextContent('Active');
    await expect(seg).toHaveTextContent('Ended');
    await expect(canvas.queryByTestId(QA_QUERY_BUILDER.DRAFT_CHIP)).toBeNull();
  },
};

// Wide palette + wrapping chips: with several committed filters the card grows
// toward 1080px and the chip row wraps onto multiple lines instead of squashing
// the input. Keyboard run-to-search still works once the chips have wrapped.
export const WideWithWrappingChips: Story = {
  args: {
    modelValue: {
      contentType: 'Article',
      filters: [
        { field: 'summary', op: 'eq', value: 'alpha' },
        { field: 'summary', op: 'eq', value: 'bravo' },
        { field: 'summary', op: 'eq', value: 'charlie' },
        { field: 'summary', op: 'eq', value: 'delta' },
        { field: 'summary', op: 'eq', value: 'echo' },
        { field: 'summary', op: 'eq', value: 'foxtrot' },
        { field: 'summary', op: 'eq', value: 'golf' },
        { field: 'summary', op: 'eq', value: 'hotel' },
      ],
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // all eight committed chips render
    expect(canvas.getAllByTestId(QA_FILTER_CHIP.VALUE_SEGMENT)).toHaveLength(8);
    // the chip row is set to wrap, and the chips actually flow onto more than one
    // line (the last chip sits below the first)
    const row = canvas.getByTestId(QA_QUERY_BUILDER.CHIP_ROW);
    expect(getComputedStyle(row).flexWrap).toBe('wrap');
    const firstChip = canvas.getByTestId(
      QA_QUERY_CHIPS.FILTER_CHIP(0)
    ) as HTMLElement;
    const lastChip = canvas.getByTestId(
      QA_QUERY_CHIPS.FILTER_CHIP(7)
    ) as HTMLElement;
    expect(lastChip.offsetTop).toBeGreaterThan(firstChip.offsetTop);
    // Enter still runs the search with the chips wrapped
    await userEvent.click(canvas.getByTestId(QA_QUERY_BUILDER.INPUT));
    await userEvent.keyboard('{Enter}');
    expect(args.onRun).toHaveBeenCalled();
  },
};

// URL-loaded query: a relation filter's chip shows the seeded title (no live pick).
export const RelationLabelSeed: Story = {
  args: {
    modelValue: {
      contentType: 'Article',
      filters: [{ field: 'author', op: 'eq', value: 'e1' }],
    },
    relationLabels: { e1: 'Jamie Rivera' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chip = within(canvas.getByTestId(QA_QUERY_CHIPS.FILTER_CHIP(0)));
    await expect(
      chip.getByTestId(QA_FILTER_CHIP.VALUE_SEGMENT)
    ).toHaveTextContent('Jamie Rivera');
  },
};

// URL-loaded query, labels still resolving → the chip value shows a skeleton.
export const RelationLabelSeedPending: Story = {
  args: {
    modelValue: {
      contentType: 'Article',
      filters: [{ field: 'author', op: 'eq', value: 'e1' }],
    },
    relationLabelsPending: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chip = within(canvas.getByTestId(QA_QUERY_CHIPS.FILTER_CHIP(0)));
    await expect(chip.getByTestId(QA_FILTER_CHIP.VALUE_SKELETON)).toBeVisible();
  },
};
// System (envelope) fields: scoped to a type, the field step offers a "System"
// group after the type's own fields with the "Entry key" row. With rich
// operators on, picking it opens the operator step with exactly SLUG's donor
// set (is / starts with); committing a value lands a chip rendering the
// DISPLAY name ("Entry key") and a model filter carrying the `$entryKey` wire
// token (#315).
export const SystemEntryKeyFlow: Story = {
  args: { lockedContentType: ARTICLE_CT, enableRichOperators: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // field step: Article's own filterable fields are followed by the "System"
    // group, which lists every SYSTEM_FIELDS row (e.g. Entry key). Locate the
    // Entry key option by its display name rather than a hardcoded index, so the
    // test stays correct as the system-field registry grows (#302).
    await expect(
      canvas.getByTestId(QA_QUERY_BUILDER.DROPDOWN)
    ).toHaveTextContent('System');
    const entryKeyRow = canvas.getByRole('option', { name: 'Entry key' });
    await userEvent.click(entryKeyRow);
    // operator step: exactly the SLUG donor operators — is / starts with
    await expect(
      canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))
    ).toHaveTextContent('is');
    await expect(
      canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(1))
    ).toHaveTextContent('starts with');
    await expect(canvas.queryByTestId(QA_QUERY_DROPDOWN.OPTION(2))).toBeNull();
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))); // is (eq)
    // value step: type + → commits (mirrors TextValueCommitsWithArrow)
    await userEvent.type(
      canvas.getByTestId(QA_QUERY_BUILDER.VALUE_INPUT),
      'my-key'
    );
    await userEvent.keyboard('{ArrowRight}');
    // chip shows display labels…
    const chip = within(canvas.getByTestId(QA_QUERY_CHIPS.FILTER_CHIP(0)));
    await expect(
      chip.getByTestId(QA_FILTER_CHIP.FIELD_SEGMENT)
    ).toHaveTextContent('Entry key');
    await expect(
      chip.getByTestId(QA_FILTER_CHIP.OPERATOR_SEGMENT)
    ).toHaveTextContent('is');
    await expect(
      chip.getByTestId(QA_FILTER_CHIP.VALUE_SEGMENT)
    ).toHaveTextContent('my-key');
    // …while the model carries the `$entryKey` wire token
    expect(args['onUpdate:modelValue']).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: [{ field: '$entryKey', op: 'eq', value: 'my-key' }],
      })
    );
  },
};

// Pre-scope system fields (#302): UNSCOPED (no content type picked), the
// contentType step offers a "System" group ABOVE "Content types" with the
// `unscoped` envelope fields (Status, Entry ID) — so "all DRAFTs across types"
// is a one-step query. Picking Status → "is any of" → Draft + Changed commits a
// single `$status` filter and the search stays cross-type (no content type).
export const PreScopeSystemFields: Story = {
  args: { enableRichOperators: true, enableMultiValueOperators: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // DOM order: the "System" group heading precedes the "Content types"
    // heading, and the Status option sits above the first content-type option.
    const dropdown = canvas.getByTestId(QA_QUERY_BUILDER.DROPDOWN);
    await expect(dropdown).toHaveTextContent('System');
    const systemHeading = within(dropdown).getByText('System');
    const contentTypesHeading = within(dropdown).getByText('Content types');
    expect(
      systemHeading.compareDocumentPosition(contentTypesHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy(); // System heading comes before Content types heading
    const statusOption = canvas.getByRole('option', { name: 'Status' });
    await expect(
      canvas.getByRole('option', { name: 'Entry ID' })
    ).toBeVisible();
    const firstType = canvas.getByRole('option', { name: 'Article' });
    expect(
      statusOption.compareDocumentPosition(firstType) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy(); // Status option precedes the first content-type option

    // Pick Status by its visible text (registry-growth robust, not an index).
    await userEvent.click(statusOption);
    // SELECT operator step: is / is not / is any of — pick "is any of".
    await userEvent.click(canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(2)));
    // multi-select editor: toggle Draft (0) + Changed (1)
    await userEvent.click(canvas.getByTestId(QA_MULTI_SELECT_EDITOR.OPTION(0))); // Draft
    await userEvent.click(canvas.getByTestId(QA_MULTI_SELECT_EDITOR.OPTION(1))); // Changed
    // clicking rows moved focus off the value input — refocus so {Enter} reaches
    // the commit+run handler (mirrors SelectIsAnyOfFlow)
    await userEvent.click(canvas.getByTestId(QA_QUERY_BUILDER.VALUE_INPUT));
    await userEvent.keyboard('{Enter}');
    // committed `$status` chip; no content type was scoped (cross-type query)
    await expect(
      canvas.getByTestId(QA_QUERY_CHIPS.FILTER_CHIP(0))
    ).toBeVisible();
    const lastRun = (args.onRun as ReturnType<typeof fn>).mock.calls.at(-1)![0];
    expect(lastRun.contentType).toBeUndefined();
    expect(lastRun.filters[0]).toEqual(
      expect.objectContaining({ field: '$status', op: 'in' })
    );
    expect(lastRun.filters[0].value).toEqual(['DRAFT', 'CHANGED']);
  },
};

// URL-prefilled system-field filter: the committed chip renders the display
// labels ("Entry key starts with fix"), never the raw `$entryKey` wire token;
// its ✕ removes it (#315).
export const SystemFieldChipFromUrl: Story = {
  args: {
    modelValue: {
      contentType: 'Article',
      filters: [{ field: '$entryKey', op: 'startsWith', value: 'fix' }],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chipEl = canvas.getByTestId(QA_QUERY_CHIPS.FILTER_CHIP(0));
    const chip = within(chipEl);
    await expect(
      chip.getByTestId(QA_FILTER_CHIP.FIELD_SEGMENT)
    ).toHaveTextContent('Entry key');
    await expect(
      chip.getByTestId(QA_FILTER_CHIP.OPERATOR_SEGMENT)
    ).toHaveTextContent('starts with');
    await expect(
      chip.getByTestId(QA_FILTER_CHIP.VALUE_SEGMENT)
    ).toHaveTextContent('fix');
    await expect(chipEl).not.toHaveTextContent('$entryKey');
    await userEvent.click(chip.getByTestId(QA_FILTER_CHIP.REMOVE_BUTTON));
    await expect(
      canvas.queryByTestId(QA_QUERY_CHIPS.FILTER_CHIP(0))
    ).toBeNull();
  },
};

// ENTRY_TITLE is filterable (#315): a type's title field is offered at the
// field step like any other field, and an eq commit reads "Title is …" on the
// chip while compiling to the `title` field identifier on the model.
export const EntryTitleFieldFilter: Story = {
  args: { lockedContentType: REPORT_CT },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const titleRow = canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0));
    await expect(titleRow).toHaveTextContent('Title');
    await userEvent.click(titleRow);
    // rich operators off → eq auto-locks → value step
    await userEvent.type(
      canvas.getByTestId(QA_QUERY_BUILDER.VALUE_INPUT),
      'quarterly'
    );
    await userEvent.keyboard('{ArrowRight}');
    const chip = within(canvas.getByTestId(QA_QUERY_CHIPS.FILTER_CHIP(0)));
    await expect(
      chip.getByTestId(QA_FILTER_CHIP.FIELD_SEGMENT)
    ).toHaveTextContent('Title');
    await expect(
      chip.getByTestId(QA_FILTER_CHIP.OPERATOR_SEGMENT)
    ).toHaveTextContent('is');
    await expect(
      chip.getByTestId(QA_FILTER_CHIP.VALUE_SEGMENT)
    ).toHaveTextContent('quarterly');
    expect(args['onUpdate:modelValue']).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: [{ field: 'title', op: 'eq', value: 'quarterly' }],
      })
    );
  },
};

// Narrowing the field step keeps the System rows reachable: typing "key"
// filters Report's fields down to "Key contact" (from 3), so the Entry key row
// continues the option id sequence at the NARROWED offset — OPTION(1), not
// OPTION(3) — and clicking it still commits the system filter. Pins the
// `fields.length + i` DOM id arithmetic under narrowing (#315).
export const NarrowedFieldStepKeepsSystemRow: Story = {
  args: { lockedContentType: REPORT_CT },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId(QA_QUERY_BUILDER.INPUT), 'key');
    await expect(
      canvas.getByTestId(QA_QUERY_BUILDER.DROPDOWN)
    ).toHaveTextContent('System');
    await expect(
      canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(0))
    ).toHaveTextContent('Key contact');
    const entryKeyRow = canvas.getByTestId(QA_QUERY_DROPDOWN.OPTION(1));
    await expect(entryKeyRow).toHaveTextContent('Entry key');
    await expect(canvas.queryByTestId(QA_QUERY_DROPDOWN.OPTION(2))).toBeNull();
    await userEvent.click(entryKeyRow);
    // eq auto-locked (rich off) → value step; commit a value
    await userEvent.type(
      canvas.getByTestId(QA_QUERY_BUILDER.VALUE_INPUT),
      'fix'
    );
    await userEvent.keyboard('{ArrowRight}');
    const chip = within(canvas.getByTestId(QA_QUERY_CHIPS.FILTER_CHIP(0)));
    await expect(
      chip.getByTestId(QA_FILTER_CHIP.FIELD_SEGMENT)
    ).toHaveTextContent('Entry key');
    // the click landed on the system row, not the narrowed ct field
    expect(args['onUpdate:modelValue']).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: [{ field: '$entryKey', op: 'eq', value: 'fix' }],
      })
    );
  },
};
