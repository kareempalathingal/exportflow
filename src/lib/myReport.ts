/**
 * My report (confirmed 27 Oct 2026): a weekly / monthly report of my own work for my
 * superior, built only from what is recorded in the app — orders planned and
 * confirmed, progress, steps finished on time, delays found and how they ended, Work
 * follow-ups and escalations, KPIs against the previous period, and what comes next.
 * Highlights are suggestions the user edits. Nothing is inflated or invented.
 */
import { addDays, daysBetween, formatDay } from './dates';
import { workingDaysBetween } from './calendar';
import type { JobOrder } from './jobOrders';
import type { Department } from './masters';
import { buildKpis, fmtPct, toneFor, type KpiTargets, type KpiTone } from './kpi';
import { buildLookAhead } from './lookAhead';
import { orderOutlook } from './managerReports';
import type { JoHistoryEvent } from './performance';
import { DEFAULT_PLANNING_DAYS, lineProgresses, orderStepProgress, PLANNING_KEY, type PlanContext } from './route';
import { isActive, outcomeText, withTaskDefaults, type Task } from './tasks';
import { istDateKey } from './time';

type Jo = JobOrder & { id: string };
const dayOf = (iso: string) => istDateKey(new Date(iso));
const short = (d: string) => formatDay(d).replace(/ \d{4}$/, '');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export type Tone = 'ok' | 'warn' | 'bad' | null;

export interface MyReport {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  monthly: boolean;
  tiles: {
    confirmed: number;
    planningAvg: number | null;
    planningBench: number | null;
    stepsDone: number;
    stepsOnTime: number;
    stepsTimed: number;
    completed: number;
    completedOnTime: number;
    tasksDone: number;
    resolved: number;
    escalated: number;
  };
  orders: { joNumber: string; customer: string; progress: string; period: string; standing: string; tone: Tone }[];
  delays: { date: string; order: string; step: string; over: string; now: string; tone: Tone }[];
  followUps: { title: string; who: string; done: string; outcome: string; tone: Tone }[];
  openEscalations: { title: string; who: string; due: string }[];
  kpis: { label: string; cur: string; prev: string; target: string; tone: KpiTone }[];
  highlights: string[];
  next: string[];
}

/** The order as it was on `date`: steps done after it are not done yet. */
function asOf(jo: Jo, date: string): Jo {
  return { ...jo, lines: jo.lines.map((l) => (l.steps ? { ...l, steps: l.steps.map((s) => (s.doneAt && dayOf(s.doneAt) > date ? { ...s, doneAt: null, startedAt: null } : s.startedAt && dayOf(s.startedAt) > date ? { ...s, startedAt: null } : s)) } : l)) };
}

function standing(jo: Jo, today: string, ctx: PlanContext): { text: string; tone: Tone } {
  if (jo.status === 'COMPLETED') {
    const by = jo.completedOn ? workingDaysBetween(jo.completedOn, jo.deadline.internalDeadline, ctx.cal) : null;
    return by === null ? { text: 'done', tone: 'ok' } : by >= 0 ? { text: `done, ${plural(by, 'working day')} early`, tone: 'ok' } : { text: `done, ${plural(-by, 'working day')} late`, tone: 'bad' };
  }
  const o = orderOutlook(jo, today, ctx);
  if (o.spareDays === null) return { text: 'finish date to be confirmed', tone: null };
  if (o.spareDays < 0) return { text: `${plural(-o.spareDays, 'day')} late`, tone: 'bad' };
  if (o.spareDays <= 2) return { text: `${plural(o.spareDays, 'day')} spare - tight`, tone: 'warn' };
  return { text: `${plural(o.spareDays, 'day')} spare`, tone: 'ok' };
}

