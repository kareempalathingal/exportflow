/**
 * Work: tasks and follow-ups for any department (design, finance, HR…),
 * for the user only (confirmed 26 Oct 2026). Not tied to Job Orders, but a
 * task may point to one. Recurring tasks create their next occurrence when
 * one is done. Pure and deterministic; dates are YYYY-MM-DD (IST).
 */
import { addDays, dateFromDayNumber, dayNumber, formatDay } from './dates';
import { weekday, WEEKDAY_NAMES } from './calendar';

export const COLLECTION_TASKS = 'tasks';

export type TaskStatus = 'OPEN' | 'WAITING' | 'DONE' | 'DROPPED';
export type TaskPriority = 'NORMAL' | 'HIGH';

export type Repeat = { kind: 'WEEKLY'; weekday: number } | { kind: 'MONTHLY'; day: number } | { kind: 'EVERY_N_DAYS'; days: number };

export interface Task {
  title: string;
  /** Department id, or '' for General. */
  departmentId: string;
  /** Whom to ask (a person in the department, or any name). */
  person: string;
  dueDate: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  /** For WAITING: who or what it waits on. */
  waitingOn: string;
  joId: string | null;
  joNumber: string;
  notes: string;
  repeat: Repeat | null;
  doneOn: string | null;
}

export const STATUS_LABEL: Record<TaskStatus, string> = { OPEN: 'Open', WAITING: 'Waiting', DONE: 'Done', DROPPED: 'Dropped' };
export const DONE_VISIBLE_DAYS = 7;

export function emptyTask(): Task {
  return { title: '', departmentId: '', person: '', dueDate: null, priority: 'NORMAL', status: 'OPEN', waitingOn: '', joId: null, joNumber: '', notes: '', repeat: null, doneOn: null };
}

/** 0 = Sunday … 6 = Saturday. */
export const weekdayOf = (date: string): number => weekday(date) ?? 0;

export const isActive = (t: Pick<Task, 'status'>) => t.status === 'OPEN' || t.status === 'WAITING';

/** Problems that stop a task from being saved. */
export function validateTask(t: Task): string | null {
  const title = t.title.trim();
  if (!title) return 'Enter what needs to be done';
  if (title.length > 200) return 'Keep the task under 200 characters';
  if (t.dueDate !== null && dayNumber(t.dueDate) === null) return 'The due date is not a valid date';
  if (t.repeat) {
    if (!t.dueDate) return 'A repeating task needs a due date (the first one)';
    if (t.repeat.kind === 'WEEKLY' && !(Number.isInteger(t.repeat.weekday) && t.repeat.weekday >= 0 && t.repeat.weekday <= 6)) return 'Choose the weekday';
    if (t.repeat.kind === 'MONTHLY' && !(Number.isInteger(t.repeat.day) && t.repeat.day >= 1 && t.repeat.day <= 31)) return 'Day of the month must be 1 to 31';
    if (t.repeat.kind === 'EVERY_N_DAYS' && !(Number.isInteger(t.repeat.days) && t.repeat.days >= 1 && t.repeat.days <= 366)) return 'Repeat every 1 to 366 days';
  }
  return null;
}

