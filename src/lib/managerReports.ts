/**
 * Manager reports (confirmed 21 Oct 2026), built only from data already in
 * the app: delivery schedule, orders at risk, management summary, department
 * work list, stock allocation and To buy by supplier. Pure and deterministic;
 * nothing is estimated — unknown values stay unknown.
 */
import { addWorkingDays, weekday, workingDaysBetween } from './calendar';
import { departmentsFor } from './contacts';
import { addDays, daysBetween, DELIVERY_DATE_TYPES, formatDay, type JobOrder } from './jobOrders';
import type { Department, MasterData, Supplier } from './masters';
import { allocationFor, parseItemKey, stockCountId, type AllocationState, type BuyTotal, type StockCount } from './materials';
import { trackGroup, trackLabel, type Track } from './progress';
import { DEFAULT_PLANNING_DAYS, lineProgresses, lineSchedule, orderTrack, PLANNING_KEY, type PlanContext } from './route';
import { formatQty, unitLabel } from './units';

type Jo = JobOrder & { id: string };
const open = (jo: Pick<JobOrder, 'status'>) => jo.status === 'DRAFT' || jo.status === 'CONFIRMED';
const plural = (n: number, word: string) => `${formatQty(n)} ${word}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------------------
// Outlook of one order (shared by the reports)
// ---------------------------------------------------------------------------

export type Fits = 'YES' | 'NO' | 'UNKNOWN' | 'DRAFT' | 'DONE';

export interface OrderOutlook {
  track: Track;
  /** Latest planned finish of all products; null when any time is unknown or no steps exist. */
  expectedFinish: string | null;
  /** Working days from expected finish to the internal deadline (negative = after it). */
  spareDays: number | null;
  fits: Fits;
  /** "Product: step" running now, per line. */
  now: string[];
  /** Steps running over plan. */
  overruns: { product: string; step: string; days: number }[];
}

export function orderOutlook(jo: JobOrder, today: string, ctx: PlanContext): OrderOutlook {
  const track = orderTrack(jo, today, ctx);
  if (jo.status === 'DRAFT') return { track, expectedFinish: null, spareDays: null, fits: 'DRAFT', now: [], overruns: [] };
  if (jo.status === 'COMPLETED') return { track, expectedFinish: jo.completedOn ?? null, spareDays: null, fits: 'DONE', now: [], overruns: [] };
  const lps = lineProgresses(jo, today, ctx);
  const finishes = lps.map(({ lp }) => lineSchedule(lp, today, ctx.cal).at(-1)?.finish ?? null);
  const expectedFinish = finishes.length && finishes.every((f) => f) ? (finishes as string[]).sort().at(-1)! : null;
  const spareDays = expectedFinish ? workingDaysBetween(expectedFinish, jo.deadline.internalDeadline, ctx.cal) : null;
  const now = lps.map(({ line, lp }) => `${line.productName}: ${lp.current ? lp.current.step.label : 'done'}`);
  const overruns = lps
    .filter(({ lp }) => lp.current && lp.current.step.key !== PLANNING_KEY && (lp.current.overrunDays ?? 0) > 0)
    .map(({ line, lp }) => ({ product: lp.current!.step.forProduct || line.productName, step: lp.current!.step.label, days: lp.current!.overrunDays! }));
  return { track, expectedFinish, spareDays, fits: spareDays === null ? 'UNKNOWN' : spareDays >= 0 ? 'YES' : 'NO', now, overruns };
}

export const FITS_LABEL: Record<Fits, string> = { YES: 'Yes', NO: 'No', UNKNOWN: 'Unknown', DRAFT: 'Draft', DONE: 'Done' };

// ---------------------------------------------------------------------------
// 1. Delivery schedule
// ---------------------------------------------------------------------------

export interface DeliveryRow {
  joId: string;
  joNumber: string;
  customer: string;
  status: JobOrder['status'];
  deliveryDate: string;
  deliveryType: string;
  internalDeadline: string;
  /** Calendar days to delivery (negative = passed). */
  daysLeft: number;
  outlook: OrderOutlook;
  progress: string;
}

export function deliverySchedule(args: { jobOrders: Jo[]; ctx: PlanContext; today: string; from: string; to: string }): { from: string; to: string; rows: DeliveryRow[] } {
  const { today, ctx, from, to } = args;
  const rows: DeliveryRow[] = [];
  for (const jo of args.jobOrders) {
    if (!open(jo)) continue;
    const d = jo.deliveryDate;
    // In the period, or already passed while still open (always shown first).
    if (!(d <= to && (d >= from || d < today))) continue;
    const outlook = orderOutlook(jo, today, ctx);
    rows.push({
      joId: jo.id,
      joNumber: jo.joNumber,
      customer: jo.customerName,
      status: jo.status,
      deliveryDate: d,
      deliveryType: DELIVERY_DATE_TYPES.find((t) => t.id === jo.deliveryDateType)?.label ?? '—',
      internalDeadline: jo.deadline.internalDeadline,
      daysLeft: daysBetween(today, d) ?? 0,
      outlook,
      progress: progressText(outlook.track),
    });
  }
  rows.sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate) || a.joNumber.localeCompare(b.joNumber));
  return { from, to, rows };
}

export function progressText(t: Track): string {
  if (t.kind === 'DRAFT') return 'Draft';
  if (t.kind === 'NOT_TRACKED') return 'Not tracked';
  const actual = t.actual === null ? '—' : `${t.actual}%`;
  return `${actual} (plan ${t.planned}%) · ${trackLabel(t)}`;
}

// ---------------------------------------------------------------------------
// 2. Orders at risk
// ---------------------------------------------------------------------------

export type RiskLevel = 'LATE' | 'HIGH' | 'WATCH';
const LEVEL_ORDER: Record<RiskLevel, number> = { LATE: 0, HIGH: 1, WATCH: 2 };
export const RISK_LABEL: Record<RiskLevel, string> = { LATE: 'Late', HIGH: 'At risk', WATCH: 'Watch' };

export interface RiskItem {
  joId: string;
  joNumber: string;
  customer: string;
  level: RiskLevel;
  reasons: string[];
  internalDeadline: string;
  deliveryDate: string;
}

export function atRiskOrders(args: { jobOrders: Jo[]; ctx: PlanContext; today: string; redAt: number }): RiskItem[] {
  const { today, ctx, redAt } = args;
  const cal = ctx.cal;
  const planningDays = ctx.planningDays === undefined ? DEFAULT_PLANNING_DAYS : ctx.planningDays;
  const out: RiskItem[] = [];
  for (const jo of args.jobOrders) {
    if (!open(jo)) continue;
    const reasons: { level: RiskLevel; text: string }[] = [];
    if (jo.deliveryDate < today) reasons.push({ level: 'LATE', text: `Customer delivery date passed (${formatDay(jo.deliveryDate)})` });
    if (jo.status === 'DRAFT') {
      const used = workingDaysBetween(jo.receivedDate, today, cal) ?? 0;
      if (planningDays !== null && used > planningDays) reasons.push({ level: 'HIGH', text: `Still in planning after ${plural(used, 'working day')} (benchmark ${formatQty(planningDays)})` });
    } else {
      const late = daysBetween(jo.deadline.internalDeadline, today) ?? 0;
      if (late > 0) reasons.push({ level: 'LATE', text: `Internal deadline passed ${plural(late, 'day')} ago (${formatDay(jo.deadline.internalDeadline)})` });
      const o = orderOutlook(jo, today, ctx);
      if (late <= 0 && o.spareDays !== null && o.spareDays < 0)
        reasons.push({ level: 'HIGH', text: `Expected finish ${formatDay(o.expectedFinish)} is ${plural(-o.spareDays, 'working day')} after the internal deadline` });
      const t = o.track;
      if (t.kind === 'TRACKED' && t.gap !== null && t.gap < 0)
        reasons.push({ level: -t.gap >= redAt ? 'HIGH' : 'WATCH', text: `${-t.gap}% behind plan (done ${t.actual}%, plan ${t.planned}%)` });
      for (const r of o.overruns) reasons.push({ level: 'WATCH', text: `${r.product} · ${r.step} running ${plural(r.days, 'working day')} over plan` });
      if (t.kind === 'NOT_TRACKED') reasons.push({ level: 'WATCH', text: 'Progress not tracked - cannot tell if it is on time' });
    }
    if (!reasons.length) continue;
    const level = reasons.map((r) => r.level).sort((a, b) => LEVEL_ORDER[a] - LEVEL_ORDER[b])[0]!;
    out.push({ joId: jo.id, joNumber: jo.joNumber, customer: jo.customerName, level, reasons: reasons.map((r) => r.text), internalDeadline: jo.deadline.internalDeadline, deliveryDate: jo.deliveryDate });
  }
  return out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.internalDeadline.localeCompare(b.internalDeadline) || a.joNumber.localeCompare(b.joNumber));
}

export function riskText(items: RiskItem[], company: string, today: string): string {
  const out = [`Orders at risk · ${company ? `${company} · ` : ''}${formatDay(today)}`];
  if (!items.length) out.push('', 'No open order is late or at risk.');
  for (const lv of ['LATE', 'HIGH', 'WATCH'] as RiskLevel[]) {
    const list = items.filter((i) => i.level === lv);
    if (!list.length) continue;
    out.push('', `${RISK_LABEL[lv]}:`);
    for (const i of list) out.push(`• ${i.joNumber} (${i.customer || '—'}): ${i.reasons.join('; ')}`);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// 3. Management summary (any period; weeks run Monday–Sunday)
// ---------------------------------------------------------------------------

export type PeriodPreset = 'this-week' | 'last-week' | 'this-month' | 'last-month';

export function periodRange(p: PeriodPreset, today: string): { from: string; to: string } {
  const wd = weekday(today) ?? 1;
  const monday = addDays(today, -((wd + 6) % 7))!;
  const month = today.slice(0, 7);
  switch (p) {
    case 'this-week':
      return { from: monday, to: addDays(monday, 6)! };
    case 'last-week':
      return { from: addDays(monday, -7)!, to: addDays(monday, -1)! };
    case 'this-month': {
      const next = addDays(`${month}-28`, 4)!.slice(0, 7);
      return { from: `${month}-01`, to: addDays(`${next}-01`, -1)! };
    }
    case 'last-month': {
      const last = addDays(`${month}-01`, -1)!;
      return { from: `${last.slice(0, 7)}-01`, to: last };
    }
  }
}

export interface ManagementSummary {
  from: string;
  to: string;
  today: string;
  received: { count: number; cancelledSince: number };
  confirmed: number;
  completed: { count: number; onTimeInternal: number; onTimeDelivery: number; list: { joNumber: string; customer: string; completedOn: string; internal: string; delivery: string }[] };
  openNow: { drafts: number; onTrack: number; behind: number; late: number; notTracked: number };
  nextDeliveries: DeliveryRow[];
  risks: RiskItem[];
  riskTotal: number;
}

export const NEXT_DELIVERY_DAYS = 7;
export const TOP_RISKS = 5;

export function managementSummary(args: { jobOrders: Jo[]; ctx: PlanContext; today: string; from: string; to: string; redAt: number }): ManagementSummary {
  const { jobOrders, ctx, today, from, to } = args;
  const inRange = (d: string | null | undefined) => !!d && d >= from && d <= to;
  const received = jobOrders.filter((j) => inRange(j.receivedDate));
  const done = jobOrders.filter((j) => j.status === 'COMPLETED' && inRange(j.completedOn)).sort((a, b) => a.completedOn!.localeCompare(b.completedOn!));
  const openNow = { drafts: 0, onTrack: 0, behind: 0, late: 0, notTracked: 0 };
  for (const j of jobOrders) {
    if (j.status === 'DRAFT') openNow.drafts++;
    else if (j.status === 'CONFIRMED') {
      const g = trackGroup(orderTrack(j, today, ctx));
      if (g === 'ON_TRACK') openNow.onTrack++;
      else if (g === 'BEHIND') openNow.behind++;
      else if (g === 'LATE') openNow.late++;
      else openNow.notTracked++;
    }
  }
  const risks = atRiskOrders({ jobOrders, ctx, today, redAt: args.redAt });
  return {
    from,
    to,
    today,
    received: { count: received.length, cancelledSince: received.filter((j) => j.status === 'CANCELLED').length },
    confirmed: jobOrders.filter((j) => j.status !== 'CANCELLED' && inRange(j.confirmedOn)).length,
    completed: {
      count: done.length,
      onTimeInternal: done.filter((j) => j.completedOn! <= j.deadline.internalDeadline).length,
      onTimeDelivery: done.filter((j) => j.completedOn! <= j.deliveryDate).length,
      list: done.map((j) => ({ joNumber: j.joNumber, customer: j.customerName, completedOn: j.completedOn!, internal: j.deadline.internalDeadline, delivery: j.deliveryDate })),
    },
    openNow,
    nextDeliveries: deliverySchedule({ jobOrders, ctx, today, from: today, to: addDays(today, NEXT_DELIVERY_DAYS - 1)! }).rows.filter((r) => r.deliveryDate >= today),
    risks: risks.slice(0, TOP_RISKS),
    riskTotal: risks.length,
  };
}

const pctOf = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—');

export function summaryText(s: ManagementSummary, company: string): string {
  const o = s.openNow;
  const out = [
    `Management summary · ${company ? `${company} · ` : ''}${formatDay(s.from)} - ${formatDay(s.to)}`,
    '',
    `Orders received: ${s.received.count}${s.received.cancelledSince ? ` (${s.received.cancelledSince} since cancelled)` : ''}`,
    `Orders confirmed: ${s.confirmed}`,
    `Orders completed: ${s.completed.count}${s.completed.count ? ` · by internal deadline ${pctOf(s.completed.onTimeInternal, s.completed.count)} · before delivery ${pctOf(s.completed.onTimeDelivery, s.completed.count)}` : ''}`,
    '',
    `Open now (${formatDay(s.today)}): ${o.onTrack} on track · ${o.behind} behind · ${o.late} late · ${o.notTracked} not tracked · ${o.drafts} in planning`,
  ];
  out.push('', `Deliveries in the next ${NEXT_DELIVERY_DAYS} days:`);
  if (!s.nextDeliveries.length) out.push('• None');
  for (const r of s.nextDeliveries) out.push(`• ${formatDay(r.deliveryDate)}: ${r.joNumber} (${r.customer || '—'}) · ${r.progress}`);
  out.push('', `Main risks${s.riskTotal > s.risks.length ? ` (${s.risks.length} of ${s.riskTotal})` : ''}:`);
  if (!s.risks.length) out.push('• None');
  for (const r of s.risks) out.push(`• ${r.joNumber}: ${r.reasons[0]}${r.reasons.length > 1 ? ` (+${r.reasons.length - 1} more)` : ''}`);
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// 6. Department work list
// ---------------------------------------------------------------------------

export const DEFAULT_WORK_DAYS = 5;
export const NO_DEPARTMENT = '__none';
export const PURCHASE_GROUP = '__purchase';

export interface WorkRow {
  joId: string;
  joNumber: string;
  product: string;
  step: string;
  quantity: string | null;
  state: 'NOW' | 'NEXT';
  start: string | null;
  finish: string | null;
  overrunDays: number | null;
  processId: string | null;
}

export interface WorkGroup {
  id: string; // department id, NO_DEPARTMENT or PURCHASE_GROUP
  name: string;
  rows: WorkRow[];
}

export function departmentWork(args: { jobOrders: Jo[]; ctx: PlanContext; today: string; days: number; departments: (Department & { id: string })[] }): { until: string; groups: WorkGroup[] } {
  const { ctx, today } = args;
  const until = addWorkingDays(today, Math.max(0, args.days), ctx.cal) ?? today;
  const rows: WorkRow[] = [];
  for (const jo of args.jobOrders) {
    if (jo.status !== 'CONFIRMED') continue;
    for (const { line, lp } of lineProgresses(jo, today, ctx)) {
      const sched = lineSchedule(lp, today, ctx.cal);
      sched.forEach((st, i) => {
        const v = st.view;
        if (v.state === 'DONE' || v.step.key === PLANNING_KEY) return;
        const prevIsNow = i > 0 && sched[i - 1]!.view.state === 'NOW';
        // Running now; starting within the window; or the very next step when its start is not known yet.
        const include = v.state === 'NOW' || (st.start !== null && st.start <= until) || (st.start === null && prevIsNow);
        if (!include) return;
        rows.push({
          joId: jo.id,
          joNumber: jo.joNumber,
          product: v.step.forProduct || line.productName,
          step: v.step.label,
          quantity: v.step.qty !== null && v.step.qtyUnit ? `${formatQty(v.step.qty)} ${unitLabel(v.step.qtyUnit)}` : null,
          state: v.state === 'NOW' ? 'NOW' : 'NEXT',
          start: st.start,
          finish: st.finish,
          overrunDays: v.state === 'NOW' ? v.overrunDays : null,
          processId: v.step.processId,
        });
      });
    }
  }
  const groups = new Map<string, WorkGroup>();
  const put = (id: string, name: string, r: WorkRow) => {
    const g = groups.get(id) ?? { id, name, rows: [] };
    g.rows.push(r);
    groups.set(id, g);
  };
  for (const r of rows) {
    if (r.processId === null) {
      put(PURCHASE_GROUP, 'Bought items (ordered / received)', r);
      continue;
    }
    const ds = departmentsFor(r.processId, args.departments);
    if (!ds.length) put(NO_DEPARTMENT, 'No department linked', r);
    for (const d of ds) put(d.id, d.name, r);
  }
  const rank = (g: WorkGroup) => (g.id === NO_DEPARTMENT ? 2 : g.id === PURCHASE_GROUP ? 1 : 0);
  const sorted = [...groups.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  for (const g of sorted)
    g.rows.sort((a, b) => (a.state === b.state ? 0 : a.state === 'NOW' ? -1 : 1) || (a.start ?? '9999').localeCompare(b.start ?? '9999') || a.joNumber.localeCompare(b.joNumber));
  return { until, groups: sorted };
}

export function workRowWhen(r: WorkRow): string {
  if (r.state === 'NOW') {
    const late = r.overrunDays !== null && r.overrunDays > 0 ? ` · ${plural(r.overrunDays, 'working day')} over plan` : '';
    return `Running now · finish ${r.finish ? formatDay(r.finish) : 'to be confirmed'}${late}`;
  }
  return `Starts ${r.start ? formatDay(r.start) : 'after the current step (date to be confirmed)'}${r.finish ? ` · finish ${formatDay(r.finish)}` : ''}`;
}

export function workText(groups: WorkGroup[], opts: { company: string; today: string; until: string }): string {
  const out = [`Work list · ${opts.company ? `${opts.company} · ` : ''}${formatDay(opts.today)} to ${formatDay(opts.until)}`];
  if (!groups.length) out.push('', 'No process steps running or due in this period.');
  for (const g of groups) {
    out.push('', `${g.name}:`);
    for (const r of g.rows) out.push(`• ${r.joNumber} · ${r.product}${r.quantity ? ` (${r.quantity})` : ''}: ${r.step} - ${workRowWhen(r)}`);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// 7. Stock allocation
// ---------------------------------------------------------------------------

export const OLD_COUNT_DAYS = 30;

export interface StockRow {
  key: string;
  name: string;
  type: 'PRODUCT' | 'RAW_MATERIAL';
  unit: string;
  counted: number | null;
  countedOn: string | null;
  countAgeDays: number | null;
  oldCount: boolean;
  confirmed: number;
  draft: number;
  /** Counted − set aside on confirmed orders (null without a count). */
  free: number | null;
  state: AllocationState;
  orders: { joId: string; joNumber: string; status: JobOrder['status']; qty: number }[];
}

export function stockAllocation(args: { jobOrders: Jo[]; counts: StockCount[]; md: MasterData; today: string; oldDays?: number }): StockRow[] {
  const { md, today } = args;
  const oldDays = args.oldDays ?? OLD_COUNT_DAYS;
  const countMap = new Map(args.counts.map((c) => [stockCountId(c.itemType, c.itemId), c]));
  const keys = new Set<string>();
  for (const jo of args.jobOrders) if (open(jo)) for (const [k, e] of Object.entries(jo.stock ?? {})) if (e.baseQty > 0) keys.add(k);
  for (const c of args.counts) keys.add(`${c.itemType}:${c.itemId}`);
  const rows: StockRow[] = [];
  for (const key of keys) {
    const p = parseItemKey(key);
    if (!p) continue;
    const item = p.type === 'PRODUCT' ? md.products.get(p.id) : md.rawMaterials.get(p.id);
    const count = countMap.get(stockCountId(p.type, p.id));
    const a = allocationFor(key, args.jobOrders, count);
    const age = a.countedOn ? daysBetween(a.countedOn, today) : null;
    rows.push({
      key,
      name: item?.name ?? `Missing item (${p.id})`,
      type: p.type,
      unit: item?.baseUnit ?? count?.unit ?? '',
      counted: a.counted,
      countedOn: a.countedOn,
      countAgeDays: age,
      oldCount: age !== null && age > oldDays,
      confirmed: a.confirmed,
      draft: a.draft,
      free: a.counted === null ? null : a.counted - a.confirmed,
      state: a.state,
      orders: args.jobOrders
        .filter((j) => open(j) && (j.stock?.[key]?.baseQty ?? 0) > 0)
        .map((j) => ({ joId: j.id, joNumber: j.joNumber, status: j.status, qty: j.stock![key]!.baseQty }))
        .sort((x, y) => x.joNumber.localeCompare(y.joNumber)),
    });
  }
  const rank = (r: StockRow) => (r.state === 'OVER' ? 0 : r.oldCount ? 1 : r.state === 'MANUAL_ONLY' ? 2 : 3);
  return rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// 8. To buy grouped by supplier
// ---------------------------------------------------------------------------

export interface SupplierGroup {
  id: string | null; // null = no supplier linked
  name: string;
  rows: { row: BuyTotal; others: string[] }[];
}

export function toBuyBySupplier(rows: BuyTotal[], suppliers: (Pick<Supplier, 'name' | 'items' | 'active'> & { id: string })[]): SupplierGroup[] {
  const active = suppliers.filter((s) => s.active !== false);
  const groups = new Map<string | null, SupplierGroup>();
  for (const r of rows) {
    const sup = active.filter((s) => (s.items ?? []).includes(r.key));
    if (!sup.length) {
      const g = groups.get(null) ?? { id: null, name: 'No supplier linked', rows: [] };
      g.rows.push({ row: r, others: [] });
      groups.set(null, g);
    }
    for (const s of sup) {
      const g = groups.get(s.id) ?? { id: s.id, name: s.name, rows: [] };
      g.rows.push({ row: r, others: sup.filter((x) => x.id !== s.id).map((x) => x.name) });
      groups.set(s.id, g);
    }
  }
  return [...groups.values()].sort((a, b) => (a.id === null ? 1 : 0) - (b.id === null ? 1 : 0) || a.name.localeCompare(b.name));
}
