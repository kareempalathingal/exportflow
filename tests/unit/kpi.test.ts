import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR } from '../../src/lib/calendar';
import { kpiDoc } from '../../src/lib/docs/kpiDoc';
import type { JobOrder, JoStep } from '../../src/lib/jobOrders';
import { buildKpis, finishedSteps, kpiText, NO_DEPT, PURCHASE, toneFor } from '../../src/lib/kpi';
import type { Bom, Department, MasterData, Process, Product, RawMaterial } from '../../src/lib/masters';
import { completeCurrent, lineProgress, startCurrent, stepTime, undoStart, type PlannedStep } from '../../src/lib/route';
import { buildSampleData } from '../../src/lib/sampleData';

const TODAY = '2026-10-26';
const writes = buildSampleData(TODAY);
const of = <T,>(c: string) => writes.filter((w) => w.collection === c).map((w) => ({ id: w.docId, ...(w.data as unknown as T) }));
const md: MasterData = { products: new Map(of<Product>('products').map((p) => [p.id, p])), rawMaterials: new Map(of<RawMaterial>('rawMaterials').map((p) => [p.id, p])), boms: new Map(of<Bom>('boms').map((p) => [p.id, p])) };
const m = new Map<string, JobOrder & { id: string }>();
for (const w of writes) if (w.collection === 'jobOrders') m.set(w.docId, { id: w.docId, ...(w.data as unknown as JobOrder) });
const jos = [...m.values()];
const ctx = { md, cal: DEFAULT_CALENDAR };
const departments = of<Department>('departments');
const processNames = new Map(of<Process>('processes').map((p) => [p.id, p.name]));
const kpis = (from: string, to: string, deps = departments) => buildKpis({ jobOrders: jos, ctx, from, to, today: TODAY, departments: deps, processNames, history: [] });

const step = (key: string, plannedDays: number | null): PlannedStep => ({ key, processId: 'p', label: key, forProduct: 'X', productId: null, perDay: null, perDayUnit: null, fixedDays: plannedDays, doneAt: null, plannedDays, qty: null, qtyUnit: null, basis: null, note: null });

describe('started and back-dated steps (confirmed 26 Oct 2026)', () => {
  it('splits waiting from working time when the start is recorded', () => {
    // Mon 19 Oct: previous done. Started Wed 21, done Fri 23 → waited 2, worked 2 working days.
    let steps: JoStep[] = [step('a', 2)];
    steps = startCurrent(steps, stepTime('2026-10-21', TODAY))!;
    steps = completeCurrent(steps, stepTime('2026-10-23', TODAY))!;
    const lp = lineProgress(steps as PlannedStep[], '2026-10-19', TODAY, DEFAULT_CALENDAR)!;
    expect(lp.steps[0]).toMatchObject({ actualDays: 4, startedOn: '2026-10-21', waitDays: 2, workDays: 2, overrunDays: 2 });
    expect(stepTime(TODAY, TODAY, new Date('2026-10-26T08:00:00Z'))).toBe('2026-10-26T08:00:00.000Z');
    expect(stepTime('2026-10-21', TODAY)).toBe('2026-10-21T06:30:00.000Z');
  });
  it('a running step shows its wait and work so far; the start can be undone', () => {
    const steps = startCurrent([step('a', 3)], stepTime('2026-10-22', TODAY))!;
    const now = lineProgress(steps as PlannedStep[], '2026-10-20', TODAY, DEFAULT_CALENDAR)!.current!;
    expect(now).toMatchObject({ state: 'NOW', waitDays: 2, workDays: 3 }); // Fri 23, Sat 24, Mon 26 (Sunday off)
    expect(undoStart(steps)![0]!.startedAt).toBeNull();
    expect(undoStart([step('a', 3)])).toBeNull();
  });
  it('without a recorded start nothing changes', () => {
    const lp = lineProgress(completeCurrent([step('a', 1)], stepTime('2026-10-22', TODAY))! as PlannedStep[], '2026-10-20', TODAY, DEFAULT_CALENDAR)!;
    expect(lp.steps[0]).toMatchObject({ actualDays: 2, waitDays: null, workDays: null });
  });
});

