/**
 * Dashboard (confirmed 17 Nov 2026): one card per process, in the order the factory works
 * them, with the state of that process across all open confirmed WOs; "Update now" takes the
 * department's figure and fills the items automatically in plan order (no manual re-ordering:
 * priorities are set in the plan).
 *  - In-house: the figure is the total made so far on that day (each update replaces the
 *    day's running total; the app adds only the difference).
 *  - Outside work: Dispatched / Landed with the quantity of that lot (several lots allowed).
 */
import { prevLimit } from './stepUpdates';
import { workingDaysBetween } from './calendar';
import { formatDay, type JobOrder, type JoLine, type JoStep } from './jobOrders';
import type { Department, Process } from './masters';
import { processUnits } from './masters';
import { addOutput, canStart, isBuiltIn, lineSchedule, orderPlan, startStepAt, stepTime, type PlanContext, type StepView } from './route';
import { istTimeKey } from './time';
import { formatQty, unitLabel } from './units';

export type BoardMode = 'MAKE' | 'DISPATCH' | 'LAND';
type Jo = JobOrder & { id: string };

const dayOf = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);
const sum = (log: JoStep['outputLog'], unit: string | null) => (log ?? []).filter((e) => !unit || e.unit === unit).reduce((a, e) => a + e.qty, 0);
/** Process of a step for the board: its own process, or the outside process for dispatch / landing. */
const procOf = (s: Pick<JoStep, 'processId' | 'outsideOf'>) => s.processId ?? s.outsideOf ?? null;
const isDispatch = (s: JoStep) => !!s.outsideOf && !!s.passThrough && s.label.startsWith('Dispatch');
const isLanding = (s: JoStep) => !!s.outsideOf && !isDispatch(s);

/**
 * The order the factory works the processes: from the step order of every WO line and product
 * route (a process before the ones that follow it); ties and loops by average place in the routes.
 */
export function processOrder(sequences: string[][], ids: string[]): string[] {
  const after = new Map<string, Set<string>>();
  const pos = new Map<string, number[]>();
  for (const seq of sequences) {
    const s = seq.filter((p, i) => p && seq[i - 1] !== p);
    s.forEach((p, i) => pos.set(p, [...(pos.get(p) ?? []), s.length > 1 ? i / (s.length - 1) : 0]));
    for (let i = 0; i + 1 < s.length; i++) if (s[i] !== s[i + 1]) after.set(s[i]!, new Set([...(after.get(s[i]!) ?? []), s[i + 1]!]));
  }
  const avg = (p: string) => {
    const v = pos.get(p);
    return v ? v.reduce((a, b) => a + b, 0) / v.length : 2;
  };
  const all = [...new Set([...ids, ...pos.keys()])];
  const into = new Map(all.map((p) => [p, 0]));
  for (const [a, set] of after) for (const b of set) if (a !== b && into.has(b)) into.set(b, into.get(b)! + 1);
  const out: string[] = [];
  const left = new Set(all);
  while (left.size > 0) {
    const ready = [...left].filter((p) => into.get(p) === 0);
    // A loop (A before B in one route, B before A in another): take the earliest on average.
    const pick = (ready.length ? ready : [...left]).sort((a, b) => avg(a) - avg(b) || a.localeCompare(b))[0]!;
    out.push(pick);
    left.delete(pick);
    for (const b of after.get(pick) ?? []) if (left.has(b)) into.set(b, into.get(b)! - 1);
  }
  return out.filter((p) => ids.includes(p));
}

export interface ProcessCard {
  processId: string;
  name: string;
  department: (Department & { id: string }) | null;
  outside: boolean;
  /** Items (one product step each) on open confirmed WOs. */
  items: number;
  done: number;
  running: number;
  next: number;
  units: string[];
  /** Made (outside: landed) and total, when all items are in one unit. */
  made: number | null;
  total: number | null;
  dispatched: number | null;
  /** % done: quantity share (one unit) or the average item % (several units); null = no quantities. */
  pct: number | null;
  /** Where it should be today by the plan; null when no item is dated. */
  planned: number | null;
  overItems: number;
  /** "500 pcs/day", "350–550 pcs/day", "2 days"; null = no benchmark. */
  benchmark: string | null;
  parallel: number;
  /** Last update on the latest day with output: "17 Nov 2026 11:40". */
  lastUpdate: string | null;
  /** Some item has a step without a quantity. */
  qtyMissing: boolean;
}

interface Item {
  view: StepView; // the process step (outside: the outside step)
  start: string | null;
  finish: string | null;
  qty: number | null;
  unit: string | null;
  made: number;
  dispatched: number;
  done: boolean;
  running: boolean;
  logs: NonNullable<JoStep['outputLog']>;
}

