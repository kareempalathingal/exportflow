/**
 * "Today" summary (confirmed 21 Oct 2026): what needs attention today and in
 * the next 2 working days. Shown on Home and shareable as text or PDF; the
 * app never sends it by itself. Pure and deterministic.
 */
import { addWorkingDays, dayOff, workingDaysBetween, type WorkCalendar } from './calendar';
import { addDays, daysBetween, formatDay, type JobOrder } from './jobOrders';
import { DEFAULT_PLANNING_DAYS, lineProgresses, type PlanContext } from './route';
import { formatQty, unitLabel } from './units';
import { isActive, type Task } from './tasks';
import { formatClock } from './time';
import { awaitedItems, startChecks } from './followUp';
import type { Department, Process, Supplier } from './masters';
import { departmentsFor } from './contacts';

export const SOON_WORKING_DAYS = 2;

export type TodayWhen = 'OVERDUE' | 'TODAY' | 'SOON';

export interface TodayItem {
  when: TodayWhen;
  date: string | null;
  text: string;
  link: string;
  /** Who it is for (16 Nov 2026): a process (its department), a department (tasks), purchase, or the whole order / general. */
  area: TodayArea;
  /** For process steps: what to ask the department about (contact buttons). */
  step?: { processId: string | null; joNumber: string; product: string; label: string; quantity: string | null; finish: string | null; late: boolean };
}

export type TodayArea = { kind: 'PROCESS'; id: string } | { kind: 'DEPT'; id: string } | { kind: 'PURCHASE' } | { kind: 'ORDER' };
const ORDER_AREA: TodayArea = { kind: 'ORDER' };
const PURCHASE_AREA: TodayArea = { kind: 'PURCHASE' };
const processArea = (id: string | null | undefined): TodayArea => (id ? { kind: 'PROCESS', id } : PURCHASE_AREA);

export interface TodaySummary {
  today: string;
  soonUntil: string;
  items: TodayItem[];
}

const ORDER: Record<TodayWhen, number> = { OVERDUE: 0, TODAY: 1, SOON: 2 };

