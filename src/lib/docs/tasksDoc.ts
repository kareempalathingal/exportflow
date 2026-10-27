/** Follow-up list PDF (Work tasks), all departments or one. */
import { formatDay } from '../jobOrders';
import { dueText, GROUP_LABEL, groupTasks, isActive, outcomeText, repeatLabel, STATUS_LABEL, withTaskDefaults, type Task } from '../tasks';
import { safeFileName, type DocModel, type DocTable } from './model';

export function tasksDoc(raw: Task[], opts: { company: string; today: string; now?: string; generatedAt: string; deptName: (id: string) => string; department?: string }): DocModel {
  const tasks = raw.map((t) => withTaskDefaults(t));
  const all = groupTasks(tasks, opts.today, opts.now);
  const groups = all.filter((g) => g.group !== 'DONE');
  const done = all.find((g) => g.group === 'DONE')?.tasks ?? [];
  const open = groups.reduce((a, g) => a + g.tasks.length, 0);
  const overdue = groups.find((g) => g.group === 'OVERDUE')?.tasks.length ?? 0;
  // Escalations and follow-ups still open (confirmed 27 Oct 2026).
  const escalations = tasks.filter((t) => isActive(t) && t.fromTaskId);
  const who = (t: Task) => [opts.deptName(t.departmentId), t.person].filter(Boolean).join('\n');
  const tables: DocTable[] = groups.map((g) => ({
    title: GROUP_LABEL[g.group],
    columns: [{ label: 'Task' }, { label: 'Department / person' }, { label: 'Due' }, { label: 'Status' }],
    rows: g.tasks.map((t) => [
      `${t.priority === 'HIGH' ? '[High] ' : ''}${t.title}${t.joNumber ? `\n${t.joNumber}` : ''}${t.repeat ? `\nRepeats ${repeatLabel(t.repeat)}` : ''}`,
      who(t),
      dueText(t, opts.today),
      `${STATUS_LABEL[t.status]}${t.status === 'WAITING' && t.waitingOn ? `\non ${t.waitingOn}` : ''}`,
    ]),
    empty: 'Nothing.',
  }));
  if (escalations.length)
    tables.unshift({
      title: 'Open escalations and follow-ups',
      columns: [{ label: 'Task' }, { label: 'Department / person' }, { label: 'Due' }],
      rows: escalations.map((t) => [t.title, who(t), dueText(t, opts.today)]),
      empty: 'None.',
    });
  if (done.length)
    tables.push({
      title: 'Done in the last 7 days - how it ended',
      columns: [{ label: 'Task' }, { label: 'Department / person' }, { label: 'Done' }, { label: 'Outcome' }],
      rows: done.map((t) => [t.title, who(t), formatDay(t.doneOn), outcomeText(t) || '-']),
      empty: 'Nothing.',
    });
  return {
    title: opts.department ? `Follow-up List - ${opts.department}` : 'Follow-up List',
    reference: formatDay(opts.today),
    company: opts.company,
    meta: [['Open', `${open}${overdue ? ` · ${overdue} overdue` : ''}${escalations.length ? ` · ${escalations.length} escalation / follow-up` : ''}`]],
    tables,
    notes: groups.length ? [] : ['Nothing open.'],
    provisional: false,
    provisionalReasons: [],
    generatedAt: opts.generatedAt,
    fileName: `follow-ups_${opts.department ? `${safeFileName(opts.department)}_` : ''}${opts.today}.pdf`,
  };
}