function itemsOf(jos: Jo[], processId: string, today: string, ctx: PlanContext): Item[] {
  const items: Item[] = [];
  for (const jo of jos) {
    if (jo.status !== 'CONFIRMED') continue;
    for (const { lp } of orderPlan(jo, today, ctx).lines) {
      const sched = lineSchedule(lp, today, ctx.cal);
      sched.forEach((sc, k) => {
        const s = sc.view.step;
        // Only what is really produced: a step with nothing to make (all from stock) is left out.
        if (s.processId !== processId || isBuiltIn(s) || s.qty === 0) return;
        if (s.outside) {
          // The group dispatch → outside → landing just around this step.
          const before = sched[k - 1];
          const disp = before && before.view.step.outsideOf === processId && isDispatch(before.view.step) ? before : null;
          const land = sched[k + 1]?.view.step.outsideOf === processId ? sched[k + 1]! : null;
          const done = (land ?? sc).view.state === 'DONE';
          const qty = s.qty;
          const landed = land ? (land.view.state === 'DONE' ? (qty ?? 0) : sum(land.view.step.outputLog, s.qtyUnit ?? null)) : done ? (qty ?? 0) : 0;
          const sent = disp ? (disp.view.state === 'DONE' ? (qty ?? 0) : sum(disp.view.step.outputLog, s.qtyUnit ?? null)) : 0;
          items.push({
            view: sc.view,
            start: disp?.start ?? sc.start,
            finish: land?.finish ?? sc.finish,
            qty,
            unit: s.qtyUnit ?? null,
            made: landed,
            dispatched: Math.max(sent, landed),
            done,
            running: !done && (sent > 0 || sc.view.state === 'NOW' || !!s.startedAt),
            logs: [...(disp?.view.step.outputLog ?? []), ...(land?.view.step.outputLog ?? [])],
          });
          return;
        }
        const done = sc.view.state === 'DONE';
        items.push({
          view: sc.view,
          start: sc.start,
          finish: sc.finish,
          qty: s.qty,
          unit: s.qtyUnit ?? null,
          made: done ? (s.qty ?? 0) : (s.outputQty ?? 0),
          dispatched: 0,
          done,
          running: !done && (!!s.startedAt || (s.outputQty ?? 0) > 0),
          logs: s.outputLog ?? [],
        });
      });
    }
  }
  return items;
}

function plannedShare(it: Item, today: string, ctx: PlanContext): number | null {
  if (it.done) return 1;
  if (!it.start || !it.finish) return null;
  if (today < it.start) return 0;
  if (today >= it.finish) return 1;
  const span = workingDaysBetween(it.start, it.finish, ctx.cal);
  const gone = workingDaysBetween(it.start, today, ctx.cal);
  return span && gone !== null ? Math.min(1, Math.max(0, gone / span)) : null;
}

function benchmarkText(items: Item[]): string | null {
  const rates = items.map((i) => i.view.step).filter((s) => s.perDay && s.perDayUnit);
  if (rates.length) {
    const units = [...new Set(rates.map((s) => s.perDayUnit!))];
    return units
      .map((u) => {
        const v = rates.filter((s) => s.perDayUnit === u).map((s) => s.perDay!);
        const lo = Math.min(...v);
        const hi = Math.max(...v);
        return `${lo === hi ? formatQty(lo) : `${formatQty(lo)}–${formatQty(hi)}`} ${unitLabel(u)}/day`;
      })
      .join(' · ');
  }
  const fixed = [...new Set(items.map((i) => i.view.step.fixedDays).filter((d): d is number => !!d))];
  return fixed.length ? `${fixed.map(formatQty).join(' / ')} day${fixed.length === 1 && fixed[0] === 1 ? '' : 's'}` : null;
}

const timeOf = (e: { time?: string; at: string }) => e.time ?? istTimeKey(new Date(e.at));

function lastUpdateText(items: Item[]): string | null {
  const all = items.flatMap((i) => i.logs);
  if (!all.length) return null;
  const key = (e: (typeof all)[number]) => `${e.on} ${timeOf(e)}`;
  const last = all.reduce((a, b) => (key(b) > key(a) ? b : a));
  return `${formatDay(last.on)} ${timeOf(last)}`;
}

