import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR } from '../../src/lib/calendar';
import { jobOrderData, type JobOrder } from '../../src/lib/jobOrders';
import type { Product } from '../../src/lib/masters';
import { orderExtrasTables } from '../../src/lib/docs/extrasDoc';
import { awaitedItems } from '../../src/lib/followUp';
import { checkDue, itemState, itemsMissingAt, lastChecklist, suggestedItems, upsertItem, type OrderItem } from '../../src/lib/orderExtras';

// Round 2 (17 Nov 2026): order items, customer requirements, design fields. Sample values only.

const jo = (p: Partial<JobOrder> = {}): JobOrder & { id: string } =>
  ({ id: 'j1', joNumber: 'S-1', customerId: 'c1', customerName: 'Sample', receivedDate: '2026-11-02', deliveryDate: '2026-11-30', status: 'CONFIRMED', lines: [{ id: 'l1', productId: 'p1', qty: 10, unit: 'pcs' }], ...p }) as unknown as JobOrder & { id: string };

describe('order items', () => {
  it('state follows landed / expected / ordered', () => {
    expect(itemState({ id: 'a', item: 'Tags' }, '2026-11-10')).toBe('TO_ORDER');
    expect(itemState({ id: 'a', item: 'Tags', poNo: '7' }, '2026-11-10')).toBe('ORDERED');
    expect(itemState({ id: 'a', item: 'Tags', expectedOn: '2026-11-12' }, '2026-11-10')).toBe('EXPECTED');
    expect(itemState({ id: 'a', item: 'Tags', expectedOn: '2026-11-09' }, '2026-11-10')).toBe('LATE');
    expect(itemState({ id: 'a', item: 'Tags', expectedOn: '2026-11-09', landedOn: '2026-11-10' }, '2026-11-10')).toBe('LANDED');
  });
  it('a changed expected date keeps the old one', () => {
    const one: OrderItem[] = upsertItem([], { id: 'a', item: 'Tags', expectedOn: '2026-11-12' }, 't1');
    const two = upsertItem(one, { id: 'a', item: 'Tags', expectedOn: '2026-11-15' }, 't2');
    expect(two).toHaveLength(1);
    expect(two[0]?.expectedOn).toBe('2026-11-15');
    expect(two[0]?.expectedHistory?.map((h) => h.on)).toEqual(['2026-11-12']);
  });
  it('items needed before a process and not landed', () => {
    const j = jo({ orderItems: [{ id: 'a', item: 'Plates', neededAt: 'pr' }, { id: 'b', item: 'Tags', neededAt: 'pr', landedOn: '2026-11-03' }, { id: 'c', item: 'Marks' }] });
    expect(itemsMissingAt(j, 'pr').map((x) => x.item)).toEqual(['Plates']);
    expect(itemsMissingAt(j, null)).toEqual([]);
  });
  it('suggestions come only from design fields, once', () => {
    const products = new Map<string, Product>([['p1', { name: 'Mat A', stencilPlates: 3, shape: 'SHAPED' } as unknown as Product]]);
    const s = suggestedItems(jo(), products, 'pr');
    expect(s.map((x) => [x.item, x.qty, x.neededAt])).toEqual([
      ['Stencil plates - 1. Mat A', 3, 'pr'],
      ['Cutting plate - 1. Mat A', 1, 'pr'],
    ]);
    expect(suggestedItems(jo({ orderItems: s }), products, 'pr')).toEqual([]);
    expect(suggestedItems(jo(), new Map([['p1', { name: 'Plain' } as unknown as Product]]), 'pr')).toEqual([]);
  });
});

