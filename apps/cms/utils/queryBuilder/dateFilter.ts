import { CalendarDate } from '@internationalized/date';

export type PresetId = 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth';

export interface DatePreset {
  id: PresetId;
  label: string;
}

/** The quick-range presets offered by the range editor, in display order. */
export const DATE_PRESETS: DatePreset[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last7', label: 'Last 7 days' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'thisMonth', label: 'This month' },
];

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const p2 = (n: number): string => String(n).padStart(2, '0');

/** `y-m1-d` (m1 is 1-based) → a UTC ISO at the start (00:00:00.000Z) or end (23:59:59.999Z) of the day. */
function boundaryIso(
  y: number,
  m1: number,
  d: number,
  edge: 'start' | 'end'
): string {
  const ymd = `${y}-${p2(m1)}-${p2(d)}`;
  return edge === 'start' ? `${ymd}T00:00:00.000Z` : `${ymd}T23:59:59.999Z`;
}

/** A CalendarDate (its `month` is 1-based) → the UTC start/end ISO of that calendar day. */
export function dayToBoundaryIso(
  date: CalendarDate,
  edge: 'start' | 'end'
): string {
  return boundaryIso(date.year, date.month, date.day, edge);
}

/** An ISO string → the CalendarDate of its UTC calendar day; null if unparseable. */
export function isoToCalendarDate(iso: string): CalendarDate | null {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return new CalendarDate(
    t.getUTCFullYear(),
    t.getUTCMonth() + 1,
    t.getUTCDate()
  );
}

/** A single ISO date → a chip label in UTC, e.g. "Jun 8, 2026". */
export function formatDateChip(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** An [startIso, endIso] range → a chip label, collapsing the year when both share it. */
export function formatDateRangeChip(range: [string, string]): string {
  const [s, e] = range;
  const sd = new Date(s);
  const ed = new Date(e);
  if (Number.isNaN(sd.getTime()) || Number.isNaN(ed.getTime())) {
    return `${s} – ${e}`;
  }
  const endStr = `${MONTHS[ed.getUTCMonth()]} ${ed.getUTCDate()}, ${ed.getUTCFullYear()}`;
  const startStr =
    sd.getUTCFullYear() === ed.getUTCFullYear()
      ? `${MONTHS[sd.getUTCMonth()]} ${sd.getUTCDate()}`
      : `${MONTHS[sd.getUTCMonth()]} ${sd.getUTCDate()}, ${sd.getUTCFullYear()}`;
  return `${startStr} – ${endStr}`;
}

const DAY_MS = 86_400_000;

function utcDayBoundary(ms: number, edge: 'start' | 'end'): string {
  const dt = new Date(ms);
  return boundaryIso(
    dt.getUTCFullYear(),
    dt.getUTCMonth() + 1,
    dt.getUTCDate(),
    edge
  );
}

/** A preset id + a reference `now` → its inclusive [startIso, endIso] UTC-day range. */
export function presetRange(id: PresetId, now: Date): [string, string] {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const todayStart = Date.UTC(y, m, d);
  switch (id) {
    case 'today':
      return [
        utcDayBoundary(todayStart, 'start'),
        utcDayBoundary(todayStart, 'end'),
      ];
    case 'yesterday':
      return [
        utcDayBoundary(todayStart - DAY_MS, 'start'),
        utcDayBoundary(todayStart - DAY_MS, 'end'),
      ];
    case 'last7':
      return [
        utcDayBoundary(todayStart - 6 * DAY_MS, 'start'),
        utcDayBoundary(todayStart, 'end'),
      ];
    case 'last30':
      return [
        utcDayBoundary(todayStart - 29 * DAY_MS, 'start'),
        utcDayBoundary(todayStart, 'end'),
      ];
    case 'thisMonth':
      return [
        utcDayBoundary(Date.UTC(y, m, 1), 'start'),
        utcDayBoundary(Date.UTC(y, m + 1, 0), 'end'), // day 0 of next month = last day of this month
      ];
  }
}
