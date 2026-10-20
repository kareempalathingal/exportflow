/**
 * Working-day calendar (confirmed 20 Oct 2026): Sunday is the weekly off;
 * company holidays are added by the user on the dashboard calendar. Plans,
 * step times and the internal deadline (rule v2) count working days only.
 * Pure and deterministic; dates are YYYY-MM-DD strings.
 */
import { dateFromDayNumber, dayNumber } from './dates';

export interface WorkCalendar {
  /** Weekdays that are always off (0 = Sunday … 6 = Saturday). */
  weeklyOff: number[];
  /** Company holidays: date → name (may be empty). */
  holidays: Record<string, string>;
}

/** Firestore doc `settings/calendar`, always in the ACTUAL workspace (holidays are real company facts). */
export const CALENDAR_DOC = 'calendar';

export const DEFAULT_CALENDAR: WorkCalendar = { weeklyOff: [0], holidays: {} };

/** Calendar with no days off (used where plain calendar days are meant, e.g. old tests). */
export const NO_DAYS_OFF: WorkCalendar = { weeklyOff: [], holidays: {} };

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

const MAX_SCAN = 3660; // ten years; stops runaway loops if every day were off

/** Reads a stored calendar safely (missing or broken fields fall back to the default). */
export function calendarFrom(doc: Partial<WorkCalendar> | null | undefined): WorkCalendar {
  const weeklyOff = Array.isArray(doc?.weeklyOff) ? doc.weeklyOff.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : DEFAULT_CALENDAR.weeklyOff;
  const holidays: Record<string, string> = {};
  if (doc?.holidays && typeof doc.holidays === 'object') {
    for (const [k, v] of Object.entries(doc.holidays)) if (dayNumber(k) !== null) holidays[k] = typeof v === 'string' ? v : '';
  }
  // A calendar where every weekday is off would make planning impossible.
  return { weeklyOff: weeklyOff.length >= 7 ? DEFAULT_CALENDAR.weeklyOff : weeklyOff, holidays };
}

/** 0 = Sunday … 6 = Saturday. 1970-01-01 was a Thursday. */
export function weekday(date: string): number | null {
  const n = dayNumber(date);
  return n === null ? null : (((n + 4) % 7) + 7) % 7;
}

export type DayOff = { off: false } | { off: true; reason: string };

export function dayOff(date: string, cal: WorkCalendar): DayOff {
  const wd = weekday(date);
  if (wd === null) return { off: false };
  if (date in cal.holidays) return { off: true, reason: cal.holidays[date] || 'Company holiday' };
  if (cal.weeklyOff.includes(wd)) return { off: true, reason: WEEKDAY_NAMES[wd]! };
  return { off: false };
}

export function isWorkingDay(date: string, cal: WorkCalendar): boolean {
  return !dayOff(date, cal).off;
}

/**
 * Working days after `a` up to and including `b`. Negative when `b` is before
 * `a` (−(working days after `b` up to and including `a`)). Null for bad dates.
 */
export function workingDaysBetween(a: string, b: string, cal: WorkCalendar): number | null {
  const na = dayNumber(a);
  const nb = dayNumber(b);
  if (na === null || nb === null) return null;
  if (na === nb) return 0;
  const [lo, hi, sign] = na < nb ? [na, nb, 1] : [nb, na, -1];
  if (hi - lo > MAX_SCAN * 3) return sign * (hi - lo); // absurd range: do not loop for ever
  let count = 0;
  for (let n = lo + 1; n <= hi; n++) if (isWorkingDay(dateFromDayNumber(n), cal)) count++;
  return sign * count;
}

/** Working days in [a, b], counting both ends (e.g. "day 3 of this step"). */
export function workingDaysInclusive(a: string, b: string, cal: WorkCalendar): number | null {
  const between = workingDaysBetween(a, b, cal);
  if (between === null) return null;
  if (between < 0) return 0;
  return between + (isWorkingDay(a, cal) ? 1 : 0);
}

/**
 * The n-th working day after `date` (n > 0) or before it (n < 0). n = 0 gives
 * `date` itself. Fractions are rounded up (half a day still uses that day).
 */
export function addWorkingDays(date: string, n: number, cal: WorkCalendar): string | null {
  let d = dayNumber(date);
  if (d === null || !Number.isFinite(n)) return null;
  let left = Math.ceil(Math.abs(n));
  const step = n < 0 ? -1 : 1;
  let guard = 0;
  while (left > 0 && guard++ < MAX_SCAN) {
    d += step;
    if (isWorkingDay(dateFromDayNumber(d), cal)) left--;
  }
  return dateFromDayNumber(d);
}

/** Holidays inside a month (YYYY-MM), sorted. */
export function holidaysIn(month: string, cal: WorkCalendar): { date: string; name: string }[] {
  return Object.entries(cal.holidays)
    .filter(([d]) => d.startsWith(`${month}-`))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, name]) => ({ date, name }));
}

/** Weeks of a month for a Sunday-first grid; null = blank cell. */
export function monthGrid(month: string): (string | null)[][] {
  const first = `${month}-01`;
  const wd = weekday(first);
  const start = dayNumber(first);
  if (wd === null || start === null) return [];
  const cells: (string | null)[] = Array.from({ length: wd }, () => null);
  for (let n = start; ; n++) {
    const d = dateFromDayNumber(n);
    if (!d.startsWith(month)) break;
    cells.push(d);
  }
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const t = y * 12 + (m - 1) + by;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
