/** PDFs for "My report" (weekly / monthly) and "Look ahead" (confirmed 27 Oct 2026). */
import { formatDay } from '../jobOrders';
import type { LookAhead } from '../lookAhead';
import type { MyReport, Tone } from '../myReport';
import { formatClock } from '../time';
import { formatQty, unitLabel } from '../units';
import { safeFileName, type DocModel, type DocTable, type DocTone } from './model';

const short = (d: string) => formatDay(d).replace(/ \d{4}$/, '');
const tone = (t: Tone): DocTone | null => (t === 'bad' ? 'late' : t === 'warn' ? 'tight' : null);

export function myReportDoc(
  r: MyReport,
  opts: { company: string; generatedAt: string; highlights: string[]; preparedBy: { name: string; designation: string }; today: string },
): DocModel {
  const t = r.tiles;
  const kind = r.monthly ? 'Monthly' : 'Weekly';
  const tables: DocTable[] = [];
  const hl = opts.highlights.map((h) => h.trim()).filter(Boolean);
  if (hl.length) tables.push({ title: 'Highlights', columns: [{ label: '' }], rows: hl.map((h) => [`- ${h}`]), empty: '', noHead: true });
  tables.push({
    title: 'At a glance',
    columns: [{ label: 'Orders confirmed' }, { label: 'Steps finished' }, { label: 'Orders completed' }, { label: 'Follow-ups closed' }],
    rows: [
      [
        `${t.confirmed}${t.confirmed && t.planningAvg !== null ? `\nplanning ${formatQty(t.planningAvg)} d${t.planningBench !== null ? ` (benchmark ${t.planningBench})` : ''}` : ''}`,
        `${t.stepsDone}${t.stepsTimed ? `\n${t.stepsOnTime} of ${t.stepsTimed} on time` : ''}`,
        `${t.completed}${t.completed ? `\n${t.completedOnTime} by the internal deadline` : ''}`,
        `${t.tasksDone}${t.tasksDone ? `\n${t.resolved} resolved${t.escalated ? ` · ${t.escalated} escalated` : ''}` : ''}`,
      ],
    ],
    empty: '',
  });
  tables.push({
    title: 'Orders',
    columns: [{ label: 'Order' }, { label: 'Customer' }, { label: 'Progress', align: 'right' }, { label: 'In the period' }, { label: 'vs internal deadline' }],
    rows: r.orders.map((o) => [o.joNumber, o.customer, o.progress, o.period, o.standing]),
    rowTones: r.orders.map((o) => tone(o.tone)),
    empty: 'No open orders.',
  });
  tables.push({
    title: 'Delays found',
    columns: [{ label: 'Date' }, { label: 'Order' }, { label: 'Step' }, { label: 'Over plan' }, { label: 'Order now' }],
    rows: r.delays.map((d) => [short(d.date), d.order, d.step, d.over, d.now]),
    rowTones: r.delays.map((d) => tone(d.tone)),
    empty: 'No step ran over its plan.',
  });
  tables.push({
    title: 'Follow-ups closed',
    columns: [{ label: 'Task' }, { label: 'Department / person' }, { label: 'Done' }, { label: 'How it ended' }],
    rows: r.followUps.map((f) => [f.title, f.who, f.done, f.outcome]),
    rowTones: r.followUps.map((f) => tone(f.tone)),
    empty: 'None closed in this period.',
  });
  if (r.openEscalations.length)
    tables.push({ title: 'Open escalations and follow-ups', columns: [{ label: 'Task' }, { label: 'Department / person' }, { label: 'Due' }], rows: r.openEscalations.map((e) => [e.title, e.who, e.due]), empty: '' });
  tables.push({
    title: 'KPIs',
    columns: [{ label: 'KPI' }, { label: 'This period', align: 'right' }, { label: 'Previous', align: 'right' }, { label: 'Target', align: 'right' }],
    rows: r.kpis.map((k) => [k.label, k.cur, k.prev, k.target]),
    rowTones: r.kpis.map((k) => (k.tone === 'bad' ? 'late' : k.tone === 'warn' ? 'tight' : null)),
    empty: '',
  });
  if (r.next.length) tables.push({ title: r.monthly ? 'Coming month' : 'Coming week', columns: [{ label: '' }], rows: r.next.map((n) => [`- ${n}`]), empty: '', noHead: true });
  return {
    title: `${kind} Report`,
    reference: `${short(r.from)} - ${formatDay(r.to)}`,
    company: opts.company,
    meta: [
      ['Prepared by', [opts.preparedBy.name, opts.preparedBy.designation].filter(Boolean).join(' · ') || '-'],
      ['Period', `${formatDay(r.from)} - ${formatDay(r.to)}${r.monthly ? '' : ' (Monday-Sunday)'}`],
      ['Compared with', `${formatDay(r.prevFrom)} - ${formatDay(r.prevTo)}`],
    ],
    tables,
    notes: ['Built from the records in ExportFlow; figures can be checked against each order and task.', 'Working days exclude Sundays and company holidays.'],
    provisional: false,
    provisionalReasons: [],
    signature: { preparedBy: opts.preparedBy.name, designation: opts.preparedBy.designation, date: formatDay(opts.today) },
    generatedAt: opts.generatedAt,
    fileName: `${kind.toLowerCase()}-report_${r.from}.pdf`,
  };
}

