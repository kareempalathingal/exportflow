import { describe, expect, it } from 'vitest';
import type { JobOrder, JoLine, StockEntry } from '../../src/lib/jobOrders';
import type { Bom, BomLine, MasterData, Product, RawMaterial } from '../../src/lib/masters';
import {
  allocationFor,
  makeStockEntry,
  overAllocated,
  planMaterials,
  stockCountId,
  toBuyAcrossOrders,
  type StockCount,
} from '../../src/lib/materials';

const na = { value: null, status: 'UNAVAILABLE' as const, source: '' };
const product = (name: string, supplyType: Product['supplyType'], baseUnit = 'pcs'): Product => ({
  name, code: '', active: true, notes: '', baseUnit, supplyType, specifications: '',
  size: { length: null, width: null, unit: 'cm', status: 'UNAVAILABLE' }, thicknessMm: na, gsm: na, weightPerPieceKg: na, customUnits: [],
});
const rm = (name: string, baseUnit = 'kg'): RawMaterial => ({ name, active: true, notes: '', baseUnit, gsm: na, customUnits: [] });
const bl = (componentType: BomLine['componentType'], componentId: string, qty: number, unit: string, wastagePct = 0): BomLine => ({
  componentType, componentId, qty, unit, wastagePct, status: 'VERIFIED', source: '',
});

// Mat (made) = 2 kg yarn (made) + 0.5 kg latex; yarn = 1.1 kg fibre. Rug is traded.
function md(): MasterData {
  return {
    products: new Map([
      ['mat', product('Mat', 'MANUFACTURED')],
      ['yarn', product('Yarn', 'MANUFACTURED', 'kg')],
      ['rug', product('Rug', 'TRADED')],
      ['both', product('Both mat', 'BOTH')],
    ]),
    rawMaterials: new Map([['fibre', rm('Fibre')], ['latex', rm('Latex')]]),
    boms: new Map<string, Bom>([
      ['mat', { productId: 'mat', notes: '', lines: [bl('PRODUCT', 'yarn', 2, 'kg'), bl('RAW_MATERIAL', 'latex', 500, 'g')] }],
      ['yarn', { productId: 'yarn', notes: '', lines: [bl('RAW_MATERIAL', 'fibre', 1.1, 'kg')] }],
      ['both', { productId: 'both', notes: '', lines: [bl('RAW_MATERIAL', 'fibre', 1, 'kg')] }],
    ]),
  };
}
const line = (productId: string, qty: number, supply: JoLine['supply'] = null): JoLine => ({ id: productId, productId, productName: productId, qty, unit: 'pcs', supply });
const entry = (baseQty: number): StockEntry => ({ qty: baseQty, unit: 'x', baseQty, location: '', remarks: '', changedAt: '2026-10-19T10:00:00Z', prevBaseQty: null });
type Jo = Pick<JobOrder, 'lines' | 'status' | 'bomSnapshot' | 'stock'>;
const jo = (lines: JoLine[], stock: Record<string, StockEntry> = {}, extra: Partial<Jo> = {}): Jo => ({ lines, status: 'DRAFT', bomSnapshot: null, stock, ...extra });
const row = (rows: { key: string }[], key: string) => rows.find((r) => r.key === key) as { gross: number; fromStock: number; net: number } | undefined;

describe('material plan with stock', () => {
  it('explodes the balance after finished-product stock', () => {
    const p = planMaterials(jo([line('mat', 100)], { 'PRODUCT:mat': entry(30) }), md());
    expect(row(p.toProduce, 'PRODUCT:mat')).toMatchObject({ gross: 100, fromStock: 30, net: 70 });
    expect(row(p.toProduce, 'PRODUCT:yarn')!.gross).toBeCloseTo(140);
    expect(row(p.toBuy, 'RAW_MATERIAL:fibre')!.gross).toBeCloseTo(154);
    expect(row(p.toBuy, 'RAW_MATERIAL:latex')!.gross).toBeCloseTo(35);
    expect(p.errors).toEqual([]);
  });
  it('deducts made sub-product stock before exploding it', () => {
    const p = planMaterials(jo([line('mat', 100)], { 'PRODUCT:yarn': entry(40) }), md());
    expect(row(p.toProduce, 'PRODUCT:yarn')).toMatchObject({ gross: 200, fromStock: 40, net: 160 });
    expect(row(p.toBuy, 'RAW_MATERIAL:fibre')!.gross).toBeCloseTo(176);
  });
  it('raw-material stock reduces To buy and never goes negative', () => {
    const p = planMaterials(jo([line('mat', 10)], { 'RAW_MATERIAL:latex': entry(50) }), md());
    expect(row(p.toBuy, 'RAW_MATERIAL:latex')).toMatchObject({ fromStock: 50, net: 0 });
    expect(p.notes.some((n) => n.includes('more stock set aside'))).toBe(true);
  });
  it('bought lines go straight to To buy; BOTH follows the line choice', () => {
    const p = planMaterials(jo([line('rug', 20), line('both', 5, 'BUY')], { 'PRODUCT:rug': entry(5) }), md());
    expect(row(p.toBuy, 'PRODUCT:rug')).toMatchObject({ gross: 20, net: 15 });
    expect(row(p.toBuy, 'PRODUCT:both')!.net).toBe(5);
    expect(p.toProduce).toEqual([]);
    const made = planMaterials(jo([line('both', 5, 'MAKE')]), md());
    expect(row(made.toBuy, 'RAW_MATERIAL:fibre')!.gross).toBeCloseTo(5);
  });
  it('sums the same component reached through different lines', () => {
    const p = planMaterials(jo([line('mat', 10), line('both', 3, 'MAKE')]), md());
    expect(row(p.toBuy, 'RAW_MATERIAL:fibre')!.gross).toBeCloseTo(22 + 3);
  });
  it('reports missing BOMs and undecided lines instead of guessing', () => {
    const m = md();
    m.boms.delete('yarn');
    const p = planMaterials(jo([line('mat', 10), line('both', 1)]), m);
    expect(p.errors).toContain('BOM missing for Yarn — its materials cannot be calculated');
    expect(p.errors).toContain('Both mat: choose Make or Buy');
    expect(p.provisional).toBe(true);
  });
  it('uses the BOM saved at confirmation, not later edits', () => {
    const m = md();
    const snap = { mat: { rev: 1, lines: [bl('RAW_MATERIAL', 'latex', 1, 'kg')] } };
    const p = planMaterials(jo([line('mat', 10)], {}, { status: 'CONFIRMED', bomSnapshot: snap }), m);
    expect(row(p.toBuy, 'RAW_MATERIAL:latex')!.gross).toBeCloseTo(10);
    expect(row(p.toBuy, 'RAW_MATERIAL:fibre')).toBeUndefined();
  });
});

