import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR } from '../../src/lib/calendar';
import type { JobOrder, JoLine } from '../../src/lib/jobOrders';
import type { MasterData, Process, Product, RouteStep } from '../../src/lib/masters';
import { addedSince, allocate, boardRows, boardWrites, completes, processCards, processOrder } from '../../src/lib/processBoard';
import { buildLineSteps } from '../../src/lib/route';

// Dashboard (confirmed 17 Nov 2026): one card per process in working order; updates filled in plan order.
const na = { value: null, status: 'UNAVAILABLE' as const, source: '' };
const step = (processId: string, perDay: number, extra: Partial<RouteStep> = {}): RouteStep => ({ processId, perDay, perDayUnit: 'pcs', fixedDays: null, status: 'USER_PROVIDED', source: '', ...extra });
const product = (name: string, route: RouteStep[]): Product => ({
  name, code: '', active: true, notes: '', baseUnit: 'pcs', supplyType: 'MANUFACTURED', specifications: '',
  size: { length: null, width: null, unit: 'cm', status: 'UNAVAILABLE' }, thicknessMm: na, gsm: na, weightPerPieceKg: na, customUnits: [], route,
});
const procList = [
  { id: 'pack', name: 'Packing', active: true, notes: '' },
  { id: 'print', name: 'Printing', active: true, notes: '' },
  { id: 'emb', name: 'Embossing', active: true, notes: '' },
  { id: 'idle', name: 'Idle', active: true, notes: '' },
];
const processes = new Map<string, Process>(procList.map((p) => [p.id, p]));
const md: MasterData = {
  products: new Map([
    ['a', product('A', [step('print', 100), step('pack', 400)])],
    ['b', product('B', [step('print', 100), step('pack', 400)])],
    ['o', product('O', [step('print', 100), step('emb', 50, { outside: true }), step('pack', 400)])],
  ]),
  rawMaterials: new Map(),
  boms: new Map(),
};
const line = (id: string, productId: string, qty: number): JoLine => {
  const l: JoLine = { id, productId, productName: md.products.get(productId)!.name, qty, unit: 'pcs', supply: 'MAKE' };
  return { ...l, steps: buildLineSteps(l, md, processes) };
};
const jo = (id: string, no: string, lines: JoLine[], deadline: string, status = 'CONFIRMED') =>
  ({
    id, joNumber: no, lines, status, bomSnapshot: null, stock: {}, confirmedOn: '2026-11-02', receivedDate: '2026-11-02',
    deadline: { internalDeadline: deadline, deliveryDate: deadline, ruleVersion: 'v2' },
  }) as unknown as JobOrder & { id: string };
const ctx = { md, cal: DEFAULT_CALENDAR, planningDays: null };
const today = '2026-11-03';
const jos = () => [jo('j1', 'WO 1', [line('1', 'a', 150), line('2', 'b', 300)], '2026-12-20'), jo('j2', 'WO 2', [line('1', 'b', 200)], '2026-12-10')];

describe('working order of the processes', () => {
  it('follows the routes; a loop or an unused process does not break it', () => {
    expect(processOrder([['print', 'pack'], ['print', 'emb', 'pack']], ['pack', 'emb', 'print', 'idle'])).toEqual(['print', 'emb', 'pack', 'idle']);
    expect(processOrder([['a', 'b'], ['b', 'a']], ['a', 'b'])).toHaveLength(2);
  });
});

describe('process cards', () => {
  it('one card per active process, in route order, with % and quantities', () => {
    const cards = processCards(jos(), procList, [], today, ctx);
    expect(cards.map((c) => c.processId)).toEqual(['print', 'emb', 'pack', 'idle']);
    const print = cards[0]!;
    expect(print).toMatchObject({ items: 3, made: 0, total: 650, pct: 0, benchmark: '100 pcs/day', units: ['pcs'] });
    expect(cards.find((c) => c.processId === 'idle')!.items).toBe(0);
    expect(cards.find((c) => c.processId === 'emb')!.outside).toBe(true);
  });
  it('done and recorded output count; Completed WOs are left out', () => {
    const rows = boardRows(jos(), 'print', today, today, ctx);
    const { writes } = boardWrites(jos(), rows, allocate(rows, 200, 'pcs'), 'Printing', today, '10:00', today, true);
    const after = jos().map((j) => ({ ...j, lines: writes.find((w) => w.joId === j.id)?.lines ?? j.lines }));
    const print = processCards(after, procList, [], today, ctx)[0]!;
    expect(print.made).toBe(200);
    expect(print.pct).toBe(30);
    expect(print.lastUpdate).toContain('10:00');
    expect(processCards([jo('j9', 'WO 9', [line('1', 'a', 10)], '2026-12-20', 'COMPLETED')], procList, [], today, ctx)[0]!.items).toBe(0);
  });
});

