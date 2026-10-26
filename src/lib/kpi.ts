/**
 * KPIs (confirmed 26 Oct 2026): factory-wide and per department / process,
 * for any period, compared with the period just before it and with the
 * user's own targets (Settings). Built only from what the app records:
 * step done (and optional started) dates, planned days, quantities and the
 * department ↔ process links. Pure and deterministic.
 *
 * Step time = working time (started → done) when the start was recorded,
 * otherwise everything since the previous step finished (waiting included).
 */
import { addDays, daysBetween, type JobOrder } from './jobOrders';
import { workingDaysBetween } from './calendar';
import { departmentsFor } from './contacts';
import type { Department } from './masters';
import { buildPerformance, type JoHistoryEvent } from './performance';
import { DEFAULT_PLANNING_DAYS, lineProgresses, orderTrack, PLANNING_KEY, type PlanContext } from './route';
import { formatQty, unitLabel } from './units';

type Jo = JobOrder & { id: string };

export interface KpiTargets {
  onTimeDeliveryPct?: number | null;
  onTimeInternalPct?: number | null;
  planningOnTimePct?: number | null;
  onTimeStepPct?: number | null;
  efficiencyPct?: number | null;
  maxAvgDelayDays?: number | null;
  maxAvgWaitDays?: number | null;
}

/** Settings doc (per workspace) holding the targets. */
export const KPI_TARGETS_DOC = 'kpiTargets';

export const NO_DEPT = '__none';
export const PURCHASE = '__purchase';

/** One finished step as the KPIs see it. */
export interface KpiStep {
  joId: string;
  joNumber: string;
  product: string;
  label: string;
  processId: string | null;
  doneOn: string;
  planned: number | null;
  /** Working days counted for the process (work only when the start was recorded). */
  days: number;
  wait: number | null;
  timed: boolean; // start recorded
  qty: number | null;
  qtyUnit: string | null;
}

export interface GroupKpi {
  id: string; // department id, NO_DEPT or PURCHASE
  name: string;
  steps: number;
  onTimeSteps: number; // of steps with a plan
  plannedSteps: number;
  onTimePct: number | null;
  avgDelay: number | null; // working days over plan, per step with a plan (early = 0)
  efficiencyPct: number | null; // planned ÷ actual days
  avgWait: number | null; // over steps with a recorded start
  avgDays: number | null; // average working days per step (e.g. supplier lead time for bought items)
  startCoverage: number; // share of steps with a recorded start (0–1)
  lateOrderShare: number; // late orders whose biggest overrun was here
  runningNow: number;
  overNow: number;
  /** Per process; quantity handled is per process (summing different processes would count the same goods twice). */
  processes: { id: string; label: string; steps: number; onTimePct: number | null; efficiencyPct: number | null; avgDelay: number | null; throughput: { unit: string; qty: number }[] }[];
}

export interface FactoryKpi {
  completed: number;
  onTimeDeliveryPct: number | null;
  onTimeInternalPct: number | null;
  avgBufferUsed: number | null;
  /** Planning (received → confirmed) of orders CONFIRMED in the period, completed or not. */
  avgPlanningDays: number | null;
  planningConfirmed: number;
  planningOnTimePct: number | null; // within the planning benchmark; null when no benchmark is set
  avgChanges: number | null;
  onTimeStepPct: number | null;
  efficiencyPct: number | null;
  avgDelay: number | null;
  avgWait: number | null;
  openLate: number;
}

export interface KpiReport {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  factory: FactoryKpi;
  prev: FactoryKpi;
  groups: GroupKpi[];
  prevGroups: Map<string, GroupKpi>;
  /** Department with the most late orders, then the lowest on-time %. */
  worstGroup: string | null;
  steps: number;
  /** Orders confirmed in the period, slowest planning first. */
  planning: PlanningRow[];
  planningBenchmark: number | null;
}

export interface PlanningRow {
  joId: string;
  joNumber: string;
  received: string;
  confirmed: string;
  days: number;
  over: boolean;
}

/** Planning time of every order confirmed in the period (working days, received → confirmed). */
export function planningRows(jobOrders: Jo[], ctx: PlanContext, from: string, to: string): PlanningRow[] {
  const bench = ctx.planningDays === undefined ? DEFAULT_PLANNING_DAYS : ctx.planningDays;
  return jobOrders
    .filter((j) => j.status !== 'DRAFT' && j.confirmedOn && j.confirmedOn >= from && j.confirmedOn <= to)
    .map((j) => {
      const days = Math.max(0, workingDaysBetween(j.receivedDate, j.confirmedOn!, ctx.cal) ?? 0);
      return { joId: j.id, joNumber: j.joNumber, received: j.receivedDate, confirmed: j.confirmedOn!, days, over: bench !== null && days > bench };
    })
    .sort((a, b) => b.days - a.days || a.joNumber.localeCompare(b.joNumber));
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : null);
const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
/** Actual days for efficiency: a step finished the same day counts as half a day. */
const effDays = (d: number) => Math.max(0.5, d);

