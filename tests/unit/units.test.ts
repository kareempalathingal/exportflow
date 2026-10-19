import { describe, expect, it } from 'vitest';
import { areaFromSize, availableUnits, completeFacts, convert, type ConversionContext } from '../../src/lib/units';
import { bomStatus, createsCycle, explodeBom, findDuplicate, masterAttention, productContext, type Bom, type MasterData, type Product, type RawMaterial } from '../../src/lib/masters';

const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9);

function value(r: ReturnType<typeof convert>): number {
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

describe('same-dimension conversions', () => {
  const ctx: ConversionContext = { baseUnit: 'kg', customUnits: [] };
  it('mass, length, area', () => {
    near(value(convert(2500, 'g', 'kg', ctx)), 2.5);
    near(value(convert(1, 't', 'kg', ctx)), 1000);
    near(value(convert(1, 'sqm', 'sqft', { baseUnit: 'sqm', customUnits: [] })), 10.763910416709722);
    near(value(convert(12, 'in', 'ft', { baseUnit: 'm', customUnits: [] })), 1);
  });
  it('is not provisional for standard factors', () => {
    const r = convert(1, 'kg', 'g', ctx);
    expect(r.ok && r.provisional).toBe(false);
  });
});

describe('GSM and size conversions (example numbers, not company data)', () => {
  // 40 × 60 cm mat, 1,500 GSM
  const area = areaFromSize(40, 60, 'cm')!;
  const ctx: ConversionContext = {
    baseUnit: 'pcs',
    customUnits: [],
    areaPerPieceSqm: { value: area, status: 'VERIFIED' },
    gsm: { value: 1500, status: 'VERIFIED' },
  };
  it('area of one piece', () => near(area, 0.24));
  it('pcs → sq m → kg', () => {
    near(value(convert(10000, 'pcs', 'sqm', ctx)), 2400);
    near(value(convert(10000, 'pcs', 'kg', ctx)), 3600);
    near(value(convert(3600, 'kg', 'pcs', ctx)), 10000);
    near(value(convert(1, 'sqft', 'kg', ctx)), 0.09290304 * 1.5);
  });
  it('derives the missing third fact', () => {
    const c = completeFacts({ baseUnit: 'pcs', customUnits: [], areaPerPieceSqm: { value: 0.24, status: 'VERIFIED' }, massPerPieceKg: { value: 0.36, status: 'VERIFIED' } });
    near(c.gsm!.value, 1500);
  });
  it('marks results provisional when a fact is only estimated', () => {
    const r = convert(1, 'pcs', 'kg', { ...ctx, gsm: { value: 1500, status: 'ESTIMATED' } });
    expect(r.ok && r.provisional).toBe(true);
  });
  it('never guesses a missing fact', () => {
    const r = convert(1, 'pcs', 'kg', { baseUnit: 'pcs', customUnits: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Conversion needed/);
    expect(convert(1, 'pcs', 'm', ctx).ok).toBe(false); // length is not convertible to count
  });
  it('lists only units that can actually be reached', () => {
    const units = availableUnits(ctx);
    expect(units).toContain('kg');
    expect(units).toContain('sqft');
    expect(units).not.toContain('l');
  });
});

describe('custom units', () => {
  const ctx: ConversionContext = { baseUnit: 'kg', customUnits: [{ name: 'Bale', factor: 50, status: 'USER_PROVIDED' }] };
  it('converts through the base unit, case-insensitively', () => {
    near(value(convert(3, 'bale', 'kg', ctx)), 150);
    near(value(convert(3, 'bale', 't', ctx)), 0.15);
  });
  it('rejects unknown units', () => {
    expect(convert(1, 'roll', 'kg', ctx).ok).toBe(false);
  });
});


// Example numbers only — not company data.
const NA = { value: null, status: 'UNAVAILABLE' as const, source: '' };
function prod(name: string, extra: Partial<Product> = {}): Product {
  return {
    name, active: true, notes: '', code: '', baseUnit: 'pcs', supplyType: 'MANUFACTURED', specifications: '',
    size: { length: null, width: null, unit: 'cm', status: 'UNAVAILABLE' },
    thicknessMm: NA, gsm: NA, weightPerPieceKg: NA, customUnits: [], ...extra,
  };
}
const rmat = (name: string, baseUnit: string): RawMaterial => ({ name, active: true, notes: '', baseUnit, gsm: NA, customUnits: [] });
const L = (type: 'RAW_MATERIAL' | 'PRODUCT', id: string, qty: number, unit: string, wastagePct = 0, status: 'VERIFIED' | 'ESTIMATED' = 'VERIFIED') =>
  ({ componentType: type, componentId: id, qty, unit, wastagePct, status, source: '' });

function data(): MasterData {
  return {
    products: new Map<string, Product>([
      ['mat', prod('Mat', { size: { length: 40, width: 60, unit: 'cm', status: 'VERIFIED' }, gsm: { value: 1500, status: 'VERIFIED', source: '' } })],
      ['yarn', prod('Yarn', { baseUnit: 'kg', supplyType: 'BOTH' })],
      ['label', prod('Label', { supplyType: 'TRADED' })],
    ]),
    rawMaterials: new Map([['fibre', rmat('Fibre', 'kg')], ['latex', rmat('Latex', 'l')]]),
    boms: new Map<string, Bom>([
      ['mat', { productId: 'mat', notes: '', lines: [L('PRODUCT', 'yarn', 400, 'g', 0), L('RAW_MATERIAL', 'latex', 0.05, 'l'), L('PRODUCT', 'label', 1, 'pcs')] }],
      ['yarn', { productId: 'yarn', notes: '', lines: [L('RAW_MATERIAL', 'fibre', 1.1, 'kg')] }],
    ]),
  };
}
const find = (rows: { id: string; qty: number }[], id: string) => rows.find((r) => r.id === id)?.qty;

describe('multi-level BOM explosion', () => {
  it('explodes product → sub-product → raw material', () => {
    const r = explodeBom('mat', 1000, 'pcs', data());
    expect(r.errors).toEqual([]);
    near(find(r.toProduce, 'yarn')!, 400); // 1000 × 0.4 kg
    near(find(r.toBuy, 'fibre')!, 440); // 400 × 1.1
    near(find(r.toBuy, 'latex')!, 50);
    near(find(r.toBuy, 'label')!, 1000); // traded product is bought, not exploded
    expect(r.provisional).toBe(false);
  });
  it('accepts the order in another unit and applies wastage at each level', () => {
    const md = data();
    md.boms.set('yarn', { productId: 'yarn', notes: '', lines: [L('RAW_MATERIAL', 'fibre', 1.1, 'kg', 10)] });
    const r = explodeBom('mat', 240, 'sqm', md); // 240 m² = 1000 pcs
    near(r.productBaseQty!, 1000);
    near(find(r.toBuy, 'fibre')!, 400 * 1.1 * 1.1);
  });
  it('adds up the same component reached by different paths', () => {
    const md = data();
    md.boms.get('mat')!.lines.push(L('RAW_MATERIAL', 'fibre', 0.1, 'kg'));
    near(find(explodeBom('mat', 1000, 'pcs', md).toBuy, 'fibre')!, 440 + 100);
  });
  it('flags a missing sub-BOM instead of guessing', () => {
    const md = data();
    md.boms.delete('yarn');
    const r = explodeBom('mat', 10, 'pcs', md);
    expect(r.errors).toContain('BOM missing for Yarn');
    expect(r.provisional).toBe(true);
    expect(find(r.toBuy, 'fibre')).toBeUndefined();
  });
  it('marks results provisional when any level is estimated', () => {
    const md = data();
    md.boms.set('yarn', { productId: 'yarn', notes: '', lines: [L('RAW_MATERIAL', 'fibre', 1.1, 'kg', 0, 'ESTIMATED')] });
    const r = explodeBom('mat', 10, 'pcs', md);
    expect(r.provisional).toBe(true);
    expect(r.toBuy.find((x) => x.id === 'fibre')!.provisional).toBe(true);
    expect(r.toBuy.find((x) => x.id === 'latex')!.provisional).toBe(false);
  });
  it('detects loops before saving and survives them when exploding', () => {
    const md = data();
    expect(createsCycle('yarn', 'mat', md)).toBe(true); // mat already uses yarn
    expect(createsCycle('mat', 'mat', md)).toBe(true);
    expect(createsCycle('mat', 'label', md)).toBe(false);
    md.boms.get('yarn')!.lines.push(L('PRODUCT', 'mat', 1, 'pcs'));
    const r = explodeBom('mat', 1, 'pcs', md);
    expect(r.errors.some((e) => e.startsWith('Loop in BOM'))).toBe(true);
  });
  it('reads early BOM lines saved with rawMaterialId', () => {
    const md = data();
    md.boms.set('yarn', { productId: 'yarn', notes: '', lines: [{ rawMaterialId: 'fibre', qty: 1, unit: 'kg', wastagePct: 0, status: 'VERIFIED', source: '' }] });
    near(find(explodeBom('yarn', 5, 'kg', md).toBuy, 'fibre')!, 5);
  });
});

describe('BOM status and attention list', () => {
  it('classifies BOMs, including sub-products', () => {
    const md = data();
    expect(bomStatus('label', md)).toBe('NOT_NEEDED');
    expect(bomStatus('mat', md)).toBe('READY');
    md.boms.set('yarn', { productId: 'yarn', notes: '', lines: [L('RAW_MATERIAL', 'fibre', 1.1, 'kg', 0, 'ESTIMATED')] });
    expect(bomStatus('yarn', md)).toBe('PROVISIONAL');
    expect(bomStatus('mat', md)).toBe('PROVISIONAL'); // because its yarn is not confirmed
    md.boms.delete('yarn');
    expect(bomStatus('yarn', md)).toBe('MISSING');
    expect(bomStatus('mat', md)).toBe('PROVISIONAL');
  });
  it('lists what still needs data, skipping inactive products', () => {
    const md = data();
    md.boms.delete('yarn');
    const list = [...md.products.entries()].map(([id, p]) => ({ ...p, id }));
    list.push({ ...prod('Old'), id: 'old', active: false });
    const items = masterAttention(list, md).map((i) => `${i.productId}:${i.kind}`);
    expect(items).toContain('mat:BOM_PROVISIONAL');
    expect(items).toContain('yarn:BOM_MISSING');
    expect(items.some((x) => x.startsWith('old:'))).toBe(false);
    expect(items).not.toContain('mat:NO_CONVERSION');
  });
  it('uses product size facts in its context', () => {
    near(productContext(data().products.get('mat')!).areaPerPieceSqm!.value, 0.24);
  });
});

describe('duplicate names', () => {
  it('ignores case, extra spaces and inactive records', () => {
    const items = [
      { id: '1', name: 'Coir Mat', active: true, notes: '' },
      { id: '2', name: 'Old Mat', active: false, notes: '' },
    ];
    expect(findDuplicate('  coir   mat ', items)?.id).toBe('1');
    expect(findDuplicate('old mat', items)).toBeUndefined();
    expect(findDuplicate('Coir Mat', items, '1')).toBeUndefined();
  });
});
