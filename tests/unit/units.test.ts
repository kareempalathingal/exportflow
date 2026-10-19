import { describe, expect, it } from 'vitest';
import { areaFromSize, availableUnits, completeFacts, convert, type ConversionContext } from '../../src/lib/units';
import { bomRequirement, findDuplicate, productContext, type Bom, type Product, type RawMaterial } from '../../src/lib/masters';

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

describe('BOM requirement', () => {
  const product: Product = {
    name: 'Mat A', active: true, notes: '', code: '', baseUnit: 'pcs', supplyType: 'MANUFACTURED', specifications: '',
    size: { length: 40, width: 60, unit: 'cm', status: 'VERIFIED' },
    thicknessMm: { value: null, status: 'UNAVAILABLE', source: '' },
    gsm: { value: 1500, status: 'VERIFIED', source: '' },
    weightPerPieceKg: { value: null, status: 'UNAVAILABLE', source: '' },
    customUnits: [],
  };
  const fibre: RawMaterial = { name: 'Fibre', active: true, notes: '', baseUnit: 'kg', gsm: { value: null, status: 'UNAVAILABLE', source: '' }, customUnits: [] };
  const latex: RawMaterial = { name: 'Latex', active: true, notes: '', baseUnit: 'l', gsm: { value: null, status: 'UNAVAILABLE', source: '' }, customUnits: [] };
  const rms = new Map([['f', fibre], ['l', latex]]);
  const bom: Bom = {
    productId: 'p', notes: '',
    lines: [
      { rawMaterialId: 'f', qty: 300, unit: 'g', wastagePct: 5, status: 'VERIFIED', source: '' },
      { rawMaterialId: 'l', qty: 0.05, unit: 'l', wastagePct: 0, status: 'ESTIMATED', source: '' },
    ],
  };
  it('scales per-unit recipe, converts units and applies wastage', () => {
    const r = bomRequirement(product, bom, rms, 1000, 'pcs');
    near(r.productBaseQty!, 1000);
    near(r.lines[0]!.gross, 1000 * 0.3 * 1.05);
    near(r.lines[1]!.gross, 50);
    expect(r.lines[0]!.provisional).toBe(false);
    expect(r.lines[1]!.provisional).toBe(true);
    expect(r.provisional).toBe(true);
  });
  it('accepts the order in another unit (sq m → pcs via size)', () => {
    const r = bomRequirement(product, bom, rms, 240, 'sqm'); // 240 m² = 1000 pcs
    near(r.productBaseQty!, 1000);
  });
  it('reports a missing product conversion instead of guessing', () => {
    const noSize = { ...product, size: { ...product.size, length: null }, gsm: { value: null, status: 'UNAVAILABLE' as const, source: '' } };
    const r = bomRequirement(noSize, bom, rms, 100, 'kg');
    expect(r.productBaseQty).toBeNull();
    expect(r.productError).toMatch(/Conversion needed/);
  });
  it('uses product size facts in its context', () => {
    near(productContext(product).areaPerPieceSqm!.value, 0.24);
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
