import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR } from '../../src/lib/calendar';
import { cleanRefs, customerByCode, refPairs, type JobOrder, type JoLine } from '../../src/lib/jobOrders';
import { findHeaderRow, findOrderFields, guessColumns, extractRows, linesValues, orderFromCells } from '../../src/lib/joImport';
import type { MasterData, Process, Product, RouteStep } from '../../src/lib/masters';
import { buildLineSteps, indentLateDays, orderPlan, setIndent, toInHouse, toOutside } from '../../src/lib/route';
import { buildToday } from '../../src/lib/today';

// Round 1 (17 Nov 2026): order references, import of a multi-line header cell, in-house / outside per order,
// indent on in-house steps, "waits for all items of this order". Sample values only.

describe('order references', () => {
  it('are trimmed, empty ones dropped, shown with dates as days', () => {
    expect(cleanRefs({ customerCode: ' C-01 ', piNo: '', revision: '  ' })).toEqual({ customerCode: 'C-01' });
    expect(cleanRefs({ piNo: '' })).toBeUndefined();
    expect(refPairs({ customerCode: 'C-01', piDate: '2026-04-22' })).toEqual([
      ['Customer Code', 'C-01'],
      ['PI date', '22 Apr 2026'],
    ]);
  });
  it('an earlier WO with the same customer code gives the customer', () => {
    const jos = [
      { customerId: 'a', receivedDate: '2026-01-01', refs: { customerCode: 'C-01' } },
      { customerId: 'b', receivedDate: '2026-03-01', refs: { customerCode: 'c-01' } },
    ] as Pick<JobOrder, 'refs' | 'customerId' | 'receivedDate'>[];
    expect(customerByCode('C-01', jos)).toBe('b');
    expect(customerByCode('C-09', jos)).toBeNull();
    expect(customerByCode('', jos)).toBeNull();
  });
});

describe('import: header lines in one cell (company WO form layout)', () => {
  const left = 'Customer Code   : C-01\nCustomer PO NO.  : 1234 dated 17-04-2026 \nProforma Invoice No. : PI-55 dated 22-04-2026\nPI Confirmed date  :';
  const right = 'Work Order No : 7/2026\nWork Order Date : 22-04-2026\nCargo Ready Date : 31-05-2026\nRevision if any :';
  const grid = [
    [],
    ['', 'WORK ORDER form'],
    ['', left, '', right],
    ['', '(note)'],
    ['', 'SL#', 'ITEM REF NO.', 'DESCRIPTION', 'ORDER QUANTIY (PCS)', 'BARCODE', 'ARTICLE NO.'],
    ['', '1', 'MAT 1', 'Sample mat', '1200', '0000000000017', 'AB01'],
  ];
  it('reads every field of the lines, the dates after "dated" included', () => {
    expect(linesValues(left)).toEqual({ customerCode: 'C-01', poNumber: '1234', poDate: '17-04-2026', piNo: 'PI-55', piDate: '22-04-2026' });
    expect(linesValues(right)).toEqual({ joNumber: '7/2026', receivedDate: '22-04-2026', deliveryDate: '31-05-2026' });
    const h = findHeaderRow(grid);
    expect(h).toBe(4);
    const v = findOrderFields(grid, h);
    expect(v.joNumber?.value).toBe('7/2026');
    expect(v.poNumber?.value).toBe('1234');
    expect(v.receivedDate?.value).toBe('22-04-2026');
    expect(v.deliveryDate?.value).toBe('31-05-2026');
    expect(v.customerCode?.value).toBe('C-01');
    // A remembered layout points at the same cell: each field still gets its own line.
    expect(orderFromCells(grid, { joNumber: { r: 2, c: 3 }, piNo: { r: 2, c: 1 } })).toMatchObject({ joNumber: { value: '7/2026' }, piNo: { value: 'PI-55' } });
  });
  it('item code, article no. and barcode are separate columns', () => {
    const cols = guessColumns(grid[4]!);
    expect(cols).toMatchObject({ code: 2, name: 3, qty: 4, barcode: 5, articleNo: 6 });
    expect(extractRows(grid, 4, cols, null)[0]).toMatchObject({ code: 'MAT 1', articleNo: 'AB01', barcode: '0000000000017', qty: 1200 });
  });
});

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
    ['a', product('A', [step('print', 100), step('pack', 1000)])],
    ['b', product('B', [step('print', 100), step('pack', 1000)])],
  ]),
  rawMaterials: new Map(),
  boms: new Map(),
};
const line = (id: string, productId: string, qty: number): JoLine => {
  const l: JoLine = { id, productId, productName: md.products.get(productId)!.name, qty, unit: 'pcs', supply: 'MAKE' };
  return { ...l, steps: buildLineSteps(l, md, processes) };
};
const jo = (lines: JoLine[]) =>
  ({ id: 'j', joNumber: 'WO 1', lines, status: 'CONFIRMED', bomSnapshot: null, stock: {}, confirmedOn: '2026-11-02', receivedDate: '2026-11-02', deliveryDate: '2026-12-30', deadline: { internalDeadline: '2026-12-20' } }) as unknown as JobOrder & { id: string };
const ctx = { md, cal: DEFAULT_CALENDAR, planningDays: null };

