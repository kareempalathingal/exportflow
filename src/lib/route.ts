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
import { effectiveSupply, resolveLine, type JobOrder, type JoLine, type JoStep, type StepOutput } from './jobOrders';
import { lineComponent, needsBom, processUnits, productContext, type MasterData, type Process, type Product, type RouteStep } from './masters';
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
  /** Parallel units per process id (default 1 when missing). Items of an order queue for a process. */
  units?: Map<string, number>;
}

/** Parallel units per process for a plan context (from the Processes master). */
export function unitsMap(processes: Map<string, Process> | (Process & { id: string })[]): Map<string, number> {
  const entries: [string, Process][] = processes instanceof Map ? [...processes] : processes.map((p) => [p.id, p]);
  return new Map(entries.map(([id, p]) => [id, processUnits(p)]));
}

/** The order clock starts when the JO is received; planning (received → confirmed) is its first stage. */
export const PLANNING_KEY = '__planning';
export const DEFAULT_PLANNING_DAYS = 1;

const pos = (n: number | null | undefined): number | null => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null);

/**
 * The benchmark of a route step when it may be used (confirmed, known or the
 * user's estimate), else nulls. Estimates carry `estimated: true`.
 */
export function firmTime(s: Pick<RouteStep, 'perDay' | 'perDayUnit' | 'fixedDays' | 'status' | 'alsoForStock' | 'waitAll'>): {
  perDay: number | null;
  perDayUnit: string | null;
  fixedDays: number | null;
  alsoForStock: boolean;
  waitAll?: boolean;
  estimated?: boolean;
} {
  const alsoForStock = s.alsoForStock === true;
  const wait = s.waitAll === true ? { waitAll: true } : {};
  if (!USABLE.includes(s.status)) return { perDay: null, perDayUnit: null, fixedDays: null, alsoForStock, ...wait };
  const perDay = pos(s.perDay);
  const fixedDays = pos(s.fixedDays);
  const out = { perDay, perDayUnit: perDay !== null ? s.perDayUnit : null, fixedDays, alsoForStock, ...wait };
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
      const name = processes.get(s.processId)?.name ?? 'Unknown process';
      const step: JoStep = { key: key(), processId: s.processId, label: name, forProduct: p.name, productId: pid, ...firmTime(s), doneAt: null };
      if (!s.outside) {
        steps.push(step);
        continue;
      }
      // Outside (job work, 5 Nov 2026): dispatch → the outside step → landing.
      const none = { perDay: null, perDayUnit: null, fixedDays: null };
      steps.push({ key: key(), processId: null, label: `Dispatch for ${name}`, forProduct: p.name, productId: pid, ...none, outsideOf: s.processId, passThrough: true, doneAt: null });
      steps.push({ ...step, label: `${name} (outside)`, outside: true });
      const land = firmTime({ perDay: s.landingPerDay ?? null, perDayUnit: s.landingPerDayUnit ?? '', fixedDays: null, status: s.status });
      steps.push({
        key: key(),
        processId: null,
        label: `Landing from ${name}`,
        forProduct: p.name,
        productId: pid,
        perDay: land.perDay,
        perDayUnit: land.perDayUnit,
        fixedDays: null,
        ...(land.estimated ? { estimated: true } : {}),
        outsideOf: s.processId,
        ...(land.perDay === null ? { passThrough: true } : {}),
        doneAt: null,
      });
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
  /** Working days planned for this step on this order (rounded up to half a day, as shown); null = time pending. */
  plannedDays: number | null;
  /** The same time unrounded: used to schedule (rounding every item added up, 5 Nov 2026). */
  workDays?: number;
  /** Quantity this step handles, in the benchmark's unit (when there is one). */
  qty: number | null;
  qtyUnit: string | null;
  /** How the time was worked out, e.g. "1,200 pcs ÷ 400/day + 1 fixed". */
  basis: string | null;
  /** Why the time is what it is (0 days, conversion needed…). */
  note: string | null;
  /** "Materials ready" stage: the date the last material is expected (not all received yet). */
  readyBy?: string;
  /** Output recorded so far, in `qtyUnit` (null = none recorded, or it cannot be converted). */
  outputQty?: number | null;
}

/** Output recorded on a step, added up in `unit` (null when an entry cannot be converted). */
export function outputTotal(log: StepOutput[] | undefined, unit: string | null, product: Product | undefined): number | null {
  if (!log?.length || !unit) return null;
  let sum = 0;
  for (const e of log) {
    if (e.unit === unit) sum += e.qty;
    else {
      const c = product ? convert(e.qty, e.unit, unit, productContext(product)) : null;
      if (!c || !c.ok) return null;
      sum += c.value;
    }
  }
  return sum;
}

/** Half-day steps, always rounded up. */
export function roundUpHalf(days: number): number {
  return Math.ceil(days * 2 - 1e-9) / 2;
}

/** Planned days for one step from its benchmark and the quantity it handles. Estimated times say so in the basis. */
export function planStep(step: JoStep, made: StepQty | undefined, product: Product | undefined): PlannedStep {
  let p = planStepTime(step, made, product);
  if (step.outputLog?.length) p = { ...p, outputQty: outputTotal(step.outputLog, p.qtyUnit ?? made?.unit ?? null, product) };
  return p.estimated && p.plannedDays !== null && p.basis ? { ...p, basis: `${p.basis} · my estimate` } : p;
}