export function lookAheadDoc(la: LookAhead, opts: { company: string; generatedAt: string; today: string }): DocModel {
  const cols = la.weeks.map((w) => ({ label: la.byMonth ? w.label : `Week of ${w.label}` }));
  const heat: DocTable = {
    title: 'How busy each department will be',
    columns: [{ label: 'Department' }, ...cols, { label: 'Quieter (leave)' }],
    rows: la.departments.map((d) => [
      d.name,
      ...d.cells.map((c) => (c.orders ? `${c.orders} order${c.orders === 1 ? '' : 's'}\navg ${formatQty(c.avg)} · peak ${c.peak}` : '-')),
      d.quietWeeks.length ? d.quietWeeks.map((w) => (la.byMonth ? la.weeks.find((x) => x.start === w)?.label ?? w : short(w < la.from ? la.from : w))).join(', ') : 'none',
    ]),
    cellLevels: la.departments.map((d) => [null, ...d.cells.map((c) => c.level || null), null]),
    empty: 'No department has planned work in this period (or no departments are linked to processes yet).',
  };
  const qtyRows = la.departments.flatMap((d) => d.processes.map((p) => [`${p.name}\n${d.name}`, ...p.qty.map((q) => (q > 0 ? `${formatQty(Math.round(q))} ${unitLabel(p.unit)}` : '-'))]));
  const tables: DocTable[] = [
    heat,
    {
      title: 'Quantity by process',
      columns: [{ label: 'Process' }, ...cols.map((c) => ({ ...c, align: 'right' as const }))],
      rows: qtyRows,
      empty: 'No quantities to show.',
    },
    {
      title: 'Key dates',
      columns: [{ label: 'Date' }, { label: 'What' }],
      rows: la.dates.map((d) => [formatDay(d.date), d.text]),
      empty: 'No deadlines, deliveries or company holidays in this period.',
    },
    {
      title: 'Recurring and planned work (Work)',
      columns: [{ label: 'Due' }, { label: 'Task' }, { label: 'Department / person' }],
      rows: la.tasks.map((t) => [`${formatDay(t.date)}${t.time ? ` ${formatClock(t.time)}` : ''}${t.date < opts.today ? ' (overdue)' : ''}`, `${t.title}${t.repeat ? ' (repeats)' : ''}`, t.who || 'General']),
      empty: 'No tasks due in this period.',
    },
    {
      title: 'Materials needed - by when',
      columns: [{ label: 'Item' }, { label: 'To buy', align: 'right' }, { label: 'Needed by' }, { label: 'For' }, { label: 'Order' }],
      rows: la.materials.map((m) => [m.name, `${formatQty(m.qty)} ${unitLabel(m.unit)}`, m.overdue ? `now (${short(m.neededBy)})` : formatDay(m.neededBy), m.usedIn, m.joNumber]),
      rowTones: la.materials.map((m) => (m.overdue ? 'tight' : null)),
      empty: 'No materials needed in this period.',
    },
  ];
  if (la.bought.length)
    tables.push({ title: 'Bought items', columns: [{ label: 'Order' }, { label: 'Item' }, { label: 'Step' }], rows: la.bought.map((b) => [b.joNumber, b.product, b.text]), empty: '' });
  const notes = [
    'Confirmed orders only. Dates follow the step plans (working days; Sundays and company holidays are off).',
    'Orders = orders with a step in that department in the period; avg / peak = jobs (one product step each) running at the same time on an average / the busiest day. Relative only: department capacity is not known yet, so busy means busier than its other weeks, not overloaded.',
    'Quantities are spread evenly over each step\'s planned working days. Quieter = no work, or under a third of its busiest period.',
    ...(la.notPlaced.length ? [`Steps without a time could not be placed: ${la.notPlaced.map((n) => `${n.step} (${n.product}, ${n.joNumber})`).join('; ')}.`] : []),
  ];
  return {
    title: 'Look Ahead',
    reference: `${short(la.from)} - ${formatDay(la.to)}`,
    company: opts.company,
    meta: [
      ['Period', `${formatDay(la.from)} - ${formatDay(la.to)}`],
      ['Orders', `${la.orders} confirmed`],
      ['In short', la.summary],
    ],
    tables,
    notes,
    provisional: false,
    provisionalReasons: [],
    generatedAt: opts.generatedAt,
    fileName: `look-ahead_${safeFileName(la.from)}.pdf`,
  };
}
