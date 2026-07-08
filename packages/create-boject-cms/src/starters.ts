import { readdirSync } from 'node:fs';

/** Starter bundle basenames in `startersDir` (the selectable set; `none` is a runtime sentinel, not a file). */
export function starterNames(startersDir: string): string[] {
  return readdirSync(startersDir)
    .filter((f) => f.endsWith('.boject.json'))
    .map((f) => f.replace(/\.boject\.json$/, ''))
    .sort();
}

const STARTER_LABELS: Record<string, string> = {
  'web-base':
    'Web Base (Image, SiteSettings, Navigation, NavigationItem, Link)',
  articles: 'Articles (Web Base + Author, Page, Article, Tag, Category)',
  sport: 'Sport (Articles + Team, Club, Season, Competition, Fixture, Player)',
  rugby: 'Rugby (Sport + Position, patched Player)',
};

/** Wizard label for a starter — curated where known, title-cased fallback otherwise. */
export function starterLabel(name: string): string {
  return (
    STARTER_LABELS[name] ??
    name
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  );
}

/**
 * Order starter names for wizard display: curated dependency-chain order
 * (STARTER_LABELS key order) first, then any unknown/future names appended
 * alphabetically.
 */
export function orderedStarterNames(names: string[]): string[] {
  const known = Object.keys(STARTER_LABELS);
  const inMap = known.filter((n) => names.includes(n));
  const rest = names.filter((n) => !known.includes(n)).sort();
  return [...inMap, ...rest];
}