/** One card per active process, in working order; processes without work stay (shown faded). */
export function processCards(jos: Jo[], processes: (Process & { id: string })[], departments: (Department & { id: string })[], today: string, ctx: PlanContext): ProcessCard[] {
  const active = processes.filter((p) => p.active !== false);
  const sequences: string[][] = [];
  for (const jo of jos) for (const l of jo.lines) if (l.steps?.length) sequences.push(l.steps.map(procOf).filter((p): p is string => !!p));
  for (const p of ctx.md.products.values()) if (p.route?.length) sequences.push(p.route.map((r) => r.processId));
  const order = processOrder(sequences, active.map((p) => p.id));
  return order.map((id) => {
    const p = active.find((x) => x.id === id)!;
    const items = itemsOf(jos, id, today, ctx);
    const units = [...new Set(items.map((i) => i.unit).filter((u): u is string => !!u))];
    const withQty = items.filter((i) => i.qty !== null && i.qty > 0);
    const one = units.length === 1 ? units[0]! : null;
    const made = one ? withQty.reduce((a, i) => a + Math.min(i.made, i.qty!), 0) : null;
    const total = one ? withQty.reduce((a, i) => a + i.qty!, 0) : null;
    const pct = !withQty.length ? (items.length && items.every((i) => i.done) ? 100 : null) : one ? (made! / total!) * 100 : (withQty.reduce((a, i) => a + Math.min(1, i.made / i.qty!), 0) / withQty.length) * 100;
    const shares = withQty.map((i) => ({ i, s: plannedShare(i, today, ctx) })).filter((x) => x.s !== null);
    const planned = !shares.length ? null : one ? (shares.reduce((a, x) => a + x.s! * x.i.qty!, 0) / shares.reduce((a, x) => a + x.i.qty!, 0)) * 100 : (shares.reduce((a, x) => a + x.s!, 0) / shares.length) * 100;
    const isOutside = items.some((i) => !!i.view.step.outside) || [...ctx.md.products.values()].some((pr) => pr.route?.some((r) => r.processId === id && r.outside));
    return {
      processId: id,
      name: p.name,
      department: departments.find((d) => d.active !== false && (d.processIds ?? []).includes(id)) ?? null,
      outside: isOutside,
      items: items.length,
      done: items.filter((i) => i.done).length,
      running: items.filter((i) => i.running).length,
      next: items.filter((i) => !i.done && !i.running).length,
      units,
      made,
      total,
      dispatched: one && isOutside ? withQty.reduce((a, i) => a + Math.min(i.dispatched, i.qty!), 0) : null,
      pct: pct === null ? null : Math.floor(pct),
      planned: planned === null ? null : Math.round(planned),
      overItems: items.filter((i) => !i.view.step.outside && (i.view.overrunDays ?? 0) > 0 && !i.done).length,
      benchmark: benchmarkText(items),
      parallel: processUnits(p),
      lastUpdate: lastUpdateText(items),
      qtyMissing: items.some((i) => i.qty === null),
    };
  });
}

export interface BoardRow {
  joId: string;
  joNumber: string;
  lineId: string;
  /** Place of the product on its WO (1, 2, 3 …). */
  no: number;
  product: string;
  stepKey: string;
  label: string;
  rawIndex: number;
  unit: string | null;
  qty: number | null;
  /** Made so far (dispatch: dispatched; landing: landed). */
  made: number;
  /** What this update can still put on the item. */
  left: number | null;
  /** Recorded on `date` for this step (in-house: part of the day's running total). */
  onDate: number;
  start: string | null;
  internalDeadline: string;
  state: 'NOW' | 'TODO';
  started: boolean;
  open: boolean;
  waiting: string | null;
  /** Whole quantity reached: the raw steps up to this index can be marked done (null = the step before is not done). */
  finishUpTo: number | null;
  overDays: number;
  /** What the step before has made so far still covers (this step's unit); null = no limit (18 Nov 2026). */
  prevLeft: number | null;
  prevLabel: string | null;
}

