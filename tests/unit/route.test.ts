import { describe, expect, it } from 'vitest';
import type { JoLine, JoStep } from '../../src/lib/jobOrders';
import type { Bom, MasterData, Process, Product } from '../../src/lib/masters';
import { buildLineSteps, completeCurrent, lineProgress, orderStepProgress, overrunningSteps, routeFits, undoLast } from '../../src/lib/route';

const na = { value: null, status: 'UNAVAILABLE' as const, source: '' };
const days = (v: number | null, status: 'USER_PROVIDED' | 'ESTIMATED' | 'PENDING_VERIFICATION' = 'USER_PROVIDED') => ({ value: v, status, source: '' });
const product = (name: string, supplyType: Product['supplyType'], route: Product['route'] = []): Product => ({
  name, code: '', active: true, notes: '', baseUnit: 'pcs', supplyType, specifications: '',
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
    ['yarn', product('Yarn', 'MANUFACTURED', [{ processId: 'spin', plannedDays: days(3) }])],
    ['mat', product('Mat', 'MANUFACTURED', [{ processId: 'weave', plannedDays: days(4) }, { processId: 'bleach', plannedDays: days(2) }, { processId: 'pack', plannedDays: days(1) }])],
    ['door', product('Door mat', 'TRADED', [{ processId: 'pack', plannedDays: days(null, 'PENDING_VERIFICATION') }])],
  ]),
  rawMaterials: new Map(),
  boms: new Map<string, Bom>([['mat', { productId: 'mat', notes: '', lines: [{ componentType: 'PRODUCT', componentId: 'yarn', qty: 1, unit: 'pcs', wastagePct: 0, status: 'VERIFIED', source: '' }] }]]),
};
const line = (productId: string, supply: JoLine['supply']): JoLine => ({ id: productId, productId, productName: productId, qty: 10, unit: 'pcs', supply });

describe('building steps for an order line', () => {
  it('made products: sub-product steps first, then the product route', () => {
    const s = buildLineSteps(line('mat', 'MAKE'), md, processes);
    expect(s.map((x) => `${x.forProduct}:${x.label}`)).toEqual(['Yarn:Spinning', 'Mat:Weaving', 'Mat:Bleaching', 'Mat:Packing']);
    expect(s.map((x) => x.plannedDays)).toEqual([3, 4, 2, 1]);
    expect(new Set(s.map((x) => x.key)).size).toBe(4);
  });
  it('bought products: Ordered, Received, then their own steps; untimed steps stay null', () => {
    const s = buildLineSteps(line('door', 'BUY'), md, processes);
    expect(s.map((x) => x.label)).toEqual(['Ordered', 'Received', 'Packing']);
    expect(s[2]!.plannedDays).toBeNull();
  });
});

describe('progress from steps', () => {
  const steps = (): JoStep[] => buildLineSteps(line('mat', 'MAKE'), md, processes);
  it('weights by planned days and measures each step', () => {
    let s = steps();
    s = completeCurrent(s, '2026-11-04T06:00:00Z')!; // spinning done on day 3
    s = completeCurrent(s, '2026-11-10T06:00:00Z')!; // weaving took 6 days (plan 4)
    const p = lineProgress(s, '2026-11-01', '2026-11-11')!;
    expect(p.actualPct).toBe(70); // (3+4)/10
    expect(p.plannedPct).toBe(100); // 10 days elapsed of 10 planned
    expect(p.steps[1]).toMatchObject({ state: 'DONE', actualDays: 6, overrunDays: 2 });
    expect(p.current).toMatchObject({ state: 'NOW', actualDays: 2, overrunDays: 0 });
    expect(p.current!.step.label).toBe('Bleaching');
  });
  it('counts steps equally when a time is missing, and plans from the deadline instead', () => {
    const s = buildLineSteps(line('door', 'BUY'), md, processes);
    const p = lineProgress(completeCurrent(s, '2026-11-02T06:00:00Z')!, '2026-11-01', '2026-11-03')!;
    expect(p.actualPct).toBe(33);
    expect(p.plannedPct).toBeNull();
  });
  it('undo puts the last step back', () => {
    const s = completeCurrent(steps(), '2026-11-04T06:00:00Z')!;
    expect(undoLast(s)!.every((x) => x.doneAt === null)).toBe(true);
    expect(undoLast(steps())).toBeNull();
  });
  it('order progress is the average of its lines; overruns are flagged', () => {
    const a = completeCurrent(completeCurrent(steps(), '2026-11-04T06:00:00Z')!, '2026-11-10T06:00:00Z')!;
    const jo = { confirmedOn: '2026-11-01', receivedDate: '2026-10-30', lines: [{ ...line('mat', 'MAKE'), steps: a }, { ...line('door', 'BUY'), steps: buildLineSteps(line('door', 'BUY'), md, processes) }] };
    expect(orderStepProgress(jo, '2026-11-11')).toEqual({ actual: 35, planned: null, on: '2026-11-11' });
    expect(overrunningSteps(jo, '2026-11-14').map((o) => o.view.step.label)).toEqual(['Bleaching']);
    expect(orderStepProgress({ ...jo, lines: [line('mat', 'MAKE')] }, '2026-11-11')).toBeNull();
  });
  it('warns when the planned route cannot fit before the deadline', () => {
    expect(routeFits(10, '2026-11-01', '2026-11-08')).toBe(false);
    expect(routeFits(10, '2026-11-01', '2026-11-20')).toBe(true);
    expect(routeFits(null, '2026-11-01', '2026-11-20')).toBeNull();
  });
});

describe('route editor parsing', async () => {
  const { routeFromDrafts } = await import('../../src/features/masters/RouteEditor');
  it('empty days = time pending; days must be positive; a process is required', () => {
    const r = routeFromDrafts([{ processId: 'weave', daysText: '4', status: 'PENDING_VERIFICATION' }, { processId: 'pack', daysText: '', status: 'USER_PROVIDED' }]);
    expect(r).toEqual([
      { processId: 'weave', plannedDays: { value: 4, status: 'USER_PROVIDED', source: '' } },
      { processId: 'pack', plannedDays: { value: null, status: 'PENDING_VERIFICATION', source: '' } },
    ]);
    expect(routeFromDrafts([{ processId: 'weave', daysText: '0', status: 'VERIFIED' }])).toMatch(/more than 0/);
    expect(routeFromDrafts([{ processId: '', daysText: '', status: 'VERIFIED' }])).toMatch(/choose a process/);
  });
});
