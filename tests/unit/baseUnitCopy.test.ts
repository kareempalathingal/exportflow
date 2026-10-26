import { describe, expect, it } from 'vitest';
import { planBaseUnitCopy, type BaseUnitCopyPlan } from '../../src/lib/baseUnitCopy';
import type { JobOrder } from '../../src/lib/jobOrders';
import { explodeBom, type Bom, type MasterData, type Product, type RawMaterial, type Supplier } from '../../src/lib/masters';
import { buildSampleData } from '../../src/lib/sampleData';

const TODAY = '2026-10-21';
const writes = buildSampleData(TODAY);
const of = <T,>(c: string) => writes.filter((w) => w.collection === c).map((w) => ({ id: w.docId, ...(w.data as unknown as T) }));
const products = new Map(of<Product>('products').map((p) => [p.id, p]));
const boms = new Map(of<Bom>('boms').map((b) => [b.id, b]));
// A product whose BOM uses the mat (to check relinking).
boms.set('kit', { id: 'kit', productId: 'kit', notes: '', lines: [{ componentType: 'PRODUCT', componentId: 'sample_p_mat', qty: 2, unit: 'pcs', wastagePct: 0, status: 'USER_PROVIDED', source: '' }] });
products.set('kit', { ...products.get('sample_p_mat')!, name: 'Mat kit', route: [] });
const md: MasterData = { products, rawMaterials: new Map(of<RawMaterial>('rawMaterials').map((r) => [r.id, r])), boms };
const jos = [...new Map(writes.filter((w) => w.collection === 'jobOrders').map((w) => [w.docId, { id: w.docId, ...(w.data as unknown as JobOrder) }])).values()];
const suppliers: (Supplier & { id: string })[] = [
  { id: 's1', name: 'Mat maker', active: true, notes: '', place: '', contactPerson: '', phone: '', email: '', gstin: '', items: ['PRODUCT:sample_p_mat'] },
  { id: 's2', name: 'Other', active: true, notes: '', place: '', contactPerson: '', phone: '', email: '', gstin: '', items: [] },
];
const mat = products.get('sample_p_mat')!;
const plan = (newUnit: string, product: Product = mat) =>
  planBaseUnitCopy({ productId: 'sample_p_mat', product, newUnit, newName: 'Coir mat 40×60 (sq m)', md, suppliers, jobOrders: jos, newId: 'copy', today: TODAY });

describe('copy with another base unit', () => {
  it('rescales the BOM so the material needed stays the same', () => {
    const p = plan('sqm') as BaseUnitCopyPlan;
    expect(p.factor).toBeCloseTo(1 / 0.24, 5); // 1 sq m = 4.1667 pieces of 40×60 cm
    expect(p.product).toMatchObject({ baseUnit: 'sqm', name: 'Coir mat 40×60 (sq m)', active: true, code: '' });
    expect(p.product.route).toEqual(mat.route);
    // Same total need: 1,200 pcs of the old product = 288 sq m of the copy.
    const md2: MasterData = { ...md, products: new Map([...md.products, ['copy', p.product]]), boms: new Map([...md.boms, ['copy', p.bom!]]) };
    const before = explodeBom('sample_p_mat', 1200, 'pcs', md);
    const after = explodeBom('copy', 288, 'sqm', md2);
    const total = (r: ReturnType<typeof explodeBom>) =>
      Object.fromEntries([...r.toBuy, ...r.toProduce].filter((l) => l.id !== 'sample_p_mat' && l.id !== 'copy').map((l) => [l.id, Math.round(l.qty * 1000) / 1000]));
    expect(Object.keys(total(before)).length).toBeGreaterThan(1);
    expect(total(after)).toEqual(total(before));
    // The same order in pieces still works on the copy (size converts pcs ↔ sq m).
    expect(explodeBom('copy', 1200, 'pcs', md2).errors).toEqual([]);
  });
  it('keeps estimates as estimates and relinks other BOMs and suppliers; orders stay unchanged', () => {
    const p = plan('sqm') as BaseUnitCopyPlan;
    expect(p.bom!.lines.find((l) => l.componentId === 'sample_rm_latex')!.status).toBe('ESTIMATED');
    expect(p.parentBoms).toEqual([{ productId: 'kit', productName: 'Mat kit', problems: [], lines: [expect.objectContaining({ componentId: 'copy', qty: 2, unit: 'pcs' })] }]);
    expect(p.suppliers).toEqual([{ id: 's1', name: 'Mat maker', items: ['PRODUCT:sample_p_mat', 'PRODUCT:copy'] }]);
    expect(p.openOrders.map((o) => o.joNumber)).toEqual(['DEMO-101', 'DEMO-102', 'DEMO-103', 'DEMO-105']);
    expect(p.summary.join(' ')).toMatch(/set Inactive/);
  });
  it('refuses a conversion it cannot make, and the same unit', () => {
    expect(plan('pcs')).toEqual({ error: expect.stringMatching(/different/) });
    expect(plan('l')).toEqual({ error: expect.stringMatching(/cannot be converted/) });
    const noSize = { ...mat, size: { length: null, width: null, unit: 'cm', status: 'UNAVAILABLE' as const } };
    expect(plan('sqm', noSize)).toEqual({ error: expect.stringMatching(/Add the size/) });
  });
  it('rescales own units', () => {
    const withBale = { ...mat, customUnits: [{ name: 'bale', factor: 50, status: 'USER_PROVIDED' as const }] };
    const p = plan('sqm', withBale) as BaseUnitCopyPlan;
    expect(p.product.customUnits[0]!.factor).toBeCloseTo(12, 5); // 50 pcs × 0.24 sq m
  });
});