/** The items an update of `processId` goes to, in plan order. */
export function boardRows(jos: Jo[], processId: string, date: string, today: string, ctx: PlanContext, mode: BoardMode = 'MAKE'): BoardRow[] {
  const rows: BoardRow[] = [];
  for (const jo of jos) {
    if (jo.status !== 'CONFIRMED') continue;
    const confirmed = dayOf(jo.confirmedOn);
    orderPlan(jo, today, ctx).lines.forEach(({ line, lp }) => {
      const raw = jo.lines.find((l) => l.id === line.id)?.steps ?? [];
      const no = jo.lines.findIndex((l) => l.id === line.id) + 1;
      const firstOpen = raw.findIndex((s) => !s.doneAt);
      for (const sc of lineSchedule(lp, today, ctx.cal)) {
        const v: StepView = sc.view;
        const s = v.step;
        if (v.state === 'DONE' || isBuiltIn(s) || s.qty === 0) continue;
        const want = mode === 'MAKE' ? s.processId === processId && !s.outside && !s.outsideOf : s.outsideOf === processId && (mode === 'DISPATCH' ? isDispatch(s) : isLanding(s));
        if (!want) continue;
        const i = raw.findIndex((x) => x.key === s.key);
        if (i < 0) continue;
        const unit = s.qtyUnit ?? null;
        const qty = s.qty;
        const made = mode === 'MAKE' ? (s.outputQty ?? 0) : sum(s.outputLog, unit);
        let cap = qty;
        if (mode === 'LAND') {
          const disp = raw.slice(0, i).reverse().find((x) => x.outsideOf === processId && isDispatch(x));
          const sent = disp ? (disp.doneAt ? (qty ?? 0) : sum(disp.outputLog, unit)) : 0;
          if (sent > 0) cap = Math.min(sent, qty ?? sent);
        }
        const started = !!raw[i]!.startedAt;
        const startable = mode !== 'MAKE' || started || canStart(raw, i);
        const prev = raw[i - 1];
        const minDate = mode !== 'MAKE' ? confirmed : started ? dayOf(raw[i]!.startedAt) : i === firstOpen ? (dayOf(prev?.doneAt) ?? confirmed) : (dayOf(prev?.startedAt) ?? dayOf(prev?.doneAt));
        const tooEarly = !!minDate && date < minDate;
        const left = cap !== null ? Math.max(0, cap - made) : null;
        const lim = mode === 'LAND' ? null : prevLimit(lp.steps, s.key);
        const prevLeft = lim && lim.unit === unit ? Math.max(0, lim.allowed - made) : null;
        // Done in order: in-house / dispatch only when it is the first open step; landing also
        // closes the dispatch / outside steps of the same process just before it.
        const group = (x: JoStep) => x.outsideOf === processId || (x.processId === processId && !!x.outside);
        const canFinish = firstOpen >= 0 && firstOpen <= i && raw.slice(firstOpen, i).every((x) => mode === 'LAND' && group(x));
        const full = left !== null && left <= 1e-9;
        rows.push({
          joId: jo.id,
          joNumber: jo.joNumber,
          lineId: line.id,
          no,
          product: s.forProduct || line.productName,
          stepKey: s.key,
          label: s.label,
          rawIndex: i,
          unit,
          qty,
          made,
          left,
          onDate: (s.outputLog ?? []).filter((e) => e.on === date && (!unit || e.unit === unit)).reduce((a, e) => a + e.qty, 0),
          start: sc.start,
          internalDeadline: jo.deadline.internalDeadline,
          state: v.state,
          started,
          open: startable && !tooEarly && qty !== null && !!unit && !full,
          waiting: !startable
            ? `waits for ${prev?.label ?? 'the step before'}`
            : tooEarly
              ? `not before ${formatDay(minDate!)}`
              : qty === null || !unit
                ? 'quantity not known'
                : full
                  ? mode === 'LAND' && cap !== qty
                    ? 'all dispatched has landed'
                    : 'whole quantity recorded · mark done on the WO'
                  : null,
          finishUpTo: canFinish ? i : null,
          overDays: v.overrunDays && v.overrunDays > 0 ? v.overrunDays : 0,
          prevLeft,
          prevLabel: lim?.prevLabel ?? null,
        });
      }
    });
  }
  return rows.sort(
    (a, b) =>
      Number(b.state === 'NOW') - Number(a.state === 'NOW') ||
      (a.start ?? '9999').localeCompare(b.start ?? '9999') ||
      a.internalDeadline.localeCompare(b.internalDeadline) ||
      a.joNumber.localeCompare(b.joNumber) ||
      a.no - b.no,
  );
}

/** In-house: what the day's running total adds to what is already recorded that day (add null = less than recorded). */
export function addedSince(rows: BoardRow[], unit: string, soFar: number): { already: number; add: number | null } {
  const already = rows.filter((r) => r.unit === unit).reduce((a, r) => a + r.onDate, 0);
  const add = soFar - already;
  return { already, add: add < -1e-9 ? null : Math.max(0, add) };
}

export interface Allocation {
  /** key `${joId}|${lineId}|${stepKey}` → quantity in the unit. */
  given: Map<string, number>;
  /** More than every open item can take. */
  extra: number;
}

export const rowKey = (r: Pick<BoardRow, 'joId' | 'lineId' | 'stepKey'>) => `${r.joId}|${r.lineId}|${r.stepKey}`;

