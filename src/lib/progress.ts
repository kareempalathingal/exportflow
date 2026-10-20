/**
 * Planned vs actual progress of a Job Order (dashboard, CLAUDE.md "Option B · Track").
 * Until stage tracking exists, actual % is entered by the user (dated);
 * planned % rises linearly from confirmation to the internal deadline.
 */
import { daysBetween, type JobOrder } from './jobOrders';

export interface ProgressEntry {
  pct: number; // 0–100, entered by the user
  on: string; // YYYY-MM-DD (IST) of the update
  at?: string; // exact time of the update (ISO); absent on early entries
}

export type TrackKind = 'DRAFT' | 'NOT_TRACKED' | 'TRACKED' | 'LATE' | 'DONE';

export interface Track {
  kind: TrackKind;
  planned: number; // where it should be today, 0–100
  actual: number | null;
  gap: number | null; // actual − planned (negative = behind)
  daysLeft: number; // to the internal deadline (negative = days late)
  updatedDaysAgo: number | null;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function plannedPct(jo: Pick<JobOrder, 'confirmedOn' | 'receivedDate' | 'deadline'>, today: string): number {
  const start = jo.confirmedOn ?? jo.receivedDate;
  const span = daysBetween(start, jo.deadline.internalDeadline);
  const done = daysBetween(start, today);
  if (span === null || done === null) return 0;
  if (span <= 0) return 100;
  return clamp(Math.round((done / span) * 100), 0, 100);
}

export function trackOf(
  jo: Pick<JobOrder, 'status' | 'confirmedOn' | 'receivedDate' | 'deadline'> & { progress?: ProgressEntry | null },
  today: string,
  fromSteps?: { actual: number; planned: number | null } | null,
): Track {
  const planned = fromSteps?.planned ?? plannedPct(jo, today);
  const daysLeft = daysBetween(today, jo.deadline.internalDeadline) ?? 0;
  const p = fromSteps ? { pct: fromSteps.actual, on: today } : (jo.progress ?? null);
  const actual = p && Number.isFinite(p.pct) ? clamp(p.pct, 0, 100) : null;
  const updatedDaysAgo = fromSteps ? null : p ? daysBetween(p.on, today) : null;
  const base = { planned, actual, daysLeft, updatedDaysAgo };
  if (jo.status === 'DRAFT') return { ...base, kind: 'DRAFT', gap: null };
  if (actual === 100 || jo.status === 'COMPLETED') return { ...base, kind: 'DONE', gap: actual === null ? null : actual - planned };
  if (daysLeft < 0) return { ...base, kind: 'LATE', gap: actual === null ? null : actual - planned };
  if (actual === null) return { ...base, kind: 'NOT_TRACKED', gap: null };
  return { ...base, kind: 'TRACKED', gap: actual - planned };
}

/**
 * Smooth colour for a schedule gap: on plan or ahead = green, then through
 * amber to full red at `redAt` points behind. Late orders are always full red.
 * Returned as OKLCH so the steps look even.
 */
export function gapColor(track: Pick<Track, 'kind' | 'gap'>, redAt: number): string {
  if (track.kind === 'DRAFT' || track.kind === 'NOT_TRACKED') return 'var(--muted)';
  if (track.kind === 'DONE') return 'oklch(0.58 0.13 150)';
  const t = track.kind === 'LATE' ? 1 : clamp(-(track.gap ?? 0) / redAt, 0, 1);
  return colorAt(t);
}

/** 0 = green, 0.5 = amber, 1 = red. */
export function colorAt(t: number): string {
  const stops = [
    [0.58, 0.13, 150],
    [0.72, 0.15, 75],
    [0.56, 0.19, 28],
  ] as const;
  const [a, b, f] = t <= 0.5 ? [stops[0], stops[1], t / 0.5] : [stops[1], stops[2], (t - 0.5) / 0.5];
  const mix = (i: 0 | 1 | 2) => a[i] + (b[i] - a[i]) * f;
  return `oklch(${mix(0).toFixed(3)} ${mix(1).toFixed(3)} ${mix(2).toFixed(1)})`;
}

export function trackLabel(t: Track): string {
  switch (t.kind) {
    case 'DRAFT':
      return 'Draft — tracking starts when confirmed';
    case 'NOT_TRACKED':
      return 'Not tracked';
    case 'DONE':
      return 'Done';
    case 'LATE':
      return `${-t.daysLeft} day${t.daysLeft === -1 ? '' : 's'} late`;
    default: {
      const g = t.gap ?? 0;
      return g >= 0 ? (g === 0 ? 'On plan' : `+${g}% ahead`) : `${-g}% behind`;
    }
  }
}

/** Summary groups for the counts row. */
export function trackGroup(t: Track): 'ON_TRACK' | 'BEHIND' | 'LATE' | 'NOT_TRACKED' {
  if (t.kind === 'LATE') return 'LATE';
  if (t.kind === 'DONE') return 'ON_TRACK';
  if (t.kind === 'TRACKED') return (t.gap ?? 0) >= 0 ? 'ON_TRACK' : 'BEHIND';
  return 'NOT_TRACKED';
}

/** Adds a progress update to the history. Every update is kept (with its time), oldest first. */
export function appendProgress(log: ProgressEntry[] | undefined, entry: ProgressEntry, max = 1000): ProgressEntry[] {
  const key = (e: ProgressEntry) => e.at ?? `${e.on}T00:00:00.000Z`;
  return [...(log ?? []), entry].sort((a, b) => key(a).localeCompare(key(b))).slice(-max);
}

/** The last update of each day (for day-by-day reports). */
export function lastPerDay(log: ProgressEntry[] | undefined): ProgressEntry[] {
  const byDay = new Map<string, ProgressEntry>();
  for (const e of log ?? []) byDay.set(e.on, e); // log is oldest first, so the last one wins
  return [...byDay.values()];
}
