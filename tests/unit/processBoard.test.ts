import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR } from '../../src/lib/calendar';
import type { JobOrder, JoLine } from '../../src/lib/jobOrders';
import type { MasterData, Process, Product, RouteStep } from '../../src/lib/masters';
import { allocate, boardRows, boardWrites, completes } from '../../src/lib/processBoard';
import { buildLineSteps } from '../../src/lib/route';

// Dashboard (confirmed 17 Nov 2026): one total per process, filled in plan order.
const na = { value: null, status: 'UNAVAILABLE' as const, source: '' };
const step = (processId: string, perDay: number): RouteStep => ({ processId, perDay, perDayUnit: 'pcs', fixedDays: null, status: 'USER_PROVIDED', source: '' });
const product = (name: string, route: RouteStep[]): Product => ({
  name, code: '', active: true, notes: '', baseUnit: 'pcs', supplyType: 'MANUFACTURED', specifications: '',
  size: { length: null, width: null, unit: 'cm', status: 'UNAVAILABLE' }, thicknessMm: na, gsm: na, weightPerPieceKg: na, customUnits: [], route,
});
const processes = new Map<string, Process>([
  ['print', { name: 'Printing', active: true, notes: '' }],
  ['pack', { name: 'Packing', active: true, notes: '' }],
]);
const md: MasterData = {
  products: new Map([
    ['a', product('A', [step('print', 100), step('pack', 400)])],
    ['b', product('B', [step('print', 100), step('pack', 400)])],
  ]),
  rawMaterials: new Map(),
  boms: new Map(),
};
const line = (id: string, productId: string, qty: number): JoLine => {
  const l: JoLine = { id, productId, productName: md.products.get(productId)!.name, qty, unit: 'pcs', supply: 'MAKE' };
  return { ...l, steps: buildLineSteps(l, md, processes) };
};
const jo = (id: string, no: string, lines: JoLine[], deadline: string) =>
  ({
    id, joNumber: no, lines, status: 'CONFIRMED', bomSnapshot: null, stock: {}, confirmedOn: '2026-11-02', receivedDate: '2026-11-02',
    deadline: { internalDeadline: deadline, deliveryDate: deadline, ruleVersion: 'v2' },
  }) as unknown as JobOrder & { id: string };
const ctx = { md, cal: DEFAULT_CALENDAR, planningDays: null };
const today = '2026-11-03';

describe("process dashboard", () => {
  const jos = [jo('j1', 'WO 1', [line('1', 'a', 150), line('2', 'b', 300)], '2026-12-20'), jo('j2', 'WO 2', [line('1', 'b', 200)], '2026-12-10')];
  it('lists every open printing step of confirmed WOs, open ones takeable', () => {
    const rows = boardRows(jos, 'print', today, today, ctx);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.open && r.unit === 'pcs' && r.firstOpen)).toBe(true);
    expect(boardRows(jos, 'pack', today, today, ctx).every((r) => !r.open && r.waiting?.startsWith('waits for'))).toBe(true);
  });
  it('fills in plan order, each up to what it still needs; the rest is reported', () => {
    const rows = boardRows(jos, 'print', today, today, ctx);
    const a = allocate(rows, 400, 'pcs');
    const sum = [...a.given.values()].reduce((x, y) => x + y, 0);
    expect(sum).toBe(400);
    expect(a.extra).toBe(0);
    // The first row in plan order is filled fully before the next one gets anything.
    const first = rows[0]!;
    expect(a.given.get(`${first.joId}|${first.lineId}|${first.stepKey}`)).toBe(Math.min(400, first.left!));
    expect(allocate(rows, 1000, 'pcs').extra).toBe(1000 - 650);
    expect(allocate(rows, 100, 'kg').given.size).toBe(0);
  });
  it('records the start and the output; marks done only when asked', () => {
    const rows = boardRows(jos, 'print', today, today, ctx);
    const a = allocate(rows, 650, 'pcs');
    expect(completes(rows, a)).toHaveLength(3);
    const keep = boardWrites(jos, rows, a, 'Printing', today, today, false);
    expect(keep.writes).toHaveLength(2);
    const s = keep.writes.find((w) => w.joId === 'j2')!.lines[0]!.steps!.find((x) => x.processId === 'print')!;
    expect(s.startedAt).toBeTruthy();
    expect(s.doneAt).toBeFalsy();
    expect(s.outputLog?.[0]).toMatchObject({ on: today, qty: 200, unit: 'pcs' });
    expect(keep.writes[0]!.what).toContain('(from the dashboard)');
    const done = boardWrites(jos, rows, a, 'Printing', today, today, true);
    expect(done.done).toHaveLength(3);
    expect(done.writes.find((w) => w.joId === 'j2')!.lines[0]!.steps!.find((x) => x.processId === 'print')!.doneAt).toBeTruthy();
  });
  it('never takes output before the step could start', () => {
    // Before the WO was confirmed: no item can take output.
    expect(boardRows(jos, 'print', '2026-11-01', today, ctx).some((r) => r.open)).toBe(false);
    // Packing waits until printing has started.
    expect(boardRows(jos, 'pack', today, today, ctx).some((r) => r.open)).toBe(false);
  });
});