describe('customer requirements', () => {
  it('due = own date, or N working days before cargo ready', () => {
    // 30 Nov 2026 is a Monday; 3 working days before (Sunday off) = Thu 26 Nov.
    expect(checkDue({ id: 'a', text: 'x', daysBefore: 3 }, jo(), DEFAULT_CALENDAR)).toBe('2026-11-26');
    expect(checkDue({ id: 'a', text: 'x', daysBefore: 0 }, jo(), DEFAULT_CALENDAR)).toBe('2026-11-30');
    expect(checkDue({ id: 'a', text: 'x', due: '2026-11-20', daysBefore: 3 }, jo(), DEFAULT_CALENDAR)).toBe('2026-11-20');
    expect(checkDue({ id: 'a', text: 'x' }, jo(), DEFAULT_CALENDAR)).toBeNull();
  });
  it('copy from the latest earlier WO of the customer keeps text and rule only', () => {
    const old = jo({ id: 'j0', receivedDate: '2026-09-01', checklist: [{ id: 'o', text: 'Old', daysBefore: 1 }] } as Partial<JobOrder>);
    const prev = jo({ id: 'j2', receivedDate: '2026-10-01', checklist: [{ id: 'q', text: 'Sample approved', daysBefore: 5, doneOn: '2026-10-10', note: 'ok' }, { id: 'r', text: 'Booking', due: '2026-10-20' }] } as Partial<JobOrder>);
    const other = jo({ id: 'j3', customerId: 'c2', receivedDate: '2026-10-15', checklist: [{ id: 's', text: 'Other' }] } as Partial<JobOrder>);
    const copy = lastChecklist([old, prev, other, jo()], 'c1', 'j1');
    expect(copy.map((c) => [c.text, c.daysBefore, c.doneOn, c.due, c.note])).toEqual([
      ['Sample approved', 5, undefined, undefined, undefined],
      ['Booking', undefined, undefined, undefined, undefined],
    ]);
  });
});

describe('jobOrderData', () => {
  it('keeps every data field and drops record meta', () => {
    const d = jobOrderData({ ...jo({ refs: { piNo: 'PI-1' }, orderItems: [{ id: 'a', item: 'Tags' }], checklist: [{ id: 'b', text: 'x' }] }), rev: 3, updatedAt: 'x', lastAuditId: 'y' } as unknown as JobOrder);
    expect(d.refs).toEqual({ piNo: 'PI-1' });
    expect(d.orderItems).toHaveLength(1);
    expect(d.checklist).toHaveLength(1);
    expect('rev' in d || 'id' in d || 'lastAuditId' in d).toBe(false);
  });
});

describe('order items in Awaited and documents (18 Nov 2026)', () => {
  it('only ordered, not landed items are awaited', () => {
    const j = jo({ orderItems: [{ id: 'a', item: 'Plates', supplierId: 's1', expectedOn: '2026-11-04' }, { id: 'b', item: 'Tags' }, { id: 'c', item: 'Marks', poNo: '9', landedOn: '2026-11-03' }] });
    const md = { products: new Map(), rawMaterials: new Map(), boms: new Map() };
    const a = awaitedItems([j], { md, cal: DEFAULT_CALENDAR }, '2026-11-06');
    expect(a.map((x) => [x.kind, x.what, x.bucket, x.lateDays])).toEqual([['ITEM', 'Plates', 'LATE', 2]]);
    expect(a[0]?.target).toEqual({ kind: 'ITEM', itemId: 'a', name: 'Plates' });
  });
  it('documents get a table per list with entries', () => {
    expect(orderExtrasTables(jo(), { today: '2026-11-06', cal: DEFAULT_CALENDAR })).toEqual([]);
    const t = orderExtrasTables(jo({ orderItems: [{ id: 'a', item: 'Plates', qty: 3, unit: 'pcs', poNo: '7', expectedOn: '2026-11-04', neededAt: 'pr' }], checklist: [{ id: 'b', text: 'Sample approved', daysBefore: 3 }] }), { today: '2026-11-06', cal: DEFAULT_CALENDAR, processName: () => 'Printing' });
    expect(t.map((x) => x.title)).toEqual(['Items to arrange for this order', 'Customer requirements']);
    expect(t[0]?.rows[0]).toEqual(['Plates', '3 pcs', 'PO 7', 'Late - expected 04 Nov 2026', 'Printing']);
    expect(t[1]?.rows[0]).toEqual(['Sample approved', '26 Nov 2026', 'Open', '']);
  });
});