describe('KPIs', () => {
  it('counts working time where the start was recorded', () => {
    const steps = finishedSteps(jos, ctx, '2026-07-01', TODAY, TODAY);
    const timed = steps.filter((s) => s.timed);
    expect(timed.length).toBe(2); // DEMO-102 sample steps with a recorded start
    expect(timed.every((s) => s.wait !== null && s.wait >= 0)).toBe(true);
    expect(steps.some((s) => s.label === 'Planning')).toBe(false);
  });
  it('builds factory and department figures and compares with the previous period', () => {
    const r = kpis('2026-07-01', TODAY);
    expect(r.prevTo).toBe('2026-06-30');
    expect(r.factory.completed).toBe(1);
    expect(r.factory.onTimeDeliveryPct).toBe(100);
    expect(r.factory.onTimeInternalPct).toBe(0);
    expect(r.factory.onTimeStepPct).not.toBeNull();
    expect(r.factory.openLate).toBeGreaterThanOrEqual(1);
    expect(r.groups.some((g) => g.id === PURCHASE)).toBe(true);
    const named = r.groups.filter((g) => g.id !== PURCHASE && g.id !== NO_DEPT);
    expect(named.length).toBeGreaterThan(0);
    expect(named.reduce((a, g) => a + g.lateOrderShare, 0)).toBeGreaterThan(0); // late orders are blamed on a department
    expect(r.worstGroup).not.toBeNull();
    expect(r.prev.completed).toBe(0);
  });
  it('steps of processes no department handles are grouped separately', () => {
    const r = kpis('2026-07-01', TODAY, []);
    expect(r.groups.map((g) => g.id)).toContain(NO_DEPT);
  });
  it('targets colour the figures; no target means no colour', () => {
    expect(toneFor(92, 90, true)).toBe('ok');
    expect(toneFor(85, 90, true)).toBe('warn');
    expect(toneFor(60, 90, true)).toBe('bad');
    expect(toneFor(1, 1, false)).toBe('ok');
    expect(toneFor(3, 1, false)).toBe('bad');
    expect(toneFor(50, null, true)).toBeNull();
    expect(toneFor(null, 90, true)).toBeNull();
  });
  it('makes shareable text and a PDF with a chart', () => {
    const r = kpis('2026-07-01', TODAY);
    expect(kpiText(r, 'Co', (d) => d)).toMatch(/^KPIs · Co/);
    const doc = kpiDoc(r, { onTimeDeliveryPct: 90 }, { company: 'Co', generatedAt: 'now' });
    expect(doc.tables[0]!.rows.find((x) => x[0] === 'On-time delivery')).toEqual(['On-time delivery', '100%', '—', '—', '>= 90%', 'Met']);
    expect(doc.charts!.length).toBe(1);
  });
});

describe('planning KPI (orders confirmed in the period, confirmed 26 Oct 2026)', () => {
  it('lists every order confirmed in the period, with planning days and benchmark check', () => {
    const r = kpis('2026-10-01', TODAY);
    const d105 = r.planning.find((p) => p.joNumber === 'DEMO-105');
    expect(d105).toBeDefined();
    expect(d105!.days).toBeGreaterThan(1);
    expect(d105!.over).toBe(true);
    expect(r.planningBenchmark).toBe(1);
    expect(r.factory.planningConfirmed).toBe(r.planning.length);
    const within = r.planning.filter((p) => !p.over).length;
    expect(r.factory.planningOnTimePct).toBe(Math.round((within / r.planning.length) * 100));
    // worst first
    expect(r.planning.map((p) => p.days)).toEqual([...r.planning.map((p) => p.days)].sort((a, b) => b - a));
  });
  it('no benchmark = nothing marked over and no on-time %', () => {
    const r = buildKpis({ jobOrders: jos, ctx: { ...ctx, planningDays: null }, from: '2026-10-01', to: TODAY, today: TODAY, departments, processNames, history: [] });
    expect(r.planning.some((p) => p.over)).toBe(false);
    expect(r.factory.planningOnTimePct).toBeNull();
  });
  it('shows in the text share and the PDF', () => {
    const r = kpis('2026-10-01', TODAY);
    const text = kpiText(r, 'X', (d) => d);
    expect(text).toContain('DEMO-105:');
    const doc = kpiDoc(r, { planningOnTimePct: 80 }, { company: 'X', generatedAt: '' });
    expect(doc.tables.some((t) => t.title.startsWith('Planning'))).toBe(true);
  });
});
