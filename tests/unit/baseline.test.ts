import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR } from '../../src/lib/calendar';
import { baselineCheck, compareToPlan, diffText, latestBaseline, snapshotPlan } from '../../src/lib/baseline';
import type { JobOrder, JoLine } from '../../src/lib/jobOrders';
import type { MasterData, Process, Product, RouteStep } from '../../src/lib/masters';
import { atRiskOrders } from '../../src/lib/managerReports';
import { buildLineSteps, completeCurrent, orderPlan } from '../../src/lib/route';

// Submitted plan (15 Nov 2026).
const na = { value: null, status: 'UNAVAILABLE' as const, source: '' };
const step = (processId: string, perDay: number): RouteStep => ({ processId, perDay, perDayUnit: 'pcs', fixedDays: null, status: 'USER_PROVIDED', source: '' });
const product = (name: string, route: RouteStep[]): Product => ({
  name, code: '', active: true, notes: '', baseUnit: 'pcs', supplyType: 'MANUFACTURED', specifications: '',
  size: { length: null, width: null, unit: 'cm', status: 'UNAVAILABLE' }, thicknessMm: na, gsm: na, weightPerPieceKg: na, customUnits: [], route,
});
const processes = new Map<string, Process>([
  ['tuft', { name: 'Tufting', active: true, notes: '' }],
  ['pack', { name: 'Packing', active: true, notes: '' }],
]);
const md: MasterData = { products: new Map([['a', product('A', [step('tuft', 100), step('pack', 400)])]]), rawMaterials: new Map(), boms: new Map() };
const line = (qty: number): JoLine => {
  const l: JoLine = { id: 'l1', productId: 'a', productName: 'A', qty, unit: 'pcs', supply: 'MAKE' };
  return { ...l, steps: buildLineSteps(l, md, processes) };
};
const jo = (lines: JoLine[], extra: Partial<JobOrder> = {}): JobOrder & { id: string } => ({
  id: 'j', joNumber: 'WO-1', customerId: 'c', customerName: 'C', poNumber: '', receivedDate: '2026-11-02', deliveryDate: '2026-12-30', deliveryDateType: 'FACTORY_DISPATCH',
  deadline: { orderPeriodDays: 50, bufferDays: 5, internalDeadline: '2026-12-23', ruleVersion: 'v2' }, status: 'CONFIRMED', lines, notes: '', bomSnapshot: {}, confirmedOn: '2026-11-02',
  itemOrderRule: 'PRIORITY', ...extra,
});
const ctx = { md, cal: DEFAULT_CALENDAR, planningDays: null };
const input = { reason: '', approvedBy: 'MD', approvedOn: '2026-11-02' };

