/**
 * Dashboard: one process across all confirmed WOs (confirmed 17 Nov 2026).
 * The department reports one total for the day; the app fills the items in plan order
 * (the order the plan works them: earliest planned start first, Rush included through the
 * plan), each up to what it still needs. No manual re-ordering: the plan decides.
 */
import { formatDay, type JobOrder, type JoLine, type JoStep } from './jobOrders';
import { addOutput, canStart, completeCurrent, isBuiltIn, lineSchedule, orderPlan, startStepAt, stepTime, type PlanContext, type StepView } from './route';
import { formatQty, unitLabel } from './units';

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
  made: number;
  left: number | null;
  /** Planned start of this step (plan order). */
  start: string | null;
  internalDeadline: string;
  state: 'NOW' | 'TODO';
  started: boolean;
  /** Can take output on `date`: started, or may start (step before started / done) on or after its earliest day. */
  open: boolean;
  /** Why it cannot take output now. */
  waiting: string | null;
  /** Earliest day output can be recorded (a plan date never blocks: the factory may work ahead). */
  minDate: string | null;
  /** First open step of its line: can be marked done. */
  firstOpen: boolean;
  overDays: number;
}

const dayOf = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);

/** Steps of `processId` not done yet, on confirmed WOs, in plan order. */
export function boardRows(jos: (JobOrder & { id: string })[], processId: string, date: string, today: string, ctx: PlanContext): BoardRow[] {
  const rows: BoardRow[] = [];
  for (const jo of jos) {
    if (jo.status !== 'CONFIRMED') continue;
    const plan = orderPlan(jo, today, ctx);
    plan.lines.forEach(({ line, lp }) => {
      const raw = jo.lines.find((l) => l.id === line.id)?.steps ?? [];
      const no = jo.lines.findIndex((l) => l.id === line.id) + 1;
      const firstOpenRaw = raw.findIndex((s) => !s.doneAt);
      for (const sc of lineSchedule(lp, today, ctx.cal)) {
        const v: StepView = sc.view;
        const s = v.step;
        if (v.state === 'DONE' || isBuiltIn(s) || s.processId !== processId || s.outsideOf) continue;
        const i = raw.findIndex((x) => x.key === s.key);
        if (i < 0) continue;
        const started = !!raw[i]!.startedAt;
        const startable = started || canStart(raw, i);
        const prev = raw[i - 1];
        const minDate = started ? dayOf(raw[i]!.startedAt) : i === firstOpenRaw ? (dayOf(prev?.doneAt) ?? dayOf(jo.confirmedOn)) : (dayOf(prev?.startedAt) ?? dayOf(prev?.doneAt));
        const tooEarly = !!minDate && date < minDate;
        const made = s.outputQty ?? 0;
        rows.push({
          joId: jo.id,
          joNumber: jo.joNumber,
          lineId: line.id,
          no,
          product: s.forProduct || line.productName,
          stepKey: s.key,
          label: s.label,
          rawIndex: i,
          unit: s.qtyUnit ?? null,
          qty: s.qty,
          made,
          left: s.qty !== null ? Math.max(0, s.qty - made) : null,
          start: sc.start,
          internalDeadline: jo.deadline.internalDeadline,
          state: v.state,
          started,
          open: startable && !tooEarly && s.qty !== null && !!s.qtyUnit,
          waiting: !startable ? `waits for ${prev?.label ?? 'the step before'}` : tooEarly ? `not before ${formatDay(minDate!)}` : s.qty === null || !s.qtyUnit ? 'quantity not known' : null,
          minDate,
          firstOpen: i === firstOpenRaw,
          overDays: v.overrunDays && v.overrunDays > 0 ? v.overrunDays : 0,
        });
      }
    });
  }
  // Plan order: running first, then by planned start; ties by internal deadline, WO, product.
  return rows.sort(
    (a, b) =>
      Number(b.state === 'NOW') - Number(a.state === 'NOW') ||
      (a.start ?? '9999').localeCompare(b.start ?? '9999') ||
      a.internalDeadline.localeCompare(b.internalDeadline) ||
      a.joNumber.localeCompare(b.joNumber) ||
      a.no - b.no,
  );
}

