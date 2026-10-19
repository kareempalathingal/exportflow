import { describe, expect, it } from 'vitest';
import {
  addDays,
  canTransition,
  changedBoms,
  checkForConfirm,
  computeDeadline,
  daysBetween,
  deadlineState,
  DEADLINE_RULE_VERSION,
  findDuplicateJo,
  jobOrderAttention,
  reasonRequired,
  resolveLine,
  snapshotBoms,
  type JobOrder,
  type JoLine,
} from '../../src/lib/jobOrders';
import type { Bom, MasterData, Product, RawMaterial } from '../../src/lib/masters';

const na = { value: null, status: 'UNAVAILABLE' as const, source: '' };
function product(id: string, supplyType: Product['supplyType'], extra: Partial<Product> = {}): Product {
  return {
    name: id, code: '', active: true, notes: '', baseUnit: 'pcs', supplyType, specifications: '',
    size: { length: 40, width: 60, unit: 'cm', status: 'VERIFIED' },
    thicknessMm: na, gsm: { value: 1500, status: 'VERIFIED', source: '' }, weightPerPieceKg: na, customUnits: [],
    ...extra,
  };
}
const fibre: RawMaterial = { name: 'Fibre', active: true, notes: '', baseUnit: 'kg', gsm: na, customUnits: [] };

function md(): MasterData {
  const products = new Map<string, Product>([
    ['mat', product('mat', 'MANUFACTURED')],
    ['both', product('both', 'BOTH')],
    ['traded', product('traded', 'TRADED')],
    ['sub', product('sub', 'MANUFACTURED')],
  ]);
  const boms = new Map<string, Bom>([
    ['mat', { productId: 'mat', notes: '', lines: [{ componentType: 'PRODUCT', componentId: 'sub', qty: 1, unit: 'pcs', wastagePct: 0, status: 'VERIFIED', source: '' }] }],
    ['sub', { productId: 'sub', notes: '', lines: [{ componentType: 'RAW_MATERIAL', componentId: 'fibre', qty: 0.3, unit: 'kg', wastagePct: 0, status: 'VERIFIED', source: '' }] }],
    ['both', { productId: 'both', notes: '', lines: [{ componentType: 'RAW_MATERIAL', componentId: 'fibre', qty: 1, unit: 'kg', wastagePct: 0, status: 'VERIFIED', source: '' }] }],
  ]);
  return { products, rawMaterials: new Map([['fibre', fibre]]), boms };
}
const line = (productId: string, qty = 10, unit = 'pcs', supply: JoLine['supply'] = null): JoLine => ({ id: productId, productId, productName: productId, qty, unit, supply });

describe('calendar dates', () => {
  it('counts calendar days and rejects impossible dates', () => {
    expect(daysBetween('2026-11-01', '2026-12-30')).toBe(59);
    expect(daysBetween('2026-02-30', '2026-03-01')).toBeNull();
    expect(addDays('2026-12-30', -6)).toBe('2026-12-24');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });
});

describe('10% internal deadline (Requirements §31.4)', () => {
  it('matches the documented examples', () => {
    const d = computeDeadline('2026-11-01', '2026-12-30');
    expect(d).toMatchObject({ ok: true, orderPeriodDays: 59, bufferDays: 6, internalDeadline: '2026-12-24', ruleVersion: DEADLINE_RULE_VERSION });
    expect(computeDeadline('2026-01-01', '2026-02-21')).toMatchObject({ orderPeriodDays: 51, bufferDays: 6 });
  });
  it('rounds up without floating-point errors and keeps a 1-day minimum', () => {
    expect(computeDeadline('2026-01-01', '2026-02-20')).toMatchObject({ orderPeriodDays: 50, bufferDays: 5 });
    expect(computeDeadline('2026-01-01', '2026-01-02')).toMatchObject({ orderPeriodDays: 1, bufferDays: 1, internalDeadline: '2026-01-01' });
    expect(computeDeadline('2026-01-01', '2026-01-11')).toMatchObject({ orderPeriodDays: 10, bufferDays: 1 });
    expect(computeDeadline('2026-01-01', '2026-01-12')).toMatchObject({ orderPeriodDays: 11, bufferDays: 2 });
  });
  it('rejects a delivery date on or before the received date', () => {
    expect(computeDeadline('2026-01-05', '2026-01-05').ok).toBe(false);
    expect(computeDeadline('2026-01-05', '2026-01-01').ok).toBe(false);
    expect(computeDeadline('', '2026-01-01').ok).toBe(false);
  });
});

describe('status rules', () => {
  it('allows only the agreed transitions', () => {
    expect(canTransition('DRAFT', 'CONFIRMED')).toBe(true);
    expect(canTransition('DRAFT', 'COMPLETED')).toBe(false);
    expect(canTransition('COMPLETED', 'COMPLETED')).toBe(false);
    expect(canTransition('COMPLETED', 'CONFIRMED')).toBe(true);
    expect(canTransition('CANCELLED', 'DRAFT')).toBe(true);
    expect(canTransition('CANCELLED', 'CONFIRMED')).toBe(false);
  });
  it('needs a reason to edit a confirmed order, cancel or reopen', () => {
    expect(reasonRequired(null, 'DRAFT')).toBe(false);
    expect(reasonRequired('DRAFT', 'DRAFT')).toBe(false);
    expect(reasonRequired('DRAFT', 'CONFIRMED')).toBe(false);
    expect(reasonRequired('CONFIRMED', 'CONFIRMED')).toBe(true);
    expect(reasonRequired('CONFIRMED', 'COMPLETED')).toBe(false);
    expect(reasonRequired('DRAFT', 'CANCELLED')).toBe(true);
    expect(reasonRequired('COMPLETED', 'CONFIRMED')).toBe(true);
  });
});

