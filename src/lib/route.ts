/**
 * Phase 4 (skeleton): process routes and step tracking per Job Order line.
 *
 * A product's route lists its processes in order, each with a benchmark:
 * output per working day and/or fixed days. When an order is confirmed, each
 * line gets its own copy of the steps (with the benchmark): made sub-products
 * first (their own routes, deepest first), then the product's route. Bought
 * lines start with "Ordered" and "Received", then the product's own steps.
 *
 * Planned days are worked out from the order every time they are shown, so
 * quantity, stock and holiday changes are reflected at once:
 *   planned days = quantity to make ÷ output per day + fixed days,
 * rounded up to half a day. Quantities come from the material plan (stock set
 * aside is deducted; a sub-product shared by several lines is split by need).
 * All day counts are working days (Sundays and company holidays left out).
 */
import { addWorkingDays, DEFAULT_CALENDAR, workingDaysBetween, type WorkCalendar } from './calendar';
import { effectiveSupply, resolveLine, type JobOrder, type JoLine, type JoStep } from './jobOrders';
import { lineComponent, needsBom, productContext, type MasterData, type Process, type Product, type RouteStep } from './masters';
import { planMaterials } from './materials';
import { istDateKey } from './time';
import { trackOf, type Track } from './progress';
import { convert, formatQty, unitLabel } from './units';

const FIRM = ['VERIFIED', 'USER_PROVIDED'];
/** Estimates are used too (confirmed 21 Oct 2026), but every plan marks them. */
const USABLE = [...FIRM, 'ESTIMATED'];

export const PURCHASE_STEPS = ['Ordered', 'Received'] as const;

export interface PlanContext {
  md: MasterData;
  cal: WorkCalendar;
  /** Planning benchmark in working days (received → confirmed); undefined = default, null = not known. */
  planningDays?: number | null;
}

/** The order clock starts when the JO is received; planning (received → confirmed) is its first stage. */
export const PLANNING_KEY = '__planning';
export const DEFAULT_PLANNING_DAYS = 1;

const pos = (n: number | null | undefined): number | null => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null);

/**
 * The benchmark of a route step when it may be used (confirmed, known or the
 * user's estimate), else nulls. Estimates carry `estimated: true`.
 */
export function firmTime(s: Pick<RouteStep, 'perDay' | 'perDayUnit' | 'fixedDays' | 'status' | 'alsoForStock'>): {
  perDay: number | null;
  perDayUnit: string | null;
  fixedDays: number | null;
  alsoForStock: boolean;
  estimated?: boolean;
} {
  const alsoForStock = s.alsoForStock === true;
  if (!USABLE.includes(s.status)) return { perDay: null, perDayUnit: null, fixedDays: null, alsoForStock };
  const perDay = pos(s.perDay);
  const fixedDays = pos(s.fixedDays);
  const out = { perDay, perDayUnit: perDay !== null ? s.perDayUnit : null, fixedDays, alsoForStock };
  return s.status === 'ESTIMATED' && (perDay !== null || fixedDays !== null) ? { ...out, estimated: true } : out;
}

/** Steps for one order line from the current masters (taken at confirmation). */
export function buildLineSteps(line: Pick<JoLine, 'id' | 'productId' | 'supply'>, md: MasterData, processes: Map<string, Process>): JoStep[] {
  const product = md.products.get(line.productId);
  if (!product) return [];
  const supply = effectiveSupply(line, product);
  const steps: JoStep[] = [];
  let n = 0;
  const key = () => `${line.id}-${n++}`;
  const own = (pid: string, p: Product) => {
    for (const s of p.route ?? []) {
      steps.push({ key: key(), processId: s.processId, label: processes.get(s.processId)?.name ?? 'Unknown process', forProduct: p.name, productId: pid, ...firmTime(s), doneAt: null });
    }
  };
  if (supply === 'BUY') {
    for (const label of PURCHASE_STEPS) steps.push({ key: key(), processId: null, label, forProduct: product.name, productId: line.productId, perDay: null, perDayUnit: null, fixedDays: null, doneAt: null });
    own(line.productId, product);
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
    own(pid, p);
  };
  visit(line.productId, []);
  return steps;
}

// ---------------------------------------------------------------------------
// Quantities and planned days
// ---------------------------------------------------------------------------

/** How much of a product one line has to process (base unit). */
export interface StepQty {
  qty: number; // to make (or, for bought lines, to handle)
  fromStock: number; // set aside from stock (not made)
  unit: string; // base unit
}

/**
 * Quantity per product for each line: made products from the material plan
 * (stock deducted; a product needed by several lines is split by each line's
 * share of the need); bought lines handle their full quantity.
 */
