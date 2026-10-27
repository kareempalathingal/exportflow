/**
 * Look ahead (confirmed 27 Oct 2026): what the coming days / weeks hold, from the
 * step plans of CONFIRMED orders only. Department load is relative (capacity is not
 * known yet): per week the orders with a step there, the jobs running at the same
 * time on an average and on the busiest day, and the quantity per process (spread
 * evenly over each step's working days; never summed across processes or units).
 * Deterministic; dates YYYY-MM-DD (IST), weeks Monday–Sunday.
 */
import { addDays, daysBetween, formatDay } from './dates';
import { isWorkingDay, weekday, type WorkCalendar } from './calendar';
import type { JobOrder } from './jobOrders';
import { planMaterials } from './materials';
import type { Department } from './masters';
import { lineProgresses, lineSchedule, PLANNING_KEY, type PlanContext } from './route';
import { isActive, nextDue, type Task } from './tasks';

export const NO_DEPT_ID = '__none';
export const BOUGHT_ID = '__bought';

type Jo = JobOrder & { id: string };

export interface LoadCell {
  orders: number;
  /** Average jobs at the same time over the week's working days in the range. */
  avg: number;
  peak: number;
  peakDay: string | null;
  /** 0 = none … 3 = among the busiest of all departments in the range. */
  level: 0 | 1 | 2 | 3;
}
export interface DeptLoad {
  id: string;
  name: string;
  cells: LoadCell[];
  quietWeeks: string[]; // week starts
  /** Quantity per process per week (per unit). */
  processes: { id: string; name: string; unit: string; qty: number[] }[];
}
export interface LookAhead {
  from: string;
  to: string;
  /** Columns: weeks (Monday–Sunday), or calendar months when the range is longer than 6 weeks. */
  weeks: { start: string; end: string; label: string; workDays: number }[];
  byMonth: boolean;
  orders: number;
  departments: DeptLoad[];
  bought: { joNumber: string; product: string; text: string }[];
  notPlaced: { joNumber: string; product: string; step: string }[];
  dates: { date: string; text: string }[];
  tasks: { date: string; time: string | null; title: string; who: string; repeat: boolean }[];
  /** usedIn = the product whose work needs it first, with that first step. */
  materials: { name: string; qty: number; unit: string; neededBy: string; overdue: boolean; usedIn: string; joNumber: string; key: string }[];
  summary: string;
}

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const monday = (d: string) => addDays(d, -(((weekday(d) ?? 1) + 6) % 7))!;
const short = (d: string) => formatDay(d).replace(/ \d{4}$/, '');

/** Working days d with a < d <= b (the days a step works on), or [a] for a same-day step. */
function stepDays(a: string, b: string, cal: WorkCalendar): string[] {
  const out: string[] = [];
  for (let d = addDays(a, 1)!; d <= b; d = addDays(d, 1)!) if (isWorkingDay(d, cal)) out.push(d);
  if (!out.length && isWorkingDay(a, cal)) out.push(a);
  return out;
}

