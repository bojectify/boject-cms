import { describe, it, expect } from 'vitest';
import { CalendarDate } from '@internationalized/date';
import {
  dayToBoundaryIso,
  isoToCalendarDate,
  formatDateChip,
  formatDateRangeChip,
  presetRange,
} from './dateFilter';

describe('dateFilter', () => {
  it('dayToBoundaryIso builds UTC start/end of a day', () => {
    const d = new CalendarDate(2026, 6, 8);
    expect(dayToBoundaryIso(d, 'start')).toBe('2026-06-08T00:00:00.000Z');
    expect(dayToBoundaryIso(d, 'end')).toBe('2026-06-08T23:59:59.999Z');
  });

  it('isoToCalendarDate maps an ISO to its UTC calendar day (null if unparseable)', () => {
    const cd = isoToCalendarDate('2026-06-08T23:59:59.999Z')!;
    expect([cd.year, cd.month, cd.day]).toEqual([2026, 6, 8]);
    expect(isoToCalendarDate('nope')).toBeNull();
  });

  it('formats single + range chips in UTC, collapsing a shared year', () => {
    expect(formatDateChip('2026-06-08T00:00:00.000Z')).toBe('Jun 8, 2026');
    expect(
      formatDateRangeChip([
        '2026-06-08T00:00:00.000Z',
        '2026-06-21T23:59:59.999Z',
      ])
    ).toBe('Jun 8 – Jun 21, 2026');
    expect(
      formatDateRangeChip([
        '2025-12-30T00:00:00.000Z',
        '2026-01-02T23:59:59.999Z',
      ])
    ).toBe('Dec 30, 2025 – Jan 2, 2026');
  });

  it('degrades to the raw input when a chip date is unparseable', () => {
    expect(formatDateChip('nope')).toBe('nope');
    expect(formatDateRangeChip(['x', 'y'])).toBe('x – y');
  });

  it('computes presets relative to a fixed now (UTC days)', () => {
    const now = new Date('2026-06-10T12:00:00.000Z');
    expect(presetRange('today', now)).toEqual([
      '2026-06-10T00:00:00.000Z',
      '2026-06-10T23:59:59.999Z',
    ]);
    expect(presetRange('yesterday', now)).toEqual([
      '2026-06-09T00:00:00.000Z',
      '2026-06-09T23:59:59.999Z',
    ]);
    expect(presetRange('last7', now)).toEqual([
      '2026-06-04T00:00:00.000Z',
      '2026-06-10T23:59:59.999Z',
    ]);
    expect(presetRange('last30', now)).toEqual([
      '2026-05-12T00:00:00.000Z',
      '2026-06-10T23:59:59.999Z',
    ]);
    expect(presetRange('thisMonth', now)).toEqual([
      '2026-06-01T00:00:00.000Z',
      '2026-06-30T23:59:59.999Z',
    ]);
    // December exercises the `Date.UTC(y, m+1, 0)` last-day roll-over across the year edge.
    expect(
      presetRange('thisMonth', new Date('2026-12-15T12:00:00.000Z'))
    ).toEqual(['2026-12-01T00:00:00.000Z', '2026-12-31T23:59:59.999Z']);
  });
});