/** Finished steps in the period (process steps and the built-in purchase steps; not Planning). */
export function finishedSteps(jobOrders: Jo[], ctx: PlanContext, from: string, to: string, today: string): KpiStep[] {
  const out: KpiStep[] = [];
  for (const jo of jobOrders) {
    if (jo.status === 'DRAFT' || jo.status === 'CANCELLED') continue;
    const at = jo.status === 'COMPLETED' && jo.completedOn ? jo.completedOn : today;
    for (const { line, lp } of lineProgresses(jo, at, ctx)) {
      for (const v of lp.steps) {
        if (v.step.key === PLANNING_KEY || v.state !== 'DONE' || !v.doneOn || v.doneOn < from || v.doneOn > to) continue;
        out.push({
          joId: jo.id,
          joNumber: jo.joNumber,
          product: v.step.forProduct || line.productName,
          label: v.step.label,
          processId: v.step.processId,
          doneOn: v.doneOn,
          planned: v.step.plannedDays,
          days: v.workDays ?? v.actualDays ?? 0,
          wait: v.waitDays,
          timed: v.workDays !== null,
          qty: v.step.qty,
          qtyUnit: v.step.qtyUnit,
        });
      }
    }
  }
  return out;
}

function stepStats(list: KpiStep[]) {
  const planned = list.filter((s) => s.planned !== null);
  const onTime = planned.filter((s) => s.days <= s.planned!).length;
  const effBase = planned.filter((s) => s.planned! > 0);
  const plannedSum = effBase.reduce((a, s) => a + s.planned!, 0);
  const actualSum = effBase.reduce((a, s) => a + effDays(s.days), 0);
  const waits = list.filter((s) => s.wait !== null).map((s) => s.wait!);
  return {
    plannedSteps: planned.length,
    onTimeSteps: onTime,
    onTimePct: pct(onTime, planned.length),
    avgDelay: avg(planned.map((s) => Math.max(0, s.days - s.planned!))),
    efficiencyPct: actualSum > 0 ? Math.round((plannedSum / actualSum) * 100) : null,
    avgWait: avg(waits),
    startCoverage: list.length ? waits.length / list.length : 0,
    avgDays: avg(list.map((s) => s.days)),
  };
}

function groupOf(processId: string | null, departments: (Department & { id: string })[]): { id: string; name: string }[] {
  if (processId === null) return [{ id: PURCHASE, name: 'Bought items (ordered / received)' }];
  const ds = departmentsFor(processId, departments);
  return ds.length ? ds.map((d) => ({ id: d.id, name: d.name })) : [{ id: NO_DEPT, name: 'No department linked' }];
}