export function buildLookAhead(args: {
  jobOrders: Jo[];
  ctx: PlanContext;
  from: string;
  to: string;
  today: string;
  departments: (Department & { id: string })[];
  processNames: Map<string, string>;
  tasks?: (Task & { id: string })[];
  deptName?: (id: string) => string;
}): LookAhead {
  const { ctx, from, to, today } = args;
  const cal = ctx.cal;
  const jos = args.jobOrders.filter((j) => j.status === 'CONFIRMED');

  // Columns: weeks, or months for long ranges.
  const byMonth = (daysBetween(from, to) ?? 0) > 42;
  const weeks: LookAhead['weeks'] = [];
  const nextStart = (w: string) => (byMonth ? `${addDays(`${w.slice(0, 7)}-28`, 4)!.slice(0, 7)}-01` : addDays(w, 7)!);
  for (let w = byMonth ? `${from.slice(0, 7)}-01` : monday(from); w <= to; w = nextStart(w)) {
    const end = addDays(nextStart(w), -1)!;
    let n = 0;
    for (let d = w; d <= end; d = addDays(d, 1)!) if (d >= from && d <= to && isWorkingDay(d, cal)) n++;
    weeks.push({ start: w, end, label: byMonth ? MONTH.format(new Date(`${w}T00:00:00Z`)) : short(w < from ? from : w), workDays: n });
  }
  const weekIndex = (d: string) => weeks.findIndex((w) => d >= w.start && d <= w.end);

  // Which department handles a process.
  const deptsOf = new Map<string, (Department & { id: string })[]>();
  for (const d of args.departments.filter((x) => x.active !== false)) for (const p of d.processIds ?? []) deptsOf.set(p, [...(deptsOf.get(p) ?? []), d]);

  // Per department: per day the jobs running, per week the orders; per process per week the quantity.
  const perDay = new Map<string, Map<string, number>>();
  const perWeekOrders = new Map<string, Set<string>[]>();
  const qty = new Map<string, Map<string, { name: string; unit: string; qty: number[] }>>(); // dept → process|unit
  const names = new Map<string, string>();
  const bought: LookAhead['bought'] = [];
  const notPlaced: LookAhead['notPlaced'] = [];
  const touch = (id: string, name: string) => {
    names.set(id, name);
    if (!perDay.has(id)) perDay.set(id, new Map());
    if (!perWeekOrders.has(id)) perWeekOrders.set(id, weeks.map(() => new Set()));
    if (!qty.has(id)) qty.set(id, new Map());
  };

  for (const jo of jos) {
    for (const { line, lp } of lineProgresses(jo, today, ctx)) {
      for (const st of lineSchedule(lp, today, cal)) {
        const s = st.view.step;
        if (s.key === PLANNING_KEY || st.view.state === 'DONE') continue;
        const product = s.forProduct || line.productName;
        if (s.processId === null) {
          bought.push({ joNumber: jo.joNumber, product, text: `${s.label}${st.finish ? ` - planned ${short(st.finish)}` : st.start ? ` - from ${short(st.start)}, date to be confirmed` : ' - date to be confirmed'}` });
          continue;
        }
        if (!st.start || !st.finish) {
          notPlaced.push({ joNumber: jo.joNumber, product, step: s.label });
          continue;
        }
        const all = stepDays(st.start, st.finish, cal);
        const days = st.view.state === 'NOW' ? all.filter((d) => d >= today) : all;
        const work = (days.length ? days : st.view.state === 'NOW' && isWorkingDay(today, cal) ? [today] : []).filter((d) => d >= from && d <= to);
        if (!work.length) continue;
        const groups = deptsOf.get(s.processId) ?? [{ id: NO_DEPT_ID, name: 'No department linked' } as Department & { id: string }];
        for (const g of groups) {
          touch(g.id, g.name);
          const pd = perDay.get(g.id)!;
          for (const d of work) {
            pd.set(d, (pd.get(d) ?? 0) + 1);
            perWeekOrders.get(g.id)![weekIndex(d)]!.add(jo.id);
          }
          if (s.qty !== null && s.qtyUnit && s.qty > 0) {
            const perDayQty = s.qty / Math.max(1, (st.view.state === 'NOW' ? days.length : all.length) || 1);
            const k = `${s.processId}|${s.qtyUnit}`;
            const m = qty.get(g.id)!;
            const row = m.get(k) ?? { name: args.processNames.get(s.processId) ?? s.label, unit: s.qtyUnit, qty: weeks.map(() => 0) };
            for (const d of work) row.qty[weekIndex(d)] = (row.qty[weekIndex(d)] ?? 0) + perDayQty;
            m.set(k, row);
          }
        }
      }
    }
  }

  const departments: DeptLoad[] = [...perDay.keys()].map((id) => {
    const pd = perDay.get(id)!;
    const cells: LoadCell[] = weeks.map((w, i) => {
      let total = 0;
      let peak = 0;
      let peakDay: string | null = null;
      for (let d = w.start; d <= w.end; d = addDays(d, 1)!) {
        const n = pd.get(d) ?? 0;
        total += n;
        if (n > peak) {
          peak = n;
          peakDay = d;
        }
      }
      return { orders: perWeekOrders.get(id)![i]!.size, avg: w.workDays ? Math.round((total / w.workDays) * 10) / 10 : 0, peak, peakDay, level: 0 };
    });
    const max = Math.max(0, ...cells.map((c) => c.avg));
    // Quieter weeks: none of its work, or under a third of its busiest week.
    const quietWeeks = weeks.filter((w, i) => w.workDays > 0 && (cells[i]!.avg === 0 || cells[i]!.avg < max / 3)).map((w) => w.start);
    return {
      id,
      name: names.get(id) ?? id,
      cells,
      quietWeeks,
      processes: [...qty.get(id)!.entries()].map(([k, v]) => ({ id: k.split('|')[0]!, ...v, qty: v.qty.map((q) => Math.round(q * 10) / 10) })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
  // Shading compares departments with each other: the darkest is the busiest department-week overall.
  const top = Math.max(0, ...departments.flatMap((d) => d.cells.map((c) => c.avg)));
  for (const d of departments) for (const c of d.cells) c.level = c.avg <= 0 || top <= 0 ? 0 : c.avg >= top * 0.66 ? 3 : c.avg >= top * 0.33 ? 2 : 1;
  // Departments with no work in the range are listed too: every week is quiet for them.
  for (const d of args.departments.filter((x) => x.active !== false && (x.processIds ?? []).length > 0 && !perDay.has(x.id)))
    departments.push({ id: d.id, name: d.name, cells: weeks.map(() => ({ orders: 0, avg: 0, peak: 0, peakDay: null, level: 0 })), quietWeeks: weeks.filter((w) => w.workDays > 0).map((w) => w.start), processes: [] });
  departments.sort((a, b) => (a.id === NO_DEPT_ID ? 1 : 0) - (b.id === NO_DEPT_ID ? 1 : 0) || a.name.localeCompare(b.name));

  // Key dates.
  const dates: LookAhead['dates'] = [];
  for (const jo of jos) {
    const dl = jo.deadline.internalDeadline;
    if (dl >= from && dl <= to) dates.push({ date: dl, text: `${jo.joNumber} internal deadline` });
    if (jo.deliveryDate >= from && jo.deliveryDate <= to) dates.push({ date: jo.deliveryDate, text: `${jo.joNumber} customer delivery` });
  }
  for (const [d, name] of Object.entries(cal.holidays)) if (d >= from && d <= to) dates.push({ date: d, text: `${name || 'Company holiday'} (no work)` });
  dates.sort((a, b) => a.date.localeCompare(b.date) || a.text.localeCompare(b.text));

  // Work tasks due in the range, with the coming repeats of repeating ones.
  const tasks: LookAhead['tasks'] = [];
  for (const t of args.tasks ?? []) {
    if (!isActive(t) || !t.dueDate) continue;
    const who = [t.departmentId && args.deptName ? args.deptName(t.departmentId) : '', t.person].filter(Boolean).join(' · ');
    let d: string | null = t.dueDate;
    for (let guard = 0; d && d <= to && guard < 400; guard++) {
      if (d >= from || guard === 0) tasks.push({ date: d, time: t.dueTime ?? null, title: t.title, who, repeat: !!t.repeat }); // overdue ones too
      if (!t.repeat) break;
      d = nextDue(t.repeat, d);
    }
  }
  tasks.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '99').localeCompare(b.time ?? '99') || a.title.localeCompare(b.title));

  // Raw materials (and bought components) still to buy: needed by the first step of the product that uses them.
  const materials: LookAhead['materials'] = [];
  for (const jo of jos) {
    const plan = planMaterials(jo, ctx.md);
    // A product's materials are needed when work on it starts; once any of its steps is done they are taken as in hand.
    const firstStart = new Map<string, { date: string; step: string }>();
    const started = new Set<string>();
    for (const { lp } of lineProgresses(jo, today, ctx))
      for (const st of lineSchedule(lp, today, cal)) {
        const s = st.view.step;
        if (s.key === PLANNING_KEY || !s.productId) continue;
        const k = `PRODUCT:${s.productId}`;
        if (st.view.state === 'DONE' || st.view.startedOn) started.add(k);
        if (!st.start) continue;
        const prev = firstStart.get(k);
        if (!prev || st.start < prev.date) firstStart.set(k, { date: st.start, step: `${s.forProduct}, from ${s.label}` });
      }
    for (const k of started) firstStart.delete(k);
    for (const r of plan.toBuy) {
      if (r.net <= 0 || (r.ordered && r.usedFor.length === 0)) continue;
      const uses = plan.links.filter((l) => l.childKey === r.key).map((l) => firstStart.get(l.parentKey)).filter((x): x is { date: string; step: string } => !!x);
      if (!uses.length) continue;
      const first = uses.sort((a, b) => a.date.localeCompare(b.date))[0]!;
      if (first.date > to) continue;
      materials.push({ name: r.name, qty: r.net, unit: r.unit, neededBy: first.date, overdue: first.date <= today, usedIn: first.step, joNumber: jo.joNumber, key: r.key });
    }
  }
  materials.sort((a, b) => a.neededBy.localeCompare(b.neededBy) || a.name.localeCompare(b.name));

  // In short.
  const busiest = departments
    .filter((d) => d.id !== NO_DEPT_ID)
    .flatMap((d) => d.cells.map((c, i) => ({ d, c, w: weeks[i]! })))
    .filter((x) => x.c.orders > 0)
    .sort((a, b) => b.c.avg - a.c.avg || b.c.orders - a.c.orders)[0];
  const parts: string[] = [];
  if (!jos.length) parts.push('No confirmed orders yet.');
  else if (busiest) parts.push(`${busiest.d.name} is busiest in ${byMonth ? busiest.w.label : `the week of ${short(busiest.w.start)}`} (${busiest.c.orders} order${busiest.c.orders === 1 ? '' : 's'}, up to ${busiest.c.peak} job${busiest.c.peak === 1 ? '' : 's'} at a time).`);
  else parts.push('No planned production work in this period.');
  const now = materials.filter((m) => m.overdue);
  if (now.length) parts.push(`Needed now: ${[...new Set(now.map((m) => m.name))].join(', ')}.`);
  const dl = dates.filter((d) => d.text.endsWith('internal deadline')).length;
  if (dl) parts.push(`${dl} internal deadline${dl === 1 ? '' : 's'} in this period.`);
  if (notPlaced.length) parts.push(`${notPlaced.length} step${notPlaced.length === 1 ? '' : 's'} without a time could not be placed.`);

  return { from, to, weeks, byMonth, orders: jos.length, departments, bought, notPlaced, dates, tasks, materials, summary: parts.join(' ') };
}
