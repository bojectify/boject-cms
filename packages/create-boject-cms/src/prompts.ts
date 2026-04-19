import { isCancel, select } from '@clack/prompts';
import type { StarterChoice } from './render.js';

const CHOICES: StarterChoice[] = ['base', 'sport', 'rugby', 'none'];

function isValidChoice(value: string): value is StarterChoice {
  return (CHOICES as string[]).includes(value);
}

export interface ResolveStarterParams {
  flag: string | undefined;
  isTTY: boolean;
}

export async function resolveStarter({
  flag,
  isTTY,
}: ResolveStarterParams): Promise<StarterChoice> {
  if (flag !== undefined) {
    if (!isValidChoice(flag)) {
      throw new Error(`--starter must be one of: ${CHOICES.join(', ')}`);
    }
    return flag;
  }

  if (!isTTY) {
    throw new Error(
      'Non-interactive shell detected. Pass --starter <base|sport|rugby|none>.'
    );
  }

  const response = await select({
    message: 'Which starter?',
    options: [
      { value: 'base', label: 'Base (8 universal content types)' },
      {
        value: 'sport',
        label: 'Sport (base + team/club/competition/fixture/player)',
      },
      { value: 'rugby', label: 'Rugby (sport + Position + patched Player)' },
      { value: 'none', label: 'None (empty database)' },
    ],
    initialValue: 'base',
  });

  if (isCancel(response)) {
    throw new Error('Scaffold cancelled by user.');
  }

  return response as StarterChoice;
}
