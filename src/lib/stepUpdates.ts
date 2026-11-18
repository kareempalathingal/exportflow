/** Pure step updates shared by the WO page and the Today card (17 Nov 2026). */
import { formatDay, type JobOrder, type JoLine, type JoStep, type StepOutput } from './jobOrders';
import { addOutput, completeCurrent, isBuiltIn, stepTime, type StepView } from './route';
import { formatQty, unitLabel } from './units';

/** The order's lines with one line's steps replaced. */
export function withLineSteps(jo: Pick<JobOrder, 'lines'>, lineId: string, steps: JoStep[]): JoLine[] {
  return jo.lines.map((l) => (l.id === lineId ? { ...l, steps } : l));
}


/** "X done" on a date: the steps after it and the history text. */
export function doneUpdate(raw: JoStep[], label: string, productName: string, when: string, today: string): { steps: JoStep[]; what: string } | null {
  const steps = completeCurrent(raw, stepTime(when, today));
  return steps ? { steps, what: `${label} done ${when === today ? 'today' : formatDay(when)} (${productName})` } : null;
}

/**
 * A day's output / a part landing on step `i`. When it completes the quantity of the first
 * open step, `confirmDone` is asked (the app never marks done by itself).
 */
export function outputUpdate(raw: JoStep[], i: number, v: StepView, entry: StepOutput, isFirst: boolean, productName: string, today: string, confirmDone: (q: string) => boolean): { steps: JoStep[]; what: string } | null {
  const next = addOutput(raw, i, entry);
  if (!next) return null;
  const label = v.step.label;
  const isReceipt = v.step.processId === null && !isBuiltIn(v.step);
  const total = (v.step.outputQty ?? 0) + (entry.unit === v.step.qtyUnit ? entry.qty : 0);
  const whole = v.step.qty !== null && entry.unit === v.step.qtyUnit && total >= v.step.qty - 1e-9;
  const amount = `${formatQty(entry.qty)} ${unitLabel(entry.unit)} on ${formatDay(entry.on)}`;
  if (whole && isFirst && confirmDone(`Whole quantity ${isReceipt ? 'in' : 'made'}: mark ${label} done?`)) {
    const done = completeCurrent(next, stepTime(entry.on, today));
    if (done) return { steps: done, what: `${label}: ${amount}; done (${productName})` };
  }
  return { steps: next, what: `${label}: ${amount} (${productName})` };
}

/** Can a day's output be entered on this step (same rule as the Products tab)? */
export function canEnterOutput(v: StepView): boolean {
  const isReceipt = v.step.processId === null && !isBuiltIn(v.step);
  return (v.state === 'NOW' || !!v.step.startedAt || isReceipt) && v.step.qty !== null && (isReceipt || !v.step.passThrough) && v.step.label !== 'Ordered';
}

/** How far a step may go by what the step before it has recorded (18 Nov 2026). */
export interface PrevLimit {
  /** Quantity of this step (in its own unit) covered by the previous step's output so far. */
  allowed: number;
  unit: string;
  prevLabel: string;
  prevMade: number;
  prevQty: number;
  prevUnit: string;
}

/**
 * The previous step's output limits this step: allowed = this step's quantity × (previous made ÷
 * previous quantity), so different units (base mat sq m → mat pcs) still match. No limit when there is
 * no previous step, it is done, it has nothing to make, its quantity is unknown, or this is a landing
 * (already limited by what was dispatched).
 */
export function prevLimit(views: StepView[], key: string): PrevLimit | null {
  const i = views.findIndex((v) => v.step.key === key);
  if (i < 0) return null;
  const cur = views[i]!.step;
  if (cur.qty === null || !cur.qtyUnit || (cur.outsideOf && cur.processId === null && i > 0 && views[i - 1]!.step.outside)) return null;
  let j = i - 1;
  while (j >= 0 && (isBuiltIn(views[j]!.step) || (views[j]!.step.outside && !views[j]!.step.outputLog?.length))) j--;
  if (j < 0) return null;
  const p = views[j]!;
  if (p.state === 'DONE' || p.step.doneAt || p.step.qty === null || !(p.step.qty > 0) || !p.step.qtyUnit) return null;
  const made = p.step.outputQty ?? 0;
  return { allowed: cur.qty * Math.min(1, made / p.step.qty), unit: cur.qtyUnit, prevLabel: p.step.label, prevMade: made, prevQty: p.step.qty, prevUnit: p.step.qtyUnit };
}

/** The question asked before saving more than the previous step covers; null = within the limit. */
export function overPrevQuestion(lim: PrevLimit | null, total: number, unit: string, label: string): string | null {
  if (!lim || unit !== lim.unit || total <= lim.allowed + 1e-9) return null;
  return `${lim.prevLabel} has recorded only ${formatQty(lim.prevMade)} of ${formatQty(lim.prevQty)} ${unitLabel(lim.prevUnit)} so far (enough for ${formatQty(lim.allowed)} ${unitLabel(lim.unit)} of ${label}). Save ${formatQty(total)} ${unitLabel(unit)} of ${label} anyway?`;
}
