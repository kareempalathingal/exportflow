import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR } from '../../src/lib/calendar';
import { firstPromise, withExpected, type JobOrder, type JoLine } from '../../src/lib/jobOrders';
import type { MasterData, Process, Product, RouteStep, Supplier } from '../../src/lib/masters';
import { awaitedItems, startChecks } from '../../src/lib/followUp';
import { addOutput, buildLineSteps, completeCurrent, orderPlan, setPromise, startStepAt, tickReady } from '../../src/lib/route';
import { buildToday } from '../../src/lib/today';

// Follow-up of bought items and outside work, and "ready to start?" (confirmed 5 Nov 2026).
const na = { value: null, status: 'UNAVAILABLE' as const, source: '' };
const step = (processId: string, perDay: number, extra: Partial<RouteStep> = {}): RouteStep => ({ processId, perDay, perDayUnit: 'pcs', fixedDays: null, status: 'USER_PROVIDED', source: '', ...extra });
const product = (name: string, route: RouteStep[], supplyType: Product['supplyType'] = 'MANUFACTURED'): Product => ({
  name, code: '', active: true, notes: '', baseUnit: 'pcs', supplyType, specifications: '',
  size: { length: null, width: null, unit: 'cm', status: 'UNAVAILABLE' }, thicknessMm: na, gsm: na, weightPerPieceKg: na, customUnits: [], route,
});
const processes = new Map<string, Process>([
  ['tuft', { name: 'Tufting', active: true, notes: '' }],
  ['emb', { name: 'Embossing', active: true, notes: '', readiness: ['Mould ready', 'Transport arranged'] }],
  ['pack', { name: 'Packing', active: true, notes: '' }],
]);
const md: MasterData = {
  products: new Map([
    ['e', product('E', [step('tuft', 100), step('emb', 100, { outside: true, landingPerDay: 500, landingPerDayUnit: 'pcs' }), step('pack', 500)])],
    ['w', product('W', [step('pack', 500)], 'TRADED')],
  ]),
  rawMaterials: new Map(),
  boms: new Map(),
};
const suppliers = new Map<string, Supplier>([['v1', { name: 'Vendor B', active: true, notes: '', place: '', contactPerson: '', phone: '', email: '', gstin: '', items: [], jobWork: true }]]);
const line = (id: string, productId: string, qty: number, supply: 'MAKE' | 'BUY' = 'MAKE'): JoLine => {
  const l: JoLine = { id, productId, productName: md.products.get(productId)!.name, qty, unit: 'pcs', supply };
  return { ...l, steps: buildLineSteps(l, md, processes) };
};
const order = (lines: JoLine[]): JobOrder & { id: string } => ({
  id: 'j1', joNumber: 'JO-1', customerId: 'c', customerName: 'C', poNumber: '', receivedDate: '2026-11-02', deliveryDate: '2026-12-31', deliveryDateType: 'PORT',
  deadline: { orderPeriodDays: 50, bufferDays: 5, internalDeadline: '2026-12-20', ruleVersion: 'x' }, status: 'CONFIRMED', lines, notes: '', bomSnapshot: {}, confirmedOn: '2026-11-02', stock: {},
});
const ctx = { md, cal: DEFAULT_CALENDAR, planningDays: null };

describe('promised dates', () => {
  it('a new expected date keeps the old one; the first promise stays known', () => {
    const a = withExpected({}, '2026-11-10', 't1');
    const b = withExpected(a, '2026-11-14', 't2');
    expect(b).toMatchObject({ expectedOn: '2026-11-14', expectedHistory: [{ on: '2026-11-10', at: 't2' }] });
    expect(firstPromise(b)).toBe('2026-11-10');
    expect(withExpected(b, '2026-11-14', 't3')).toBe(b);
  });
  it("a bought item's Received lasts until the supplier's date", () => {
    const l = line('1', 'w', 516, 'BUY');
    const ordered = { ...l, steps: setPromise(completeCurrent(l.steps!, '2026-11-03T06:30:00.000Z')!, 0, { supplierId: 'v1', poNo: '123', expectedOn: '2026-11-13' }, 't')! };
    const p = orderPlan(order([ordered]), '2026-11-04', ctx);
    const rec = p.lines[0]!.lp.schedule!.find((s) => s.view.step.label === 'Received')!;
    expect(rec.finish).toBe('2026-11-13');
    expect(p.lines[0]!.lp.schedule!.at(-1)!.finish).not.toBeNull(); // packing is dated now
  });
  it('outside work: the vendor date drives the plan; past it the step is late', () => {
    const l = line('1', 'e', 1000);
    let s = completeCurrent(l.steps!, '2026-11-03T06:30:00.000Z')!; // tufting done
    s = setPromise(s, 2, { supplierId: 'v1', poNo: '456', expectedOn: '2026-11-06' }, 't')!;
    const p = orderPlan(order([{ ...l, steps: s }]), '2026-11-10', ctx);
    const emb = p.lines[0]!.lp.steps.find((v) => v.step.label === 'Embossing (outside)')!;
    expect(emb.lateDays).toBe(3);
    expect(emb.overrunDays).toBeNull();
  });
});

