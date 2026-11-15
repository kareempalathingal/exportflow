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

describe('item priority (15 Nov 2026)', () => {
  const wait = (processId: string, perDay: number): RouteStep => ({ ...step(processId, perDay), waitAll: true });
  const pmd: MasterData = {
    products: new Map([
      ['short', product('Short', [step('tuft', 100), step('pack', 400)])],
      ['long', product('Long', [step('tuft', 100), wait('shear', 100), wait('pack', 50)])],
      ['x', product('X', [wait('print', 100)])],
      ['a', product('A', [step('tuft', 100), wait('print', 100)])],
      ['b', product('B', [step('tuft', 100), wait('print', 100), wait('pack', 100)])],
    ]),
    rawMaterials: new Map(),
    boms: new Map(),
  };
  const pproc = new Map<string, Process>([...processes, ['print', { name: 'Printing', active: true, notes: '' }]]);
  const pline = (id: string, productId: string, qty: number, rush = false): JoLine => {
    const l: JoLine = { id, productId, productName: productId, qty, unit: 'pcs', supply: 'MAKE', ...(rush ? { rush: true } : {}) };
    return { ...l, steps: buildLineSteps(l, pmd, pproc) };
  };
  const pctx = (units?: Record<string, number>) => ({ md: pmd, cal: DEFAULT_CALENDAR, planningDays: null, ...(units ? { units: new Map(Object.entries(units)) } : {}) });
  const at = (p: ReturnType<typeof orderPlan>, i: number, label: string) => p.lines[i]!.lp.schedule!.find((s) => s.view.step.label === label)!;
  const off = (d: string | null) => workingDaysBetween('2026-11-02', d!, DEFAULT_CALENDAR);
  const porder = (lines: JoLine[]) => ({ ...order(lines), itemOrderRule: 'PRIORITY' as const });

  it('the item with more work left gets the shared process first, even when listed second', () => {
    const p = orderPlan(porder([pline('1', 'short', 300), pline('2', 'long', 300)]), '2026-11-02', pctx());
    expect(off(at(p, 1, 'Tufting').start)).toBe(0);
    expect(at(p, 0, 'Tufting').start).toBe(at(p, 1, 'Tufting').finish);
    expect(p.itemOrder.items.map((i) => i.lineId)).toEqual(['2', '1']);
    expect(p.itemOrder.gainDays! >= 0).toBe(true);
  });
  it('Rush goes first whatever the work left', () => {
    const p = orderPlan(porder([pline('1', 'short', 300, true), pline('2', 'long', 300)]), '2026-11-02', pctx());
    expect(off(at(p, 0, 'Tufting').start)).toBe(0);
    expect(p.itemOrder.items[0]).toMatchObject({ lineId: '1', rush: true });
  });
  it('items waiting for the same unit are chosen by priority, not by who was ready first', () => {
    // Printing is busy with X until day 6; A is ready for it on day 3, B on day 4 (two tufting units).
    const lines = [pline('0', 'x', 600), pline('1', 'a', 300), pline('2', 'b', 400)];
    const p = orderPlan(porder(lines), '2026-11-02', pctx({ tuft: 2 }));
    expect(off(at(p, 2, 'Printing').start)).toBe(6); // B has more work left
    expect(off(at(p, 1, 'Printing').start)).toBe(10);
    expect(p.itemOrder.readyListed).not.toBeNull();
    // In listed order A (ready first) would take the unit at day 6: the order ends 3 working days later.
    expect(p.itemOrder.gainDays).toBe(3);
  });
  it('an idle unit is never kept for a more urgent item', () => {
    const lines = [pline('1', 'a', 300), pline('2', 'b', 400)];
    const p = orderPlan(porder(lines), '2026-11-02', pctx({ tuft: 2 }));
    expect(off(at(p, 0, 'Printing').start)).toBe(3); // A is ready first and printing is free
    expect(off(at(p, 1, 'Printing').start)).toBe(6);
  });
  it('days left and "part unknown" per item', () => {
    const p = orderPlan(porder([pline('1', 'short', 300), pline('2', 'long', 300)]), '2026-11-02', pctx());
    const long = p.itemOrder.items.find((i) => i.lineId === '2')!;
    expect(long).toMatchObject({ step: 'Tufting', daysLeft: 9, partUnknown: false });
  });
  it('counts the work AFTER the shared step (the case where "all work left" picks wrong)', () => {
    // A: tufting 2 days, then printing 6; B: tufting 4 days, then packing 5. After tufting A has 6, B 5: A first.
    const md2: MasterData = {
      products: new Map([
        ['a', product('A', [step('tuft', 100), wait('print', 100)])],
        ['b', product('B', [step('tuft', 100), wait('pack', 100)])],
      ]),
      rawMaterials: new Map(),
      boms: new Map(),
    };
    const l = (id: string, pid: string, tq: number, nq: number): JoLine => {
      const x: JoLine = { id, productId: pid, productName: pid, qty: tq, unit: 'pcs', supply: 'MAKE' };
      const steps = buildLineSteps(x, md2, pproc).map((s) => (s.processId === 'tuft' ? s : { ...s, perDay: tq / nq }));
      return { ...x, steps };
    };
    const p = orderPlan(porder([l('2', 'b', 400, 5), l('1', 'a', 200, 6)]), '2026-11-02', { md: md2, cal: DEFAULT_CALENDAR, planningDays: null });
    expect(off(p.lines[1]!.lp.schedule!.find((s) => s.view.step.label === 'Tufting')!.start)).toBe(0); // A first although listed second
    expect(p.itemOrder.gainDays).toBe(1); // listed order (B first) would end a day later
  });
});

