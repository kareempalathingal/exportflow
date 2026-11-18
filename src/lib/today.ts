/**
 * "Today" summary (confirmed 21 Oct 2026): what needs attention today and in
 * the next 2 working days. Shown on Home and shareable as text or PDF; the
 * app never sends it by itself. Pure and deterministic.
 */
import { checkDue } from './orderExtras';
import { milestoneSummary } from './milestones';
import { addWorkingDays, dayOff, workingDaysBetween, type WorkCalendar } from './calendar';
import { addDays, daysBetween, formatDay, type JobOrder } from './jobOrders';
import { DEFAULT_PLANNING_DAYS, lineProgresses, type PlanContext } from './route';
import { formatQty, unitLabel } from './units';
import { isActive, type Task } from './tasks';
import { formatClock } from './time';
import { awaitedItems, startChecks, type AwaitTarget } from './followUp';
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
  /** The button that leads to where it is solved (17 Nov 2026); absent for information only (holidays). */
  open?: { label: string; link: string };
  /** What can be done right here (round 2, 17 Nov 2026): a step, an awaited item or a task. */
  act?: TodayAct;
  /** "+ Follow-up task" prefill: the WO it is about (tasks themselves have none). */
  followUp?: { joId: string; joNumber: string };
  /** For process steps: what to ask the department about (contact buttons). */
  step?: { processId: string | null; joNumber: string; product: string; label: string; quantity: string | null; finish: string | null; late: boolean };
}