function periodKpi(args: { jobOrders: Jo[]; ctx: PlanContext; from: string; to: string; today: string; departments: (Department & { id: string })[]; processNames: Map<string, string>; history: JoHistoryEvent[]; current: boolean }) {
  const { jobOrders, ctx, from, to, today, departments } = args;
  const steps = finishedSteps(jobOrders, ctx, from, to, today);
  const perf = buildPerformance({ jobOrders, ctx, from, to, today, history: args.history });
  const s = perf.summary;
  const all = stepStats(steps.filter((x) => x.processId !== null));

  // Late orders: completed in the period after the internal deadline (+ open orders already late, for the current period).
  const lateOrders: Jo[] = jobOrders.filter(
    (j) => (j.status === 'COMPLETED' && j.completedOn && j.completedOn >= from && j.completedOn <= to && j.completedOn > j.deadline.internalDeadline) || (args.current && j.status === 'CONFIRMED' && j.deadline.internalDeadline < today),
  );
  const blame = new Map<string, number>();
  for (const jo of lateOrders) {
    const at = jo.status === 'COMPLETED' && jo.completedOn ? jo.completedOn : today;
    let worst: { processId: string | null; over: number } | null = null;
    for (const { lp } of lineProgresses(jo, at, ctx)) {
      for (const v of lp.steps) {
        if (v.step.key === PLANNING_KEY || v.step.plannedDays === null || v.state === 'TODO') continue;
        const over = (v.workDays ?? v.actualDays ?? 0) - v.step.plannedDays;
        if (over > 0 && (!worst || over > worst.over)) worst = { processId: v.step.processId, over };
      }
    }
    if (worst) for (const g of groupOf(worst.processId, departments)) blame.set(g.id, (blame.get(g.id) ?? 0) + 1);
  }

  // Running now (current period only).
  const running = new Map<string, { now: number; over: number }>();
  if (args.current) {
    for (const jo of jobOrders) {
      if (jo.status !== 'CONFIRMED') continue;
      for (const { lp } of lineProgresses(jo, today, ctx)) {
        const c = lp.current;
        if (!c || c.step.key === PLANNING_KEY) continue;
        const over = c.step.plannedDays !== null && (c.workDays ?? c.actualDays ?? 0) > c.step.plannedDays;
        for (const g of groupOf(c.step.processId, departments)) {
          const r = running.get(g.id) ?? { now: 0, over: 0 };
          r.now += 1;
          if (over) r.over += 1;
          running.set(g.id, r);
        }
      }
    }
  }

  const byGroup = new Map<string, { name: string; list: KpiStep[] }>();
  for (const st of steps) for (const g of groupOf(st.processId, departments)) byGroup.set(g.id, { name: g.name, list: [...(byGroup.get(g.id)?.list ?? []), st] });
  for (const [id] of running) if (!byGroup.has(id)) byGroup.set(id, { name: id === NO_DEPT ? 'No department linked' : id === PURCHASE ? 'Bought items (ordered / received)' : (departments.find((d) => d.id === id)?.name ?? id), list: [] });

  const groups: GroupKpi[] = [...byGroup.entries()].map(([id, { name, list }]) => {
    const st = stepStats(list);
    const qtyOf = (l: KpiStep[]) => {
      const units = new Map<string, number>();
      for (const x of l) if (x.qty !== null && x.qtyUnit && x.qty > 0) units.set(x.qtyUnit, (units.get(x.qtyUnit) ?? 0) + x.qty);
      return [...units.entries()].map(([unit, qty]) => ({ unit, qty }));
    };
    const procs = new Map<string, KpiStep[]>();
    for (const x of list) {
      const k = x.processId ?? x.label;
      procs.set(k, [...(procs.get(k) ?? []), x]);
    }
    return {
      id,
      name,
      steps: list.length,
      ...st,
      lateOrderShare: blame.get(id) ?? 0,
      runningNow: running.get(id)?.now ?? 0,
      overNow: running.get(id)?.over ?? 0,
      processes: [...procs.entries()]
        .map(([pid, l]) => {
          const p = stepStats(l);
          return { id: pid, label: args.processNames.get(pid) ?? l[0]!.label, steps: l.length, onTimePct: p.onTimePct, efficiencyPct: p.efficiencyPct, avgDelay: p.avgDelay, throughput: qtyOf(l) };
        })
        .sort((a, b) => a.label.localeCompare(b.label)),
    };
  });
  const rank = (g: GroupKpi) => (g.id === NO_DEPT ? 2 : g.id === PURCHASE ? 1 : 0);
  groups.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  const completedPerf = perf.completed;
  const factory: FactoryKpi = {
    completed: s.completed,
    onTimeDeliveryPct: pct(s.onTimeDelivery, s.completed),
    onTimeInternalPct: pct(s.onTimeInternal, s.completed),
    avgBufferUsed: s.avgBufferUsed,
    ...(() => {
      const rows = planningRows(jobOrders, ctx, from, to);
      const bench = ctx.planningDays === undefined ? DEFAULT_PLANNING_DAYS : ctx.planningDays;
      return {
        avgPlanningDays: avg(rows.map((r) => r.days)),
        planningConfirmed: rows.length,
        planningOnTimePct: bench === null ? null : pct(rows.filter((r) => !r.over).length, rows.length),
      };
    })(),
    avgChanges: completedPerf.length ? avg(completedPerf.map((c) => c.changes.count)) : null,
    onTimeStepPct: all.onTimePct,
    efficiencyPct: all.efficiencyPct,
    avgDelay: all.avgDelay,
    avgWait: all.avgWait,
    openLate: args.current ? jobOrders.filter((j) => j.status === 'CONFIRMED' && orderTrack(j, today, ctx).kind === 'LATE').length : 0,
  };
  return { factory, groups, steps: steps.length };
}