function planStepTime(step: JoStep, made: StepQty | undefined, product: Product | undefined): PlannedStep {
  // Steps like packing also handle the stock set aside for the order.
  const q = made && step.alsoForStock ? { qty: made.qty + made.fromStock, fromStock: 0, unit: made.unit } : made;
  const base: PlannedStep = { ...step, plannedDays: null, qty: null, qtyUnit: null, basis: null, note: null };
  const perDay = pos(step.perDay);
  const fixed = pos(step.fixedDays);
  if (step.passThrough) return { ...base, plannedDays: 0, workDays: 0, qty: q?.qty ?? null, qtyUnit: q?.unit ?? null, note: 'No time of its own: assumed together with the step before' };
  if (perDay === null && fixed === null) return base; // time pending
  if (!q) {
    if (perDay === null) return { ...base, plannedDays: roundUpHalf(fixed!), workDays: fixed!, basis: `${formatQty(fixed!)} fixed days` };
    return { ...base, note: 'Quantity cannot be worked out (check the BOM and conversions)' };
  }
  const unit = unitLabel(q.unit);
  if (q.qty <= 1e-9) {
    return { ...base, plannedDays: 0, qty: 0, qtyUnit: q.unit, note: q.fromStock > 0 ? `All ${formatQty(q.fromStock)} ${unit} from stock (set aside) — nothing to make` : 'Nothing to make' };
  }
  const stockNote =
    q.fromStock > 1e-9 ? `${formatQty(q.fromStock)} ${unit} from stock` : step.alsoForStock && made && made.fromStock > 1e-9 ? `Includes ${formatQty(made.fromStock)} ${unit} from stock` : null;
  if (perDay === null) return { ...base, plannedDays: roundUpHalf(fixed!), workDays: fixed!, qty: q.qty, qtyUnit: q.unit, basis: `${formatQty(fixed!)} fixed days`, note: stockNote };
  const to = step.perDayUnit ?? q.unit;
  const c = product ? convert(q.qty, q.unit, to, productContext(product)) : null;
  if (!c || !c.ok) return { ...base, note: `Conversion needed (${unit} → ${unitLabel(to)})` };
  const days = c.value / perDay + (fixed ?? 0);
  return {
    ...base,
    plannedDays: roundUpHalf(days),
    workDays: days,
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
  /** Day work started, when "Started" was recorded. */
  startedOn: string | null;
  /** Working days waiting before work started (needs startedOn). */
  waitDays: number | null;
  /** Working days of actual work: started → done (or → today while running). */
  workDays: number | null;
  /** Next in line but the process is still busy with other items of the order (startOn = expected start). */
  queued?: boolean;
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
  /** Dates of every step from the whole-order plan (set by lineProgresses / orderPlan). */
  schedule?: ScheduledStep[];
}

const dayOf = (iso: string) => istDateKey(new Date(iso));

/** Built-in stages (not process steps): skipped in KPIs, overruns and department lists. */
export function isBuiltIn(s: Pick<JoStep, 'key'>): boolean {
  return s.key === PLANNING_KEY || s.key === MATERIALS_KEY;
}

/** actual − planned, when it means something (never for "Materials ready" or a step without a time of its own). */
function overrunOf(s: PlannedStep, actualDays: number): number | null {
  if (s.plannedDays === null || s.key === MATERIALS_KEY || s.passThrough) return null;
  return actualDays - s.plannedDays;
}

/** Share of a running step done by the recorded output (0–1), when known. */
function outputShare(s: PlannedStep): number {
  if (s.outputQty === null || s.outputQty === undefined || s.qty === null || !(s.qty > 0)) return 0;
  return Math.min(1, s.outputQty / s.qty);
}

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
  let chain = true; // still in the run of started steps after the current one (parallel running, 5 Nov 2026)
  const views: StepView[] = steps.map((s) => {
    if (s.doneAt) {
      const doneOn = dayOf(s.doneAt);
      const actualDays = Math.max(0, workingDaysBetween(prevDone, doneOn, cal) ?? 0);
      const split = splitWait(prevDone, s.startedAt, doneOn, cal);
      const v: StepView = { step: s, state: 'DONE', startOn: prevDone, doneOn, actualDays, overrunDays: overrunOf(s, actualDays), ...split };
      prevDone = doneOn;
      doneWeight += weight(s);
      return v;
    }
    if (!foundNow) {
      foundNow = true;
      const actualDays = Math.max(0, workingDaysBetween(prevDone, today, cal) ?? 0);
      const split = splitWait(prevDone, s.startedAt, today, cal);
      doneWeight += weight(s) * outputShare(s);
      return { step: s, state: 'NOW', startOn: prevDone, doneOn: null, actualDays, overrunDays: overrunOf(s, actualDays), ...split };
    }
    if (chain && s.startedAt) {
      // Started while the step before it is still running (overlap).
      const startedOn = dayOf(s.startedAt) > today ? today : dayOf(s.startedAt);
      const actualDays = Math.max(0, workingDaysBetween(startedOn, today, cal) ?? 0);
      doneWeight += weight(s) * outputShare(s);
      return { step: s, state: 'NOW', startOn: startedOn, doneOn: null, actualDays, overrunDays: overrunOf(s, actualDays), startedOn, waitDays: 0, workDays: actualDays };
    }
    chain = false;
    return { step: s, state: 'TODO', startOn: null, doneOn: null, actualDays: null, overrunDays: null, startedOn: null, waitDays: null, workDays: null };
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
    actualPct: total > 0 ? Math.min(100, Math.round((doneWeight / total) * 100)) : 0,
    plannedPct: allTimed ? (timedTotal > 0 ? Math.min(100, Math.round((elapsed / timedTotal) * 100)) : 100) : null,
    plannedTotalDays: allTimed ? timedTotal : null,
    expectedFinish,
    done: !current,
  };
}

/** Waiting vs working days of a step whose start was recorded (wait + work = all days). */
function splitWait(prevDone: string, startedAt: string | null | undefined, end: string, cal: WorkCalendar): Pick<StepView, 'startedOn' | 'waitDays' | 'workDays'> {
  if (!startedAt) return { startedOn: null, waitDays: null, workDays: null };
  let startedOn = dayOf(startedAt);
  if (startedOn < prevDone) startedOn = prevDone; // cannot start before the previous step finished
  if (startedOn > end) startedOn = end;
  return {
    startedOn,
    waitDays: Math.max(0, workingDaysBetween(prevDone, startedOn, cal) ?? 0),
    workDays: Math.max(0, workingDaysBetween(startedOn, end, cal) ?? 0),
  };
}

/**
 * The time to store for a step recorded on `date`: now when it is today,
 * otherwise midday IST of that date (back-dated entries, confirmed 26 Oct 2026).
 */
export function stepTime(date: string, today: string, now: Date = new Date()): string {
  return date === today ? now.toISOString() : `${date}T06:30:00.000Z`;
}

/** Records when work on the current step started. Null when all steps are done. */
export function startCurrent(steps: JoStep[], iso: string): JoStep[] | null {
  const i = steps.findIndex((s) => !s.doneAt);
  if (i < 0) return null;
  return steps.map((s, j) => (j === i ? { ...s, startedAt: iso } : s));
}

/** Removes the recorded start of the current step (for mistakes). */
export function undoStart(steps: JoStep[]): JoStep[] | null {
  const i = steps.findIndex((s) => !s.doneAt);
  if (i < 0 || !steps[i]!.startedAt) return null;
  return steps.map((s, j) => (j === i ? { ...s, startedAt: null } : s));
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

/**
 * Steps can run at the same time (confirmed 5 Nov 2026): a step may be started once
 * the step before it has started (or is done); one that waits for the whole quantity
 * only after the step before it is done. "Done" stays in order (completeCurrent).
 */
export function canStart(steps: JoStep[], i: number): boolean {
  const s = steps[i];
  if (!s || s.doneAt || s.startedAt) return false;
  const first = steps.findIndex((x) => !x.doneAt);
  if (i === first) return true;
  if (i < first) return false;
  const prev = steps[i - 1]!;
  return s.waitAll ? !!prev.doneAt : !!(prev.doneAt || prev.startedAt);
}

/** Records the start of step `i` (see canStart). Null when it cannot start. */
export function startStepAt(steps: JoStep[], i: number, iso: string): JoStep[] | null {
  if (!canStart(steps, i)) return null;
  return steps.map((s, j) => (j === i ? { ...s, startedAt: iso } : s));
}

/** Removes the recorded start of step `i` (only when no later step has started). */
export function undoStartAt(steps: JoStep[], i: number): JoStep[] | null {
  const s = steps[i];
  if (!s || s.doneAt || !s.startedAt || steps[i + 1]?.startedAt) return null;
  return steps.map((x, j) => (j === i ? { ...x, startedAt: null } : x));
}

/** Adds one day's output to step `i` (kept oldest first). */
export function addOutput(steps: JoStep[], i: number, entry: StepOutput): JoStep[] | null {
  const s = steps[i];
  if (!s || !(entry.qty > 0) || !entry.unit) return null;
  const log = [...(s.outputLog ?? []), entry].sort((a, b) => a.on.localeCompare(b.on) || a.at.localeCompare(b.at));
  return steps.map((x, j) => (j === i ? { ...x, outputLog: log } : x));
}

/** Removes output entry `k` of step `i`. */
export function removeOutput(steps: JoStep[], i: number, k: number): JoStep[] | null {
  const s = steps[i];
  if (!s?.outputLog?.[k]) return null;
  const log = s.outputLog.filter((_, n) => n !== k);
  return steps.map((x, j) => (j === i ? { ...x, outputLog: log } : x));
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

/** The built-in "Materials ready" stage of a made line (5 Nov 2026; worked out, not stored). */
export const MATERIALS_KEY = '__materials';

/**
 * "Materials ready" for one made line: done when nothing has to be bought for it or
 * everything it needs has been received; otherwise ready by the latest expected (or
 * received) date; unknown while any material has neither (lead times are never guessed).
 * Every material is needed at the product's first step (for now).
 */
export function materialsStep(
  jo: Pick<JobOrder, 'status' | 'confirmedOn' | 'receivedDate' | 'materialDates'>,
  line: Pick<JoLine, 'productId' | 'productName'>,
  toBuy: { key: string; name: string; net: number; ordered: boolean; usedForIds: string[] }[],
  planning: PlannedStep,
): PlannedStep {
  const need = toBuy.filter((r) => r.net > 1e-9 && !r.ordered && r.usedForIds.includes(line.productId));
  const base: PlannedStep = {
    key: MATERIALS_KEY,
    processId: null,
    label: 'Materials ready',
    forProduct: line.productName,
    productId: null,
    perDay: null,
    perDayUnit: null,
    fixedDays: null,
    doneAt: null,
    plannedDays: 0,
    workDays: 0,
    qty: null,
    qtyUnit: null,
    basis: null,
    note: null,
  };
  if (need.length === 0) return { ...base, doneAt: planning.doneAt, note: 'Nothing to buy: everything from stock' };
  const dates = need.map((r) => ({ r, d: jo.materialDates?.[r.key] }));
  const received = dates.filter((x) => x.d?.receivedOn).map((x) => x.d!.receivedOn!);
  const names = (xs: typeof dates) => xs.map((x) => x.r.name).join(', ');
  if (received.length === need.length) {
    const last = received.sort().at(-1)!;
    const plannedDone = planning.doneAt ? dayOf(planning.doneAt) : null;
    const at = plannedDone && plannedDone > last ? planning.doneAt! : `${last}T06:30:00.000Z`;
    return { ...base, doneAt: planning.doneAt ? at : null, note: `Received: ${names(dates)}` };
  }
  const missing = dates.filter((x) => !x.d?.receivedOn && !x.d?.expectedOn);
  if (missing.length) return { ...base, plannedDays: null, workDays: undefined, note: `Expected date not entered: ${names(missing)}` };
  const readyBy = dates.map((x) => x.d!.receivedOn ?? x.d!.expectedOn!).sort().at(-1)!;
  const waiting = dates.filter((x) => !x.d?.receivedOn);
  return { ...base, readyBy, note: `Waiting for ${names(waiting)}` };
}

/** A line's steps with the planning stage first (for progress and schedules). */
export function withPlanning(steps: PlannedStep[] | undefined, jo: Pick<JobOrder, 'status' | 'confirmedOn' | 'receivedDate'>, ctx: Pick<PlanContext, 'planningDays'>): PlannedStep[] | undefined {
  return steps && steps.length ? [planningStep(jo, ctx), ...steps] : steps;
}

type StepOrder = Pick<JobOrder, 'lines' | 'confirmedOn' | 'receivedDate' | 'status' | 'bomSnapshot' | 'stock'> & Partial<Pick<JobOrder, 'materialDates'>>;

/**
 * Progress of every line that has steps (lines without steps are skipped),
 * planned for the whole order at once (confirmed 5 Nov 2026): the items of an
 * order share each process. A process works on as many items at a time as it
 * has parallel units (default 1); the others wait, in the order of the lines.
 * Finished steps use their real dates (in the order they were finished), so a
 * step that waited for the process to be free is not counted as late.
 */
export function lineProgresses(jo: StepOrder, today: string, ctx: PlanContext): { line: PlannedLine; lp: LineProgress }[] {
  return orderPlan(jo, today, ctx).lines;
}

/** One process in the order plan (the company's "WO planning" view). */
export interface ProcessPlan {
  processId: string;
  units: number;
  /** Steps of this process in the order (finished ones too). */
  steps: { lineId: string; product: string; qty: number | null; qtyUnit: string | null; perDay: number | null; perDayUnit: string | null; days: number | null; start: string | null; finish: string | null; done: boolean }[];
  /** First start and last finish of the steps that have dates. */
  start: string | null;
  finish: string | null;
  /** Steps without dates yet (their time or an earlier step's is not known): the finish may move. */
  undated: number;
}

export interface OrderPlan {
  lines: { line: PlannedLine; lp: LineProgress }[];
  processes: ProcessPlan[];
}

interface Slot {
  s: number;
  e: number;
}

/** Earliest start ≥ ready where [start, start + len] fits in one unit's free time; returns [unit, start]. */
function earliestSlot(units: Slot[][], ready: number, len: number): [number, number] {
  let best: [number, number] = [0, Infinity];
  units.forEach((slots, u) => {
    let t = ready;
    for (const sl of [...slots].sort((a, b) => a.s - b.s)) {
      if (sl.e <= t + 1e-9) continue;
      if (sl.s >= t + len - 1e-9 && len > 0) break;
      if (len === 0 && sl.s >= t - 1e-9) break;
      t = Math.max(t, sl.e);
    }
    if (t < best[1]) best = [u, t];
  });
  return best;
}

/** Time used to schedule a step: unrounded when known. */
const work = (s: PlannedStep): number | null => (s.plannedDays === null ? null : (s.workDays ?? s.plannedDays));

type StepTimes = { start: number | null; finish: number | null; queued: boolean; startDate?: string; finishDate?: string; workStart?: number };

/**
 * Overlap within one item (confirmed 5 Nov 2026, like the company WO plan): a step may
 * start once the previous step has made one day's worth of this step's output (batches
 * of one day of this step move on), and it runs without stopping, so it finishes no
 * earlier than one day of its work after the previous step's finish. No overlap when either step has no output per day (fixed days,
 * purchase), when the step is set to "wait for the whole quantity", or when the
 * previous step is still waiting for a date. Returns the earliest start (offset).
 */
function overlapReady(prev: PlannedStep, pt: StepTimes, s: PlannedStep): number {
  const pF = pt.finish!;
  if (s.waitAll || pt.start === null || prev.perDay === null || s.perDay === null) return pF;
  const pD = work(prev) ?? 0;
  const sD = work(s) ?? 0;
  if (pD <= 0 || sD <= 0) return pF;
  const pS = Math.max(pt.workStart ?? pt.start, pF - pD); // the previous step's own working time
  const first = pS + Math.min(pD, pD / sD); // one day of this step's work is ready
  const last = pF + Math.min(1, sD) - sD; // the last day's batch arrives at pF and still takes a day of this step
  return Math.min(pF, Math.max(first, last));
}

/** The step before `si` that has a time of its own (dispatch / landing without a rate are skipped). */
function realPrev(ss: PlannedStep[], si: number): number {
  let j = si - 1;
  while (j > 0 && ss[j]!.passThrough) j--;
  return j;
}

/** The order-wide schedule in working-day offsets from the received date. `actuals` = use finished steps' real dates. */
function scheduleOrder(steps: (PlannedStep[] | undefined)[], base: string, today: string, ctx: PlanContext, actuals: boolean): StepTimes[][] {
  const cal = ctx.cal;
  const off = (d: string) => workingDaysBetween(base, d, cal) ?? 0;
  const todayOff = off(today);
  const busy = new Map<string, Slot[][]>();
  const unitsOf = (pid: string) => {
    let u = busy.get(pid);
    if (!u) {
      u = Array.from({ length: Math.max(1, Math.floor(ctx.units?.get(pid) ?? 1)) }, () => []);
      busy.set(pid, u);
    }
    return u;
  };
  const res: StepTimes[][] = steps.map((ss) => (ss ?? []).map(() => ({ start: null, finish: null, queued: false })));
  const isDone = (s: PlannedStep) => actuals && !!s.doneAt;
  // 1. Finished steps, in the order they were finished.
  const done: { li: number; si: number; at: number }[] = [];
  steps.forEach((ss, li) => (ss ?? []).forEach((s, si) => isDone(s) && done.push({ li, si, at: off(dayOf(s.doneAt!)) })));
  done.sort((a, b) => a.at - b.at || a.si - b.si || a.li - b.li);
  // Real dates are kept for finished steps (a step may finish on a day off).
  const freeDate = new Map<Slot[], string>();
  for (const { li, si, at } of done) {
    const s = steps[li]![si]!;
    const doneDate = dayOf(s.doneAt!);
    const prevT = si === 0 ? null : res[li]![si - 1]!;
    const prevDate = prevT?.finishDate ?? base;
    let startDate = prevDate < doneDate ? prevDate : doneDate;
    if (s.processId) {
      const units = unitsOf(s.processId);
      let u = 0;
      units.forEach((sl, i) => {
        if ((freeDate.get(sl) ?? '') < (freeDate.get(units[u]!) ?? '')) u = i;
      });
      const free = freeDate.get(units[u]!) ?? '';
      const ready = prevDate > free ? prevDate : free;
      startDate = ready < doneDate ? ready : doneDate;
      units[u]!.push({ s: off(startDate), e: at });
      freeDate.set(units[u]!, doneDate);
    }
    // Started before the step before it was done (overlap): its own start counts.
    if (s.startedAt && dayOf(s.startedAt) < startDate) startDate = dayOf(s.startedAt) < (prevT?.startDate ?? base) ? (prevT?.startDate ?? base) : dayOf(s.startedAt);
    res[li]![si] = { start: off(startDate), finish: at, queued: false, startDate, finishDate: doneDate };
  }
  // 2. Steps already started hold their unit: the current one and any started with it (overlap).
  const first = steps.map((ss) => (ss ?? []).findIndex((s) => !isDone(s)));
  const started = (s: PlannedStep) => actuals && !!s.startedAt && !s.doneAt;
  /** Expected finish of a running step from its recorded output: the rest at the benchmark rate, from today. */
  const byOutput = (s: PlannedStep): number | null => {
    if (s.outputQty === null || s.outputQty === undefined || s.qty === null || s.perDay === null || s.fixedDays !== null) return null;
    const rest = Math.max(0, s.qty - s.outputQty);
    if (rest <= 1e-9) return todayOff;
    const loggedToday = (s.outputLog ?? []).some((e) => e.on >= today);
    return todayOff + (loggedToday ? 1 : 0) + rest / s.perDay;
  };
  steps.forEach((ss, li) => {
    const f = first[li]!;
    if (f < 0 || !ss) return;
    for (let si = f; si < ss.length && started(ss[si]!); si++) {
      const s = ss[si]!;
      const prevT = si === 0 ? null : res[li]![si - 1]!;
      const prev = prevT?.finish ?? 0;
      if (si === f) {
        const start = Math.max(prev, Math.min(off(dayOf(s.startedAt!)), todayOff));
        if (s.plannedDays === null) {
          res[li]![si] = { start: prev, finish: null, queued: false };
          break;
        }
        // As before: the step's time counts from the previous step's finish (waiting included).
        let finish = Math.max(prev + work(s)!, todayOff, start);
        const out = byOutput(s);
        if (out !== null) finish = Math.max(out, start);
        if (s.processId) unitsOf(s.processId)[0]!.push({ s: start, e: finish });
        const prevDate = si > 0 ? res[li]![si - 1]!.finishDate : undefined;
        res[li]![si] = { start: prev, finish, queued: false, workStart: start, ...(prevDate ? { startDate: prevDate } : {}) };
        continue;
      }
      // Started while the step before it is still running.
      if (!prevT || prevT.finish === null || s.plannedDays === null) {
        res[li]![si] = { start: null, finish: null, queued: false };
        break;
      }
      const startDate = dayOf(s.startedAt!) > today ? today : dayOf(s.startedAt!);
      const start = Math.max(prevT.workStart ?? prevT.start ?? 0, off(startDate));
      const len = work(s)!;
      let finish = Math.max(start + len, prevT.finish + Math.min(1, len), todayOff);
      const out = byOutput(s);
      if (out !== null) finish = Math.max(out, prevT.finish + Math.min(1, len), todayOff);
      if (s.processId) unitsOf(s.processId)[0]!.push({ s: start, e: finish });
      res[li]![si] = { start, finish, queued: false, workStart: start, startDate };
    }
  });
  // 3. Everything else, first come first served (5 Nov 2026): the step that can start
  // earliest is placed next; on a tie, the line listed first goes first.
  const ptr = steps.map((ss, li) => (ss ? Math.max(0, first[li]!) : 0));
  const stopped = steps.map((ss) => !ss);
  for (;;) {
    let pick: { li: number; si: number; ready: number; after: number } | null = null;
    steps.forEach((ss, li) => {
      if (stopped[li] || !ss) return;
      let si = ptr[li]!;
      // Skip what is already placed (finished or started); a started step without a time stops the line.
      // Steps without a time of their own (dispatch, landing without a rate) go with the step before.
      for (;;) {
        while (si < ss.length && (res[li]![si]!.finish !== null || started(ss[si]!))) {
          if (res[li]![si]!.finish === null) {
            si = ss.length;
            break;
          }
          si++;
        }
        if (si >= ss.length || !ss[si]!.passThrough) break;
        const pt = si === 0 ? null : res[li]![si - 1]!;
        if (!pt || pt.finish === null) break;
        const runningNow = actuals && si === first[li];
        res[li]![si] = { start: pt.start, finish: runningNow ? Math.max(pt.finish, todayOff) : pt.finish, queued: false, ...(pt.workStart !== undefined ? { workStart: pt.workStart } : {}), ...(pt.startDate ? { startDate: pt.startDate } : {}) };
        si++;
      }
      ptr[li] = si;
      if (si >= ss.length) return void (stopped[li] = true);
      const s = ss[si]!;
      const after = si === 0 ? 0 : res[li]![si - 1]!.finish;
      if (after === null || s.plannedDays === null) return void (stopped[li] = true); // unknown from here on
      let ready = si === 0 ? 0 : overlapReady(ss[realPrev(ss, si)]!, res[li]![si - 1]!, s);
      // A step that has not started cannot start in the past (the running step keeps its date).
      if (actuals && si > first[li]! && ready < todayOff) ready = Math.min(after, todayOff);
      if (!pick || ready < pick.ready - 1e-9) pick = { li, si, ready, after };
    });
    if (!pick) break;
    const { li, si, ready, after } = pick as { li: number; si: number; ready: number; after: number };
    const ss = steps[li]!;
    const s = ss[si]!;
    // "Materials ready": lasts until the last material is expected.
    const len = s.key === MATERIALS_KEY && s.readyBy ? Math.max(0, off(s.readyBy) - ready) : work(s)!;
    let start = ready;
    if (s.processId) {
      const units = unitsOf(s.processId);
      const [u, t] = earliestSlot(units, ready, len);
      start = t;
      units[u]!.push({ s: start, e: start + len });
    }
    let finish = start + len;
    const running = si === first[li] && actuals;
    if (running && start < todayOff && finish < todayOff) finish = todayOff; // running late: at the earliest today
    const prevDate = si > 0 ? res[li]![si - 1]!.finishDate : undefined;
    res[li]![si] = { start, finish, queued: start > ready + 1e-9, ...(Math.abs(start - after) <= 1e-9 && prevDate ? { startDate: prevDate } : {}) };
    ptr[li] = si + 1;
  }
  return res;
}

/** Whole-order plan: every line's progress and dates, and the plan per process. */
export function orderPlan(jo: StepOrder, today: string, ctx: PlanContext): OrderPlan {
  const cal = ctx.cal;
  const base = orderStart(jo);
  const planned = planLines(jo, ctx.md);
  const toBuy = planned.some((l) => l.steps?.length) ? planMaterials(jo, ctx.md).toBuy : [];
  const steps = planned.map((line) => {
    const ss = withPlanning(line.steps, jo, ctx);
    // Only orders that track material arrivals (confirmed from 5 Nov 2026, or switched on).
    if (!ss || !jo.materialDates || effectiveSupply(line, ctx.md.products.get(line.productId)) !== 'MAKE') return ss;
    let mat = materialsStep(jo, line, toBuy, ss[0]!);
    // Production already started or finished: the materials were there by then.
    const moved = ss.slice(1).flatMap((x) => [x.startedAt, x.doneAt]).filter((x): x is string => !!x).sort()[0];
    if (!mat.doneAt && moved) mat = { ...mat, doneAt: moved, readyBy: undefined, plannedDays: 0, workDays: 0, note: 'Production has started' };
    return [ss[0]!, mat, ...ss.slice(1)];
  });
  const at = (o: number) => (o <= 0 ? base : addWorkingDays(base, o, cal)!);
  const real = scheduleOrder(steps, base, today, ctx, true);
  const plan = scheduleOrder(steps, base, today, ctx, false);
  const todayOff = workingDaysBetween(base, today, cal) ?? 0;
  const lines: { line: PlannedLine; lp: LineProgress }[] = [];
  planned.forEach((line, li) => {
    const ss = steps[li];
    if (!ss || !ss.length) return;
    const lp = lineProgress(ss, base, today, cal)!;
    const times = real[li]!;
    const startOf = (i: number) => times[i]!.startDate ?? (times[i]!.start !== null ? at(times[i]!.start!) : null);
    lp.steps = lp.steps.map((v, i) => {
      if (v.state === 'DONE') {
        const startOn = startOf(i) ?? v.startOn!;
        const actualDays = Math.max(0, workingDaysBetween(startOn, v.doneOn!, cal) ?? 0);
        return { ...v, startOn, actualDays, overrunDays: overrunOf(v.step, actualDays), ...splitWait(startOn, v.step.startedAt, v.doneOn!, cal) };
      }
      if (v.state === 'NOW') {
        const startOn = startOf(i) ?? v.startOn!;
        if (startOn > today) return { ...v, startOn, actualDays: 0, overrunDays: null, queued: true };
        const actualDays = Math.max(0, workingDaysBetween(startOn, today, cal) ?? 0);
        return { ...v, startOn, actualDays, overrunDays: overrunOf(v.step, actualDays), ...splitWait(startOn, v.step.startedAt, today, cal) };
      }
      return v;
    });
    lp.current = lp.steps.find((v) => v.state === 'NOW') ?? null;
    lp.schedule = lp.steps.map((v, i) => ({
      view: v,
      start: v.state === 'DONE' ? v.startOn : startOf(i),
      finish: v.state === 'DONE' ? v.doneOn : times[i]!.finish !== null ? at(times[i]!.finish!) : null,
    }));
    const last = lp.schedule.at(-1)!;
    lp.expectedFinish = lp.done ? last.finish : last.finish;
    const span = plan[li]!.at(-1)?.finish ?? null;
    lp.plannedTotalDays = span;
    lp.plannedPct = span === null ? null : span > 0 ? Math.min(100, Math.round((Math.max(0, todayOff) / span) * 100)) : 100;
    lines.push({ line, lp });
  });
  // Per process (the "WO planning" view).
  const byProc = new Map<string, ProcessPlan>();
  lines.forEach(({ line, lp }) => {
    for (const st of lp.schedule!) {
      const s = st.view.step;
      if (!s.processId) continue;
      let pp = byProc.get(s.processId);
      if (!pp) {
        pp = { processId: s.processId, units: Math.max(1, Math.floor(ctx.units?.get(s.processId) ?? 1)), steps: [], start: null, finish: null, undated: 0 };
        byProc.set(s.processId, pp);
      }
      pp.steps.push({ lineId: line.id, product: s.forProduct, qty: s.qty, qtyUnit: s.qtyUnit, perDay: s.perDay, perDayUnit: s.perDayUnit, days: work(s), start: st.start, finish: st.finish, done: st.view.state === 'DONE' });
    }
  });
  const processes = [...byProc.values()].map((pp) => {
    const dated = pp.steps.filter((x) => x.start && x.finish);
    return { ...pp, start: dated.map((x) => x.start!).sort()[0] ?? null, finish: dated.map((x) => x.finish!).sort().at(-1) ?? null, undated: pp.steps.length - dated.length };
  });
  processes.sort((a, b) => (a.start ?? '9999').localeCompare(b.start ?? '9999'));
  return { lines, processes };
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
  if (lp.schedule) return lp.schedule;
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

/** What the Products tab shows as the expected date of one step (confirmed 28 Oct 2026). */
export type StepDate =
  | { kind: 'DONE' }
  /** Running, within its plan: expected to finish on `finish`. */
  | { kind: 'DUE'; finish: string; approx: boolean; earliest: boolean }
  /** Running past its plan: the finish is not known (never guessed). */
  | { kind: 'OVER'; overDays: number }
  /** Still to do: from `start` to `finish`. */
  | { kind: 'PLANNED'; start: string; finish: string; approx: boolean; earliest: boolean }
  /** No date: this step (`noTime`) or an earlier one has no time yet. */
  | { kind: 'UNKNOWN'; noTime: boolean };

export interface ReadyDate {
  /** null = not known yet (see `missing`). */
  date: string | null;
  /** Label of the first step without a time, when the date is not known. */
  missing: string | null;
  /** Depends on a step running past its plan (dates are "at the earliest"). */
  earliest: boolean;
  approx: boolean;
  /** Working days before (+) or after (−) the internal deadline. */
  spareDays: number | null;
  tone: 'ok' | 'tight' | 'late' | 'unknown';
}

/** Days before the internal deadline at or under which "Ready" is tight (same as the plan PDF). */
export const READY_TIGHT_DAYS = 2;

/**
 * Expected dates per step and the line's "Ready" date, from `lineSchedule()`
 * (the same dates as the plan PDF). A step running past its plan has no
 * expected finish; later steps are then "at the earliest" (counted as if it
 * finished today). From the first step without a time onwards: unknown.
 */
export function stepDates(lp: LineProgress, today: string, cal: WorkCalendar, internalDeadline: string): { steps: StepDate[]; ready: ReadyDate | null } {
  const sched = lineSchedule(lp, today, cal);
  let earliest = false;
  let approx = false;
  let missing: string | null = null;
  const steps = sched.map(({ view: v, start, finish }): StepDate => {
    if (v.state === 'DONE') return { kind: 'DONE' };
    if (missing !== null) return { kind: 'UNKNOWN', noTime: v.step.plannedDays === null };
    if (v.step.plannedDays === null || !start || !finish) {
      missing = v.step.label;
      return { kind: 'UNKNOWN', noTime: v.step.plannedDays === null };
    }
    approx ||= !!v.step.estimated;
    if (v.state === 'NOW') {
      if (v.overrunDays !== null && v.overrunDays > 0) {
        earliest = true;
        return { kind: 'OVER', overDays: v.overrunDays };
      }
      return { kind: 'DUE', finish, approx: !!v.step.estimated, earliest };
    }
    return { kind: 'PLANNED', start, finish, approx: !!v.step.estimated, earliest };
  });
  if (lp.done) return { steps, ready: null };
  const last = sched.at(-1)?.finish ?? null;
  const date = missing === null ? last : null;
  let spareDays: number | null = null;
  let tone: ReadyDate['tone'] = 'unknown';
  if (date) {
    if (date > internalDeadline) {
      spareDays = -(workingDaysBetween(internalDeadline, date, cal) ?? 0);
      tone = 'late';
    } else {
      spareDays = workingDaysBetween(date, internalDeadline, cal) ?? 0;
      tone = spareDays <= READY_TIGHT_DAYS ? 'tight' : 'ok';
    }
  }
  return { steps, ready: { date, missing, earliest, approx, spareDays, tone } };
}

/** One row of the "plan by process" table (the company's WO planning view, 5 Nov 2026). */
export interface ProcessPlanRow {
  processId: string;
  /** Total quantity per unit of measure ("6561 pcs"; never added across units). */
  qty: string;
  /** Output per working day per unit, e.g. "1650 / 1300 pcs" when products differ. */
  rate: string;
  units: number;
  /** Working days of work (sum of the steps ÷ parallel units); null when a time is missing. */
  days: number | null;
  start: string | null;
  finish: string | null;
  items: number;
  /** Items whose dates are not known yet (the finish is then "at the earliest"). */
  undated: number;
  done: boolean;
}

export function processPlanRows(plan: OrderPlan): ProcessPlanRow[] {
  return plan.processes.map((p) => {
    const byUnit = new Map<string, number>();
    for (const s of p.steps) if (s.qty !== null && s.qtyUnit) byUnit.set(s.qtyUnit, (byUnit.get(s.qtyUnit) ?? 0) + s.qty);
    const rateBy = new Map<string, Set<string>>();
    for (const s of p.steps) if (s.perDay !== null) rateBy.set(s.perDayUnit ?? '', (rateBy.get(s.perDayUnit ?? '') ?? new Set()).add(formatQty(s.perDay)));
    const rates = [...rateBy].map(([u, v]) => `${[...v].join(' / ')} ${unitLabel(u)}`);
    const known = p.steps.every((s) => s.days !== null);
    return {
      processId: p.processId,
      qty: [...byUnit].map(([u, q]) => `${formatQty(q)} ${unitLabel(u)}`).join(' + ') || '—',
      rate: rates.join(', ') || (known ? 'fixed days' : 'time pending'),
      units: p.units,
      days: known ? roundUpHalf(p.steps.reduce((a, s) => a + s.days!, 0) / p.units) : null,
      start: p.start,
      finish: p.finish,
      items: p.steps.length,
      undated: p.undated,
      done: p.steps.every((s) => s.done),
    };
  });
}