export function lineQuantities(jo: Pick<JobOrder, 'lines' | 'status' | 'bomSnapshot' | 'stock'>, md: MasterData): Map<string, StepQty>[] {
  const order = planMaterials(jo, md);
  const orderRow = new Map(order.toProduce.map((r) => [r.id, r]));
  // Each line's own need without stock, and the total of those needs: the share of a product per line.
  const own = jo.lines.map((line) => new Map(planMaterials({ ...jo, lines: [line], stock: {} }, md).toProduce.map((r) => [r.id, r.gross])));
  const totalNeed = new Map<string, number>();
  for (const m of own) for (const [id, g] of m) totalNeed.set(id, (totalNeed.get(id) ?? 0) + g);
  return jo.lines.map((line, i) => {
    const out = new Map<string, StepQty>();
    const product = md.products.get(line.productId);
    if (effectiveSupply(line, product) === 'BUY') {
      const r = resolveLine(line, md);
      if (r.baseQty !== null && r.baseUnit) out.set(line.productId, { qty: r.baseQty, fromStock: 0, unit: r.baseUnit });
      return out;
    }
    for (const [id, gross] of own[i]!) {
      const whole = orderRow.get(id);
      const total = totalNeed.get(id) ?? 0;
      if (!whole || !(total > 0)) continue;
      const share = gross / total;
      out.set(id, { qty: whole.net * share, fromStock: Math.min(whole.fromStock, whole.gross) * share, unit: whole.unit });
    }
    return out;
  });
}

export interface PlannedStep extends JoStep {
  /** Working days planned for this step on this order; null = time pending. */
  plannedDays: number | null;
  /** Quantity this step handles, in the benchmark's unit (when there is one). */
  qty: number | null;
  qtyUnit: string | null;
  /** How the time was worked out, e.g. "1,200 pcs ÷ 400/day + 1 fixed". */
  basis: string | null;
  /** Why the time is what it is (0 days, conversion needed…). */
  note: string | null;
}

/** Half-day steps, always rounded up. */
export function roundUpHalf(days: number): number {
  return Math.ceil(days * 2 - 1e-9) / 2;
}

/** Planned days for one step from its benchmark and the quantity it handles. Estimated times say so in the basis. */
export function planStep(step: JoStep, made: StepQty | undefined, product: Product | undefined): PlannedStep {
  const p = planStepTime(step, made, product);
  return p.estimated && p.plannedDays !== null && p.basis ? { ...p, basis: `${p.basis} · my estimate` } : p;
}

function planStepTime(step: JoStep, made: StepQty | undefined, product: Product | undefined): PlannedStep {
  // Steps like packing also handle the stock set aside for the order.
  const q = made && step.alsoForStock ? { qty: made.qty + made.fromStock, fromStock: 0, unit: made.unit } : made;
  const base: PlannedStep = { ...step, plannedDays: null, qty: null, qtyUnit: null, basis: null, note: null };
  const perDay = pos(step.perDay);
  const fixed = pos(step.fixedDays);
  if (perDay === null && fixed === null) return base; // time pending
  if (!q) {
    if (perDay === null) return { ...base, plannedDays: roundUpHalf(fixed!), basis: `${formatQty(fixed!)} fixed days` };
    return { ...base, note: 'Quantity cannot be worked out (check the BOM and conversions)' };
  }
  const unit = unitLabel(q.unit);
  if (q.qty <= 1e-9) {
    return { ...base, plannedDays: 0, qty: 0, qtyUnit: q.unit, note: q.fromStock > 0 ? `All ${formatQty(q.fromStock)} ${unit} from stock (set aside) — nothing to make` : 'Nothing to make' };
  }
  const stockNote =
    q.fromStock > 1e-9 ? `${formatQty(q.fromStock)} ${unit} from stock` : step.alsoForStock && made && made.fromStock > 1e-9 ? `Includes ${formatQty(made.fromStock)} ${unit} from stock` : null;
  if (perDay === null) return { ...base, plannedDays: roundUpHalf(fixed!), qty: q.qty, qtyUnit: q.unit, basis: `${formatQty(fixed!)} fixed days`, note: stockNote };
  const to = step.perDayUnit ?? q.unit;
  const c = product ? convert(q.qty, q.unit, to, productContext(product)) : null;
  if (!c || !c.ok) return { ...base, note: `Conversion needed (${unit} → ${unitLabel(to)})` };
  const days = c.value / perDay + (fixed ?? 0);
  return {
    ...base,
    plannedDays: roundUpHalf(days),
    qty: c.value,
    qtyUnit: to,
    basis: `${formatQty(c.value)} ${unitLabel(to)} ÷ ${formatQty(perDay)}/day${fixed !== null ? ` + ${formatQty(fixed)} fixed` : ''}${c.provisional ? ' (estimated conversion)' : ''}`,
    note: stockNote,
  };
}

