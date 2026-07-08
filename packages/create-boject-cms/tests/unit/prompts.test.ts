import { describe, expect, it, vi } from 'vitest';
import { resolveAiAssist, resolveStarter } from '../../src/prompts.js';

vi.mock('@clack/prompts', () => ({
  select: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
}));

import * as clack from '@clack/prompts';

describe('resolveStarter', () => {
  it('returns the flag value without calling the prompt when a valid flag is supplied', async () => {
    const result = await resolveStarter({ flag: 'sport', isTTY: true });
    expect(result).toBe('sport');
    expect(clack.select).not.toHaveBeenCalled();
  });

  it('throws on an invalid flag value', async () => {
    await expect(
      resolveStarter({ flag: 'invalid', isTTY: true })
    ).rejects.toThrow(/must be one of/);
  });

  it('throws when non-TTY and no flag is provided', async () => {
    await expect(
      resolveStarter({ flag: undefined, isTTY: false })
    ).rejects.toThrow(/non-interactive/i);
  });

  it('prompts via @clack/prompts when TTY and no flag', async () => {
    vi.mocked(clack.select).mockResolvedValueOnce('web-base');
    const result = await resolveStarter({ flag: undefined, isTTY: true });
    expect(result).toBe('web-base');
    expect(clack.select).toHaveBeenCalledOnce();
  });

  it('throws if the user cancels the prompt', async () => {
    const cancelSymbol = Symbol('cancel');
    vi.mocked(clack.select).mockResolvedValueOnce(
      // eslint-disable-next-line no-restricted-syntax -- Symbol has no overlap with string; mocking clack's cancel sentinel
      cancelSymbol as unknown as string
    );
    vi.mocked(clack.isCancel).mockReturnValueOnce(true);
    await expect(
      resolveStarter({ flag: undefined, isTTY: true })
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
