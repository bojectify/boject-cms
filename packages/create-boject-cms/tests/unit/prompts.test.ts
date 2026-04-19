import { describe, expect, it, vi } from 'vitest';
import { resolveStarter } from '../../src/prompts.js';

vi.mock('@clack/prompts', () => ({
  select: vi.fn(),
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
    vi.mocked(clack.select).mockResolvedValueOnce('base');
    const result = await resolveStarter({ flag: undefined, isTTY: true });
    expect(result).toBe('base');
    expect(clack.select).toHaveBeenCalledOnce();
  });

  it('throws if the user cancels the prompt', async () => {
    const cancelSymbol = Symbol('cancel');
    vi.mocked(clack.select).mockResolvedValueOnce(
      cancelSymbol as unknown as string
    );
    vi.mocked(clack.isCancel).mockReturnValueOnce(true);
    await expect(
      resolveStarter({ flag: undefined, isTTY: true })
    ).rejects.toThrow(/cancelled/i);
  });
});
