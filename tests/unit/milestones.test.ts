import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR } from '../../src/lib/calendar';
import type { JobOrder, JoStep } from '../../src/lib/jobOrders';
import type { Product } from '../../src/lib/masters';
import { buildToday } from '../../src/lib/today';
import { milestonesTable } from '../../src/lib/docs/extrasDoc';
import { DEFAULT_STAGES, isSamplingWo, milestoneDue, milestonesFor, milestoneView, orderFlowOf, routeDiffs, withDue, type Milestone, type MilestoneFacts } from '../../src/lib/milestones';

// Order flow and milestones (18 Nov 2026). Sample values only.

const jo = (p: Partial<JobOrder> = {}): JobOrder & { id: string } =>
  ({ id: 'j1', joNumber: 'S-1', customerId: 'c1', customerName: 'Sample', poNumber: 'PO-1', receivedDate: '2026-11-02', deliveryDate: '2026-11-30', status: 'CONFIRMED', deadline: { internalDeadline: '2026-11-26' }, lines: [], ...p }) as unknown as JobOrder & { id: string };
const step = (p: Partial<JoStep>): JoStep => ({ key: 'k', processId: 'pr', label: 'Step', forProduct: 'Mat', productId: 'p1', perDay: null, perDayUnit: null, fixedDays: null, doneAt: null, ...p });
const facts = (p: Partial<MilestoneFacts> = {}): MilestoneFacts => ({ productionDone: null, productionReady: null, productionPct: 0, materialsDone: null, steps: [], ...p });
const ms = (p: Partial<Milestone>): Milestone => ({ id: 'm', name: 'Stage', phase: 'AFTER', ...p });
const today = '2026-11-18';

describe('order flow', () => {
  it('defaults until saved; no due rule is filled in', () => {
    const f = orderFlowOf(null, ['a', 'b']);
    expect(f.production).toEqual(['a', 'b']);
    expect(f.stages).toBe(DEFAULT_STAGES);
    expect(DEFAULT_STAGES.every((s) => !s.rule)).toBe(true);
    expect(DEFAULT_STAGES.some((s) => /^PI$/.test(s.name))).toBe(false);
    expect(orderFlowOf({ stages: [], production: ['x'] }, ['a']).production).toEqual(['x']);
  });
  it('sampling WO: from the customer PO unless set; no samples or after-production stages', () => {
    expect(isSamplingWo({ poNumber: 'Sampling' })).toBe(true);
    expect(isSamplingWo({ poNumber: '597989' })).toBe(false);
    expect(isSamplingWo({ poNumber: 'Sampling', sampling: false })).toBe(false);
    expect(isSamplingWo({ poNumber: '', sampling: true })).toBe(true);
    const flow = orderFlowOf(null, []);
    const normal = milestonesFor(flow, false);
    const sampling = milestonesFor(flow, true);
    expect(normal).toHaveLength(DEFAULT_STAGES.length);
    expect(sampling.some((m) => m.phase === 'AFTER' || m.link === 'SAMPLES')).toBe(false);
    expect(new Set(normal.map((m) => m.id)).size).toBe(normal.length);
  });
});

describe('due dates', () => {
  const j = jo();
  it('four ways: fixed, after the WO date, before cargo ready, after production', () => {
    expect(milestoneDue(ms({ due: '2026-11-20', rule: { kind: 'AFTER_WO', days: 1 } }), j, facts(), DEFAULT_CALENDAR)).toBe('2026-11-20');
    // 2 Nov 2026 is a Monday: 3 working days after = Thu 5 Nov.
    expect(milestoneDue(ms({ rule: { kind: 'AFTER_WO', days: 3 } }), j, facts(), DEFAULT_CALENDAR)).toBe('2026-11-05');
    // 30 Nov is a Monday: 3 working days before (Sunday off) = Thu 26 Nov; 0 = cargo ready.
    expect(milestoneDue(ms({ rule: { kind: 'BEFORE_CARGO', days: 3 } }), j, facts(), DEFAULT_CALENDAR)).toBe('2026-11-26');
    expect(milestoneDue(ms({ rule: { kind: 'BEFORE_CARGO', days: 0 } }), j, facts(), DEFAULT_CALENDAR)).toBe('2026-11-30');
    // After production: the actual finish wins over the plan.
    expect(milestoneDue(ms({ rule: { kind: 'AFTER_PRODUCTION', days: 1 } }), j, facts({ productionReady: '2026-11-20' }), DEFAULT_CALENDAR)).toBe('2026-11-21');
    expect(milestoneDue(ms({ rule: { kind: 'AFTER_PRODUCTION', days: 1 } }), j, facts({ productionReady: '2026-11-20', productionDone: '2026-11-17' }), DEFAULT_CALENDAR)).toBe('2026-11-18');
    expect(milestoneDue(ms({ rule: { kind: 'AFTER_PRODUCTION', days: 1 } }), j, facts(), DEFAULT_CALENDAR)).toBeNull();
    expect(milestoneDue(ms({}), j, facts(), DEFAULT_CALENDAR)).toBeNull();
  });
  it('a new date keeps the old one', () => {
    const m = withDue(ms({ due: '2026-11-20' }), '2026-11-24', '2026-11-20', 't');
    expect(m.due).toBe('2026-11-24');
    expect(m.dueHistory?.map((h) => h.on)).toEqual(['2026-11-20']);
    expect(withDue(ms({}), '2026-11-24', null, 't').dueHistory).toBeUndefined();
  });
});