describe('submitted plan', () => {
  it('saves the step dates and the WO ready date as v1, then v2', () => {
    const w = jo([line(300)]);
    const p = orderPlan(w, '2026-11-02', ctx);
    const v1 = snapshotPlan(w, p, { today: '2026-11-02', now: '2026-11-02T05:00:00Z' }, input);
    expect(v1).toMatchObject({ version: 1, approvedBy: 'MD', approvedOn: '2026-11-02', ready: p.itemOrder.ready, internalDeadline: '2026-12-23' });
    expect(v1.steps.map((s) => s.label)).toEqual(['Planning', 'Tufting', 'Packing']);
    const v2 = snapshotPlan({ ...w, baselines: [v1] }, p, { today: '2026-11-03', now: 'x' }, { reason: 'Customer added an item', approvedBy: '', approvedOn: '' });
    expect(v2.version).toBe(2);
    expect('approvedBy' in v2).toBe(false);
  });
  it('a new version needs a reason; only confirmed WOs; no future approval date', () => {
    const w = jo([line(300)]);
    const v1 = snapshotPlan(w, orderPlan(w, '2026-11-02', ctx), { today: '2026-11-02', now: 'x' }, input);
    expect(baselineCheck(w, { reason: '', approvedOn: '' }, '2026-11-02')).toBeNull();
    expect(baselineCheck({ ...w, baselines: [v1] }, { reason: ' ', approvedOn: '' }, '2026-11-02')).toMatch(/why/i);
    expect(baselineCheck({ ...w, status: 'DRAFT' }, { reason: '', approvedOn: '' }, '2026-11-02')).toMatch(/confirmed/);
    expect(baselineCheck(w, { reason: '', approvedOn: '2026-11-05' }, '2026-11-02')).toMatch(/future/);
  });
  it('compares now with the LATEST version, step by step, and keeps the first one', () => {
    const w = jo([line(300)]);
    const v1 = snapshotPlan(w, orderPlan(w, '2026-11-02', ctx), { today: '2026-11-02', now: 'x' }, input);
    // More quantity later: tufting takes 2 more working days.
    const bigger = jo([line(500)], { baselines: [v1] });
    const c = compareToPlan(bigger, orderPlan(bigger, '2026-11-02', ctx), DEFAULT_CALENDAR)!;
    expect(c.base.version).toBe(1);
    expect(c.readyDiff).toBeGreaterThan(0);
    expect(c.behind[0]).toMatchObject({ label: 'Tufting', diff: 2 });
    expect(c.notInPlan).toBe(0);
    expect(latestBaseline(bigger)!.version).toBe(1);
    expect(diffText(2)).toBe('+2 working days');
    expect(diffText(-1)).toBe('−1 working day');
    expect(diffText(0)).toBe('on plan');
  });
  it('a done step compares its real finish', () => {
    const l = line(300);
    const w = jo([l]);
    const v1 = snapshotPlan(w, orderPlan(w, '2026-11-02', ctx), { today: '2026-11-02', now: 'x' }, input);
    const planned = v1.steps.find((s) => s.label === 'Tufting')!.finish!;
    const done = { ...l, steps: completeCurrent(l.steps!, '2026-11-09T06:00:00Z')! };
    const later = jo([done], { baselines: [v1] });
    const c = compareToPlan(later, orderPlan(later, '2026-11-10', ctx), DEFAULT_CALENDAR)!;
    const t = [...c.steps.values()].find((s) => s.planFinish === planned)!;
    expect(t.diff).toBeGreaterThan(0);
  });
  it('Orders at risk: Watch when more than 2 working days behind the submitted plan', () => {
    const w = jo([line(300)]);
    const v1 = snapshotPlan(w, orderPlan(w, '2026-11-02', ctx), { today: '2026-11-02', now: 'x' }, input);
    const slow = jo([line(800)], { baselines: [v1] });
    const risk = atRiskOrders({ jobOrders: [slow], ctx, today: '2026-11-02', redAt: 20 });
    expect(risk[0]!.reasons.some((r) => /behind the submitted plan \(v1/.test(r))).toBe(true);
    const near = jo([line(400)], { baselines: [v1] });
    const ok = atRiskOrders({ jobOrders: [near], ctx, today: '2026-11-02', redAt: 20 });
    expect((ok[0]?.reasons ?? []).some((r) => /submitted plan/.test(r))).toBe(false);
  });
  it('the plan PDFs list what moved since the submitted plan', async () => {
    const { productionPlanDoc } = await import('../../src/lib/docs/model');
    const w = jo([line(300)]);
    const v1 = snapshotPlan(w, orderPlan(w, '2026-11-02', ctx), { today: '2026-11-02', now: 'x' }, input);
    const later = jo([line(500)], { baselines: [v1], rev: 3 } as Partial<JobOrder>);
    for (const variant of ['submit', 'working'] as const) {
      const m = productionPlanDoc({ jo: later, md, processes, ctx, today: '2026-11-02', company: 'Co', generatedAt: 'x', preparedBy: { name: '', designation: '' }, variant });
      const t = m.tables.find((x) => x.title.startsWith('Changes since the submitted plan (v1'))!;
      expect(t.rows[0]![0]).toBe('WO ready (last item)');
      expect(t.rows.some((r) => r[0] === 'A · Tufting' && r[3] === '+2 working days')).toBe(true);
    }
  });
});