export function buildToday(args: {
  jobOrders: (JobOrder & { id: string })[];
  ctx: PlanContext;
  today: string;
  backupDue?: { days: number | null } | null;
  /** Work tasks (any department): overdue, today and the next 2 working days. */
  tasks?: (Task & { id: string })[];
  deptName?: (id: string) => string;
  /** Ready-to-start checks and supplier / vendor follow-ups (5 Nov 2026). */
  processes?: Map<string, Process>;
  suppliers?: Map<string, Supplier>;
  alertDays?: number;
}): TodaySummary {
  const { today, ctx } = args;
  const cal: WorkCalendar = ctx.cal;
  const soonUntil = addWorkingDays(today, SOON_WORKING_DAYS, cal) ?? today;
  const items: TodayItem[] = [];
  const when = (date: string): TodayWhen | null => (date < today ? 'OVERDUE' : date === today ? 'TODAY' : date <= soonUntil ? 'SOON' : null);
  const day = (d: string) => (d === today ? 'today' : formatDay(d));

  const planningDays = ctx.planningDays === undefined ? DEFAULT_PLANNING_DAYS : ctx.planningDays;
  for (const jo of args.jobOrders) {
    const link = `/orders/${jo.id}`;
    // Drafts: planning is the first stage of the order clock.
    if (jo.status === 'DRAFT' && planningDays !== null) {
      const used = workingDaysBetween(jo.receivedDate, today, cal) ?? 0;
      const due = addWorkingDays(jo.receivedDate, planningDays, cal) ?? today;
      if (used > planningDays) items.push({ when: 'OVERDUE', date: null, text: `${jo.joNumber}: still in planning after ${formatQty(used)} working days (benchmark ${formatQty(planningDays)}) — confirm the plan`, link, area: ORDER_AREA });
      else if (when(due) === 'TODAY' || when(due) === 'SOON') items.push({ when: when(due)!, date: due, text: `${jo.joNumber}: plan to be confirmed by ${day(due)}`, link, area: ORDER_AREA });
      continue;
    }
    if (jo.status !== 'CONFIRMED') continue;
    const d = jo.deadline.internalDeadline;
    const w = when(d);
    if (w === 'OVERDUE') {
      const n = daysBetween(d, today) ?? 0;
      items.push({ when: w, date: d, text: `${jo.joNumber}: internal deadline passed ${n} day${n === 1 ? '' : 's'} ago (${formatDay(d)})`, link, area: ORDER_AREA });
    } else if (w) items.push({ when: w, date: d, text: `${jo.joNumber}: internal deadline ${day(d)}`, link, area: ORDER_AREA });
    const dw = when(jo.deliveryDate);
    if (dw && dw !== 'OVERDUE') items.push({ when: dw, date: jo.deliveryDate, text: `${jo.joNumber}: cargo ready ${day(jo.deliveryDate)}`, link, area: ORDER_AREA });

    for (const { line, lp } of lineProgresses(jo, today, ctx)) {
      const cur = lp.current;
      if (!cur) continue;
      const name = `${jo.joNumber} · ${line.productName}: ${cur.step.label}`;
      const end = cur.step.plannedDays !== null && cur.startOn ? addWorkingDays(cur.startOn, cur.step.plannedDays, cal) : null;
      const late = cur.overrunDays !== null && cur.overrunDays > 0;
      const area = processArea(cur.step.processId ?? cur.step.outsideOf);
      const step = {
        processId: cur.step.processId,
        joNumber: jo.joNumber,
        product: cur.step.forProduct || line.productName,
        label: cur.step.label,
        quantity: cur.step.qty !== null && cur.step.qtyUnit ? `${formatQty(cur.step.qty)} ${unitLabel(cur.step.qtyUnit)}` : null,
        finish: end ? formatDay(end) : null,
        late,
      };
      if (late) {
        items.push({ when: 'OVERDUE', date: null, text: `${name} running ${formatQty(cur.overrunDays!)} working day${cur.overrunDays === 1 ? '' : 's'} over plan`, link: `${link}?tab=products`, step, area });
      } else if (end) {
        const ew = when(end);
        if (ew === 'TODAY' || ew === 'SOON') items.push({ when: ew, date: end, text: `${name} should finish ${day(end)}`, link: `${link}?tab=products`, step, area });
      }
    }
  }

  // Steps starting soon that are not ready, and what is awaited from outside.
  if (args.processes) {
    for (const c of startChecks(args.jobOrders, ctx, today, args.processes, args.suppliers ?? new Map(), args.alertDays)) {
      if (c.ready) continue;
      const w: TodayWhen = c.start <= today ? 'OVERDUE' : 'SOON';
      items.push({ when: w, date: c.start, text: `${c.joNumber} · ${c.product}: ${c.label} ${c.start <= today ? 'due to start' : `starts ${day(c.start)}`} - ready ${c.readyCount} of ${c.total}`, link: '/', area: processArea(c.processId) });
    }
    const name = (id: string | null) => (id ? (args.suppliers?.get(id)?.name ?? 'supplier') : 'no supplier yet');
    for (const a of awaitedItems(args.jobOrders, ctx, today, args.alertDays)) {
      if (a.bucket === 'LATE') items.push({ when: 'OVERDUE', date: a.expectedOn, text: `${a.joNumber}: ${a.what} from ${name(a.supplierId)} ${a.lateDays} working day${a.lateDays === 1 ? '' : 's'} late (${a.outstanding})`, link: a.link, area: a.kind === 'JOB_WORK' ? processArea(a.processId) : PURCHASE_AREA });
      else if (a.bucket === 'SOON') items.push({ when: a.expectedOn === today ? 'TODAY' : 'SOON', date: a.expectedOn, text: `${a.joNumber}: ${a.what} expected from ${name(a.supplierId)} ${day(a.expectedOn!)} - confirm (${a.outstanding})`, link: a.link, area: a.kind === 'JOB_WORK' ? processArea(a.processId) : PURCHASE_AREA });
    }
  }

  // Company holidays coming up (Sundays are known; only holidays are listed).
  for (let d = addDays(today, 1)!; d <= soonUntil; d = addDays(d, 1)!) {
    const off = dayOff(d, cal);
    if (off.off && d in cal.holidays) items.push({ when: 'SOON', date: d, text: `${formatDay(d)}: ${off.reason} (no work)`, link: '/', area: ORDER_AREA });
  }

  for (const t of args.tasks ?? []) {
    if (!isActive(t) || !t.dueDate) continue;
    const w = when(t.dueDate);
    if (!w) continue;
    const who = [t.departmentId && args.deptName ? args.deptName(t.departmentId) : '', t.person].filter(Boolean).join(' · ');
    const lateBy = w === 'OVERDUE' ? ` - due ${formatDay(t.dueDate)}` : w === 'SOON' ? ` - ${day(t.dueDate)}` : '';
    const at = t.dueTime ? ` at ${formatClock(t.dueTime)}` : '';
    items.push({ when: w, date: t.dueDate, text: `Task${t.priority === 'HIGH' ? ' [High]' : ''}: ${t.title}${who ? ` (${who})` : ''}${t.status === 'WAITING' ? ' · waiting' : ''}${lateBy}${at}`, link: `/work/${t.id}`, area: t.departmentId ? { kind: 'DEPT', id: t.departmentId } : ORDER_AREA });
  }

  if (args.backupDue) {
    items.push({ when: 'TODAY', date: null, text: args.backupDue.days === null ? 'Backup: none taken on this phone yet' : `Backup: last one ${args.backupDue.days} days ago`, link: '/settings', area: ORDER_AREA });
  }

  items.sort((a, b) => ORDER[a.when] - ORDER[b.when] || (a.date ?? '').localeCompare(b.date ?? '') || a.text.localeCompare(b.text));
  return { today, soonUntil, items };
}

