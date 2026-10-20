/**
 * Phase 4 (skeleton): process routes and step tracking per Job Order line.
 *
 * A product's route lists its processes in order. When an order is confirmed,
 * each line gets its own copy of the steps: made sub-products first (their own
 * routes, deepest first), then the product's route. Bought lines start with
 * "Ordered" and "Received", then the product's own steps (e.g. packing).
 * Progress is the share of steps done, weighted by planned days when every
 * step has a firm benchmark, otherwise each step counts the same.
 */
import { daysBetween, effectiveSupply, type JobOrder, type JoLine, type JoStep } from './jobOrders';
import { lineComponent, needsBom, type MasterData, type Process, type Product } from './masters';
import { istDateKey } from './time';
import { trackOf, type Track } from './progress';

const FIRM = ['VERIFIED', 'USER_PROVIDED'];

export const PURCHASE_STEPS = ['Ordered', 'Received'] as const;

export function firmDays(step: { plannedDays: { value: number | null; status: string } }): number | null {
  const v = step.plannedDays?.value;
  return typeof v === 'number' && v > 0 && FIRM.includes(step.plannedDays.status) ? v : null;
}

/** Steps for one order line from the current masters (taken at confirmation). */
export function buildLineSteps(line: Pick<JoLine, 'id' | 'productId' | 'supply'>, md: MasterData, processes: Map<string, Process>): JoStep[] {
  const product = md.products.get(line.productId);
  if (!product) return [];
  const supply = effectiveSupply(line, product);
  const steps: JoStep[] = [];
  let n = 0;
  const key = () => `${line.id}-${n++}`;
  const own = (p: Product) => {
    for (const s of p.route ?? []) {
      steps.push({ key: key(), processId: s.processId, label: processes.get(s.processId)?.name ?? 'Unknown process', forProduct: p.name, plannedDays: firmDays(s), doneAt: null });
    }
  };
  if (supply === 'BUY') {
    for (const label of PURCHASE_STEPS) steps.push({ key: key(), processId: null, label, forProduct: product.name, plannedDays: null, doneAt: null });
    own(product);
    return steps;
  }
  const seen = new Set<string>();
  const visit = (pid: string, path: string[]) => {
    if (seen.has(pid) || path.includes(pid)) return;
    seen.add(pid);
    const p = md.products.get(pid);
    if (!p) return;
    for (const bl of md.boms.get(pid)?.lines ?? []) {
      const c = lineComponent(bl);
      const sub = c.type === 'PRODUCT' ? md.products.get(c.id) : undefined;
      if (sub && needsBom(sub)) visit(c.id, [...path, pid]);
    }
    own(p);
  };
  visit(line.productId, []);
  return steps;
}

export interface StepView {
  step: JoStep;
  state: 'DONE' | 'NOW' | 'TODO';
  startOn: string | null; // YYYY-MM-DD
  doneOn: string | null;
  actualDays: number | null; // done: start→done; now: days so far
  overrunDays: number | null; // actual − planned (done or now), when planned is known
}

export interface LineProgress {
  steps: StepView[];
  current: StepView | null;
  actualPct: number; // 0–100
  /** Planned % today from the benchmarks; null when some step has no firm time. */
  plannedPct: number | null;
  plannedTotalDays: number | null;
  done: boolean;
}

const dayOf = (iso: string) => istDateKey(new Date(iso));

