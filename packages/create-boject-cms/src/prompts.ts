import { confirm, isCancel, select } from '@clack/prompts';
import { orderedStarterNames, starterLabel } from './starters.js';
import type { StarterChoice } from './render.js';

export interface ResolveStarterParams {
  flag: string | undefined;
  isTTY: boolean;
  starters: string[]; // derived starter names (no 'none')
}

export async function resolveStarter({
  flag,
  isTTY,
  starters,
}: ResolveStarterParams): Promise<StarterChoice> {
  const choices = [...starters, 'none'];

  if (flag !== undefined) {
    if (!choices.includes(flag)) {
      throw new Error(`--starter must be one of: ${choices.join(', ')}`);
    }
    return flag;
  }

  if (!isTTY) {
    throw new Error(
      `Non-interactive shell detected. Pass --starter <${choices.join('|')}>.`
    );
  }

  const ordered = orderedStarterNames(starters);

  const response = await select({
    message:
      'Pick the starter model that best suits your needs — a starting point you\n' +
      'can extend or edit later, including with the model_content MCP tool if you\n' +
      'enable AI-assisted modelling.',
    options: [
      ...ordered.map((name) => ({ value: name, label: starterLabel(name) })),
      { value: 'none', label: 'None (empty database)' },
    ],
    initialValue: ordered[0] ?? 'none',
  });

  if (isCancel(response)) {
    throw new Error('Scaffold cancelled by user.');
  }

  return response as StarterChoice;
}

export interface ResolveAiAssistParams {
  flag: boolean | undefined;
  isTTY: boolean;
}

export async function resolveAiAssist({
  flag,
  isTTY,
}: ResolveAiAssistParams): Promise<boolean> {
  if (flag !== undefined) return flag;
  if (!isTTY) return false;

  const response = await confirm({
    message:
      'Set up AI-assisted content modelling? (adds a Claude Code MCP config)',
    initialValue: false,
  });

  if (isCancel(response)) {
    throw new Error('Scaffold cancelled by user.');
  }

  return response === true;
}
