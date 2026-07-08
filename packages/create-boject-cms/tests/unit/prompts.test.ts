import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { resolveAiAssist, resolveStarter } from '../../src/prompts.js';
import { starterNames } from '../../src/starters.js';

vi.mock('@clack/prompts', () => ({
  select: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
}));

import * as clack from '@clack/prompts';

const REPO_STARTERS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'starters'
);
const STARTERS = starterNames(REPO_STARTERS);

describe('resolveStarter', () => {
  it('returns the flag value without calling the prompt when a valid flag is supplied', async () => {
    const result = await resolveStarter({
      flag: 'sport',
      isTTY: true,
      starters: STARTERS,
    });
    expect(result).toBe('sport');
    expect(clack.select).not.toHaveBeenCalled();
  });

  it('throws on an invalid flag value', async () => {
    await expect(
      resolveStarter({ flag: 'invalid', isTTY: true, starters: STARTERS })
    ).rejects.toThrow(/must be one of/);
  });

  it('throws when non-TTY and no flag is provided', async () => {
    await expect(
      resolveStarter({ flag: undefined, isTTY: false, starters: STARTERS })
    ).rejects.toThrow(/non-interactive/i);
  });

  it('prompts via @clack/prompts when TTY and no flag', async () => {
    vi.mocked(clack.select).mockResolvedValueOnce('web-base');
    const result = await resolveStarter({
      flag: undefined,
      isTTY: true,
      starters: STARTERS,
    });
    expect(result).toBe('web-base');
    expect(clack.select).toHaveBeenCalledOnce();
  });

  it('orders prompt options by dependency chain (not alphabetically) and defaults to web-base', async () => {
    vi.mocked(clack.select).mockResolvedValueOnce('web-base');
    await resolveStarter({
      flag: undefined,
      isTTY: true,
      starters: STARTERS,
    });

    const call = vi.mocked(clack.select).mock.calls[0][0] as {
      options: Array<{ value: string }>;
      initialValue: string;
    };

    expect(call.options.map((o) => o.value)).toEqual([
      'web-base',
      'articles',
      'sport',
      'rugby',
      'none',
    ]);
    expect(call.initialValue).toBe('web-base');
  });

  it('throws if the user cancels the prompt', async () => {
    const cancelSymbol = Symbol('cancel');
    vi.mocked(clack.select).mockResolvedValueOnce(
      // eslint-disable-next-line no-restricted-syntax -- Symbol has no overlap with string; mocking clack's cancel sentinel
      cancelSymbol as unknown as string
    );
    vi.mocked(clack.isCancel).mockReturnValueOnce(true);
    await expect(
      resolveStarter({ flag: undefined, isTTY: true, starters: STARTERS })
    ).rejects.toThrow(/cancelled/i);
  });
});

describe('resolveAiAssist', () => {
  it('returns the flag without prompting when --ai is passed', async () => {
    expect(await resolveAiAssist({ flag: true, isTTY: true })).toBe(true);
    expect(clack.confirm).not.toHaveBeenCalled();
  });

  it('returns false when non-TTY and no flag (opt-in default off)', async () => {
    expect(await resolveAiAssist({ flag: undefined, isTTY: false })).toBe(
      false
    );
    expect(clack.confirm).not.toHaveBeenCalled();
  });

  it('prompts (default no) when TTY and no flag', async () => {
    vi.mocked(clack.confirm).mockResolvedValueOnce(true);
    expect(await resolveAiAssist({ flag: undefined, isTTY: true })).toBe(true);
    expect(clack.confirm).toHaveBeenCalledOnce();
  });

  it('throws if the user cancels the prompt', async () => {
    const cancelSymbol = Symbol('cancel');
    vi.mocked(clack.confirm).mockResolvedValueOnce(
      // eslint-disable-next-line no-restricted-syntax -- Symbol has no overlap with boolean; mocking clack's cancel sentinel
      cancelSymbol as unknown as boolean
    );
    vi.mocked(clack.isCancel).mockReturnValueOnce(true);
    await expect(
      resolveAiAssist({ flag: undefined, isTTY: true })
    ).rejects.toThrow(/cancelled/i);
  });
});
