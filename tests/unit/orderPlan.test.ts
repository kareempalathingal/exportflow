import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR, workingDaysBetween } from '../../src/lib/calendar';
import type { JoLine } from '../../src/lib/jobOrders';
import type { MasterData, Process, Product, RouteStep } from '../../src/lib/masters';
import { buildLineSteps, completeCurrent, orderPlan, processPlanRows, startCurrent } from '../../src/lib/route';

// Within-order capacity (5 Nov 2026): items of one order queue for each process.
const na = { value: null, status: 'UNAVAILABLE' as const, source: '' };
const step = (processId: string, perDay: number): RouteStep => ({ processId, perDay, perDayUnit: 'pcs', fixedDays: null, status: 'USER_PROVIDED', source: '' });
const product = (name: string, route: RouteStep[]): Product => ({
  name, code: '', active: true, notes: '', baseUnit: 'pcs', supplyType: 'MANUFACTURED', specifications: '',
  size: { length: null, width: null, unit: 'cm', status: 'UNAVAILABLE' }, thicknessMm: na, gsm: na, weightPerPieceKg: na, customUnits: [], route,
});
const processes = new Map<string, Process>([
  ['tuft', { name: 'Tufting', active: true, notes: '' }],
  ['pack', { name: 'Packing', active: true, notes: '' }],
  ['shear', { name: 'Shearing', active: true, notes: '' }],
]);
const md: MasterData = {
  products: new Map([
    ['a', product('A', [step('tuft', 100), step('pack', 400)])],
    ['b', product('B', [step('tuft', 100), step('pack', 400)])],
    ['c', product('C', [step('tuft', 400), step('shear', 100)])],
    ['d', product('D', [step('tuft', 100), step('shear', 200)])],
    ['e', product('E', [step('tuft', 400), { ...step('shear', 100), waitAll: true }])],
  ]),
  rawMaterials: new Map(),
  boms: new Map(),
};
const line = (id: string, productId: string, qty: number): JoLine => {
  const l: JoLine = { id, productId, productName: productId, qty, unit: 'pcs', supply: 'MAKE' };
  return { ...l, steps: buildLineSteps(l, md, processes) };
};
// Received Mon 2 Nov, confirmed the same day.
const order = (lines: JoLine[]) => ({ lines, status: 'CONFIRMED' as const, bomSnapshot: null, stock: {}, confirmedOn: '2026-11-02', receivedDate: '2026-11-02' });
const ctx = (units?: Record<string, number>) => ({ md, cal: DEFAULT_CALENDAR, planningDays: null, ...(units ? { units: new Map(Object.entries(units)) } : {}) });
const tuft = (p: ReturnType<typeof orderPlan>, i: number) => p.lines[i]!.lp.schedule!.find((s) => s.view.step.label === 'Tufting')!;

describe('order plan: items share each process', () => {
  it('one unit: the second item waits for the first; finish moves out', () => {
    const p = orderPlan(order([line('1', 'a', 300), line('2', 'b', 300)]), '2026-11-02', ctx());
    expect(tuft(p, 1).start).toBe(tuft(p, 0).finish);
    expect(tuft(p, 1).finish! > tuft(p, 0).finish!).toBe(true);
    const rows = processPlanRows(p);
    expect(rows.map((r) => processes.get(r.processId)!.name)).toEqual(['Tufting', 'Packing']);
    expect(rows[0]).toMatchObject({ qty: '600 pcs', rate: '100 pcs', units: 1, days: 6, items: 2, done: false });
  });
  it('two parallel units: both items run at the same time', () => {
    const p = orderPlan(order([line('1', 'a', 300), line('2', 'b', 300)]), '2026-11-02', ctx({ tuft: 2 }));
    expect(tuft(p, 1).start).toBe(tuft(p, 0).start);
    expect(processPlanRows(p)[0]).toMatchObject({ units: 2, days: 3 });
  });
  it('a waiting item is "queued", not late, while the unit is busy', () => {
    const l1 = line('1', 'a', 300);
    const started = { ...l1, steps: startCurrent(l1.steps!, '2026-11-02T06:00:00Z')! };
    const p = orderPlan(order([started, line('2', 'b', 300)]), '2026-11-03', ctx());
    const second = p.lines[1]!.lp.current!;
    expect(second.step.label).toBe('Tufting');
    expect(second.queued).toBe(true);
    expect(second.overrunDays).toBeNull();
  });
  it('finished steps keep their real dates and free the unit then', () => {
    const l1 = line('1', 'a', 100);
    const done = { ...l1, steps: completeCurrent(l1.steps!, '2026-11-03T06:00:00Z')! };
    const p = orderPlan(order([done, line('2', 'b', 100)]), '2026-11-04', ctx());
    expect(tuft(p, 0).view.state).toBe('DONE');
    expect(tuft(p, 0).finish).toBe('2026-11-03');
    expect(tuft(p, 1).start! >= '2026-11-03').toBe(true);
    expect(processPlanRows(p)[0]!.done).toBe(false);
  });
  it('quantities are never added across units', () => {
    const p = orderPlan(order([line('1', 'a', 100)]), '2026-11-02', ctx());
    expect(processPlanRows(p)[0]!.qty).toBe('100 pcs');
  });
});

describe('overlap within one item (like the company WO plan)', () => {
  const at = (p: ReturnType<typeof orderPlan>, label: string) => p.lines[0]!.lp.schedule!.find((s) => s.view.step.label === label)!;
  const days = (d: string | null) => workingDaysBetween('2026-11-02', d!, DEFAULT_CALENDAR);
  it('a slower next step starts once one day of its work is ready', () => {
    // 2000 pcs: tufting 5 days, shearing 20 days; shearing starts a quarter day in (shown on day 1).
    const p = orderPlan(order([line('1', 'c', 2000)]), '2026-11-02', ctx());
    expect(days(at(p, 'Shearing').start)).toBe(1);
    expect(days(at(p, 'Shearing').finish)).toBe(21); // 20.25, not 25
  });
  it('a faster next step runs without stopping and ends one day after the previous one', () => {
    // 2000 pcs: tufting 20 days, shearing 10 days: starts on day 11, ends on day 21.
    const p = orderPlan(order([line('1', 'd', 2000)]), '2026-11-02', ctx());
    expect(days(at(p, 'Tufting').finish)).toBe(20);
    expect(days(at(p, 'Shearing').start)).toBe(11);
    expect(days(at(p, 'Shearing').finish)).toBe(21);
  });
  it('"waits for the whole quantity" turns the overlap off', () => {
    const p = orderPlan(order([line('1', 'e', 2000)]), '2026-11-02', ctx());
    expect(days(at(p, 'Shearing').start)).toBe(5);
    expect(days(at(p, 'Shearing').finish)).toBe(25);
  });
});

describe('exact times in the queue (5 Nov 2026)', () => {
  it('rounding is for display only: seven items of 1.1 days take 7.7 days, not 10.5', () => {
    const lines = Array.from({ length: 7 }, (_, i) => line(String(i + 1), i % 2 ? 'b' : 'a', 110));
    const p = orderPlan(order(lines), '2026-11-02', ctx());
    const tuftRow = processPlanRows(p)[0]!;
    expect(tuftRow.days).toBe(8); // 7.7 rounded up to half a day
    expect(p.lines[0]!.lp.schedule!.find((s) => s.view.step.label === 'Tufting')!.view.step.plannedDays).toBe(1.5); // shown per item
    expect(workingDaysBetween('2026-11-02', tuftRow.finish!, DEFAULT_CALENDAR)).toBe(8);
  });
});