describe('in-house or outside, for this order only', () => {
  it('outside adds dispatch and landing around the step; back to in-house removes them', () => {
    const st = line('1', 'a', 100).steps!;
    const out = toOutside(st, 0)!;
    expect(out.map((s) => s.label)).toEqual(['Dispatch for Printing', 'Printing (outside)', 'Landing from Printing', 'Packing']);
    expect(out[0]).toMatchObject({ processId: null, outsideOf: 'print', passThrough: true });
    expect(out[1]).toMatchObject({ processId: 'print', outside: true, key: st[0]!.key });
    expect(toOutside(out, 1)).toBeNull();
    const back = toInHouse(out, 1)!;
    expect(back.map((s) => s.label)).toEqual(['Printing', 'Packing']);
    expect(back[0]!.outside).toBeUndefined();
  });
  it('cannot go back once something was dispatched; done steps cannot be switched', () => {
    const out = toOutside(line('1', 'a', 100).steps!, 0)!;
    const sent = out.map((s, j) => (j === 0 ? { ...s, outputLog: [{ on: '2026-11-03', qty: 10, unit: 'pcs', at: '' }] } : s));
    expect(toInHouse(sent, 1)).toBeNull();
    const done = line('1', 'a', 100).steps!.map((s, j) => (j === 0 ? { ...s, doneAt: '2026-11-03T06:30:00.000Z' } : s));
    expect(toOutside(done, 0)).toBeNull();
  });
});

describe('indent on an in-house step', () => {
  it('is saved and cleared; "required by" passed counts working days', () => {
    const st = setIndent(line('1', 'a', 100).steps!, 0, { indentNo: ' IN-1 ', indentOn: '2026-11-02', requiredBy: '2026-11-05' })!;
    expect(st[0]).toMatchObject({ indentNo: 'IN-1', indentOn: '2026-11-02', requiredBy: '2026-11-05' });
    expect(indentLateDays(st[0]!, '2026-11-05', DEFAULT_CALENDAR)).toBe(0);
    expect(indentLateDays(st[0]!, '2026-11-09', DEFAULT_CALENDAR)).toBe(3); // Fri, Sat, Mon (Sunday off)
    expect(indentLateDays({ ...st[0]!, doneAt: '2026-11-06T06:30:00.000Z' }, '2026-11-09', DEFAULT_CALENDAR)).toBe(0);
    const cleared = setIndent(st, 0, { indentNo: '', indentOn: null, requiredBy: null })!;
    expect(cleared[0]!.indentNo).toBeUndefined();
    expect(cleared[0]!.requiredBy).toBeUndefined();
  });
  it('a passed "required by" is overdue in Today', () => {
    const st = setIndent(line('1', 'a', 100).steps!, 0, { indentNo: 'IN-1', indentOn: '2026-11-02', requiredBy: '2026-11-04' })!;
    const s = buildToday({ jobOrders: [jo([{ ...line('1', 'a', 100), steps: st }])], ctx, today: '2026-11-06', tasks: [], deptName: () => '', processes, suppliers: new Map(), alertDays: 2 });
    expect(s.items.some((i) => i.when === 'OVERDUE' && i.text.includes('Printing (indent IN-1) required by'))).toBe(true);
  });
});

describe('round 2 in Today', () => {
  it('a late order item and a requirement due soon show up', () => {
    const base = jo([line('1', 'a', 100)]);
    const j = { ...base, deliveryDate: '2026-11-30', orderItems: [{ id: 'x', item: 'Swing tags', expectedOn: '2026-11-04' }], checklist: [{ id: 'y', text: 'Sample approved', due: '2026-11-07' }, { id: 'z', text: 'Done one', due: '2026-11-05', doneOn: '2026-11-05' }] };
    const s = buildToday({ jobOrders: [j], ctx, today: '2026-11-06', tasks: [], deptName: () => '', processes, suppliers: new Map(), alertDays: 2 });
    expect(s.items.some((i) => i.when === 'OVERDUE' && i.text.includes('Swing tags expected'))).toBe(true);
    expect(s.items.some((i) => i.when !== 'OVERDUE' && i.text.includes('Sample approved - due'))).toBe(true);
    expect(s.items.some((i) => i.text.includes('Done one'))).toBe(false);
  });
});

describe('waits for all items of this order', () => {
  it('packing of an item waits until every other item has finished its steps before packing', () => {
    const l1 = line('1', 'a', 100); // printing 1 day
    const l2 = line('2', 'b', 1000); // printing 10 days
    const free = orderPlan(jo([l1, l2]), '2026-11-02', ctx);
    const packFree = free.lines[0]!.lp.schedule!.find((x) => x.view.step.processId === 'pack')!;
    const waiting = { ...l1, steps: l1.steps!.map((s) => (s.processId === 'pack' ? { ...s, waitsForOrder: true } : s)) };
    const tied = orderPlan(jo([waiting, l2]), '2026-11-02', ctx);
    const packTied = tied.lines[0]!.lp.schedule!.find((x) => x.view.step.processId === 'pack')!;
    const print2 = tied.lines[1]!.lp.schedule!.find((x) => x.view.step.processId === 'print')!;
    expect(packFree.start! < print2.finish!).toBe(true);
    expect(packTied.start! >= print2.finish!).toBe(true);
  });
});
