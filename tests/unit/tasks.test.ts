import { describe, expect, it } from 'vitest';
import { tasksDoc } from '../../src/lib/docs/tasksDoc';
import { checkIntegrity } from '../../src/lib/integrity';
import { buildSampleData } from '../../src/lib/sampleData';
import { completeTask, emptyTask, groupOf, groupTasks, monthDay, nextDue, tasksText, validateTask, type Task } from '../../src/lib/tasks';
import { buildToday } from '../../src/lib/today';
import { DEFAULT_CALENDAR } from '../../src/lib/calendar';

const TODAY = '2026-10-26'; // Monday
const task = (t: Partial<Task>): Task & { id: string } => ({ id: t.title ?? 'x', ...emptyTask(), ...t });

describe('repeats', () => {
  it('weekly, monthly (short months) and every N days', () => {
    expect(nextDue({ kind: 'WEEKLY', weekday: 1 }, '2026-10-26')).toBe('2026-11-02'); // Monday → next Monday
    expect(nextDue({ kind: 'WEEKLY', weekday: 5 }, '2026-10-26')).toBe('2026-10-30');
    expect(nextDue({ kind: 'MONTHLY', day: 10 }, '2026-10-10')).toBe('2026-11-10');
    expect(nextDue({ kind: 'MONTHLY', day: 31 }, '2026-10-31')).toBe('2026-11-30');
    expect(nextDue({ kind: 'MONTHLY', day: 31 }, '2026-11-30')).toBe('2026-12-31');
    expect(monthDay('2027-02', 30)).toBe('2027-02-28');
    expect(nextDue({ kind: 'EVERY_N_DAYS', days: 14 }, '2026-10-26')).toBe('2026-11-09');
  });
  it('done adds the next one; a late completion moves on to the coming date', () => {
    const t = task({ title: 'GST', dueDate: '2026-10-10', repeat: { kind: 'MONTHLY', day: 10 } });
    const late = completeTask(t, TODAY);
    expect(late.done).toMatchObject({ status: 'DONE', doneOn: TODAY });
    expect(late.next).toMatchObject({ status: 'OPEN', dueDate: '2026-11-10', doneOn: null });
    const weekly = completeTask(task({ title: 'W', dueDate: '2026-09-28', repeat: { kind: 'WEEKLY', weekday: 1 } }), TODAY);
    expect(weekly.next!.dueDate).toBe('2026-10-26'); // not a past Monday
    expect(completeTask(task({ title: 'once' }), TODAY).next).toBeNull();
  });
  it('validation', () => {
    expect(validateTask(task({ title: ' ' }))).toMatch(/Enter/);
    expect(validateTask(task({ title: 'x', repeat: { kind: 'MONTHLY', day: 5 } }))).toMatch(/needs a due date/);
    expect(validateTask(task({ title: 'x', dueDate: TODAY, repeat: { kind: 'EVERY_N_DAYS', days: 0 } }))).toMatch(/1 to 366/);
    expect(validateTask(task({ title: 'ok', dueDate: TODAY }))).toBeNull();
  });
});

describe('groups and lists', () => {
  const list = [
    task({ title: 'late', dueDate: '2026-10-20' }),
    task({ title: 'late waiting', dueDate: '2026-10-25', status: 'WAITING' }),
    task({ title: 'today', dueDate: TODAY, priority: 'HIGH' }),
    task({ title: 'week', dueDate: '2026-11-01' }),
    task({ title: 'later', dueDate: '2026-12-01' }),
    task({ title: 'waiting', status: 'WAITING', dueDate: '2026-11-20' }),
    task({ title: 'nodate' }),
    task({ title: 'done', status: 'DONE', doneOn: '2026-10-22' }),
    task({ title: 'old done', status: 'DONE', doneOn: '2026-09-01' }),
    task({ title: 'dropped', status: 'DROPPED' }),
  ];
  it('puts every task in one group; overdue wins over waiting; old done and dropped are hidden', () => {
    const g = Object.fromEntries(groupTasks(list, TODAY).map((x) => [x.group, x.tasks.map((t) => t.title)]));
    expect(g).toEqual({ OVERDUE: ['late', 'late waiting'], TODAY: ['today'], WEEK: ['week'], WAITING: ['waiting'], LATER: ['later'], NO_DATE: ['nodate'], DONE: ['done'] });
    expect(groupOf(list[8]!, TODAY)).toBeNull();
  });
  it('Today card shows overdue, today and the next 2 working days', () => {
    const s = buildToday({ jobOrders: [], ctx: { md: { products: new Map(), rawMaterials: new Map(), boms: new Map() }, cal: DEFAULT_CALENDAR }, today: TODAY, tasks: list, deptName: () => 'Finance' });
    expect(s.items.map((i) => [i.when, i.text.split(':')[1]!.trim().split(' ')[0]])).toEqual([
      ['OVERDUE', 'late'],
      ['OVERDUE', 'late'],
      ['TODAY', 'today'],
    ]);
    expect(s.items[2]!.text).toMatch(/^Task \[High\]: today/);
  });
  it('text and PDF leave out done tasks', () => {
    const text = tasksText(list, { company: 'Co', today: TODAY, title: 'Follow-ups', deptName: () => 'General' });
    expect(text).toMatch(/Overdue:\n• late - 6 days overdue/);
    expect(text).not.toMatch(/done/);
    expect(tasksDoc(list, { company: 'Co', today: TODAY, generatedAt: 'now', deptName: () => '' }).tables.map((t) => t.title)).not.toContain('Done (last 7 days)');
  });
});

describe('sample tasks', () => {
  it('DEMO has follow-ups in Design and Finance, one repeating; links check out', () => {
    const writes = buildSampleData(TODAY);
    const tasks = writes.filter((w) => w.collection === 'tasks').map((w) => ({ id: w.docId, ...(w.data as unknown as Task) }));
    expect(tasks.length).toBe(4);
    expect(tasks.some((t) => t.repeat)).toBe(true);
    expect(tasks.every((t) => validateTask(t) === null)).toBe(true);
    const departments = writes.filter((w) => w.collection === 'departments').map((w) => ({ id: w.docId, ...(w.data as object) })) as never;
    const jobOrders = [...new Map(writes.filter((w) => w.collection === 'jobOrders').map((w) => [w.docId, { id: w.docId, ...(w.data as object) }])).values()] as never;
    const issues = checkIntegrity({ md: { products: new Map(), rawMaterials: new Map(), boms: new Map() }, jobOrders, customers: [], processes: [], suppliers: [], departments, tasks });
    expect(issues.filter((i) => i.text.startsWith('Task'))).toEqual([]);
    const broken = checkIntegrity({ md: { products: new Map(), rawMaterials: new Map(), boms: new Map() }, jobOrders: [], customers: [], processes: [], suppliers: [], departments: [], tasks });
    expect(broken.some((i) => /department is missing/.test(i.text))).toBe(true);
  });
});
