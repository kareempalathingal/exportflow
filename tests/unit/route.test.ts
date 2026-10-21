import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR } from '../../src/lib/calendar';
import type { JoLine, StockEntry } from '../../src/lib/jobOrders';
import type { Bom, MasterData, Process, Product, RouteStep } from '../../src/lib/masters';
import {
  buildLineSteps,
  completeCurrent,
  lineProgress,
  orderStepProgress,
  overrunningSteps,
  planLines,
  roundUpHalf,
  routeFits,
  undoLast,
} from '../../src/lib/route';

const na = { value: null, status: 'UNAVAILABLE' as const, source: '' };
const step = (processId: string, perDay: number | null, perDayUnit: string, fixedDays: number | null = null, status: RouteStep['status'] = 'USER_PROVIDED'): RouteStep => ({
  processId, perDay, perDayUnit, fixedDays, status, source: '',
});
const product = (name: string, supplyType: Product['supplyType'], baseUnit: string, route: RouteStep[] = []): Product => ({
  name, code: '', active: true, notes: '', baseUnit, supplyType, specifications: '',
  size: { length: null, width: null, unit: 'cm', status: 'UNAVAILABLE' }, thicknessMm: na, gsm: na, weightPerPieceKg: na, customUnits: [], route,
});
const processes = new Map<string, Process>([
  ['spin', { name: 'Spinning', active: true, notes: '' }],
  ['weave', { name: 'Weaving', active: true, notes: '' }],
  ['bleach', { name: 'Bleaching', active: true, notes: '' }],
  ['pack', { name: 'Packing', active: true, notes: '' }],
]);
const md: MasterData = {
  products: new Map([
    ['yarn', product('Yarn', 'MANUFACTURED', 'kg', [step('spin', 100, 'kg')])],
    ['mat', product('Mat', 'MANUFACTURED', 'pcs', [step('weave', 100, 'pcs'), step('bleach', null, 'pcs', 2), step('pack', 500, 'pcs')])],
    ['door', product('Door mat', 'TRADED', 'pcs', [step('pack', null, 'pcs', null, 'PENDING_VERIFICATION')])],
    ['rug', product('Rug', 'MANUFACTURED', 'pcs', [step('weave', 50, 'sqm')])], // no size: pcs → sq m cannot convert
  ]),
  rawMaterials: new Map(),
  boms: new Map<string, Bom>([
    ['mat', { productId: 'mat', notes: '', lines: [{ componentType: 'PRODUCT', componentId: 'yarn', qty: 0.5, unit: 'kg', wastagePct: 0, status: 'VERIFIED', source: '' }] }],
    ['yarn', { productId: 'yarn', notes: '', lines: [] }],
  ]),
};
const ctx = { md, cal: DEFAULT_CALENDAR };
const line = (id: string, productId: string, qty: number, supply: JoLine['supply']): JoLine => ({ id, productId, productName: productId, qty, unit: 'pcs', supply });
const withSteps = (l: JoLine): JoLine => ({ ...l, steps: buildLineSteps(l, md, processes) });
const order = (lines: JoLine[], stock: Record<string, StockEntry> = {}) => ({
  lines: lines.map(withSteps), status: 'CONFIRMED' as const, bomSnapshot: null, stock, confirmedOn: '2026-11-02', receivedDate: '2026-10-30',
});
const earmark = (baseQty: number): StockEntry => ({ qty: baseQty, unit: 'x', baseQty, location: '', remarks: '', changedAt: '2026-11-01T00:00:00Z', prevBaseQty: null });

describe('building steps for an order line', () => {
  it('made products: sub-product steps first, then the product route, with the benchmark copied', () => {
    const s = buildLineSteps(line('a', 'mat', 400, 'MAKE'), md, processes);
    expect(s.map((x) => `${x.forProduct}:${x.label}`)).toEqual(['Yarn:Spinning', 'Mat:Weaving', 'Mat:Bleaching', 'Mat:Packing']);
    expect(s[0]).toMatchObject({ productId: 'yarn', perDay: 100, perDayUnit: 'kg', fixedDays: null });
    expect(s[2]).toMatchObject({ perDay: null, fixedDays: 2 });
    expect(new Set(s.map((x) => x.key)).size).toBe(4);
  });
  it('bought products: Ordered, Received, then their own steps; pending benchmarks are not copied', () => {
    const s = buildLineSteps(line('b', 'door', 10, 'BUY'), md, processes);
    expect(s.map((x) => x.label)).toEqual(['Ordered', 'Received', 'Packing']);
    expect(s[2]).toMatchObject({ perDay: null, fixedDays: null });
  });
});