export type PlannedLine = Omit<JoLine, 'steps'> & { steps?: PlannedStep[] };

/** Every line with its steps' planned days worked out from the order as it is now. */
export function planLines(jo: Pick<JobOrder, 'lines' | 'status' | 'bomSnapshot' | 'stock'>, md: MasterData): PlannedLine[] {
  const qs = jo.lines.some((l) => l.steps?.length) ? lineQuantities(jo, md) : [];
  return jo.lines.map((l, i) => {
    if (!l.steps) return { ...l, steps: undefined };
    return { ...l, steps: l.steps.map((s) => planStep(s, qs[i]?.get(s.productId ?? l.productId), md.products.get(s.productId ?? l.productId))) };
  });
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface StepView {
  step: PlannedStep;
  state: 'DONE' | 'NOW' | 'TODO';
  startOn: string | null; // YYYY-MM-DD
  doneOn: string | null;
  /** Working days used: done = start → done; now = full days so far (today not counted). */
  actualDays: number | null;
  /** actual − planned (done, or running past its plan), when planned is known. */
  overrunDays: number | null;
}

export interface LineProgress {
  steps: StepView[];
  current: StepView | null;
  actualPct: number; // 0–100
  /** Planned % today from the benchmarks; null when some step has no time yet. */
  plannedPct: number | null;
  plannedTotalDays: number | null;
  /** Expected finish (working days, from the step running now); null when some time is unknown. */
  expectedFinish: string | null;
  done: boolean;
}

const dayOf = (iso: string) => istDateKey(new Date(iso));

/** Step-by-step view of a line: what is done, what is running, how long each took (working days). */
export function lineProgress(steps: PlannedStep[] | undefined, startOn: string, today: string, cal: WorkCalendar = DEFAULT_CALENDAR): LineProgress | null {
  if (!steps || steps.length === 0) return null;
  const allTimed = steps.every((s) => s.plannedDays !== null);
  const timedTotal = allTimed ? steps.reduce((a, s) => a + s.plannedDays!, 0) : 0;
  const byTime = allTimed && timedTotal > 0;
  const weight = (s: PlannedStep) => (byTime ? s.plannedDays! : 1);
  const total = steps.reduce((a, s) => a + weight(s), 0);
  let prevDone = startOn;
  let doneWeight = 0;
  let foundNow = false;
  const views: StepView[] = steps.map((s) => {
    if (s.doneAt) {
      const doneOn = dayOf(s.doneAt);
      const actualDays = Math.max(0, workingDaysBetween(prevDone, doneOn, cal) ?? 0);
      const v: StepView = { step: s, state: 'DONE', startOn: prevDone, doneOn, actualDays, overrunDays: s.plannedDays !== null ? actualDays - s.plannedDays : null };
      prevDone = doneOn;
      doneWeight += weight(s);
      return v;
    }
    if (!foundNow) {
      foundNow = true;
      const actualDays = Math.max(0, workingDaysBetween(prevDone, today, cal) ?? 0);
      return { step: s, state: 'NOW', startOn: prevDone, doneOn: null, actualDays, overrunDays: s.plannedDays !== null ? actualDays - s.plannedDays : null };
    }
    return { step: s, state: 'TODO', startOn: null, doneOn: null, actualDays: null, overrunDays: null };
  });
  const current = views.find((v) => v.state === 'NOW') ?? null;
  const elapsed = Math.max(0, workingDaysBetween(startOn, today, cal) ?? 0);
  let expectedFinish: string | null = null;
  if (!current) expectedFinish = views[views.length - 1]!.doneOn;
  else if (allTimed) {
    let nowEnd = addWorkingDays(current.startOn!, current.step.plannedDays!, cal)!;
    if (nowEnd < today) nowEnd = today; // running late: assume it finishes today
    const rest = views.filter((v) => v.state === 'TODO').reduce((a, v) => a + v.step.plannedDays!, 0);
    expectedFinish = addWorkingDays(nowEnd, rest, cal);
  }
  return {
    steps: views,
    current,
    actualPct: total > 0 ? Math.round((doneWeight / total) * 100) : 0,
    plannedPct: allTimed ? (timedTotal > 0 ? Math.min(100, Math.round((elapsed / timedTotal) * 100)) : 100) : null,
    plannedTotalDays: allTimed ? timedTotal : null,
    expectedFinish,
    done: !current,
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
export function orderStart(jo: Pick<JobOrder, 'receivedDate'>): string {
  return jo.receivedDate;
}

/** The built-in first stage of every order: received → confirmed (not stored; worked out). */
export function planningStep(jo: Pick<JobOrder, 'status' | 'confirmedOn' | 'receivedDate'>, ctx: Pick<PlanContext, 'planningDays'>): PlannedStep {
  const days = ctx.planningDays === undefined ? DEFAULT_PLANNING_DAYS : ctx.planningDays;
  const done = jo.status !== 'DRAFT' ? (jo.confirmedOn ?? jo.receivedDate) : null;
  return {
    key: PLANNING_KEY,
    processId: null,
    label: 'Planning',
    forProduct: 'Whole order',
    productId: null,
    perDay: null,
    perDayUnit: null,
    fixedDays: days,
    doneAt: done ? `${done}T06:30:00.000Z` : null,
    plannedDays: days,
    qty: null,
    qtyUnit: null,
    basis: days === null ? null : `Received → confirmed · benchmark ${formatQty(days)} working day${days === 1 ? '' : 's'}`,
    note: days === null ? 'Planning benchmark not set (Settings)' : null,
  };
}

/** A line's steps with the planning stage first (for progress and schedules). */
export function withPlanning(steps: PlannedStep[] | undefined, jo: Pick<JobOrder, 'status' | 'confirmedOn' | 'receivedDate'>, ctx: Pick<PlanContext, 'planningDays'>): PlannedStep[] | undefined {
  return steps && steps.length ? [planningStep(jo, ctx), ...steps] : steps;
}

type StepOrder = Pick<JobOrder, 'lines' | 'confirmedOn' | 'receivedDate' | 'status' | 'bomSnapshot' | 'stock'>;

/** Progress of every line that has steps (lines without steps are skipped). */
export function lineProgresses(jo: StepOrder, today: string, ctx: PlanContext): { line: PlannedLine; lp: LineProgress }[] {
  const start = orderStart(jo);
  return planLines(jo, ctx.md)
    .map((line) => ({ line, lp: lineProgress(withPlanning(line.steps, jo, ctx), start, today, ctx.cal) }))
    .filter((x): x is { line: PlannedLine; lp: LineProgress } => x.lp !== null);
}

/**
 * Order progress from its lines' steps: the average of the lines that have
 * steps. Null when no line has steps (then the manual slider is used).
 */
export function orderStepProgress(jo: StepOrder, today: string, ctx: PlanContext): { actual: number; planned: number | null; on: string } | null {
  const lps = lineProgresses(jo, today, ctx).map((x) => x.lp);
  if (lps.length === 0) return null;
  const actual = Math.round(lps.reduce((a, p) => a + p.actualPct, 0) / lps.length);
  const planned = lps.every((p) => p.plannedPct !== null) ? Math.round(lps.reduce((a, p) => a + p.plannedPct!, 0) / lps.length) : null;
  return { actual, planned, on: today };
}

/** Steps running longer than planned, for the attention list. */
export function overrunningSteps(jo: StepOrder, today: string, ctx: PlanContext): { line: PlannedLine; view: StepView }[] {
  return lineProgresses(jo, today, ctx)
    .filter(({ lp }) => lp.current && lp.current.overrunDays !== null && lp.current.overrunDays > 0)
    .map(({ line, lp }) => ({ line, view: lp.current! }));
}

/** Route time vs the working days available: a route that cannot fit the deadline is a risk. */
export function routeFits(plannedTotalDays: number | null, start: string, internalDeadline: string, cal: WorkCalendar = DEFAULT_CALENDAR): boolean | null {
  if (plannedTotalDays === null) return null;
  const available = workingDaysBetween(start, internalDeadline, cal);
  return available === null ? null : plannedTotalDays <= available;
}

/** The order's track: from process steps when any line has them, else the manual slider. */
export function orderTrack(jo: JobOrder, today: string, ctx: PlanContext): Track {
  return trackOf(jo, today, jo.status === 'DRAFT' ? null : orderStepProgress(jo, today, ctx), ctx.cal);
}

// ---------------------------------------------------------------------------
// Schedule (dates per step, for the plan document)
// ---------------------------------------------------------------------------

export interface ScheduledStep {
  view: StepView;
  start: string | null;
  finish: string | null;
}

/**
 * Dates for every step: actual dates for finished steps, planned dates for
 * the rest (each step starts the day the previous one finishes; working
 * days). Unknown from the first step without a time onwards.
 */
export function lineSchedule(lp: LineProgress, today: string, cal: WorkCalendar): ScheduledStep[] {
  let prev: string | null = null;
  return lp.steps.map((v) => {
    if (v.state === 'DONE') {
      prev = v.doneOn;
      return { view: v, start: v.startOn, finish: v.doneOn };
    }
    const start: string | null = v.state === 'NOW' ? v.startOn : prev;
    let finish: string | null = null;
    if (start && v.step.plannedDays !== null) {
      finish = addWorkingDays(start, v.step.plannedDays, cal);
      if (v.state === 'NOW' && finish && finish < today) finish = today; // running late: at the earliest today
    }
    prev = finish;
    return { view: v, start, finish };
  });
}
