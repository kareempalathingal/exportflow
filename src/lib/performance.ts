/**
 * JO performance report (confirmed 20–21 Oct 2026). Pure and deterministic:
 * the caller passes the orders, the plan context and the Job Order history.
 * Day counts are working days. Benchmark suggestions are suggestions only —
 * nothing here changes a product route.
 */
import type { FieldChange } from './audit';
import { isWorkingDayRule, type JobOrder } from './jobOrders';
import { workingDaysBetween } from './calendar';
import { plannedPct } from './progress';
import { lineProgresses, orderStart, orderTrack, type PlanContext } from './route';

export const SUGGEST_MIN_STEPS = 5;
export const SUGGEST_MIN_DIFF = 0.15;

export interface JoHistoryEvent {
  entityPath: string;
  at: string | null; // ISO; null = not yet confirmed by the server
  action: string;
  changes: FieldChange[];
}

export interface StepPerf {
  product: string;
  label: string;
  processId: string | null;
  planned: number | null;
  actual: number;
  overrun: number | null;
}

export interface JoPerf {
  id: string;
  joNumber: string;
  customerName: string;
  start: string;
  completedOn: string;
  internalDeadline: string;
  deliveryDate: string;
  /** Working days after the internal deadline (≤ 0 = on time). */
  vsInternal: number;
  /** Working days after the delivery date (≤ 0 = on time). */
  vsDelivery: number;
  bufferDays: number;
  bufferUsed: number;
  /** Working days from start to the internal deadline. */
  allowedDays: number;
  /** Working days from received to confirmed. */
  planningDays: number | null;
  /** Longest product route by plan, when every step has a time. */
  plannedDays: number | null;
  actualDays: number;
  steps: StepPerf[];
  slowest: StepPerf | null;
  worstGap: { gap: number; on: string } | null;
  changes: { count: number; fields: Record<string, number> };
  ruleNote: string | null;
}

export interface OpenPerf {
  id: string;
  joNumber: string;
  customerName: string;
  gap: number | null;
  late: boolean;
  internalDeadline: string;
}

export interface ProcessPerf {
  key: string;
  label: string;
  steps: number;
  plannedTotal: number;
  actualTotal: number;
  /** actual ÷ planned over all steps with a plan (1 = as planned). */
  ratio: number | null;
  suggestion: string | null;
}

export interface PerformanceReport {
  from: string;
  to: string;
  completed: JoPerf[];
  open: OpenPerf[];
  cancelled: number;
  summary: {
    completed: number;
    onTimeInternal: number;
    onTimeDelivery: number;
    avgLateDays: number | null; // over late orders (vs internal deadline)
    avgBufferUsed: number | null;
    avgPlanningDays: number | null;
  };
  processes: ProcessPerf[];
}

const CHANGE_LABEL: Record<string, string> = {
  lines: 'Products / quantities',
  deliveryDate: 'Delivery date',
  receivedDate: 'Received date',
  deliveryDateType: 'Delivery date type',
  deadline: 'Internal deadline',
  bomSnapshot: 'BOMs',
  stock: 'Stock set aside',
};

/** Order lines without the step tracking inside them (step updates are progress, not plan changes). */
function linesWithoutSteps(v: unknown): string {
  if (!Array.isArray(v)) return JSON.stringify(v ?? null);
  return JSON.stringify(v.map((l) => (l && typeof l === 'object' ? Object.fromEntries(Object.entries(l as Record<string, unknown>).filter(([k]) => k !== 'steps')) : l)));
}

