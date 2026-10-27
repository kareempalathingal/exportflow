/** All user-facing dates and times are shown in India Standard Time. */
export const APP_TIME_ZONE = 'Asia/Kolkata';

const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: APP_TIME_ZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

export function formatDateTime(d: Date | null | undefined): string {
  return d ? dateTimeFmt.format(d) : '—';
}

/** Calendar date (YYYY-MM-DD) of an instant, as seen in IST. */
export function istDateKey(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Clock time (HH:MM, 24-hour) of an instant, as seen in IST. */
export function istTimeKey(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('hour')}:${get('minute')}`;
}

/** "3:30 PM" from "15:30". */
export function formatClock(hhmm: string | null | undefined): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm ?? '');
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}