/** The last day of a YYYY-MM month. */
function lastDayOf(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The day of a month, moved to its last day when the month is shorter (31 → 30 Nov, 28 Feb). */
export function monthDay(month: string, day: number): string {
  const d = Math.min(day, lastDayOf(month));
  return `${month}-${String(d).padStart(2, '0')}`;
}

/** The next due date after `after` for a repeat rule. */
export function nextDue(repeat: Repeat, after: string): string {
  if (repeat.kind === 'EVERY_N_DAYS') return addDays(after, repeat.days)!;
  if (repeat.kind === 'WEEKLY') {
    const wd = weekday(after) ?? 0;
    const diff = (repeat.weekday - wd + 7) % 7 || 7;
    return addDays(after, diff)!;
  }
  // Monthly: this month's day if still ahead, else next month's.
  const month = after.slice(0, 7);
  const here = monthDay(month, repeat.day);
  if (here > after) return here;
  const n = dayNumber(`${month}-01`)!;
  const next = dateFromDayNumber(n + 32).slice(0, 7);
  return monthDay(next, repeat.day);
}

/**
 * Marks a task done. A repeating task also returns its next occurrence: the
 * next date after this one's due date, and never a date already past (a late
 * completion moves on to the coming occurrence instead of piling up overdue ones).
 */
export function completeTask(t: Task, today: string): { done: Task; next: Task | null } {
  const done: Task = { ...t, status: 'DONE', doneOn: today };
  if (!t.repeat) return { done, next: null };
  let due = nextDue(t.repeat, t.dueDate ?? today);
  for (let guard = 0; due < today && guard < 1000; guard++) due = nextDue(t.repeat, due);
  return { done, next: { ...t, status: 'OPEN', waitingOn: '', doneOn: null, dueDate: due } };
}

export function repeatLabel(r: Repeat | null): string {
  if (!r) return '';
  if (r.kind === 'WEEKLY') return `every ${WEEKDAY_NAMES[r.weekday]}`;
  if (r.kind === 'MONTHLY') return `every month on day ${r.day}`;
  return r.days === 1 ? 'every day' : `every ${r.days} days`;
}

// ---------------------------------------------------------------------------
// Grouping for the Work screen
// ---------------------------------------------------------------------------

export type TaskGroup = 'OVERDUE' | 'TODAY' | 'WEEK' | 'LATER' | 'NO_DATE' | 'WAITING' | 'DONE';
export const GROUP_LABEL: Record<TaskGroup, string> = {
  OVERDUE: 'Overdue',
  TODAY: 'Today',
  WEEK: 'This week',
  LATER: 'Later',
  NO_DATE: 'No date',
  WAITING: 'Waiting',
  DONE: 'Done (last 7 days)',
};
export const GROUP_ORDER: TaskGroup[] = ['OVERDUE', 'TODAY', 'WEEK', 'WAITING', 'LATER', 'NO_DATE', 'DONE'];

export function groupOf(t: Task, today: string): TaskGroup | null {
  if (t.status === 'DROPPED') return null;
  if (t.status === 'DONE') return t.doneOn && t.doneOn >= addDays(today, -DONE_VISIBLE_DAYS)! ? 'DONE' : null;
  if (t.dueDate && t.dueDate < today) return 'OVERDUE'; // late, even when waiting
  if (t.status === 'WAITING') return 'WAITING';
  if (!t.dueDate) return 'NO_DATE';
  if (t.dueDate === today) return 'TODAY';
  if (t.dueDate <= addDays(today, 6)!) return 'WEEK';
  return 'LATER';
}

const byUrgency = <T extends Task>(a: T, b: T) =>
  (a.priority === 'HIGH' ? 0 : 1) - (b.priority === 'HIGH' ? 0 : 1) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.title.localeCompare(b.title);

export function groupTasks<T extends Task>(tasks: T[], today: string): { group: TaskGroup; tasks: T[] }[] {
  const map = new Map<TaskGroup, T[]>();
  for (const t of tasks) {
    const g = groupOf(t, today);
    if (g) map.set(g, [...(map.get(g) ?? []), t]);
  }
  return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({ group: g, tasks: map.get(g)!.sort(g === 'DONE' ? (a, b) => (b.doneOn ?? '').localeCompare(a.doneOn ?? '') : byUrgency) }));
}

export function dueText(t: Pick<Task, 'dueDate' | 'status'>, today: string): string {
  if (!t.dueDate) return 'no date';
  if (t.dueDate === today) return 'today';
  if (t.dueDate < today) {
    const n = (dayNumber(today) ?? 0) - (dayNumber(t.dueDate) ?? 0);
    return `${n} day${n === 1 ? '' : 's'} overdue (${formatDay(t.dueDate)})`;
  }
  return formatDay(t.dueDate);
}

/** Follow-up list as plain text (all departments or one). */
export function tasksText<T extends Task>(tasks: T[], opts: { company: string; today: string; title: string; deptName: (id: string) => string }): string {
  const out = [`${opts.title} · ${opts.company ? `${opts.company} · ` : ''}${formatDay(opts.today)}`];
  const groups = groupTasks(tasks, opts.today).filter((g) => g.group !== 'DONE');
  if (!groups.length) out.push('', 'Nothing open.');
  for (const g of groups) {
    out.push('', `${GROUP_LABEL[g.group]}:`);
    for (const t of g.tasks) {
      const extra = [t.departmentId ? opts.deptName(t.departmentId) : '', t.person, t.status === 'WAITING' && t.waitingOn ? `waiting on ${t.waitingOn}` : '', t.joNumber].filter(Boolean).join(' · ');
      out.push(`• ${t.priority === 'HIGH' ? '[High] ' : ''}${t.title}${t.dueDate ? ` - ${dueText(t, opts.today)}` : ''}${extra ? ` (${extra})` : ''}`);
    }
  }
  return out.join('\n');
}

/** A short follow-up message to the person (the user edits and sends it). */
export function taskMessage(t: Pick<Task, 'title' | 'dueDate' | 'joNumber'>, person: string): { subject: string; body: string } {
  const hi = person ? `Hi ${person.split(' ')[0]},` : 'Hi,';
  const when = t.dueDate ? ` (needed by ${formatDay(t.dueDate)})` : '';
  return { subject: `Follow-up: ${t.title}`, body: `${hi}\nFollowing up on: ${t.title}${t.joNumber ? ` - ${t.joNumber}` : ''}${when}.\nCould you update me on the status?\nThank you.` };
}