describe('awaited from outside', () => {
  it('lists job work still out, bought items and late ones first', () => {
    const e = line('1', 'e', 900);
    let s = completeCurrent(e.steps!, '2026-11-03T06:30:00.000Z')!;
    s = addOutput(s, 1, { on: '2026-11-03', qty: 900, unit: 'pcs', at: 'a' })!; // dispatched
    s = setPromise(s, 2, { supplierId: 'v1', poNo: '456', expectedOn: '2026-11-06' }, 't')!;
    s = addOutput(s, 3, { on: '2026-11-05', qty: 560, unit: 'pcs', at: 'b' })!; // back
    const w = line('2', 'w', 516, 'BUY');
    const ws = setPromise(w.steps!, 0, { expectedOn: '2026-11-20' }, 't')!;
    const items = awaitedItems([order([{ ...e, steps: s }, { ...w, steps: ws }])], ctx, '2026-11-10');
    expect(items.map((i) => [i.kind, i.bucket])).toEqual([
      ['JOB_WORK', 'LATE'],
      ['BOUGHT', 'LATER'],
    ]);
    expect(items[0]).toMatchObject({ what: 'Embossing', outstanding: '340 of 900 pcs still out', poNo: '456', lateDays: 3 });
    expect(items[1]!.outstanding).toBe('516 pcs · not ordered yet');
  });
  it('late items reach Today', () => {
    const e = line('1', 'e', 900);
    let s = completeCurrent(e.steps!, '2026-11-03T06:30:00.000Z')!;
    s = setPromise(s, 2, { supplierId: 'v1', expectedOn: '2026-11-06' }, 't')!;
    const t = buildToday({ jobOrders: [order([{ ...e, steps: s }])], ctx, today: '2026-11-10', processes, suppliers });
    expect(t.items.some((i) => i.when === 'OVERDUE' && /Embossing from Vendor B 3 working days late/.test(i.text))).toBe(true);
  });
});

describe('ready to start?', () => {
  it('outside step about to start: the app checks vendor and date; the process checklist is ticked per order', () => {
    const e = line('1', 'e', 300); // tufting 3 days from 2 Nov; embossing starts on day 1 (overlap)
    const started = { ...e, steps: startStepAt(e.steps!, 0, '2026-11-02T06:30:00.000Z')! };
    const c = startChecks([order([started])], ctx, '2026-11-02', processes, suppliers).find((x) => x.label === 'Dispatch for Embossing')!;
    expect(c.auto).toEqual([
      { ok: true, text: 'Tufting: running' },
      { ok: false, text: 'No vendor recorded' },
      { ok: false, text: 'No expected date' },
    ]);
    expect(c.items.map((x) => x.item)).toEqual(['Mould ready', 'Transport arranged']);
    expect(c.ready).toBe(false);
    const ticked = { ...started, steps: tickReady(started.steps!, 1, 'Mould ready', '2026-11-02')! };
    const c2 = startChecks([order([ticked])], ctx, '2026-11-02', processes, suppliers).find((x) => x.label === 'Dispatch for Embossing')!;
    expect(c2.items[0]).toEqual({ item: 'Mould ready', on: '2026-11-02' });
    expect(c2.readyCount).toBe(2);
  });
  it('steps further out than the alert days are not asked yet', () => {
    const e = line('1', 'e', 3000);
    const checks = startChecks([order([e])], ctx, '2026-11-02', processes, suppliers, 1);
    expect(checks.every((c) => c.start <= '2026-11-03')).toBe(true);
  });
});