describe('update now: in-house', () => {
  it('lists open printing steps; packing waits for printing', () => {
    const rows = boardRows(jos(), 'print', today, today, ctx);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.open && r.unit === 'pcs' && r.finishUpTo === r.rawIndex)).toBe(true);
    expect(boardRows(jos(), 'pack', today, today, ctx).every((r) => !r.open && r.waiting?.startsWith('waits for'))).toBe(true);
  });
  it('fills in plan order, each up to what it still needs; the rest is reported', () => {
    const rows = boardRows(jos(), 'print', today, today, ctx);
    const a = allocate(rows, 400, 'pcs');
    expect([...a.given.values()].reduce((x, y) => x + y, 0)).toBe(400);
    const first = rows[0]!;
    expect(a.given.get(`${first.joId}|${first.lineId}|${first.stepKey}`)).toBe(Math.min(400, first.left!));
    expect(allocate(rows, 1000, 'pcs').extra).toBe(350);
    expect(allocate(rows, 100, 'kg').given.size).toBe(0);
  });
  it("the day's running total: a second update adds only the difference", () => {
    const rows = boardRows(jos(), 'print', today, today, ctx);
    const { writes } = boardWrites(jos(), rows, allocate(rows, 120, 'pcs'), 'Printing', today, '11:40', today, false);
    const after = jos().map((j) => ({ ...j, lines: writes.find((w) => w.joId === j.id)?.lines ?? j.lines }));
    const rows2 = boardRows(after, 'print', today, today, ctx);
    expect(addedSince(rows2, 'pcs', 300)).toEqual({ already: 120, add: 180 });
    expect(addedSince(rows2, 'pcs', 100).add).toBeNull();
  });
  it('records start, output with the time; marks done only when asked', () => {
    const rows = boardRows(jos(), 'print', today, today, ctx);
    const a = allocate(rows, 650, 'pcs');
    expect(completes(rows, a)).toHaveLength(3);
    const keep = boardWrites(jos(), rows, a, 'Printing', today, '16:20', today, false);
    expect(keep.writes).toHaveLength(2);
    const s = keep.writes.find((w) => w.joId === 'j2')!.lines[0]!.steps!.find((x) => x.processId === 'print')!;
    expect(s.startedAt).toBeTruthy();
    expect(s.doneAt).toBeFalsy();
    expect(s.outputLog?.[0]).toMatchObject({ on: today, time: '16:20', qty: 200, unit: 'pcs' });
    expect(keep.writes[0]!.what).toContain('16:20');
    expect(keep.writes[0]!.what).toContain('(from the dashboard)');
    const done = boardWrites(jos(), rows, a, 'Printing', today, '16:20', today, true);
    expect(done.done).toHaveLength(3);
    expect(done.writes.find((w) => w.joId === 'j2')!.lines[0]!.steps!.find((x) => x.processId === 'print')!.doneAt).toBeTruthy();
  });
  it('never before the WO was confirmed', () => {
    expect(boardRows(jos(), 'print', '2026-11-01', today, ctx).some((r) => r.open)).toBe(false);
  });
});

describe('update now: outside work', () => {
  const ojo = () => [jo('j3', 'WO 3', [line('1', 'o', 100)], '2026-12-20')];
  it('dispatch lots, then landing only up to what was dispatched', () => {
    const d = boardRows(ojo(), 'emb', today, today, ctx, 'DISPATCH');
    expect(d).toHaveLength(1);
    expect(d[0]!.left).toBe(100);
    const w1 = boardWrites(ojo(), d, allocate(d, 60, 'pcs'), 'Embossing', today, '09:00', today, false, 'DISPATCH');
    expect(w1.writes[0]!.what).toContain('Embossing dispatched');
    const after = ojo().map((j) => ({ ...j, lines: w1.writes[0]!.lines }));
    const l = boardRows(after, 'emb', today, today, ctx, 'LAND');
    expect(l[0]!.left).toBe(60);
    expect(allocate(l, 80, 'pcs').extra).toBe(20);
    const card = processCards(after, procList, [], today, ctx).find((c) => c.processId === 'emb')!;
    expect(card).toMatchObject({ dispatched: 60, made: 0, running: 1 });
  });
});

describe('a made sub-product shared by several products is counted once', () => {
  const md2: MasterData = {
    products: new Map([
      ['bm', { ...product('Base', [step('tuft', 100)]) }],
      ['m1', product('M1', [step('print', 100)])],
      ['m2', product('M2', [step('print', 100)])],
    ]),
    rawMaterials: new Map(),
    boms: new Map([
      ['m1', { productId: 'm1', notes: '', lines: [{ componentType: 'PRODUCT', componentId: 'bm', qty: 1, unit: 'pcs', wastagePct: 0, status: 'USER_PROVIDED', source: '' }] }],
      ['m2', { productId: 'm2', notes: '', lines: [{ componentType: 'PRODUCT', componentId: 'bm', qty: 1, unit: 'pcs', wastagePct: 0, status: 'USER_PROVIDED', source: '' }] }],
    ]),
  };
  const procs2 = new Map<string, Process>([['tuft', { name: 'Tufting', active: true, notes: '' }], ['print', { name: 'Printing', active: true, notes: '' }]]);
  const l2 = (id: string, productId: string, qty: number): JoLine => {
    const l: JoLine = { id, productId, productName: md2.products.get(productId)!.name, qty, unit: 'pcs', supply: 'MAKE' };
    return { ...l, steps: buildLineSteps(l, md2, procs2) };
  };
  it('tufting total = the base mat to make (100 + 50), not per ordered product twice', () => {
    const ctx2 = { md: md2, cal: DEFAULT_CALENDAR, planningDays: null };
    const cards = processCards([jo('j', 'WO 5', [l2('1', 'm1', 100), l2('2', 'm2', 50)], '2026-12-20')], [...procs2].map(([id, p]) => ({ id, ...p })), [], today, ctx2);
    const tuft = cards.find((c) => c.processId === 'tuft')!;
    expect(cards[0]!.processId).toBe('tuft');
    expect(tuft.total).toBe(150);
    expect(cards.find((c) => c.processId === 'print')!.total).toBe(150);
  });
});