describe('planned days from quantity', () => {
  it('quantity ÷ output per day + fixed days, rounded up to half a day', () => {
    const [l] = planLines(order([line('a', 'mat', 400, 'MAKE')]), md);
    // yarn 400 × 0.5 = 200 kg ÷ 100 = 2; weaving 400 ÷ 100 = 4; bleaching fixed 2; packing 400 ÷ 500 = 0.8 → 1
    expect(l!.steps!.map((s) => s.plannedDays)).toEqual([2, 4, 2, 1]);
    expect(l!.steps![1]!.basis).toBe('400 pcs ÷ 100/day');
    expect(roundUpHalf(2.01)).toBe(2.5);
    expect(roundUpHalf(2)).toBe(2);
  });
  it('a bigger order takes longer', () => {
    const [l] = planLines(order([line('a', 'mat', 1000, 'MAKE')]), md);
    expect(l!.steps!.map((s) => s.plannedDays)).toEqual([5, 10, 2, 2]);
  });
  it('stock set aside is not made: 0 days with the reason, or fewer days', () => {
    const [all] = planLines(order([line('a', 'mat', 400, 'MAKE')], { 'PRODUCT:yarn': earmark(200) }), md);
    expect(all!.steps![0]).toMatchObject({ plannedDays: 0, note: 'All 200 kg from stock (set aside) — nothing to make' });
    const [part] = planLines(order([line('a', 'mat', 400, 'MAKE')], { 'PRODUCT:mat': earmark(100) }), md);
    // 300 mats to make → 150 kg yarn → 1.5 days; weaving 3; packing 0.6 → 1
    expect(part!.steps!.map((s) => s.plannedDays)).toEqual([1.5, 3, 2, 1]);
    expect(part!.steps![1]!.note).toBe('100 pcs from stock');
  });
  it('steps marked "also for stock" (packing) count the stock set aside too', () => {
    const packAll: MasterData = { ...md, products: new Map(md.products) };
    packAll.products.set('mat', product('Mat', 'MANUFACTURED', 'pcs', [step('weave', 100, 'pcs'), { ...step('pack', 100, 'pcs'), alsoForStock: true }]));
    const o = { ...order([line('a', 'mat', 400, 'MAKE')], { 'PRODUCT:mat': earmark(100) }) };
    o.lines = o.lines.map((l) => ({ ...l, steps: buildLineSteps(l, packAll, processes) }));
    const [l] = planLines(o, packAll);
    expect(l!.steps!.map((s) => s.plannedDays)).toEqual([1.5, 3, 4]); // yarn 150 kg; weaving 300 made; packing all 400
    expect(l!.steps![2]!.note).toBe('Includes 100 pcs from stock');
  });
  it('a sub-product needed by two lines is split by each line’s share', () => {
    const [a, b] = planLines(order([line('a', 'mat', 300, 'MAKE'), line('b', 'mat', 100, 'MAKE')]), md);
    expect(a!.steps![0]!.plannedDays).toBe(1.5); // 150 kg
    expect(b!.steps![0]!.plannedDays).toBe(0.5); // 50 kg
  });
  it('never guesses a missing conversion', () => {
    const [l] = planLines(order([line('a', 'rug', 10, 'MAKE')]), md);
    expect(l!.steps![0]).toMatchObject({ plannedDays: null, note: 'Conversion needed (pcs → sq m)' });
  });
});

