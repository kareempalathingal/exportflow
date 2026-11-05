import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR, workingDaysBetween } from '../../src/lib/calendar';
import type { JoLine } from '../../src/lib/jobOrders';
import type { MasterData, Process, Product, RouteStep } from '../../src/lib/masters';
import { addOutput, buildLineSteps, canStart, completeCurrent, MATERIALS_KEY, orderPlan, startStepAt, undoStartAt } from '../../src/lib/route';

// Flow tracking (confirmed 5 Nov 2026): outside work, materials ready, parallel steps, day's output.
const na = { value: null, status: 'UNAVAILABLE' as const, source: '' };
const step = (processId: string, perDay: number, extra: Partial<RouteStep> = {}): RouteStep => ({ processId, perDay, perDayUnit: 'pcs', fixedDays: null, status: 'USER_PROVIDED', source: '', ...extra });
const product = (name: string, route: RouteStep[]): Product => ({
  name, code: '', active: true, notes: '', baseUnit: 'pcs', supplyType: 'MANUFACTURED', specifications: '',
  size: { length: null, width: null, unit: 'cm', status: 'UNAVAILABLE' }, thicknessMm: na, gsm: na, weightPerPieceKg: na, customUnits: [], route,
});
const processes = new Map<string, Process>([
  ['tuft', { name: 'Tufting', active: true, notes: '' }],
  ['shear', { name: 'Shearing', active: true, notes: '' }],
  ['print', { name: 'Printing', active: true, notes: '' }],
  ['pack', { name: 'Packing', active: true, notes: '' }],
]);
const md: MasterData = {
  products: new Map([
    ['a', product('A', [step('tuft', 100), step('shear', 50)])],
    ['o', product('O', [step('tuft', 100), step('print', 50, { outside: true, landingPerDay: 200, landingPerDayUnit: 'pcs' }), step('pack', 400)])],
    ['n', product('N', [step('tuft', 100), step('print', 50, { outside: true }), step('pack', 400)])],
  ]),
  rawMaterials: new Map([['yarn', { name: 'Yarn', active: true, notes: '', baseUnit: 'kg', gsm: na, customUnits: [] }]]),
  boms: new Map([['a', { productId: 'a', notes: '', lines: [{ componentType: 'RAW_MATERIAL', componentId: 'yarn', qty: 0.5, unit: 'kg', wastagePct: 0, status: 'USER_PROVIDED', source: '' }] }]]),
};
const line = (id: string, productId: string, qty: number): JoLine => {
  const l: JoLine = { id, productId, productName: md.products.get(productId)!.name, qty, unit: 'pcs', supply: 'MAKE' };
  return { ...l, steps: buildLineSteps(l, md, processes) };
};
const order = (lines: JoLine[], extra: object = {}) => ({ lines, status: 'CONFIRMED' as const, bomSnapshot: null, stock: {}, confirmedOn: '2026-11-02', receivedDate: '2026-11-02', ...extra });
const ctx = { md, cal: DEFAULT_CALENDAR, planningDays: null };
const days = (d: string | null | undefined) => workingDaysBetween('2026-11-02', d!, DEFAULT_CALENDAR);
const at = (p: ReturnType<typeof orderPlan>, label: string, li = 0) => p.lines[li]!.lp.schedule!.find((s) => s.view.step.label === label)!;

describe('outside work: dispatch → outside step → landing', () => {
  it('a route step done outside becomes three order steps', () => {
    expect(line('1', 'o', 100).steps!.map((s) => s.label)).toEqual(['Tufting', 'Dispatch for Printing', 'Printing (outside)', 'Landing from Printing', 'Packing']);
    const st = line('1', 'o', 100).steps!;
    expect(st[1]).toMatchObject({ processId: null, outsideOf: 'print', passThrough: true });
    expect(st[2]).toMatchObject({ processId: 'print', outside: true });
    expect(st[3]).toMatchObject({ processId: null, outsideOf: 'print', perDay: 200 });
    expect(st[3]!.passThrough).toBeUndefined();
    expect(line('1', 'n', 100).steps![3]).toMatchObject({ label: 'Landing from Printing', passThrough: true });
  });
  it('dispatch goes with the step before it; landing overlaps the outside step', () => {
    const p = orderPlan(order([line('1', 'o', 1000)]), '2026-11-02', ctx);
    expect(at(p, 'Dispatch for Printing').start).toBe(at(p, 'Tufting').start);
    expect(at(p, 'Dispatch for Printing').finish).toBe(at(p, 'Tufting').finish);
    // Printing 20 days, starting a half day into tufting (10 days); landing 5 days ends 1 day after printing.
    expect(days(at(p, 'Printing (outside)').finish)).toBe(21);
    expect(days(at(p, 'Landing from Printing').finish)).toBe(22);
    expect(at(p, 'Dispatch for Printing').view.step.plannedDays).toBe(0);
  });
  it('a dispatch or landing without a time is never counted as over plan', () => {
    const l = line('1', 'n', 100);
    const done = { ...l, steps: completeCurrent(l.steps!, '2026-11-03T06:30:00.000Z')! };
    const p = orderPlan(order([done]), '2026-11-20', ctx);
    expect(at(p, 'Dispatch for Printing').view.overrunDays).toBeNull();
  });
});

