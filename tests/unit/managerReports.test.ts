import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR } from '../../src/lib/calendar';
import { deliveryDoc, riskDoc, stockDoc, summaryDoc, toBuyBySupplierDoc, workDoc } from '../../src/lib/docs/managerDocs';
import type { JobOrder } from '../../src/lib/jobOrders';
import type { Bom, Department, MasterData, Product, RawMaterial, Supplier } from '../../src/lib/masters';
import { toBuyAcrossOrders, type StockCount } from '../../src/lib/materials';
import {
  atRiskOrders,
  deliverySchedule,
  departmentWork,
  managementSummary,
  NO_DEPARTMENT,
  periodRange,
  riskText,
  stockAllocation,
  summaryText,
  toBuyBySupplier,
  workText,
} from '../../src/lib/managerReports';
import { buildSampleData } from '../../src/lib/sampleData';

const TODAY = '2026-10-20'; // a Tuesday
const writes = buildSampleData(TODAY);
const of = <T,>(c: string) => writes.filter((w) => w.collection === c).map((w) => ({ id: w.docId, ...(w.data as unknown as T) }));
const md: MasterData = {
  products: new Map(of<Product>('products').map((p) => [p.id, p])),
  rawMaterials: new Map(of<RawMaterial>('rawMaterials').map((p) => [p.id, p])),
  boms: new Map(of<Bom>('boms').map((p) => [p.id, p])),
};
const finalJo = new Map<string, JobOrder & { id: string }>();
for (const w of writes) if (w.collection === 'jobOrders') finalJo.set(w.docId, { id: w.docId, ...(w.data as unknown as JobOrder) });
const jos = [...finalJo.values()];
const ctx = { md, cal: DEFAULT_CALENDAR };
const gen = { company: 'Co', today: TODAY, generatedAt: 'now' };

