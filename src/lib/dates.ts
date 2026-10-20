/** Calendar dates (YYYY-MM-DD, no time zone; the user's IST calendar day). */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Day number of a YYYY-MM-DD date, or null if it is not a real date. */
export function dayNumber(date: string): number | null {
  const m = DATE_RE.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return Math.round(t / 86_400_000);
}

export function dateFromDayNumber(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

/** Calendar days from a to b (b − a). Null if either date is invalid. */
export function daysBetween(a: string, b: string): number | null {
  const x = dayNumber(a);
  const y = dayNumber(b);
  return x === null || y === null ? null : y - x;
}

export function addDays(date: string, n: number): string | null {
  const x = dayNumber(date);
  return x === null ? null : dateFromDayNumber(x + n);
}

const dayFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
export function formatDay(date: string | null | undefined): string {
  const n = date ? dayNumber(date) : null;
  return n === null ? '—' : dayFmt.format(new Date(n * 86_400_000));
}
