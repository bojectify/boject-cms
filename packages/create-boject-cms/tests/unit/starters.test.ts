import { describe, it, expect } from 'vitest';
import { orderedStarterNames, starterLabel } from '../../src/starters.js';

describe('orderedStarterNames', () => {
  it('curated starters first (dependency-chain order), then unknowns alphabetically', () => {
    expect(
      orderedStarterNames(['rugby', 'zebra', 'web-base', 'articles', 'alpha'])
    ).toEqual(['web-base', 'articles', 'rugby', 'alpha', 'zebra']);
  });
});

describe('starterLabel', () => {
  it('returns the curated label for a known starter', () => {
    expect(starterLabel('web-base')).toContain('Web Base');
  });
  it('title-cases a hyphenated name as fallback for an unknown starter', () => {
    expect(starterLabel('my-cool-starter')).toBe('My Cool Starter');
  });
});