/** Plan changes made after confirmation, from the order's history. */
export function changesAfterConfirm(events: JoHistoryEvent[], confirmedOn: string | null): { count: number; fields: Record<string, number> } {
  const fields: Record<string, number> = {};
  let count = 0;
  if (!confirmedOn) return { count, fields };
  for (const e of events) {
    if (e.action !== 'UPDATE') continue;
    if (e.at && e.at.slice(0, 10) < confirmedOn) continue;
    // The confirmation itself (status Draft → Confirmed) is not a change.
    if (e.changes.some((c) => c.field === 'status' && c.after === 'CONFIRMED' && c.before === 'DRAFT')) continue;
    let counted = false;
    for (const c of e.changes) {
      const label = CHANGE_LABEL[c.field];
      if (!label) continue;
      if (c.field === 'lines' && linesWithoutSteps(c.before) === linesWithoutSteps(c.after)) continue;
      fields[label] = (fields[label] ?? 0) + 1;
      counted = true;
    }
    if (counted) count++;
  }
  return { count, fields };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const round1 = (n: number) => Math.round(n * 10) / 10;
const niceRate = (n: number) => (n >= 100 ? Math.round(n / 10) * 10 : n >= 10 ? Math.round(n) : round1(n));

export function buildPerformance(args: {
  jobOrders: (JobOrder & { id: string })[];
  ctx: PlanContext;
  from: string;
  to: string;
  today: string;
  history: JoHistoryEvent[];
}): PerformanceReport {
  const { ctx, from, to, today } = args;
  const cal = ctx.cal;
  const byPath = new Map<string, JoHistoryEvent[]>();
  for (const e of args.history) {
    const id = e.entityPath.split('/').pop() ?? '';
    byPath.set(id, [...(byPath.get(id) ?? []), e]);
  }

  const completed: JoPerf[] = [];
  const allSteps: (StepPerf & { perDay: number | null; perDayUnit: string | null; fixedDays: number | null; qty: number | null; qtyUnit: string | null; doneOn: string })[] = [];

  for (const jo of args.jobOrders) {
    if (jo.status === 'DRAFT') continue;
    // Steps finished inside the range feed the process figures (completed and open orders alike).
    const at = jo.status === 'COMPLETED' && jo.completedOn ? jo.completedOn : today;
    for (const { line, lp } of lineProgresses(jo, at, ctx)) {
      for (const v of lp.steps) {
        if (v.state !== 'DONE' || !v.doneOn || v.doneOn < from || v.doneOn > to) continue;
        allSteps.push({
          product: v.step.forProduct || line.productName,
          label: v.step.label,
          processId: v.step.processId,
          planned: v.step.plannedDays,
          actual: v.actualDays ?? 0,
          overrun: v.overrunDays,
          perDay: v.step.perDay,
          perDayUnit: v.step.perDayUnit,
          fixedDays: v.step.fixedDays,
          qty: v.step.qty,
          qtyUnit: v.step.qtyUnit,
          doneOn: v.doneOn,
        });
      }
    }

    if (jo.status !== 'COMPLETED' || !jo.completedOn || jo.completedOn < from || jo.completedOn > to) continue;
    const start = orderStart(jo);
    const lps = lineProgresses(jo, jo.completedOn, ctx);
    const steps: StepPerf[] = lps.flatMap(({ line, lp }) =>
      lp.steps
        .filter((v) => v.state === 'DONE')
        .map((v) => ({ product: v.step.forProduct || line.productName, label: v.step.label, processId: v.step.processId, planned: v.step.plannedDays, actual: v.actualDays ?? 0, overrun: v.overrunDays })),
    );
    const slowest = steps.filter((s) => s.overrun !== null && s.overrun > 0).sort((a, b) => b.overrun! - a.overrun!)[0] ?? null;
    const timed = lps.length > 0 && lps.every(({ lp }) => lp.plannedTotalDays !== null);
    let worstGap: JoPerf['worstGap'] = null;
    for (const p of jo.progressLog ?? []) {
      if (!Number.isFinite(p.pct)) continue;
      const gap = p.pct - plannedPct(jo, p.on, cal);
      if (!worstGap || gap < worstGap.gap) worstGap = { gap, on: p.on };
    }
    const vsInternal = workingDaysBetween(jo.deadline.internalDeadline, jo.completedOn, cal) ?? 0;
    completed.push({
      id: jo.id,
      joNumber: jo.joNumber,
      customerName: jo.customerName,
      start,
      completedOn: jo.completedOn,
      internalDeadline: jo.deadline.internalDeadline,
      deliveryDate: jo.deliveryDate,
      vsInternal,
      vsDelivery: workingDaysBetween(jo.deliveryDate, jo.completedOn, cal) ?? 0,
      bufferDays: jo.deadline.bufferDays,
      bufferUsed: Math.min(jo.deadline.bufferDays, Math.max(0, vsInternal)),
      allowedDays: Math.max(0, workingDaysBetween(start, jo.deadline.internalDeadline, cal) ?? 0),
      planningDays: jo.confirmedOn ? Math.max(0, workingDaysBetween(jo.receivedDate, jo.confirmedOn, cal) ?? 0) : null,
      plannedDays: timed ? Math.max(...lps.map(({ lp }) => lp.plannedTotalDays!)) : null,
      actualDays: Math.max(0, workingDaysBetween(start, jo.completedOn, cal) ?? 0),
      steps,
      slowest,
      worstGap: worstGap && worstGap.gap < 0 ? worstGap : null,
      changes: changesAfterConfirm(byPath.get(jo.id) ?? [], jo.confirmedOn),
      ruleNote: isWorkingDayRule(jo.deadline) ? null : 'Deadline from the older calendar-day rule',
    });
  }
  completed.sort((a, b) => a.completedOn.localeCompare(b.completedOn) || a.joNumber.localeCompare(b.joNumber));

  const open: OpenPerf[] = args.jobOrders
    .filter((j) => j.status === 'CONFIRMED' && (j.confirmedOn ?? j.receivedDate) <= to)
    .map((j) => {
      const t = orderTrack(j, today, ctx);
      return { id: j.id, joNumber: j.joNumber, customerName: j.customerName, gap: t.gap, late: t.kind === 'LATE', internalDeadline: j.deadline.internalDeadline };
    })
    .sort((a, b) => Number(b.late) - Number(a.late) || (a.gap ?? 0) - (b.gap ?? 0));

  const cancelled = args.jobOrders.filter((j) => j.status === 'CANCELLED' && j.receivedDate >= from && j.receivedDate <= to).length;

  const late = completed.filter((c) => c.vsInternal > 0);
  const summary = {
    completed: completed.length,
    onTimeInternal: completed.length - late.length,
    onTimeDelivery: completed.filter((c) => c.vsDelivery <= 0).length,
    avgLateDays: late.length ? round1(late.reduce((a, c) => a + c.vsInternal, 0) / late.length) : null,
    avgBufferUsed: completed.length ? round1(completed.reduce((a, c) => a + c.bufferUsed, 0) / completed.length) : null,
    avgPlanningDays: (() => {
      const xs = completed.filter((c) => c.planningDays !== null).map((c) => c.planningDays!);
      return xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
    })(),
  };

  // Per process: planned vs actual, and a benchmark suggestion when the evidence is strong enough.
  const groups = new Map<string, typeof allSteps>();
  for (const s of allSteps) {
    if (!s.processId) continue; // built-in purchase steps have no benchmark
    groups.set(s.processId, [...(groups.get(s.processId) ?? []), s]);
  }
  const processes: ProcessPerf[] = [...groups.entries()].map(([key, list]) => {
    const withPlan = list.filter((s) => s.planned !== null);
    const plannedTotal = withPlan.reduce((a, s) => a + s.planned!, 0);
    const actualTotal = withPlan.reduce((a, s) => a + s.actual, 0);
    let suggestion: string | null = null;
    const rated = list.filter((s) => s.perDay !== null && s.qty !== null && s.qty > 0);
    if (rated.length >= SUGGEST_MIN_STEPS) {
      const current = median(rated.map((s) => s.perDay!));
      const actual = median(rated.map((s) => s.qty! / Math.max(0.5, s.actual - (s.fixedDays ?? 0))));
      if (Math.abs(actual / current - 1) >= SUGGEST_MIN_DIFF) {
        suggestion = `Planned ${niceRate(current)}/day, actual median ${niceRate(actual)}/day over ${rated.length} steps — consider ${niceRate(actual)}/day`;
      }
    } else {
      const fixedOnly = list.filter((s) => s.perDay === null && s.fixedDays !== null);
      if (fixedOnly.length >= SUGGEST_MIN_STEPS) {
        const current = median(fixedOnly.map((s) => s.fixedDays!));
        const actual = median(fixedOnly.map((s) => s.actual));
        if (current > 0 && Math.abs(actual / current - 1) >= SUGGEST_MIN_DIFF) {
          suggestion = `Planned ${round1(current)} days, actual median ${round1(actual)} days over ${fixedOnly.length} steps — consider ${round1(actual)} days`;
        }
      }
    }
    return { key, label: list[0]!.label, steps: list.length, plannedTotal, actualTotal, ratio: plannedTotal > 0 ? actualTotal / plannedTotal : null, suggestion };
  });
  processes.sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0) || a.label.localeCompare(b.label));

  return { from, to, completed, open, cancelled, summary, processes };
}