describe('item priority: texts, effect list and plan line', () => {
  it('gain text in working days, both ways', async () => {
    const { gainText, itemPrioritySummary } = await import('../../src/lib/itemOrder');
    expect(gainText(3)).toEqual({ text: '3 working days earlier', tone: 'ok' });
    expect(gainText(-1)).toEqual({ text: '1 working day later', tone: 'warn' });
    expect(gainText(0)!.tone).toBe('neutral');
    expect(gainText(null)).toBeNull();
    expect(itemPrioritySummary([])).toBe('No open WO with two or more items');
  });
  it('the effect list covers drafts (steps from the routes) and confirmed WOs with two or more items', async () => {
    const { itemPriorityRows, itemPriorityText } = await import('../../src/lib/itemOrder');
    const base = { customerId: 'c', customerName: 'C', poNumber: '', deliveryDate: '2026-12-30', deliveryDateType: 'FACTORY_DISPATCH' as const, notes: '', deadline: { orderPeriodDays: 40, bufferDays: 4, internalDeadline: '2026-12-24', ruleVersion: 'v2' }, progressLog: [] };
    const raw = (id: string, productId: string, qty: number): JoLine => ({ id, productId, productName: productId, qty, unit: 'pcs', supply: 'MAKE' });
    const jos = [
      { id: 'd', joNumber: 'WO-D', ...order([raw('1', 'a', 300), raw('2', 'b', 300)]), status: 'DRAFT' as const, ...base },
      { id: 'c', joNumber: 'WO-C', ...order([line('1', 'a', 300), line('2', 'c', 300)]), ...base },
      { id: 's', joNumber: 'WO-S', ...order([line('1', 'a', 300)]), ...base },
    ] as unknown as Parameters<typeof itemPriorityRows>[0];
    const rows = itemPriorityRows(jos, '2026-11-02', ctx(), processes);
    expect(rows.map((r) => r.joNumber).sort()).toEqual(['WO-C', 'WO-D']);
    expect(rows.find((r) => r.joNumber === 'WO-D')!.draft).toBe(true);
    expect(itemPriorityText(rows, '2026-11-02')).toContain('WO-D (draft): listed order');
  });
});

describe('item order rule per WO (15 Nov 2026)', () => {
  it('a WO confirmed before item priority keeps the listed order; a draft uses the priority', () => {
    const lines = [line('1', 'a', 300), line('2', 'c', 300)];
    expect(orderPlan(order(lines), '2026-11-02', ctx()).itemOrder.rule).toBe('LISTED');
    expect(orderPlan({ ...order(lines), itemOrderRule: 'PRIORITY' as const }, '2026-11-02', ctx()).itemOrder.rule).toBe('PRIORITY');
    expect(orderPlan({ ...order(lines), status: 'DRAFT' as const }, '2026-11-02', ctx()).itemOrder.rule).toBe('PRIORITY');
  });
  it('the listed WO is planned exactly as before; the priority is shown only as a comparison', () => {
    const lines = [line('1', 'a', 300), line('2', 'b', 300)];
    const old = orderPlan(order(lines), '2026-11-02', ctx());
    expect(tuft(old, 1).start).toBe(tuft(old, 0).finish); // listed order: first line first
    expect(old.itemOrder.ready).toBe(old.itemOrder.readyListed);
    expect(old.itemOrder.items.map((i) => i.lineId)).toEqual(['1', '2']);
  });
});

describe('plan cache (15 Nov 2026)', () => {
  it('the same WO, masters and day give the same plan object; anything else is planned again', async () => {
    const { orderPlanUncached } = await import('../../src/lib/route');
    const w = order([line('1', 'a', 300), line('2', 'b', 300)]);
    const c = ctx();
    const p1 = orderPlan(w, '2026-11-02', c);
    expect(orderPlan(w, '2026-11-02', { ...c })).toBe(p1); // a new ctx object with the same contents
    expect(JSON.stringify(p1)).toBe(JSON.stringify(orderPlanUncached(w, '2026-11-02', c)));
    expect(orderPlan(w, '2026-11-03', c)).not.toBe(p1);
    expect(orderPlan(w, '2026-11-02', ctx({ tuft: 2 }))).not.toBe(p1);
    expect(orderPlan({ ...w }, '2026-11-02', c)).not.toBe(p1); // a changed record is a new object
  });
});