/** Fills the open rows of `unit` in plan order, each up to what it can still take. */
export function allocate(rows: BoardRow[], total: number, unit: string): Allocation {
  const given = new Map<string, number>();
  let rest = total > 0 ? total : 0;
  // First what the step before already covers (18 Nov 2026), then the rest up to each item's quantity.
  for (const pass of [0, 1]) {
    for (const r of rows) {
      if (rest <= 1e-9) break;
      if (!r.open || r.unit !== unit || r.left === null || r.left <= 1e-9) continue;
      const had = given.get(rowKey(r)) ?? 0;
      const room = (pass === 0 && r.prevLeft !== null ? Math.min(r.left, r.prevLeft) : r.left) - had;
      if (room <= 1e-9) continue;
      const q = Math.min(rest, room);
      given.set(rowKey(r), had + q);
      rest -= q;
    }
  }
  return { given, extra: rest > 1e-9 ? rest : 0 };
}

/** Items whose WHOLE quantity this allocation reaches (to ask "mark done?"). */
export function completes(rows: BoardRow[], alloc: Allocation): BoardRow[] {
  return rows.filter((r) => {
    const q = alloc.given.get(rowKey(r));
    return q !== undefined && r.qty !== null && r.made + q >= r.qty - 1e-9;
  });
}

export interface BoardWrite {
  joId: string;
  lines: JoLine[];
  what: string;
}

const MODE_TEXT: Record<BoardMode, string> = { MAKE: '', DISPATCH: ' dispatched', LAND: ' landed' };

/**
 * The writes for an allocation, per WO: in-house steps get their start (on `date`, when not
 * started yet) and the output (with the time); items whose whole quantity is reached are marked
 * done only when `markDone` is true and the steps before are done (landing: also the dispatch /
 * outside steps of that process).
 */
export function boardWrites(jos: Jo[], rows: BoardRow[], alloc: Allocation, processName: string, date: string, time: string, today: string, markDone: boolean, mode: BoardMode = 'MAKE', now = new Date()): { writes: BoardWrite[]; done: string[]; notDone: string[] } {
  const writes: BoardWrite[] = [];
  const done: string[] = [];
  const notDone: string[] = [];
  const whole = new Set(completes(rows, alloc).map(rowKey));
  const byJo = new Map<string, BoardRow[]>();
  for (const r of rows) if (alloc.given.has(rowKey(r))) byJo.set(r.joId, [...(byJo.get(r.joId) ?? []), r]);
  const at = stepTime(date, today, now);
  for (const [joId, list] of byJo) {
    const jo = jos.find((j) => j.id === joId);
    if (!jo) continue;
    const steps = new Map<string, JoStep[]>(jo.lines.map((l) => [l.id, l.steps ?? []]));
    const parts: string[] = [];
    for (const r of list) {
      const q = alloc.given.get(rowKey(r))!;
      let raw = steps.get(r.lineId)!;
      if (mode === 'MAKE' && !raw[r.rawIndex]!.startedAt) raw = startStepAt(raw, r.rawIndex, at) ?? raw;
      raw = addOutput(raw, r.rawIndex, { on: date, time, qty: q, unit: r.unit!, at: now.toISOString() }) ?? raw;
      const name = `${r.no}. ${r.product}`;
      let text = `${formatQty(q)} ${unitLabel(r.unit!)} (${name})`;
      if (whole.has(rowKey(r))) {
        if (markDone && r.finishUpTo !== null) {
          raw = raw.map((s, j) => (j <= r.finishUpTo! && !s.doneAt ? { ...s, doneAt: at } : s));
          text += ' - done';
          done.push(`${r.joNumber} · ${name}`);
        } else if (r.finishUpTo === null) notDone.push(`${r.joNumber} · ${name}`);
      }
      steps.set(r.lineId, raw);
      parts.push(text);
    }
    writes.push({
      joId,
      lines: jo.lines.map((l) => (steps.has(l.id) ? { ...l, steps: steps.get(l.id)! } : l)),
      what: `${processName}${MODE_TEXT[mode]} on ${formatDay(date)} ${time}: ${parts.join(', ')} (from the dashboard)`,
    });
  }
  return { writes, done, notDone };
}

/** Items given more than the step before has made so far covers (asked before saving, 18 Nov 2026). */
export function overPrevRows(rows: BoardRow[], alloc: Allocation): BoardRow[] {
  return rows.filter((r) => {
    const q = alloc.given.get(rowKey(r));
    return q !== undefined && r.prevLeft !== null && q > r.prevLeft + 1e-9;
  });
}