export interface Allocation {
  /** key `${joId}|${lineId}|${stepKey}` → quantity in the unit. */
  given: Map<string, number>;
  /** More than every open item still needs. */
  extra: number;
}

export const rowKey = (r: Pick<BoardRow, 'joId' | 'lineId' | 'stepKey'>) => `${r.joId}|${r.lineId}|${r.stepKey}`;

/** Fills the open rows of `unit` in plan order, each up to what it still needs. */
export function allocate(rows: BoardRow[], total: number, unit: string): Allocation {
  const given = new Map<string, number>();
  let rest = total > 0 ? total : 0;
  for (const r of rows) {
    if (rest <= 1e-9) break;
    if (!r.open || r.unit !== unit || r.left === null || r.left <= 1e-9) continue;
    const q = Math.min(rest, r.left);
    given.set(rowKey(r), q);
    rest -= q;
  }
  return { given, extra: rest > 1e-9 ? rest : 0 };
}

export interface BoardWrite {
  joId: string;
  lines: JoLine[];
  what: string;
}

/**
 * The writes for an allocation: per WO, the steps get their start (when not started yet, on
 * `date`) and the output; items whose whole quantity is now made are marked done only when
 * `markDone` is true and the step is its line's first open step.
 */
export function boardWrites(jos: (JobOrder & { id: string })[], rows: BoardRow[], alloc: Allocation, processName: string, date: string, today: string, markDone: boolean, now = new Date()): { writes: BoardWrite[]; done: string[]; notDone: string[] } {
  const writes: BoardWrite[] = [];
  const done: string[] = [];
  const notDone: string[] = [];
  const byJo = new Map<string, BoardRow[]>();
  for (const r of rows) if (alloc.given.has(rowKey(r))) byJo.set(r.joId, [...(byJo.get(r.joId) ?? []), r]);
  for (const [joId, list] of byJo) {
    const jo = jos.find((j) => j.id === joId);
    if (!jo) continue;
    const steps = new Map<string, JoStep[]>(jo.lines.map((l) => [l.id, l.steps ?? []]));
    const parts: string[] = [];
    for (const r of list) {
      const q = alloc.given.get(rowKey(r))!;
      let raw = steps.get(r.lineId)!;
      if (!raw[r.rawIndex]!.startedAt) raw = startStepAt(raw, r.rawIndex, stepTime(date, today, now)) ?? raw;
      raw = addOutput(raw, r.rawIndex, { on: date, qty: q, unit: r.unit!, at: now.toISOString() }) ?? raw;
      let text = `${formatQty(q)} ${unitLabel(r.unit!)} (${r.no}. ${r.product})`;
      if (r.left !== null && q >= r.left - 1e-9) {
        if (markDone && r.firstOpen) {
          raw = completeCurrent(raw, stepTime(date, today, now)) ?? raw;
          text += ' - done';
          done.push(`${r.joNumber} · ${r.no}. ${r.product}`);
        } else if (!r.firstOpen) notDone.push(`${r.joNumber} · ${r.no}. ${r.product}`);
      }
      steps.set(r.lineId, raw);
      parts.push(text);
    }
    writes.push({
      joId,
      lines: jo.lines.map((l) => (steps.has(l.id) ? { ...l, steps: steps.get(l.id)! } : l)),
      what: `${processName} on ${formatDay(date)}: ${parts.join(', ')} (from the dashboard)`,
    });
  }
  return { writes, done, notDone };
}

/** Items whose whole remaining quantity this allocation covers (to ask "mark done?"). */
export function completes(rows: BoardRow[], alloc: Allocation): BoardRow[] {
  return rows.filter((r) => {
    const q = alloc.given.get(rowKey(r));
    return q !== undefined && r.left !== null && q >= r.left - 1e-9;
  });
}