describe('progress from steps (working days)', () => {
  const planned = (stock: Record<string, StockEntry> = {}, done: string[] = []) => {
    const o = order([line('a', 'mat', 400, 'MAKE')], stock);
    let steps = o.lines[0]!.steps!;
    for (const at of done) steps = completeCurrent(steps, at)!;
    return planLines({ ...o, lines: [{ ...o.lines[0]!, steps }] }, md)[0]!.steps!;
  };
  it('weights by planned days, counts working days only and measures each step', () => {
    // Started Mon 2 Nov 2026; spinning done Wed 4 Nov; weaving done Tue 10 Nov (Sunday 8 Nov is off).
    const p = lineProgress(planned({}, ['2026-11-04T06:00:00Z', '2026-11-10T06:00:00Z']), '2026-11-02', '2026-11-11', DEFAULT_CALENDAR)!;
    expect(p.actualPct).toBe(67); // (2 + 4) / 9
    expect(p.plannedPct).toBe(89); // 8 working days of 9
    expect(p.steps[0]).toMatchObject({ state: 'DONE', actualDays: 2, overrunDays: 0 });
    expect(p.steps[1]).toMatchObject({ state: 'DONE', actualDays: 5, overrunDays: 1 });
    expect(p.current).toMatchObject({ state: 'NOW', actualDays: 1, overrunDays: -1 });
    expect(p.current!.step.label).toBe('Bleaching');
    expect(p.expectedFinish).toBe('2026-11-13');
  });
  it('a company holiday moves the expected finish', () => {
    const cal = { weeklyOff: [0], holidays: { '2026-11-12': 'Holiday' } };
    const p = lineProgress(planned({}, ['2026-11-04T06:00:00Z', '2026-11-10T06:00:00Z']), '2026-11-02', '2026-11-11', cal)!;
    expect(p.expectedFinish).toBe('2026-11-14');
  });
  it('counts steps equally when a time is missing, and plans from the deadline instead', () => {
    const o = order([line('b', 'door', 10, 'BUY')]);
    const steps = completeCurrent(o.lines[0]!.steps!, '2026-11-03T06:00:00Z')!;
    const p = lineProgress(planLines({ ...o, lines: [{ ...o.lines[0]!, steps }] }, md)[0]!.steps, '2026-11-02', '2026-11-04')!;
    expect(p.actualPct).toBe(33);
    expect(p.plannedPct).toBeNull();
    expect(p.expectedFinish).toBeNull();
  });
  it('undo puts the last step back', () => {
    const o = order([line('a', 'mat', 400, 'MAKE')]);
    const s = completeCurrent(o.lines[0]!.steps!, '2026-11-04T06:00:00Z')!;
    expect(undoLast(s)!.every((x) => x.doneAt === null)).toBe(true);
    expect(undoLast(o.lines[0]!.steps!)).toBeNull();
  });
  it('order progress is the average of its lines; overruns are flagged', () => {
    const o = order([line('a', 'mat', 400, 'MAKE'), line('b', 'door', 10, 'BUY')]);
    const a = completeCurrent(completeCurrent(o.lines[0]!.steps!, '2026-11-04T06:00:00Z')!, '2026-11-10T06:00:00Z')!;
    const jo = { ...o, lines: [{ ...o.lines[0]!, steps: a }, o.lines[1]!] };
    expect(orderStepProgress(jo, '2026-11-11', ctx)).toEqual({ actual: 34, planned: null, on: '2026-11-11' }); // (67 + 0) / 2
    expect(overrunningSteps(jo, '2026-11-14', ctx).map((x) => x.view.step.label)).toEqual(['Bleaching']); // 3 working days of 2
    expect(orderStepProgress({ ...jo, lines: [line('a', 'mat', 400, 'MAKE')] }, '2026-11-11', ctx)).toBeNull();
  });
  it('warns when the planned route cannot fit the working days before the deadline', () => {
    expect(routeFits(10, '2026-11-02', '2026-11-12')).toBe(false); // 9 working days
    expect(routeFits(9, '2026-11-02', '2026-11-12')).toBe(true);
    expect(routeFits(null, '2026-11-01', '2026-11-20')).toBeNull();
  });
});

describe('route editor parsing', async () => {
  const { routeFromDrafts } = await import('../../src/features/masters/RouteEditor');
  it('both empty = time pending; values must be positive; a process is required', () => {
    const r = routeFromDrafts([
      { processId: 'weave', perDayText: '400', perDayUnit: 'pcs', fixedText: '', alsoForStock: false, status: 'PENDING_VERIFICATION' },
      { processId: 'latex', perDayText: '', perDayUnit: 'pcs', fixedText: '2', alsoForStock: true, status: 'ESTIMATED' },
      { processId: 'pack', perDayText: '', perDayUnit: 'pcs', fixedText: '', alsoForStock: false, status: 'USER_PROVIDED' },
    ]);
    expect(r).toEqual([
      { processId: 'weave', perDay: 400, perDayUnit: 'pcs', fixedDays: null, status: 'USER_PROVIDED', source: '' },
      { processId: 'latex', perDay: null, perDayUnit: 'pcs', fixedDays: 2, alsoForStock: true, status: 'ESTIMATED', source: '' },
      { processId: 'pack', perDay: null, perDayUnit: 'pcs', fixedDays: null, status: 'PENDING_VERIFICATION', source: '' },
    ]);
    expect(routeFromDrafts([{ processId: 'weave', perDayText: '0', perDayUnit: 'pcs', fixedText: '', alsoForStock: false, status: 'VERIFIED' }])).toMatch(/more than 0/);
    expect(routeFromDrafts([{ processId: '', perDayText: '', perDayUnit: 'pcs', fixedText: '', alsoForStock: false, status: 'VERIFIED' }])).toMatch(/choose a process/);
  });
});
