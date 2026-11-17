/**
 * Scheduling within one Work Order (split out of route.ts, 15 Nov 2026): items share each
 * process (parallel units), steps of one item overlap like the company plan, and the item
 * order rule decides who goes first when items wait for the same unit. `orderPlan()` in
 * route.ts calls these; nothing here reads or writes data.
 */
import { workingDaysBetween, type WorkCalendar } from './calendar';
import type { JobOrder } from './jobOrders';
import { istDateKey } from './time';
import { PLANNING_KEY, type ItemOrder, type PlanContext, type PlannedLine, type PlannedStep } from './route';

const dayOf = (iso: string) => istDateKey(new Date(iso));

interface Slot {
  s: number;
  e: number;
}

/** Earliest start ≥ ready where [start, start + len] fits in one unit's free time; returns [unit, start]. */
export function earliestSlot(units: Slot[][], ready: number, len: number): [number, number] {
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
export const work = (s: PlannedStep): number | null => (s.plannedDays === null ? null : (s.workDays ?? s.plannedDays));

export type StepTimes = { start: number | null; finish: number | null; queued: boolean; startDate?: string; finishDate?: string; workStart?: number };

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

/**
 * Work left on a line from step `si` (working days): the planned time of the steps still to come,
 * a promised date counting until that date. Steps without a time count 0 (`unknown` says so).
 */
export function workLeft(ss: PlannedStep[], si: number, from: number, off: (d: string) => number): { days: number; unknown: boolean } {
  let days = 0;
  let unknown = false;
  for (let j = si; j < ss.length; j++) {
    const s = ss[j]!;
    if (s.passThrough && s.plannedDays === null) continue;
    if (s.readyBy) days += Math.max(0, off(s.readyBy) - from);
    else if (s.plannedDays === null) unknown = true;
    else days += work(s)!;
  }
  return { days, unknown };
}

/**
 * How items take turns at a process (15 Nov 2026). PRIORITY: the step that can really
 * start earliest goes next (a unit never waits idle for a more urgent item); items
 * waiting for the same unit at the same moment go Rush first, then the one with more
 * work AFTER this step, then in listed order. LISTED: the earlier rule (the step ready
 * first goes next, ties in listed order): WOs confirmed before the change keep it until
 * "Use item priority", and it is the comparison for the others.
 */
export type ItemOrderRule = 'PRIORITY' | 'LISTED';

/** The order-wide schedule in working-day offsets from the received date. `actuals` = use finished steps' real dates. */
export function scheduleOrder(
  steps: (PlannedStep[] | undefined)[],
  base: string,
  today: string,
  ctx: PlanContext,
  actuals: boolean,
  opts: { rush?: boolean[]; rule?: ItemOrderRule } = {},
): StepTimes[][] {
  const rule = opts.rule ?? 'PRIORITY';
  const rush = opts.rush ?? [];
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
        let finish = s.readyBy ? Math.max(off(s.readyBy), todayOff, start) : Math.max(prev + work(s)!, todayOff, start);
        const out = s.readyBy ? null : byOutput(s);
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
      let finish = s.readyBy ? Math.max(off(s.readyBy), todayOff, start) : Math.max(start + len, prevT.finish + Math.min(1, len), todayOff);
      const out = s.readyBy ? null : byOutput(s);
      if (out !== null) finish = Math.max(out, prevT.finish + Math.min(1, len), todayOff);
      if (s.processId) unitsOf(s.processId)[0]!.push({ s: start, e: finish });
      res[li]![si] = { start, finish, queued: false, workStart: start, startDate };
    }
  });
  // 3. Everything else (see ItemOrderRule).
  const ptr = steps.map((ss, li) => (ss ? Math.max(0, first[li]!) : 0));
  const stopped = steps.map((ss) => !ss);
  type Cand = { li: number; si: number; ready: number; after: number; at: number; rush: boolean; left: number };
  const better = (c: Cand, p: Cand): boolean => {
    if (rule === 'LISTED') return c.ready < p.ready - 1e-9;
    if (c.at < p.at - 1e-9) return true;
    if (c.at > p.at + 1e-9) return false;
    if (c.rush !== p.rush) return c.rush;
    return c.left > p.left + 1e-9; // equal: the line listed first stays
  };
  for (;;) {
    let pick: Cand | null = null;
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
      // "Waits for all items of this order" (17 Nov 2026): every other item first finishes its steps
      // before its own step of this process (all its steps when it has none).
      if (s.waitsForOrder) {
        let gate = 0;
        let wait = false;
        steps.forEach((oo, lj) => {
          if (lj === li || !oo || !oo.length) return;
          const k = s.processId ? oo.findIndex((x) => x.processId === s.processId) : -1;
          const end = k >= 0 ? k : oo.length;
          if (end === 0) return;
          const f = res[lj]![end - 1]!.finish;
          if (f === null) wait = true;
          else gate = Math.max(gate, f);
        });
        // Placed later, once the other items are; if one of them can never be dated, this step stays undated too.
        if (wait) return;
        ready = Math.max(ready, gate);
      }
      // A step that has not started cannot start in the past (the running step keeps its date).
      if (actuals && si > first[li]! && ready < todayOff) ready = Math.min(after, todayOff);
      let at = ready;
      if (rule === 'PRIORITY' && s.processId) {
        const len = s.readyBy ? Math.max(0, off(s.readyBy) - ready) : work(s)!;
        at = earliestSlot(unitsOf(s.processId), ready, len)[1];
      }
      const cand: Cand = { li, si, ready, after, at, rush: !!rush[li], left: rule === 'PRIORITY' ? workLeft(ss, si + 1, ready, off).days : 0 };
      if (!pick || better(cand, pick)) pick = cand;
    });
    if (!pick) break;
    const { li, si, ready, after } = pick as Cand;
    const ss = steps[li]!;
    const s = ss[si]!;
    // "Materials ready", a bought item or outside work with a promised date: lasts until that date.
    const len = s.readyBy ? Math.max(0, off(s.readyBy) - ready) : work(s)!;
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


