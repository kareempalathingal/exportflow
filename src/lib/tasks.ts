/**
 * Work: tasks and follow-ups for any department (design, finance, HR…),
 * for the user only (confirmed 26 Oct 2026). Not tied to Job Orders, but a
 * task may point to one. Recurring tasks create their next occurrence when
 * one is done. Pure and deterministic; dates are YYYY-MM-DD (IST).
 */
import { addDays, dateFromDayNumber, dayNumber, formatDay } from './dates';
import { weekday, WEEKDAY_NAMES } from './calendar';
import { formatClock } from './time';

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
  /** Optional time on the due date, HH:MM (24-hour, IST). */
  dueTime: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  /** For WAITING: who or what it waits on. */
  waitingOn: string;
  joId: string | null;
  joNumber: string;
  notes: string;
  repeat: Repeat | null;
  doneOn: string | null;
  /** How it ended (confirmed 27 Oct 2026): set when Done. */
  outcome: TaskOutcome | null;
  /** Optional note on how it ended (or why it was dropped). */
  outcomeNote: string;
  /** For a task that was not resolved: what came next. */
  nextStep: NextStep | null;
  /** The follow-up / escalation task created from this one. */
  nextTaskId: string | null;
  /** The task this one follows up or escalates. */
  fromTaskId: string | null;
}

export type TaskOutcome = 'RESOLVED' | 'NOT_RESOLVED';
export type NextStep = 'ESCALATE' | 'FOLLOW_UP' | 'CLOSE';
export const OUTCOME_LABEL: Record<TaskOutcome, string> = { RESOLVED: 'Resolved', NOT_RESOLVED: 'Not resolved' };
export const NEXT_STEP_LABEL: Record<NextStep, string> = { ESCALATE: 'Escalated', FOLLOW_UP: 'Followed up again', CLOSE: 'Closed anyway' };

export const STATUS_LABEL: Record<TaskStatus, string> = { OPEN: 'Open', WAITING: 'Waiting', DONE: 'Done', DROPPED: 'Dropped' };
export const DONE_VISIBLE_DAYS = 7;

export function emptyTask(): Task {
  return {
    title: '',
    departmentId: '',
    person: '',
    dueDate: null,
    dueTime: null,
    priority: 'NORMAL',
    status: 'OPEN',
    waitingOn: '',
    joId: null,
    joNumber: '',
    notes: '',
    repeat: null,
    doneOn: null,
    outcome: null,
    outcomeNote: '',
    nextStep: null,
    nextTaskId: null,
    fromTaskId: null,
  };
}

/** Older tasks saved before the newer fields existed. */
export function withTaskDefaults<T extends Partial<Task>>(t: T): T & Task {
  return { ...emptyTask(), ...t } as T & Task;
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
  if (t.dueTime !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.dueTime)) return 'The time is not valid';
  if (t.dueTime !== null && !t.dueDate) return 'Set the due date for the time';
  if (t.outcomeNote.length > 500) return 'Keep the note under 500 characters';
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
export function completeTask(t: Task, today: string, end?: { outcome: TaskOutcome; note: string; nextStep?: NextStep | null }): { done: Task; next: Task | null } {
  const done: Task = { ...t, status: 'DONE', doneOn: today, outcome: end?.outcome ?? t.outcome ?? null, outcomeNote: (end?.note ?? t.outcomeNote ?? '').trim(), nextStep: end?.outcome === 'NOT_RESOLVED' ? (end.nextStep ?? 'CLOSE') : null };
  if (!t.repeat) return { done, next: null };
  let due = nextDue(t.repeat, t.dueDate ?? today);
  for (let guard = 0; due < today && guard < 1000; guard++) due = nextDue(t.repeat, due);
  return { done, next: { ...t, status: 'OPEN', waitingOn: '', doneOn: null, dueDate: due, outcome: null, outcomeNote: '', nextStep: null, nextTaskId: null, fromTaskId: null } };
}

/**
 * The follow-up or escalation of a task that was not resolved (confirmed 27 Oct 2026):
 * a new open task linked back to it. Escalations go to any department / person and are High.
 */
