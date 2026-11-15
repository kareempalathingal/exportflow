/**
 * Submitted plan (baseline), confirmed 15 Nov 2026: the step dates of the plan given to
 * management, saved on the WO when the user chooses "Save as submitted plan" (never by
 * itself, never on share). Later dates are compared with the LATEST version; the first
 * version is shown as "first submitted". The app never marks a plan approved: "approved
 * by / on" is optional and written by the user.
 */
import { workingDaysBetween, type WorkCalendar } from './calendar';
import type { JobOrder } from './jobOrders';
import { PLANNING_KEY, type OrderPlan } from './route';

export interface BaselineStep {
  lineId: string;
  key: string;
  label: string;
  product: string;
  start: string | null;
  finish: string | null;
}

export interface PlanBaseline {
  version: number;
  /** Day the plan was saved (IST date) and the exact time. */
  savedOn: string;
  savedAt: string;
  /** WO revision the plan was made from. */
  rev: number | null;
  /** Why a new version (required from v2). */
  reason: string;
  approvedBy?: string;
  approvedOn?: string;
  /** Last item ready (null = some date was not known). */
  ready: string | null;
  internalDeadline: string;
  steps: BaselineStep[];
}

/** More than this many working days behind the submitted plan → "Watch" in Orders at risk. */
export const BASELINE_WATCH_DAYS = 2;
/** Versions kept per WO. */
export const MAX_BASELINES = 20;

export function latestBaseline(jo: Pick<JobOrder, 'baselines'>): PlanBaseline | null {
  return jo.baselines?.length ? jo.baselines[jo.baselines.length - 1]! : null;
}

/** Can a plan be saved now, and what must be filled. */
export function baselineCheck(jo: Pick<JobOrder, 'status' | 'baselines'>, input: { reason: string; approvedOn: string }, today: string): string | null {
  if (jo.status !== 'CONFIRMED') return 'Only a confirmed WO can have a submitted plan';
  if ((jo.baselines?.length ?? 0) > 0 && !input.reason.trim()) return 'Say why there is a new version';
  if (input.approvedOn && input.approvedOn > today) return 'Approved on cannot be in the future';
  if ((jo.baselines?.length ?? 0) >= MAX_BASELINES) return `At most ${MAX_BASELINES} versions are kept`;
  return null;
}

/** The plan as it stands now, as the next version. */
export function snapshotPlan(
  jo: Pick<JobOrder, 'baselines' | 'deadline'> & { rev?: number },
  oplan: OrderPlan,
  at: { today: string; now: string },
  input: { reason: string; approvedBy: string; approvedOn: string },
): PlanBaseline {
  const steps: BaselineStep[] = [];
  for (const { line, lp } of oplan.lines) {
    for (const st of lp.schedule ?? []) {
      const s = st.view.step;
      steps.push({ lineId: line.id, key: s.key, label: s.key === PLANNING_KEY ? 'Planning' : s.label, product: s.forProduct || line.productName, start: st.start, finish: st.finish });
    }
  }
  return {
    version: (latestBaseline(jo)?.version ?? 0) + 1,
    savedOn: at.today,
    savedAt: at.now,
    rev: jo.rev ?? null,
    reason: input.reason.trim(),
    ...(input.approvedBy.trim() ? { approvedBy: input.approvedBy.trim() } : {}),
    ...(input.approvedOn ? { approvedOn: input.approvedOn } : {}),
    ready: oplan.itemOrder.ready,
    internalDeadline: jo.deadline.internalDeadline,
    steps,
  };
}

export interface StepVsPlan {
  planStart: string | null;
  planFinish: string | null;
  /** Working days the step finishes after (+) / before (−) the plan; null = a date not known. */
  diff: number | null;
}

export interface PlanCompare {
  base: PlanBaseline;
  first: PlanBaseline;
  readyNow: string | null;
  /** Working days the WO is ready after (+) / before (−) the plan. */
  readyDiff: number | null;
  /** Per step: `${lineId}|${key}`. */
  steps: Map<string, StepVsPlan>;
  /** Steps finishing later than planned, worst first. */
  behind: { product: string; label: string; diff: number }[];
  /** Steps on the WO now that were not in the submitted plan. */
  notInPlan: number;
}

export const stepKey = (lineId: string, key: string) => `${lineId}|${key}`;

export function compareToPlan(jo: Pick<JobOrder, 'baselines'>, oplan: OrderPlan, cal: WorkCalendar): PlanCompare | null {
  const base = latestBaseline(jo);
  if (!base) return null;
  const planned = new Map(base.steps.map((s) => [stepKey(s.lineId, s.key), s]));
  const steps = new Map<string, StepVsPlan>();
  const behind: PlanCompare['behind'] = [];
  let notInPlan = 0;
  for (const { line, lp } of oplan.lines) {
    for (const st of lp.schedule ?? []) {
      const s = st.view.step;
      const k = stepKey(line.id, s.key);
      const p = planned.get(k);
      if (!p) {
        notInPlan++;
        continue;
      }
      const diff = p.finish && st.finish ? workingDaysBetween(p.finish, st.finish, cal) : null;
      steps.set(k, { planStart: p.start, planFinish: p.finish, diff });
      if (diff !== null && diff > 0 && s.key !== PLANNING_KEY) behind.push({ product: s.forProduct || line.productName, label: s.label, diff });
    }
  }
  behind.sort((a, b) => b.diff - a.diff);
  const readyNow = oplan.itemOrder.ready;
  return {
    base,
    first: jo.baselines![0]!,
    readyNow,
    readyDiff: base.ready && readyNow ? workingDaysBetween(base.ready, readyNow, cal) : null,
    steps,
    behind,
    notInPlan,
  };
}

/** "+2 working days", "−1 working day", "on plan". */
export function diffText(d: number): string {
  if (d === 0) return 'on plan';
  const n = Math.abs(d);
  return `${d > 0 ? '+' : '−'}${n} working day${n === 1 ? '' : 's'}`;
}