describe('materials ready', () => {
  it('only for orders that track arrivals', () => {
    const p = orderPlan(order([line('1', 'a', 100)]), '2026-11-02', ctx);
    expect(p.lines[0]!.lp.steps.map((v) => v.step.key)).not.toContain(MATERIALS_KEY);
  });
  it('no dates entered: production dates are to be confirmed', () => {
    const p = orderPlan(order([line('1', 'a', 100)], { materialDates: {} }), '2026-11-02', ctx);
    const m = p.lines[0]!.lp.schedule![1]!;
    expect(m.view.step.label).toBe('Materials ready');
    expect(m.view.step.note).toBe('Expected date not entered: Yarn');
    expect(at(p, 'Tufting').start).toBeNull();
    expect(p.lines[0]!.lp.current!.step.key).toBe(MATERIALS_KEY);
  });
  it('expected date: production starts when the material is expected', () => {
    const p = orderPlan(order([line('1', 'a', 100)], { materialDates: { 'RAW_MATERIAL:yarn': { orderedOn: '2026-11-02', expectedOn: '2026-11-06' } } }), '2026-11-02', ctx);
    expect(at(p, 'Tufting').start).toBe('2026-11-06');
    expect(p.lines[0]!.lp.steps[1]!.overrunDays).toBeNull();
  });
  it('received: done; and a started production step means the materials were there', () => {
    const recv = orderPlan(order([line('1', 'a', 100)], { materialDates: { 'RAW_MATERIAL:yarn': { receivedOn: '2026-11-04' } } }), '2026-11-05', ctx);
    expect(recv.lines[0]!.lp.steps[1]).toMatchObject({ state: 'DONE', doneOn: '2026-11-04' });
    const l = line('1', 'a', 100);
    const started = { ...l, steps: startStepAt(l.steps!, 0, '2026-11-03T06:30:00.000Z')! };
    const p = orderPlan(order([started], { materialDates: {} }), '2026-11-04', ctx);
    expect(p.lines[0]!.lp.steps[1]).toMatchObject({ state: 'DONE' });
    expect(p.lines[0]!.lp.steps[1]!.step.note).toBe('Production has started');
  });
});

describe('steps running at the same time', () => {
  it('a step can start once the one before it has started; done stays in order', () => {
    const s0 = line('1', 'a', 1000).steps!;
    expect(canStart(s0, 0)).toBe(true);
    expect(canStart(s0, 1)).toBe(false);
    const s1 = startStepAt(s0, 0, '2026-11-02T06:30:00.000Z')!;
    expect(canStart(s1, 1)).toBe(true);
    const s2 = startStepAt(s1, 1, '2026-11-03T06:30:00.000Z')!;
    expect(undoStartAt(s2, 0)).toBeNull(); // a later step has started
    expect(undoStartAt(s2, 1)).not.toBeNull();
    const p = orderPlan(order([{ ...line('1', 'a', 1000), steps: s2 }]), '2026-11-04', ctx);
    const views = p.lines[0]!.lp.steps;
    expect(views.filter((v) => v.state === 'NOW').map((v) => v.step.label)).toEqual(['Tufting', 'Shearing']);
    expect(views[2]).toMatchObject({ startedOn: '2026-11-03', waitDays: 0 });
  });
  it('a step that waits for the whole quantity starts only after the one before is done', () => {
    const s = line('1', 'a', 100).steps!.map((x, i) => (i === 1 ? { ...x, waitAll: true } : x));
    expect(canStart(startStepAt(s, 0, '2026-11-02T06:30:00.000Z')!, 1)).toBe(false);
  });
});

describe("day's output", () => {
  it('counts towards the step and sets the expected finish from the rest at the benchmark', () => {
    const l = line('1', 'a', 1000); // tufting 10 days
    let s = startStepAt(l.steps!, 0, '2026-11-02T06:30:00.000Z')!;
    s = addOutput(s, 0, { on: '2026-11-02', qty: 300, unit: 'pcs', at: '2026-11-02T12:00:00.000Z' })!;
    s = addOutput(s, 0, { on: '2026-11-03', qty: 300, unit: 'pcs', at: '2026-11-03T12:00:00.000Z' })!;
    const p = orderPlan(order([{ ...l, steps: s }]), '2026-11-03', ctx);
    const t = p.lines[0]!.lp.steps[1]!;
    expect(t.step.outputQty).toBe(600);
    // 400 left at 100/day, from tomorrow (today's output is in): 4 days → finish on day 1 + 1 + 4.
    expect(days(at(p, 'Tufting').finish)).toBe(6);
    expect(p.lines[0]!.lp.actualPct).toBeGreaterThan(0);
  });
  it('rejects empty entries', () => {
    expect(addOutput(line('1', 'a', 10).steps!, 0, { on: '2026-11-02', qty: 0, unit: 'pcs', at: 'x' })).toBeNull();
  });
});