describe('periods', () => {
  it('weeks run Monday to Sunday; months are whole months', () => {
    expect(periodRange('this-week', TODAY)).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(periodRange('last-week', TODAY)).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(periodRange('this-week', '2026-10-25')).toEqual({ from: '2026-10-19', to: '2026-10-25' }); // Sunday belongs to the week before it
    expect(periodRange('this-month', TODAY)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodRange('this-month', '2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodRange('last-month', '2026-01-05')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
});

describe('delivery schedule', () => {
  it('lists open orders by delivery date with expected finish and whether it fits', () => {
    const d = deliverySchedule({ jobOrders: jos, ctx, today: TODAY, from: TODAY, to: '2026-12-31' });
    expect(d.rows.map((r) => r.joNumber)).toEqual(['DEMO-101', 'DEMO-102', 'DEMO-103', 'DEMO-105', 'DEMO-104']);
    const by = Object.fromEntries(d.rows.map((r) => [r.joNumber, r]));
    expect(by['DEMO-102']!.outlook.fits).toBe('YES');
    expect(by['DEMO-103']!.outlook.fits).toBe('NO');
    expect(by['DEMO-104']!.outlook.fits).toBe('DRAFT');
    expect(by['DEMO-101']!.daysLeft).toBe(3);
    // Completed orders never appear.
    expect(d.rows.some((r) => r.joNumber === 'DEMO-099')).toBe(false);
  });
  it('a short period keeps only its deliveries, plus open orders whose delivery already passed', () => {
    const d = deliverySchedule({ jobOrders: jos, ctx, today: TODAY, from: TODAY, to: '2026-10-31' });
    expect(d.rows.map((r) => r.joNumber)).toEqual(['DEMO-101']);
    const late = deliverySchedule({ jobOrders: jos, ctx, today: '2026-11-05', from: '2026-11-05', to: '2026-11-10' });
    expect(late.rows.map((r) => [r.joNumber, r.daysLeft < 0])).toEqual([
      ['DEMO-101', true],
      ['DEMO-102', true],
    ]);
    const doc = deliveryDoc(late, gen);
    expect(doc.tables[0]!.title).toMatch(/passed/);
    expect(doc.tables[1]!.rows).toEqual([]);
  });
});

describe('orders at risk', () => {
  const risks = atRiskOrders({ jobOrders: jos, ctx, today: TODAY, redAt: 20 });
  it('puts late first, gives every reason, and leaves on-time orders out', () => {
    expect(risks.map((r) => [r.joNumber, r.level])).toEqual([
      ['DEMO-101', 'LATE'],
      ['DEMO-103', 'HIGH'],
      ['DEMO-104', 'HIGH'],
      ['DEMO-102', 'WATCH'],
    ]);
    expect(risks[0]!.reasons.join(' ')).toMatch(/Internal deadline passed 1 day ago.*Packing.*over plan/);
    expect(risks[1]!.reasons.join(' ')).toMatch(/after the internal deadline.*22% behind plan/);
    expect(risks[2]!.reasons[0]).toMatch(/Still in planning/);
  });
  it('the red threshold decides between at risk and watch', () => {
    const lax = atRiskOrders({ jobOrders: jos.filter((j) => j.joNumber === 'DEMO-103'), ctx, today: TODAY, redAt: 50 });
    expect(lax[0]!.level).toBe('HIGH'); // still: expected finish is after the deadline
    expect(riskText(risks, 'Co', TODAY)).toMatch(/^Orders at risk · Co/);
    expect(riskDoc(risks, gen).tables[0]!.rows).toHaveLength(4);
  });
});

describe('management summary', () => {
  it('counts the period and lists open orders, next deliveries and top risks', () => {
    const s = managementSummary({ jobOrders: jos, ctx, today: TODAY, redAt: 20, ...periodRange('this-month', TODAY) });
    expect(s.openNow).toEqual({ drafts: 1, onTrack: 2, behind: 1, late: 1, notTracked: 0 });
    expect(s.nextDeliveries.map((r) => r.joNumber)).toEqual(['DEMO-101']);
    expect(s.risks.length).toBeLessThanOrEqual(5);
    expect(summaryText(s, 'Co')).toMatch(/Open now .*2 on track · 1 behind · 1 late/);
    const wide = managementSummary({ jobOrders: jos, ctx, today: TODAY, redAt: 20, from: '2026-07-01', to: TODAY });
    expect(wide.completed.count).toBe(1);
    expect(wide.completed).toMatchObject({ onTimeInternal: 0, onTimeDelivery: 1 });
    const doc = summaryDoc(wide, { company: 'Co', generatedAt: 'now' });
    expect(doc.tables[0]!.rows[0]).toContain('Within buffer');
  });
});

describe('department work list', () => {
  const departments = of<Department>('departments');
  it('groups running and upcoming steps by department, within the chosen working days', () => {
    const w = departmentWork({ jobOrders: jos, ctx, today: TODAY, days: 5, departments });
    expect(w.until).toBe('2026-10-26'); // Sunday skipped
    const rows = w.groups.flatMap((g) => g.rows);
    expect(rows.some((r) => r.state === 'NOW')).toBe(true);
    expect(rows.every((r) => r.state === 'NOW' || (r.start !== null && r.start <= w.until) || r.start === null)).toBe(true);
    expect(rows.some((r) => r.step === 'Planning')).toBe(false);
    const short = departmentWork({ jobOrders: jos, ctx, today: TODAY, days: 1, departments });
    expect(short.groups.flatMap((g) => g.rows).length).toBeLessThanOrEqual(rows.length);
    expect(workText(w.groups, { company: 'Co', today: TODAY, until: w.until })).toMatch(/Running now/);
    expect(workDoc(w.groups, { ...gen, until: w.until }).tables.length).toBe(w.groups.length);
  });
  it('steps of processes no department handles are listed separately', () => {
    const w = departmentWork({ jobOrders: jos, ctx, today: TODAY, days: 5, departments: [] });
    expect(w.groups.map((g) => g.id)).toContain(NO_DEPARTMENT);
  });
});

describe('stock allocation', () => {
  const counts = of<StockCount>('stockCounts');
  it('shows counted vs set aside, over-allocation first, and old counts', () => {
    const rows = stockAllocation({ jobOrders: jos, counts, md, today: TODAY });
    expect(rows[0]).toMatchObject({ name: 'Coir fibre (sample)', state: 'OVER', counted: 800, confirmed: 900, free: -100, oldCount: false });
    expect(rows[0]!.orders.map((o) => o.joNumber)).toEqual(['DEMO-102', 'DEMO-103']);
    expect(rows.filter((r) => r.state === 'MANUAL_ONLY').every((r) => r.free === null)).toBe(true);
    const later = stockAllocation({ jobOrders: jos, counts, md, today: '2026-12-01' });
    expect(later.find((r) => r.key === 'RAW_MATERIAL:sample_rm_fibre')!.oldCount).toBe(true);
    expect(stockDoc(rows, { ...gen, oldDays: 30 }).meta[0]![1]).toMatch(/1 over-allocated/);
  });
});

describe('to buy by supplier', () => {
  it('lists each item under every supplier that can supply it, and unlinked items last', () => {
    const tb = toBuyAcrossOrders(jos, md, false);
    const suppliers = of<Supplier>('suppliers');
    const groups = toBuyBySupplier(tb.rows, suppliers);
    const listed = new Set(groups.flatMap((g) => g.rows.map((r) => r.row.key)));
    expect(listed).toEqual(new Set(tb.rows.map((r) => r.key)));
    const two = toBuyBySupplier(tb.rows.slice(0, 1), [
      { id: 'a', name: 'A', items: [tb.rows[0]!.key], active: true },
      { id: 'b', name: 'B', items: [tb.rows[0]!.key], active: true },
      { id: 'c', name: 'C', items: [tb.rows[0]!.key], active: false },
    ]);
    expect(two.map((g) => [g.name, g.rows[0]!.others])).toEqual([
      ['A', ['B']],
      ['B', ['A']],
    ]);
    const none = toBuyBySupplier(tb.rows.slice(0, 1), []);
    expect(none[0]!.id).toBeNull();
    expect(toBuyBySupplierDoc(groups, [], { ...gen, includeDrafts: false }).tables.length).toBe(groups.length);
  });
});