/** Step-by-step view of a line: what is done, what is running, how long each took. */
export function lineProgress(steps: JoStep[] | undefined, startOn: string, today: string): LineProgress | null {
  if (!steps || steps.length === 0) return null;
  const allTimed = steps.every((s) => s.plannedDays !== null);
  const weight = (s: JoStep) => (allTimed ? s.plannedDays! : 1);
  const total = steps.reduce((a, s) => a + weight(s), 0);
  let prevDone = startOn;
  let doneWeight = 0;
  let foundNow = false;
  const views: StepView[] = steps.map((s) => {
    if (s.doneAt) {
      const doneOn = dayOf(s.doneAt);
      const actualDays = Math.max(0, daysBetween(prevDone, doneOn) ?? 0);
      const v: StepView = { step: s, state: 'DONE', startOn: prevDone, doneOn, actualDays, overrunDays: s.plannedDays !== null ? actualDays - s.plannedDays : null };
      prevDone = doneOn;
      doneWeight += weight(s);
      return v;
    }
    if (!foundNow) {
      foundNow = true;
      const actualDays = Math.max(0, (daysBetween(prevDone, today) ?? 0) + 1); // day N, counting today
      return { step: s, state: 'NOW', startOn: prevDone, doneOn: null, actualDays, overrunDays: s.plannedDays !== null ? actualDays - s.plannedDays : null };
    }
    return { step: s, state: 'TODO', startOn: null, doneOn: null, actualDays: null, overrunDays: null };
  });
  const elapsed = Math.max(0, daysBetween(startOn, today) ?? 0);
  return {
    steps: views,
    current: views.find((v) => v.state === 'NOW') ?? null,
    actualPct: total > 0 ? Math.round((doneWeight / total) * 100) : 0,
    plannedPct: allTimed && total > 0 ? Math.min(100, Math.round((elapsed / total) * 100)) : null,
    plannedTotalDays: allTimed ? total : null,
    done: views.every((v) => v.state === 'DONE'),
  };
}

/** Marks the current step done (now). Returns the new steps, or null when all are done. */
export function completeCurrent(steps: JoStep[], nowIso: string): JoStep[] | null {
  const i = steps.findIndex((s) => !s.doneAt);
  if (i < 0) return null;
  return steps.map((s, j) => (j === i ? { ...s, doneAt: nowIso } : s));
}

/** Undo the last done step (for mistakes). */
export function undoLast(steps: JoStep[]): JoStep[] | null {
  let i = -1;
  steps.forEach((s, j) => {
    if (s.doneAt) i = j;
  });
  if (i < 0) return null;
  return steps.map((s, j) => (j === i ? { ...s, doneAt: null } : s));
}

/** Where the order's start is counted from. */
export function orderStart(jo: Pick<JobOrder, 'confirmedOn' | 'receivedDate'>): string {
  return jo.confirmedOn ?? jo.receivedDate;
}

/**
 * Order progress from its lines' steps: the average of the lines that have
 * steps. Null when no line has steps (then the manual slider is used).
 */
export function orderStepProgress(jo: Pick<JobOrder, 'lines' | 'confirmedOn' | 'receivedDate'>, today: string): { actual: number; planned: number | null; on: string } | null {
  const start = orderStart(jo);
  const lps = jo.lines.map((l) => lineProgress(l.steps, start, today)).filter((x): x is LineProgress => x !== null);
  if (lps.length === 0) return null;
  const actual = Math.round(lps.reduce((a, p) => a + p.actualPct, 0) / lps.length);
  const planned = lps.every((p) => p.plannedPct !== null) ? Math.round(lps.reduce((a, p) => a + p.plannedPct!, 0) / lps.length) : null;
  return { actual, planned, on: today };
}

/** Steps running longer than planned, for the attention list. */
export function overrunningSteps(jo: Pick<JobOrder, 'lines' | 'confirmedOn' | 'receivedDate'>, today: string): { line: JoLine; view: StepView }[] {
  const start = orderStart(jo);
  const out: { line: JoLine; view: StepView }[] = [];
  for (const l of jo.lines) {
    const lp = lineProgress(l.steps, start, today);
    if (lp?.current && lp.current.overrunDays !== null && lp.current.overrunDays > 0) out.push({ line: l, view: lp.current });
  }
  return out;
}

/** Route days vs the time available: a route that cannot fit the deadline is a risk. */
export function routeFits(plannedTotalDays: number | null, start: string, internalDeadline: string): boolean | null {
  if (plannedTotalDays === null) return null;
  const available = daysBetween(start, internalDeadline);
  return available === null ? null : plannedTotalDays <= available;
}

/** The order's track: from process steps when any line has them, else the manual slider. */
export function orderTrack(jo: JobOrder, today: string): Track {
  return trackOf(jo, today, jo.status === 'DRAFT' ? null : orderStepProgress(jo, today));
}