export type TodayAct = { kind: 'STEP'; joId: string; lineId: string; stepKey: string } | { kind: 'AWAIT'; joId: string; target: AwaitTarget } | { kind: 'TASK'; taskId: string };

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
    const woActs = { open: { label: jo.status === 'DRAFT' ? 'Open WO to confirm' : 'Open WO', link }, followUp: { joId: jo.id, joNumber: jo.joNumber } };
    // Drafts: planning is the first stage of the order clock.
    if (jo.status === 'DRAFT' && planningDays !== null) {
      const used = workingDaysBetween(jo.receivedDate, today, cal) ?? 0;
      const due = addWorkingDays(jo.receivedDate, planningDays, cal) ?? today;
      if (used > planningDays) items.push({ when: 'OVERDUE', date: null, text: `${jo.joNumber}: still in planning after ${formatQty(used)} working days (benchmark ${formatQty(planningDays)}) — confirm the plan`, link, area: ORDER_AREA, ...woActs });
      else if (when(due) === 'TODAY' || when(due) === 'SOON') items.push({ when: when(due)!, date: due, text: `${jo.joNumber}: plan to be confirmed by ${day(due)}`, link, area: ORDER_AREA, ...woActs });
      continue;
    }
    if (jo.status !== 'CONFIRMED') continue;
    const d = jo.deadline.internalDeadline;
    const w = when(d);
    if (w === 'OVERDUE') {
      const n = daysBetween(d, today) ?? 0;
      items.push({ when: w, date: d, text: `${jo.joNumber}: internal deadline passed ${n} day${n === 1 ? '' : 's'} ago (${formatDay(d)})`, link, area: ORDER_AREA, ...woActs });
    } else if (w) items.push({ when: w, date: d, text: `${jo.joNumber}: internal deadline ${day(d)}`, link, area: ORDER_AREA, ...woActs });
    const dw = when(jo.deliveryDate);
    if (dw && dw !== 'OVERDUE') items.push({ when: dw, date: jo.deliveryDate, text: `${jo.joNumber}: cargo ready ${day(jo.deliveryDate)}`, link, area: ORDER_AREA, ...woActs });

    // Round 2 (17 Nov 2026): customer requirements due (order items come through the awaited list below).
    const clLink = `${link}?tab=checklist`;
    for (const c of jo.checklist ?? []) {
      if (c.doneOn) continue;
      const due = checkDue(c, jo, cal);
      const w = due ? when(due) : null;
      if (!due || !w) continue;
      items.push({ when: w, date: due, text: w === 'OVERDUE' ? `${jo.joNumber}: ${c.text} - was due ${formatDay(due)}` : `${jo.joNumber}: ${c.text} - due ${day(due)}`, link: clLink, area: ORDER_AREA, open: { label: 'Open checklist', link: clLink }, followUp: { joId: jo.id, joNumber: jo.joNumber } });
    }
    // Order flow milestones (18 Nov 2026): late or due soon; filled ones (indents, vendor orders…) count as done.
    if (jo.milestones?.length) {
      const msLink = `${link}?tab=milestones`;
      const ms = milestoneSummary(jo, today, ctx);
      for (const v of [...ms.before, ...ms.after]) {
        if ((v.state !== 'LATE' && v.state !== 'OPEN') || !v.due) continue;
        const w = when(v.due);
        if (!w) continue;
        items.push({ when: w, date: v.due, text: w === 'OVERDUE' ? `${jo.joNumber}: ${v.m.name} - was due ${formatDay(v.due)}` : `${jo.joNumber}: ${v.m.name} - due ${day(v.due)}`, link: msLink, area: v.m.departmentId ? { kind: 'DEPT', id: v.m.departmentId } : ORDER_AREA, open: { label: 'Open milestones', link: msLink }, followUp: { joId: jo.id, joNumber: jo.joNumber } });
      }
    }
    for (const { line, lp } of lineProgresses(jo, today, ctx)) {
      const stepLink = (key: string) => `${link}?tab=products&line=${encodeURIComponent(line.id)}&step=${encodeURIComponent(key)}`;
      // Indent targets of in-house steps (17 Nov 2026): "required by" passed or coming up.
      for (const v of lp.steps) {
        const rb = v.step.requiredBy;
        if (!rb || v.state === 'DONE') continue;
        const w = rb < today ? 'OVERDUE' : when(rb);
        if (!w) continue;
        const what = `${jo.joNumber} · ${line.productName}: ${v.step.label}${v.step.indentNo ? ` (indent ${v.step.indentNo})` : ''}`;
        items.push({ when: w, date: rb, text: rb < today ? `${what} required by ${formatDay(rb)} - not done yet` : `${what} required by ${day(rb)}`, link: stepLink(v.step.key), area: processArea(v.step.processId), open: { label: 'Open step', link: stepLink(v.step.key) }, act: { kind: 'STEP', joId: jo.id, lineId: line.id, stepKey: v.step.key }, followUp: { joId: jo.id, joNumber: jo.joNumber } });
      }
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
        items.push({ when: 'OVERDUE', date: null, text: `${name} running ${formatQty(cur.overrunDays!)} working day${cur.overrunDays === 1 ? '' : 's'} over plan`, link: stepLink(cur.step.key), step, area, open: { label: 'Open step', link: stepLink(cur.step.key) }, act: { kind: 'STEP', joId: jo.id, lineId: line.id, stepKey: cur.step.key }, followUp: { joId: jo.id, joNumber: jo.joNumber } });
      } else if (end) {
        const ew = when(end);
        if (ew === 'TODAY' || ew === 'SOON') items.push({ when: ew, date: end, text: `${name} should finish ${day(end)}`, link: stepLink(cur.step.key), step, area, open: { label: 'Open step', link: stepLink(cur.step.key) }, act: { kind: 'STEP', joId: jo.id, lineId: line.id, stepKey: cur.step.key }, followUp: { joId: jo.id, joNumber: jo.joNumber } });
      }
    }
  }

  // Steps starting soon that are not ready, and what is awaited from outside.
  if (args.processes) {
    const stepOf = (c: { joId: string; lineId: string; stepKey: string }) => `/orders/${c.joId}?tab=products&line=${encodeURIComponent(c.lineId)}&step=${encodeURIComponent(c.stepKey)}`;
    for (const c of startChecks(args.jobOrders, ctx, today, args.processes, args.suppliers ?? new Map(), args.alertDays)) {
      if (c.ready) continue;
      const w: TodayWhen = c.start <= today ? 'OVERDUE' : 'SOON';
      items.push({ when: w, date: c.start, text: `${c.joNumber} · ${c.product}: ${c.label} ${c.start <= today ? 'due to start' : `starts ${day(c.start)}`} - ready ${c.readyCount} of ${c.total}`, link: stepOf(c), area: processArea(c.processId), open: { label: 'Open step', link: stepOf(c) }, followUp: { joId: c.joId, joNumber: c.joNumber } });
    }
    const name = (id: string | null) => (id ? (args.suppliers?.get(id)?.name ?? 'supplier') : 'no supplier yet');
    for (const a of awaitedItems(args.jobOrders, ctx, today, args.alertDays)) {
      if (a.bucket === 'LATE') items.push({ when: 'OVERDUE', date: a.expectedOn, text: `${a.joNumber}: ${a.what} from ${name(a.supplierId)} ${a.lateDays} working day${a.lateDays === 1 ? '' : 's'} late (${a.outstanding})`, link: a.link, area: a.kind === 'JOB_WORK' ? processArea(a.processId) : PURCHASE_AREA, open: { label: 'Open', link: a.link }, act: { kind: 'AWAIT', joId: a.joId, target: a.target }, followUp: { joId: a.joId, joNumber: a.joNumber } });
      else if (a.bucket === 'SOON') items.push({ when: a.expectedOn === today ? 'TODAY' : 'SOON', date: a.expectedOn, text: `${a.joNumber}: ${a.what} expected from ${name(a.supplierId)} ${day(a.expectedOn!)} - confirm (${a.outstanding})`, link: a.link, area: a.kind === 'JOB_WORK' ? processArea(a.processId) : PURCHASE_AREA, open: { label: 'Open', link: a.link }, act: { kind: 'AWAIT', joId: a.joId, target: a.target }, followUp: { joId: a.joId, joNumber: a.joNumber } });
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
    items.push({ when: w, date: t.dueDate, text: `Task${t.priority === 'HIGH' ? ' [High]' : ''}: ${t.title}${who ? ` (${who})` : ''}${t.status === 'WAITING' ? ' · waiting' : ''}${lateBy}${at}`, link: `/work/${t.id}`, open: { label: 'Open task', link: `/work/${t.id}` }, act: { kind: 'TASK', taskId: t.id }, area: t.departmentId ? { kind: 'DEPT', id: t.departmentId } : ORDER_AREA });
  }

  if (args.backupDue) {
    items.push({ when: 'TODAY', date: null, text: args.backupDue.days === null ? 'Backup: none taken on this phone yet' : `Backup: last one ${args.backupDue.days} days ago`, link: '/settings', area: ORDER_AREA, open: { label: 'Back up now', link: '/settings' } });
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
  /** Open (not handled) items per when. */
  counts: Record<TodayWhen, number>;
  handled: number;
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
export function todayByDepartment(s: TodaySummary, departments: (Department & { id?: string })[], h?: HandledOf): TodayGroup[] {
  const groups = new Map<string, TodayGroup>();
  const add = (key: string, name: string, department: Department | null, item: TodayItem) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, name, department, items: [], counts: { OVERDUE: 0, TODAY: 0, SOON: 0 }, handled: 0 }));
    g.items.push(item);
    if (h?.(item)) g.handled++;
    else g.counts[item.when]++;
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