/** Drafts always use the priority; confirmed WOs the rule saved on them (none saved = confirmed before 15 Nov 2026 = LISTED). */
export function itemOrderRuleOf(jo: { status: JobOrder['status']; itemOrderRule?: ItemOrderRule }): ItemOrderRule {
  return jo.status === 'DRAFT' ? 'PRIORITY' : (jo.itemOrderRule ?? 'LISTED');
}

export function itemOrderOf(
  rule: ItemOrderRule,
  planned: PlannedLine[],
  steps: (PlannedStep[] | undefined)[],
  prio: StepTimes[][],
  listed: StepTimes[][],
  base: string,
  today: string,
  cal: WorkCalendar,
  at: (o: number) => string,
): ItemOrder {
  const off = (d: string) => workingDaysBetween(base, d, cal) ?? 0;
  const todayOff = off(today);
  const withSteps = planned.map((line, li) => ({ line, li, ss: steps[li] })).filter((x) => x.ss && x.ss.length);
  const lastReady = (times: StepTimes[][]): string | null => {
    let best: number | null = null;
    for (const { li } of withSteps) {
      const f = times[li]!.at(-1)?.finish ?? null;
      if (f === null) return null;
      best = best === null ? f : Math.max(best, f);
    }
    return best === null ? null : at(best);
  };
  const items = withSteps
    .map(({ line, li, ss }) => {
      const from = ss!.findIndex((s) => !s.doneAt);
      const left = from < 0 ? { days: 0, unknown: false } : workLeft(ss!, from + 1, todayOff, off);
      const now = from < 0 ? null : ss![from]!;
      return { li, lineId: line.id, product: line.productName, rush: !!line.rush, step: now ? (now.key === PLANNING_KEY ? 'Planning' : now.label) : null, daysLeft: Math.round(left.days * 2) / 2, partUnknown: left.unknown };
    })
    .sort((a, b) => (rule === 'LISTED' ? a.li - b.li : Number(b.rush) - Number(a.rush) || b.daysLeft - a.daysLeft || a.li - b.li))
    .map(({ lineId, product, rush, step, daysLeft, partUnknown }) => ({ lineId, product, rush, step, daysLeft, partUnknown }));
  const readyPriority = lastReady(prio);
  const readyListed = lastReady(listed);
  return {
    rule,
    items,
    ready: rule === 'PRIORITY' ? readyPriority : readyListed,
    readyPriority,
    readyListed,
    gainDays: readyPriority && readyListed ? workingDaysBetween(readyPriority, readyListed, cal) : null,
  };
}

