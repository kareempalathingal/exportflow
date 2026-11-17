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