export function buildKpis(args: {
  jobOrders: Jo[];
  ctx: PlanContext;
  from: string;
  to: string;
  today: string;
  departments: (Department & { id: string })[];
  processNames: Map<string, string>;
  history: JoHistoryEvent[];
}): KpiReport {
  const len = Math.max(1, (daysBetween(args.from, args.to) ?? 0) + 1);
  const prevTo = addDays(args.from, -1)!;
  const prevFrom = addDays(prevTo, -(len - 1))!;
  const cur = periodKpi({ ...args, current: true });
  const prev = periodKpi({ ...args, from: prevFrom, to: prevTo, current: false });
  const real = cur.groups.filter((g) => g.id !== NO_DEPT && g.id !== PURCHASE && g.steps > 0);
  const worst = [...real].sort((a, b) => b.lateOrderShare - a.lateOrderShare || (a.onTimePct ?? 101) - (b.onTimePct ?? 101))[0];
  return {
    from: args.from,
    to: args.to,
    prevFrom,
    prevTo,
    factory: cur.factory,
    prev: prev.factory,
    groups: cur.groups,
    prevGroups: new Map(prev.groups.map((g) => [g.id, g])),
    worstGroup: worst && (worst.lateOrderShare > 0 || (worst.onTimePct ?? 100) < 100) ? worst.name : null,
    steps: cur.steps,
    planning: planningRows(args.jobOrders, args.ctx, args.from, args.to),
    planningBenchmark: args.ctx.planningDays === undefined ? DEFAULT_PLANNING_DAYS : args.ctx.planningDays,
  };
}

// ---------------------------------------------------------------------------
// Targets and display
// ---------------------------------------------------------------------------

export type KpiTone = 'ok' | 'warn' | 'bad' | null;

/** Colour against a target: met = ok, within 10% of it = warn, otherwise bad. No target = no colour. */
export function toneFor(value: number | null, target: number | null | undefined, higherIsBetter: boolean): KpiTone {
  if (value === null || target === null || target === undefined || !Number.isFinite(target)) return null;
  if (higherIsBetter) return value >= target ? 'ok' : value >= target * 0.9 ? 'warn' : 'bad';
  return value <= target ? 'ok' : value <= target * 1.1 + 0.25 ? 'warn' : 'bad';
}

export function delta(cur: number | null, prev: number | null): number | null {
  return cur === null || prev === null ? null : round1(cur - prev);
}

export const fmtPct = (n: number | null) => (n === null ? '—' : `${n}%`);
export const fmtDays = (n: number | null) => (n === null ? '—' : `${formatQty(n)} d`);
export const fmtThroughput = (t: { unit: string; qty: number }[]) => (t.length ? t.map((x) => `${formatQty(x.qty)} ${unitLabel(x.unit)}`).join(' · ') : '—');

/** Plain text to paste into WhatsApp or email. */
export function kpiText(r: KpiReport, company: string, fmtDay: (d: string) => string): string {
  const f = r.factory;
  const d = (cur: number | null, prev: number | null, unit: string) => {
    const x = delta(cur, prev);
    return x === null || x === 0 ? '' : ` (${x > 0 ? '+' : ''}${formatQty(x)}${unit} vs previous)`;
  };
  const out = [
    `KPIs · ${company ? `${company} · ` : ''}${fmtDay(r.from)} - ${fmtDay(r.to)}`,
    '',
    `Orders completed: ${f.completed}`,
    `On-time delivery: ${fmtPct(f.onTimeDeliveryPct)}${d(f.onTimeDeliveryPct, r.prev.onTimeDeliveryPct, ' pts')}`,
    `By internal deadline: ${fmtPct(f.onTimeInternalPct)}${d(f.onTimeInternalPct, r.prev.onTimeInternalPct, ' pts')}`,
    `Steps on time: ${fmtPct(f.onTimeStepPct)}${d(f.onTimeStepPct, r.prev.onTimeStepPct, ' pts')}`,
    `Efficiency (planned ÷ actual time): ${fmtPct(f.efficiencyPct)}`,
    `Average delay per step: ${fmtDays(f.avgDelay)} · average wait before a step: ${fmtDays(f.avgWait)}`,
    `Open orders late now: ${f.openLate}`,
    `Planning (orders confirmed in the period): ${f.planningConfirmed} · average ${fmtDays(f.avgPlanningDays)}${f.planningOnTimePct !== null ? ` · within ${r.planningBenchmark} working day benchmark ${fmtPct(f.planningOnTimePct)}` : ''}`,
    ...r.planning.filter((p) => p.over).map((p) => `  - ${p.joNumber}: ${formatQty(p.days)} working days (benchmark ${r.planningBenchmark})`),
  ];
  for (const g of r.groups) {
    out.push('', `${g.name}: ${g.steps} steps · on time ${fmtPct(g.onTimePct)} · efficiency ${fmtPct(g.efficiencyPct)} · avg delay ${fmtDays(g.avgDelay)}${g.lateOrderShare ? ` · main delay in ${g.lateOrderShare} late order${g.lateOrderShare === 1 ? '' : 's'}` : ''}${g.runningNow ? ` · ${g.runningNow} running now (${g.overNow} over plan)` : ''}`);
  }
  return out.join('\n');
}
