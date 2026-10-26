/** Follow-up list PDF (Work tasks), all departments or one. */
import { formatDay } from '../jobOrders';
import { dueText, GROUP_LABEL, groupTasks, repeatLabel, STATUS_LABEL, type Task } from '../tasks';
import { safeFileName, type DocModel } from './model';

export function tasksDoc(tasks: Task[], opts: { company: string; today: string; generatedAt: string; deptName: (id: string) => string; department?: string }): DocModel {
  const groups = groupTasks(tasks, opts.today).filter((g) => g.group !== 'DONE');
  const open = groups.reduce((a, g) => a + g.tasks.length, 0);
  const overdue = groups.find((g) => g.group === 'OVERDUE')?.tasks.length ?? 0;
  return {
    title: opts.department ? `Follow-up List - ${opts.department}` : 'Follow-up List',
    reference: formatDay(opts.today),
    company: opts.company,
    meta: [['Open', `${open}${overdue ? ` · ${overdue} overdue` : ''}`]],
    tables: groups.map((g) => ({
      title: GROUP_LABEL[g.group],
      columns: [{ label: 'Task' }, { label: 'Department / person' }, { label: 'Due' }, { label: 'Status' }],
      rows: g.tasks.map((t) => [
        `${t.priority === 'HIGH' ? '[High] ' : ''}${t.title}${t.joNumber ? `\n${t.joNumber}` : ''}${t.repeat ? `\nRepeats ${repeatLabel(t.repeat)}` : ''}`,
        [opts.deptName(t.departmentId), t.person].filter(Boolean).join('\n'),
        dueText(t, opts.today),
        `${STATUS_LABEL[t.status]}${t.status === 'WAITING' && t.waitingOn ? `\non ${t.waitingOn}` : ''}`,
      ]),
      empty: 'Nothing.',
    })),
    notes: groups.length ? [] : ['Nothing open.'],
    provisional: false,
    provisionalReasons: [],
    generatedAt: opts.generatedAt,
    fileName: `follow-ups_${opts.department ? `${safeFileName(opts.department)}_` : ''}${opts.today}.pdf`,
  };
}