const HEAD: Record<TodayWhen, string> = { OVERDUE: 'Overdue / running late', TODAY: 'Today', SOON: 'Next 2 working days' };

export interface TodayGroup {
  key: string;
  name: string;
  /** The department (contacts), when the group is one. */
  department: Department | null;
  items: TodayItem[];
  counts: Record<TodayWhen, number>;
}

export const NO_DEPT_GROUP = 'No department linked';
export const PURCHASE_GROUP = 'Purchase and suppliers';
export const ORDER_GROUP = 'Whole order and general';

/**
 * The Today items by department (16 Nov 2026): a process step goes to the department that
 * handles the process, a task to its department; bought items and materials to "Purchase
 * and suppliers"; deadlines, planning, holidays and the backup to "Whole order and general".
 * Departments with overdue items first; the three other groups last.
 */
export function todayByDepartment(s: TodaySummary, departments: (Department & { id?: string })[]): TodayGroup[] {
  const groups = new Map<string, TodayGroup>();
  const add = (key: string, name: string, department: Department | null, item: TodayItem) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, name, department, items: [], counts: { OVERDUE: 0, TODAY: 0, SOON: 0 } }));
    g.items.push(item);
    g.counts[item.when]++;
  };
  for (const i of s.items) {
    const a = i.area;
    if (a.kind === 'PROCESS') {
      const d = departmentsFor(a.id, departments)[0];
      if (d) add(`d:${d.id ?? d.name}`, d.name, d, i);
      else add('none', NO_DEPT_GROUP, null, i);
    } else if (a.kind === 'DEPT') {
      const d = departments.find((x) => x.id === a.id);
      if (d) add(`d:${a.id}`, d.name, d, i);
      else add('order', ORDER_GROUP, null, i);
    } else if (a.kind === 'PURCHASE') add('purchase', PURCHASE_GROUP, null, i);
    else add('order', ORDER_GROUP, null, i);
  }
  const LAST: Record<string, number> = { none: 1, purchase: 2, order: 3 };
  return [...groups.values()].sort(
    (x, y) => (LAST[x.key] ?? 0) - (LAST[y.key] ?? 0) || y.counts.OVERDUE - x.counts.OVERDUE || x.name.localeCompare(y.name),
  );
}

const TAG: Record<TodayWhen, string> = { OVERDUE: 'Overdue', TODAY: 'Today', SOON: 'Next 2 days' };

export function countsText(c: Record<TodayWhen, number>): string {
  return (['OVERDUE', 'TODAY', 'SOON'] as TodayWhen[])
    .filter((w) => c[w] > 0)
    .map((w) => `${c[w]} ${w === 'OVERDUE' ? 'overdue' : w === 'TODAY' ? 'today' : 'soon'}`)
    .join(', ');
}

/** One department's list, to send to its team leader (a draft the user sends). */
export function todayGroupText(g: TodayGroup, today: string, company: string): string {
  return [`${g.name} · ${company ? `${company} · ` : ''}${formatDay(today)}`, '', ...g.items.map((i) => `• [${TAG[i.when]}] ${i.text}`)].join('\n');
}

/** Plain text to paste into WhatsApp or email; by department when departments are given (16 Nov 2026). */
export function todayText(s: TodaySummary, company: string, departments?: (Department & { id?: string })[]): string {
  const out = [`${company ? `${company} · ` : ''}${formatDay(s.today)}`];
  if (s.items.length === 0) out.push('', 'Nothing due today or in the next 2 working days.');
  if (departments) {
    for (const g of todayByDepartment(s, departments)) out.push('', `${g.name} (${countsText(g.counts)}):`, ...g.items.map((i) => `• [${TAG[i.when]}] ${i.text}`));
    return out.join('\n');
  }
  for (const w of ['OVERDUE', 'TODAY', 'SOON'] as TodayWhen[]) {
    const list = s.items.filter((i) => i.when === w);
    if (!list.length) continue;
    out.push('', `${HEAD[w]}:`, ...list.map((i) => `• ${i.text}`));
  }
  return out.join('\n');
}

export const TODAY_HEADINGS = HEAD;