describe('order lines', () => {
  it('converts the ordered unit to the product base unit', () => {
    const r = resolveLine(line('mat', 24, 'sqm'), md());
    expect(r.baseUnit).toBe('pcs');
    expect(r.baseQty).toBeCloseTo(100); // 0.4 × 0.6 = 0.24 sq m per piece
  });
  it('never guesses a missing conversion', () => {
    const m = md();
    m.products.set('mat', product('mat', 'MANUFACTURED', { gsm: na, size: { length: null, width: null, unit: 'cm', status: 'UNAVAILABLE' } }));
    const r = resolveLine(line('mat', 10, 'kg'), m);
    expect(r.baseQty).toBeNull();
    expect(r.problem).toMatch(/Conversion needed/);
  });
  it('blocks confirmation on missing essentials, warns on the rest', () => {
    const deadline = computeDeadline('2026-11-01', '2026-12-30');
    if (!deadline.ok) throw new Error();
    const c = checkForConfirm({ lines: [line('both'), line('mat', 0)], deliveryDateType: 'UNCONFIRMED', deadline }, md(), '2026-11-02');
    expect(c.blocking).toEqual(['Line 1 (both): choose Make or Buy', 'Line 2: quantity must be more than 0']);
    expect(c.warnings).toContain('Delivery date type is not confirmed yet');
    const ok = checkForConfirm({ lines: [line('both', 5, 'pcs', 'BUY'), line('traded')], deliveryDateType: 'PORT', deadline }, md(), '2026-11-02');
    expect(ok).toEqual({ blocking: [], warnings: [] });
    expect(checkForConfirm({ lines: [], deliveryDateType: 'PORT', deadline }, md(), '2026-11-02').blocking).toHaveLength(1);
  });
});

describe('BOM snapshot', () => {
  const revs: Record<string, number> = { mat: 3, sub: 2, both: 1 };
  const revOf = (id: string) => revs[id] ?? 0;
  it('copies every BOM reachable from MAKE lines, not BUY lines', () => {
    const snap = snapshotBoms([line('mat'), line('both', 1, 'pcs', 'BUY'), line('traded')], md(), revOf);
    expect(Object.keys(snap).sort()).toEqual(['mat', 'sub']);
    expect(snap.mat!.rev).toBe(3);
  });
  it('keeps existing entries and only adds new ones', () => {
    const first = snapshotBoms([line('mat')], md(), revOf);
    const m = md();
    m.boms.get('mat')!.lines[0]!.qty = 2; // BOM edited later
    const next = snapshotBoms([line('mat'), line('both', 1, 'pcs', 'MAKE')], m, () => 9, first);
    expect(next.mat!.lines[0]!.qty).toBe(1);
    expect(next.both!.rev).toBe(9);
  });
  it('reports BOMs changed after confirmation', () => {
    const snap = snapshotBoms([line('mat')], md(), revOf);
    expect(changedBoms(snap, md(), revOf)).toEqual([]);
    expect(changedBoms(snap, md(), (id) => (id === 'sub' ? 5 : revOf(id)))).toEqual(['sub']);
  });
});

describe('deadline state and attention', () => {
  const d = computeDeadline('2026-11-01', '2026-12-30');
  if (!d.ok) throw new Error();
  const jo: JobOrder & { id: string } = {
    id: 'j1', joNumber: 'JO-1', customerId: 'c', customerName: 'C', poNumber: '', receivedDate: '2026-11-01', deliveryDate: '2026-12-30',
    deliveryDateType: 'PORT', deadline: d, status: 'CONFIRMED', lines: [line('both')], notes: '', bomSnapshot: {}, confirmedOn: '2026-11-01',
  };
  it('classifies days left against the internal deadline', () => {
    expect(deadlineState(jo, '2026-11-02')).toBe('ON_TRACK');
    expect(deadlineState(jo, '2026-12-17')).toBe('DUE_SOON');
    expect(deadlineState(jo, '2026-12-25')).toBe('OVERDUE');
    expect(deadlineState(jo, '2026-12-31')).toBe('DELIVERY_PASSED');
    expect(deadlineState({ ...jo, status: 'COMPLETED' }, '2026-12-31')).toBe('CLOSED');
  });
  it('lists what needs attention on open orders only', () => {
    const items = jobOrderAttention([jo, { ...jo, id: 'j2', status: 'CANCELLED' }], md(), () => 0, '2026-12-24');
    expect(items.map((i) => i.kind)).toEqual(['DUE_SOON', 'UNDECIDED']);
    expect(items[0]!.detail).toBe('Internal deadline is today');
  });
  it('warns on duplicate JO numbers, ignoring cancelled orders', () => {
    expect(findDuplicateJo(' jo-1 ', [jo])?.id).toBe('j1');
    expect(findDuplicateJo('JO-1', [jo], 'j1')).toBeUndefined();
    expect(findDuplicateJo('JO-1', [{ ...jo, status: 'CANCELLED' }])).toBeUndefined();
  });
});