export function followUpTask(from: Task, fromId: string, step: 'ESCALATE' | 'FOLLOW_UP', to: { departmentId: string; person: string; dueDate: string | null; dueTime: string | null }): Task {
  const base = from.title.replace(/^(Escalated|Follow-up): /, '');
  return {
    ...emptyTask(),
    title: `${step === 'ESCALATE' ? 'Escalated' : 'Follow-up'}: ${base}`.slice(0, 200),
    departmentId: step === 'ESCALATE' ? to.departmentId : from.departmentId,
    person: step === 'ESCALATE' ? to.person : from.person,
    dueDate: to.dueDate,
    dueTime: to.dueDate ? to.dueTime : null,
    priority: step === 'ESCALATE' ? 'HIGH' : from.priority,
    joId: from.joId,
    joNumber: from.joNumber,
    notes: from.outcomeNote ? `Earlier: ${from.outcomeNote}` : '',
    fromTaskId: fromId,
  };
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

/** Past its due date, or due today at a time that has passed (`now` = HH:MM). */
export function isOverdue(t: Pick<Task, 'dueDate' | 'dueTime'>, today: string, now?: string): boolean {
  if (!t.dueDate) return false;
  return t.dueDate < today || (t.dueDate === today && !!t.dueTime && !!now && t.dueTime < now);
}

export function groupOf(t: Task, today: string, now?: string): TaskGroup | null {
  if (t.status === 'DROPPED') return null;
  if (t.status === 'DONE') return t.doneOn && t.doneOn >= addDays(today, -DONE_VISIBLE_DAYS)! ? 'DONE' : null;
  if (isOverdue(t, today, now)) return 'OVERDUE'; // late, even when waiting
  if (t.status === 'WAITING') return 'WAITING';
  if (!t.dueDate) return 'NO_DATE';
  if (t.dueDate === today) return 'TODAY';
  if (t.dueDate <= addDays(today, 6)!) return 'WEEK';
  return 'LATER';
}

const byUrgency = <T extends Task>(a: T, b: T) =>
  (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') === 0
    ? (a.priority === 'HIGH' ? 0 : 1) - (b.priority === 'HIGH' ? 0 : 1) || (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99') || a.title.localeCompare(b.title)
    : (a.priority === 'HIGH' ? 0 : 1) - (b.priority === 'HIGH' ? 0 : 1) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999');

export function groupTasks<T extends Task>(tasks: T[], today: string, now?: string): { group: TaskGroup; tasks: T[] }[] {
  const map = new Map<TaskGroup, T[]>();
  for (const t of tasks) {
    const g = groupOf(withTaskDefaults(t), today, now);
    if (g) map.set(g, [...(map.get(g) ?? []), t]);
  }
  return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({ group: g, tasks: map.get(g)!.sort(g === 'DONE' ? (a, b) => (b.doneOn ?? '').localeCompare(a.doneOn ?? '') : byUrgency) }));
}

export function dueText(t: Pick<Task, 'dueDate' | 'status'> & { dueTime?: string | null }, today: string): string {
  if (!t.dueDate) return 'no date';
  const at = t.dueTime ? ` ${formatClock(t.dueTime)}` : '';
  if (t.dueDate === today) return `today${at}`;
  if (t.dueDate < today) {
    const n = (dayNumber(today) ?? 0) - (dayNumber(t.dueDate) ?? 0);
    return `${n} day${n === 1 ? '' : 's'} overdue (${formatDay(t.dueDate)}${at})`;
  }
  return `${formatDay(t.dueDate)}${at}`;
}

/** "Resolved - artwork approved" / "Not resolved · escalated - buyer silent". */
export function outcomeText(t: Pick<Task, 'status' | 'outcome' | 'outcomeNote' | 'nextStep'>): string {
  if (t.status === 'DROPPED') return `Dropped${t.outcomeNote ? ` - ${t.outcomeNote}` : ''}`;
  if (!t.outcome) return t.outcomeNote ? t.outcomeNote : '';
  return `${OUTCOME_LABEL[t.outcome]}${t.outcome === 'NOT_RESOLVED' && t.nextStep ? ` · ${NEXT_STEP_LABEL[t.nextStep].toLowerCase()}` : ''}${t.outcomeNote ? ` - ${t.outcomeNote}` : ''}`;
}

/** Follow-up list as plain text (all departments or one). */
export function tasksText<T extends Task>(tasks: T[], opts: { company: string; today: string; now?: string; title: string; deptName: (id: string) => string }): string {
  const out = [`${opts.title} · ${opts.company ? `${opts.company} · ` : ''}${formatDay(opts.today)}`];
  const all = groupTasks(tasks, opts.today, opts.now);
  const groups = all.filter((g) => g.group !== 'DONE');
  if (!groups.length) out.push('', 'Nothing open.');
  for (const g of groups) {
    out.push('', `${GROUP_LABEL[g.group]}:`);
    for (const t of g.tasks) {
      const extra = [t.departmentId ? opts.deptName(t.departmentId) : '', t.person, t.status === 'WAITING' && t.waitingOn ? `waiting on ${t.waitingOn}` : '', t.joNumber, t.fromTaskId ? (t.title.startsWith('Escalated') ? 'escalation' : 'follow-up') : ''].filter(Boolean).join(' · ');
      out.push(`• ${t.priority === 'HIGH' ? '[High] ' : ''}${t.title}${t.dueDate ? ` - ${dueText(t, opts.today)}` : ''}${extra ? ` (${extra})` : ''}`);
    }
  }
  const done = all.find((g) => g.group === 'DONE')?.tasks ?? [];
  if (done.length) {
    out.push('', `${GROUP_LABEL.DONE}:`);
    for (const t of done) out.push(`• ${t.title}${outcomeText(t) ? ` - ${outcomeText(t)}` : ''}`);
  }
  return out.join('\n');
}

/** A short follow-up message to the person (the user edits and sends it). */
export function taskMessage(t: Pick<Task, 'title' | 'dueDate' | 'joNumber'>, person: string): { subject: string; body: string } {
  const hi = person ? `Hi ${person.split(' ')[0]},` : 'Hi,';
  const when = t.dueDate ? ` (needed by ${formatDay(t.dueDate)})` : '';
  return { subject: `Follow-up: ${t.title}`, body: `${hi}\nFollowing up on: ${t.title}${t.joNumber ? ` - ${t.joNumber}` : ''}${when}.\nCould you update me on the status?\nThank you.` };
}