export function buildMyReport(args: {
  jobOrders: Jo[];
  ctx: PlanContext;
  from: string;
  to: string;
  today: string;
  monthly: boolean;
  departments: (Department & { id: string })[];
  processNames: Map<string, string>;
  history: JoHistoryEvent[];
  tasks: (Task & { id: string })[];
  targets: KpiTargets;
  deptName: (id: string) => string;
}): MyReport {
  const { ctx, from, to, today } = args;
  const end = to < today ? to : today;
  const kpi = buildKpis({ jobOrders: args.jobOrders, ctx, from, to, today, departments: args.departments, processNames: args.processNames, history: args.history });
  const bench = ctx.planningDays === undefined ? DEFAULT_PLANNING_DAYS : ctx.planningDays;
  const inRange = (d: string | null | undefined) => !!d && d >= from && d <= to;

  // Orders: open now, plus those confirmed or completed in the period.
  const relevant = args.jobOrders
    .filter((j) => j.status === 'CONFIRMED' || (j.status === 'COMPLETED' && inRange(j.completedOn)))
    .sort((a, b) => a.joNumber.localeCompare(b.joNumber));
  const confirmed = args.jobOrders.filter((j) => j.status !== 'DRAFT' && j.status !== 'CANCELLED' && inRange(j.confirmedOn));
  const completed = args.jobOrders.filter((j) => j.status === 'COMPLETED' && inRange(j.completedOn));
  const completedOnTime = completed.filter((j) => j.completedOn && j.completedOn <= j.deadline.internalDeadline).length;

  // Steps finished in the period, and steps that ran over plan.
  let stepsDone = 0;
  let stepsTimed = 0;
  let stepsOnTime = 0;
  const delays: MyReport['delays'] = [];
  const doneSteps = new Map<string, string[]>();
  for (const jo of args.jobOrders.filter((j) => j.status === 'CONFIRMED' || j.status === 'COMPLETED')) {
    const st = standing(jo, today, ctx);
    for (const { line, lp } of lineProgresses(jo, today, ctx)) {
      for (const v of lp.steps) {
        if (v.step.key === PLANNING_KEY) continue;
        const product = v.step.forProduct || line.productName;
        if (v.state === 'DONE' && inRange(v.doneOn)) {
          stepsDone++;
          doneSteps.set(jo.id, [...(doneSteps.get(jo.id) ?? []), v.step.label]);
          if (v.step.plannedDays !== null && v.overrunDays !== null) {
            stepsTimed++;
            if (v.overrunDays <= 0) stepsOnTime++;
            else delays.push({ date: v.doneOn!, order: jo.joNumber, step: `${v.step.label} · ${product}`, over: `${v.overrunDays} days over`, now: st.text, tone: st.tone });
          }
        }
        if (v.state === 'NOW' && to >= today && v.step.plannedDays !== null && (v.overrunDays ?? 0) > 0)
          delays.push({ date: today, order: jo.joNumber, step: `${v.step.label} · ${product} (running)`, over: `${v.overrunDays} days over`, now: st.text, tone: st.tone });
      }
    }
  }
  delays.sort((a, b) => a.date.localeCompare(b.date) || a.order.localeCompare(b.order));

  const orders: MyReport['orders'] = relevant.map((jo) => {
    const a = orderStepProgress(asOf(jo, addDays(from, -1)!), addDays(from, -1)!, ctx);
    const b = orderStepProgress(asOf(jo, end), end, ctx);
    const progress = a && b ? `${a.actual}% → ${b.actual}%` : b ? `${b.actual}%` : '—';
    const bits: string[] = [];
    if (inRange(jo.confirmedOn)) bits.push(`confirmed ${short(jo.confirmedOn!)}`);
    const ds = doneSteps.get(jo.id) ?? [];
    if (ds.length) bits.push(`${plural(ds.length, 'step')} done`);
    if (jo.status === 'COMPLETED' && inRange(jo.completedOn)) bits.push(`completed ${short(jo.completedOn!)}`);
    const st = standing(jo, today, ctx);
    return { joNumber: jo.joNumber, customer: jo.customerName, progress, period: bits.join(' · ') || 'no step finished', standing: st.text, tone: st.tone };
  });

  // Work follow-ups.
  const tasks = args.tasks.map((t) => ({ ...withTaskDefaults(t), id: t.id }));
  const who = (t: Task) => [t.departmentId ? args.deptName(t.departmentId) : 'General', t.person].filter(Boolean).join(' · ');
  const done = tasks.filter((t) => t.status === 'DONE' && inRange(t.doneOn)).sort((a, b) => (a.doneOn ?? '').localeCompare(b.doneOn ?? ''));
  const followUps: MyReport['followUps'] = done.map((t) => ({ title: t.title, who: who(t), done: short(t.doneOn!), outcome: outcomeText(t) || 'Done', tone: t.outcome === 'NOT_RESOLVED' ? 'warn' : 'ok' }));
  const escalated = done.filter((t) => t.nextStep === 'ESCALATE').length;
  const openEscalations = tasks.filter((t) => isActive(t) && t.fromTaskId).map((t) => ({ title: t.title, who: who(t), due: t.dueDate ? short(t.dueDate) : 'no date' }));

  // KPIs against the previous period of the same length.
  const f = kpi.factory;
  const p = kpi.prev;
  const row = (label: string, cur: number | null, prev: number | null, target: number | null | undefined, fmt: (n: number | null) => string, higher = true) => ({
    label,
    cur: fmt(cur),
    prev: fmt(prev),
    target: target === null || target === undefined ? '–' : fmt(target),
    tone: toneFor(cur, target, higher),
  });
  const kpis: MyReport['kpis'] = [
    row('Steps on time', f.onTimeStepPct, p.onTimeStepPct, args.targets.onTimeStepPct, fmtPct),
    row('Efficiency (planned ÷ actual time)', f.efficiencyPct, p.efficiencyPct, args.targets.efficiencyPct, fmtPct),
    row('Planning within benchmark', f.planningOnTimePct, p.planningOnTimePct, args.targets.planningOnTimePct, fmtPct),
    row('On-time delivery (orders completed)', f.onTimeDeliveryPct, p.onTimeDeliveryPct, args.targets.onTimeDeliveryPct, fmtPct),
  ];

  // Highlights: suggestions from the records; the user edits them before sending.
  const highlights: string[] = [];
  for (const jo of confirmed) {
    const days = jo.confirmedOn ? Math.max(0, workingDaysBetween(jo.receivedDate, jo.confirmedOn, ctx.cal) ?? 0) : null;
    const st = standing(jo, today, ctx);
    highlights.push(
      `${jo.joNumber} (${plural(jo.lines.length, 'product')}, ${jo.customerName}) planned and confirmed on ${short(jo.confirmedOn!)}${days !== null ? `; planning took ${plural(days, 'working day')}${bench !== null ? ` (benchmark ${bench})` : ''}` : ''}; ${st.text}.`,
    );
  }
  for (const jo of completed) highlights.push(`${jo.joNumber} completed on ${short(jo.completedOn!)} - ${standing(jo, today, ctx).text.replace(/^done, /, '')} against the internal deadline.`);
  for (const d of delays.slice(0, 3)) highlights.push(`${d.step.replace(' (running)', '')} on ${d.order} ${d.step.endsWith('(running)') ? 'is running' : 'ran'} ${d.over} plan; the order is now ${d.now}.`);
  for (const t of done.filter((x) => x.fromTaskId && x.outcome === 'RESOLVED').slice(0, 2)) highlights.push(`${t.title.replace(/^(Escalated|Follow-up): /, '')} - ${t.title.startsWith('Escalated') ? 'escalated and' : 'followed up and'} resolved on ${short(t.doneOn!)}.`);
  if (done.length) highlights.push(`${plural(done.length, 'follow-up')} closed: ${done.filter((t) => t.outcome !== 'NOT_RESOLVED').length} resolved${escalated ? `, ${escalated} escalated` : ''}.`);

  // What comes next: the following week / month.
  const nextFrom = addDays(to, 1)!;
  const monthAfter = addDays(`${nextFrom.slice(0, 7)}-28`, 4)!.slice(0, 7);
  const nextTo = args.monthly ? addDays(`${monthAfter}-01`, -1)! : addDays(nextFrom, 6)!;
  const la = buildLookAhead({ jobOrders: args.jobOrders, ctx, from: nextFrom, to: nextTo, today, departments: args.departments, processNames: args.processNames, tasks: args.tasks, deptName: args.deptName });
  const next: string[] = [];
  for (const d of la.dates.slice(0, 3)) next.push(`${formatDay(d.date)}: ${d.text}`);
  const busy = la.departments.flatMap((d) => d.cells.map((c, i) => ({ d, c, w: la.weeks[i]! }))).filter((x) => x.c.orders > 0).sort((a, b) => b.c.avg - a.c.avg)[0];
  if (busy) next.push(`${busy.d.name} busiest in the week of ${short(busy.w.start)} (${plural(busy.c.orders, 'order')}, up to ${busy.c.peak} at a time) - see Look ahead.`);
  for (const t of la.tasks.filter((x) => x.date >= nextFrom).slice(0, 2)) next.push(`${formatDay(t.date)}: ${t.title}${t.who ? ` (${t.who})` : ''}`);
  for (const m of la.materials.slice(0, 1)) next.push(`${m.name} needed by ${formatDay(m.neededBy)} (${m.joNumber}).`);

  const len = (daysBetween(from, to) ?? 0) + 1;
  return {
    from,
    to,
    prevFrom: addDays(from, -len)!,
    prevTo: addDays(from, -1)!,
    monthly: args.monthly,
    tiles: {
      confirmed: confirmed.length,
      planningAvg: f.avgPlanningDays,
      planningBench: bench,
      stepsDone,
      stepsOnTime,
      stepsTimed,
      completed: completed.length,
      completedOnTime,
      tasksDone: done.length,
      resolved: done.filter((t) => t.outcome !== 'NOT_RESOLVED').length,
      escalated,
    },
    orders,
    delays,
    followUps,
    openEscalations,
    kpis,
    highlights,
    next,
  };
}