describe('no double allocation', () => {
  const count: StockCount = { itemType: 'RAW_MATERIAL', itemId: 'fibre', qty: 100, unit: 'kg', countedOn: '2026-10-15', notes: '' };
  const jos = [
    { status: 'CONFIRMED' as const, stock: { 'RAW_MATERIAL:fibre': entry(70) } },
    { status: 'CONFIRMED' as const, stock: { 'RAW_MATERIAL:fibre': entry(50) } },
    { status: 'DRAFT' as const, stock: { 'RAW_MATERIAL:fibre': entry(40) } },
    { status: 'COMPLETED' as const, stock: { 'RAW_MATERIAL:fibre': entry(500) } },
  ];
  it('warns only on confirmed orders; drafts are information', () => {
    expect(allocationFor('RAW_MATERIAL:fibre', jos, count)).toMatchObject({ confirmed: 120, draft: 40, counted: 100, state: 'OVER' });
    expect(allocationFor('RAW_MATERIAL:fibre', jos.slice(1), count).state).toBe('OK');
    expect(allocationFor('RAW_MATERIAL:fibre', jos, undefined).state).toBe('MANUAL_ONLY');
    expect(overAllocated(jos, new Map([[stockCountId('RAW_MATERIAL', 'fibre'), count]])).map((o) => o.key)).toEqual(['RAW_MATERIAL:fibre']);
  });
});

describe('stock entries', () => {
  it('converts to the base unit and keeps the previous value', () => {
    const first = makeStockEntry({ qty: 500, unit: 'g', location: ' Store 2 ', remarks: '' }, 'RAW_MATERIAL', 'latex', md(), undefined, 't1');
    expect(first).toMatchObject({ baseQty: 0.5, location: 'Store 2', prevBaseQty: null, changedAt: 't1' });
    const second = makeStockEntry({ qty: 2, unit: 'kg', location: '', remarks: '' }, 'RAW_MATERIAL', 'latex', md(), first as StockEntry, 't2');
    expect(second).toMatchObject({ baseQty: 2, prevBaseQty: 0.5, changedAt: 't2' });
    const unchanged = makeStockEntry({ qty: 2, unit: 'kg', location: 'x', remarks: '' }, 'RAW_MATERIAL', 'latex', md(), second as StockEntry, 't3');
    expect(unchanged).toMatchObject({ changedAt: 't2', prevBaseQty: 0.5 });
    expect(makeStockEntry({ qty: 1, unit: 'sqm', location: '', remarks: '' }, 'RAW_MATERIAL', 'latex', md(), undefined, 't')).toMatch(/Conversion needed/);
  });
});

describe('To buy across orders', () => {
  it('adds up confirmed orders and lists each order', () => {
    const a = { id: 'a', joNumber: 'JO-1', ...jo([line('mat', 10)], {}, { status: 'CONFIRMED', bomSnapshot: {} }) };
    const b = { id: 'b', joNumber: 'JO-2', ...jo([line('mat', 10)], { 'RAW_MATERIAL:latex': entry(1) }, { status: 'CONFIRMED', bomSnapshot: {} }) };
    const d = { id: 'd', joNumber: 'JO-3', ...jo([line('mat', 10)]) };
    const r = toBuyAcrossOrders([a, b, d], md(), false);
    const latex = r.rows.find((x) => x.key === 'RAW_MATERIAL:latex')!;
    expect(latex.net).toBeCloseTo(9);
    expect(latex.orders.map((o) => o.joNumber)).toEqual(['JO-1', 'JO-2']);
    expect(toBuyAcrossOrders([a, b, d], md(), true).rows.find((x) => x.key === 'RAW_MATERIAL:latex')!.net).toBeCloseTo(14);
  });
});