export function countsText(c: Record<TodayWhen, number>, handled = 0): string {
  return [
    ...(['OVERDUE', 'TODAY', 'SOON'] as TodayWhen[]).filter((w) => c[w] > 0).map((w) => `${c[w]} ${w === 'OVERDUE' ? 'overdue' : w === 'TODAY' ? 'today' : 'soon'}`),
    ...(handled ? [`${handled} handled`] : []),
  ].join(', ');
}

/** Marked "Handled" today (on the phone), with an optional note (17 Nov 2026). */
export interface HandledMark {
  at: string; // HH:MM
  note: string;
}
export type HandledOf = (i: TodayItem) => HandledMark | undefined;
/** A stable key of an item within one day. */
export const todayItemKey = (i: TodayItem) => `${i.link}|${i.text}`;
const line = (i: TodayItem, h?: HandledOf) => {
  const m = h?.(i);
  return m ? `• [Handled ${m.at}] ${i.text}${m.note ? ` - ${m.note}` : ''}` : `• [${TAG[i.when]}] ${i.text}`;
};
/** Open items first, handled ones last (keeping the order otherwise). */
export function handledLast(items: TodayItem[], h?: HandledOf): TodayItem[] {
  return h ? [...items.filter((i) => !h(i)), ...items.filter((i) => h(i))] : items;
}

/** One department's list, to send to its team leader (a draft the user sends). */
export function todayGroupText(g: TodayGroup, today: string, company: string, h?: HandledOf): string {
  return [`${g.name} · ${company ? `${company} · ` : ''}${formatDay(today)}`, '', ...handledLast(g.items, h).map((i) => line(i, h))].join('\n');
}

/** Plain text to paste into WhatsApp or email; by department when departments are given (16 Nov 2026). */
export function todayText(s: TodaySummary, company: string, departments?: (Department & { id?: string })[], h?: HandledOf): string {
  const out = [`${company ? `${company} · ` : ''}${formatDay(s.today)}`];
  if (s.items.length === 0) out.push('', 'Nothing due today or in the next 2 working days.');
  if (departments) {
    for (const g of todayByDepartment(s, departments, h)) out.push('', `${g.name} (${countsText(g.counts, g.handled)}):`, ...handledLast(g.items, h).map((i) => line(i, h)));
    return out.join('\n');
  }
  for (const w of ['OVERDUE', 'TODAY', 'SOON'] as TodayWhen[]) {
    const list = s.items.filter((i) => i.when === w);
    if (!list.length) continue;
    out.push('', `${HEAD[w]}:`, ...handledLast(list, h).map((i) => (h?.(i) ? line(i, h) : `• ${i.text}`)));
  }
  return out.join('\n');
}

export const TODAY_HEADINGS = HEAD;