describe('state', () => {
  const j = jo();
  const view = (m: Partial<Milestone>, f = facts(), o = j) => milestoneView(ms(m), o, f, DEFAULT_CALENDAR, today);
  it('manual: done, not needed, late, open, no date', () => {
    expect(view({ doneOn: '2026-11-10' }).state).toBe('DONE');
    expect(view({ notNeeded: true, doneOn: '2026-11-10' }).state).toBe('NOT_NEEDED');
    expect(view({ due: '2026-11-17' }).state).toBe('LATE');
    expect(view({ due: '2026-11-18' }).state).toBe('OPEN');
    expect(view({}).state).toBe('NO_DATE');
  });
  it('indents: done when every in-house step has one (dispatch, landing and outside steps do not count)', () => {
    const steps = [step({ key: 'a', indentNo: 'Pi-1', indentOn: '2026-11-03' }), step({ key: 'b' }), step({ key: 'c', outside: true }), step({ key: 'd', processId: null, outsideOf: 'pr', label: 'Dispatch for X' })];
    const open = view({ link: 'INDENTS', due: '2026-11-20' }, facts({ steps }));
    expect([open.state, open.auto]).toEqual(['OPEN', '1 of 2 in-house steps have an indent']);
    const all = view({ link: 'INDENTS' }, facts({ steps: steps.map((s) => (s.key === 'b' ? { ...s, indentOn: '2026-11-05' } : s)) }));
    expect([all.state, all.doneOn]).toEqual(['DONE', '2026-11-05']);
  });
  it('vendor orders: every outside step with a vendor and order date; none = not needed', () => {
    const out = step({ key: 'o', outside: true, supplierId: 'v1', orderedOn: '2026-11-06' });
    expect(view({ link: 'VENDOR_ORDERS' }, facts({ steps: [out] })).doneOn).toBe('2026-11-06');
    expect(view({ link: 'VENDOR_ORDERS' }, facts({ steps: [out, step({ key: 'p', outside: true })] })).state).toBe('NO_DATE');
    expect(view({ link: 'VENDOR_ORDERS' }, facts({ steps: [step({})] })).state).toBe('NOT_NEEDED');
  });
  it('materials and order items', () => {
    expect(view({ link: 'MATERIALS' }, facts({ materialsDone: '2026-11-09' })).doneOn).toBe('2026-11-09');
    expect(view({ link: 'MATERIALS' }, facts({ materialsDone: undefined })).state).toBe('NOT_NEEDED');
    const o = jo({ orderItems: [{ id: 'a', item: 'Tags', landedOn: '2026-11-12' }, { id: 'b', item: 'Labels' }] });
    expect(view({ link: 'ORDER_ITEMS', itemIds: ['a'] }, facts(), o).doneOn).toBe('2026-11-12');
    expect(view({ link: 'ORDER_ITEMS', itemIds: ['a', 'b'] }, facts(), o).auto).toBe('1 of 2 items landed');
    // Nothing ticked: recorded by hand.
    expect(view({ link: 'ORDER_ITEMS' }, facts(), o).auto).toBeNull();
  });
});

describe('product routes against the standard order', () => {
  const route = (...ids: string[]) => ids.map((processId) => ({ processId }));
  const products = [
    { id: 'p1', name: 'Plain', route: route('sh', 'tr') },
    { id: 'p2', name: 'Printed shaped', route: route('sh', 'pr', 'sc') },
    { id: 'p3', name: 'Odd', route: route('sh', 'zz') },
    { id: 'p4', name: 'Old', active: false, route: route('pr', 'sh') },
  ] as unknown as (Product & { id: string })[];
  it('missing processes are fine; a changed order or an unknown process is shown', () => {
    const d = routeDiffs(products, ['sh', 'sc', 'tr', 'pr']);
    expect(d.map((x) => [x.productId, x.outOfOrder, x.notInList])).toEqual([
      ['p2', [['pr', 'sc']], []],
      ['p3', [], ['zz']],
    ]);
  });
});

describe('Today and documents', () => {
  const ctx = { md: { products: new Map(), rawMaterials: new Map(), boms: new Map() }, cal: DEFAULT_CALENDAR };
  const j = jo({ milestones: [ms({ id: 'a', name: 'Fumigation', due: '2026-11-17', departmentId: 'd1' }), ms({ id: 'b', name: 'Booking', due: '2026-11-19' }), ms({ id: 'c', name: 'Loading', due: '2026-12-10' }), ms({ id: 'd', name: 'Docs', due: '2026-11-17', doneOn: '2026-11-16' })] });
  it('late and coming milestones, in their department', () => {
    const t = buildToday({ jobOrders: [j], ctx, today });
    const ours = t.items.filter((i) => i.link.endsWith('tab=milestones'));
    expect(ours.map((i) => [i.when, i.text, i.area.kind])).toEqual([
      ['OVERDUE', 'S-1: Fumigation - was due 17 Nov 2026', 'DEPT'],
      ['SOON', 'S-1: Booking - due 19 Nov 2026', 'ORDER'],
    ]);
  });
  it('one table when the WO has milestones', () => {
    expect(milestonesTable(jo(), { today, ctx })).toEqual([]);
    const [t] = milestonesTable(j, { today, ctx });
    expect(t?.title).toBe('Milestones (1 of 4 done)');
    expect(t?.rows.map((r) => r[3])).toEqual(['Overdue', 'Open', 'Open', 'Done 16 Nov 2026']);
  });
});
