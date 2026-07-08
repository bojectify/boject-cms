import { confirm, isCancel, select } from '@clack/prompts';
import type { StarterChoice } from './render.js';

const CHOICES: StarterChoice[] = [
  'web-base',
  'articles',
  'sport',
  'rugby',
  'none',
];

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
      'Non-interactive shell detected. Pass --starter <web-base|articles|sport|rugby|none>.'
    );
  }

  const response = await select({
    message: 'Which starter?',
    options: [
      {
        value: 'web-base',
        label:
          'Web Base (Image, SiteSettings, Navigation, NavigationItem, Link)',
      },
      {
        value: 'articles',
        label: 'Articles (Web Base + Author, Page, Article, Tag, Category)',
      },
      {
        value: 'sport',
        label:
          'Sport (Articles + Team, Club, Season, Competition, Fixture, Player)',
      },
      { value: 'rugby', label: 'Rugby (Sport + Position, patched Player)' },
      { value: 'none', label: 'None (empty database)' },
    ],
    initialValue: 'web-base',
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
