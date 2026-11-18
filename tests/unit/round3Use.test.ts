import { describe, expect, it } from 'vitest';
import type { JobOrder } from '../../src/lib/jobOrders';
import type { Bom, MasterData, Product, RawMaterial } from '../../src/lib/masters';
import { compareEntry, directParents, isDuplicateUse, matchMaterial, materialTone, materialTotals, materialUseReport, parseUseGrid, woKey, type UseEntry } from '../../src/lib/materialUse';
import { readDate } from '../../src/lib/joImport';

// Round 3 (18 Nov 2026): material use vs BOM. Sample values only.

const raw = (name: string): RawMaterial => ({ name, active: true, baseUnit: 'kg', customUnits: [], gsm: { value: null, status: 'UNAVAILABLE', source: '' } }) as unknown as RawMaterial;
const prod = (name: string, baseUnit: string, size?: [number, number]): Product =>
  ({ name, active: true, baseUnit, supplyType: 'MANUFACTURED', customUnits: [], size: size ? { width: size[0], length: size[1], unit: 'cm', status: 'USER_PROVIDED' } : { width: null, length: null, unit: 'cm', status: 'UNAVAILABLE' }, gsm: { value: null, status: 'UNAVAILABLE', source: '' }, weightPerPieceKg: { value: null, status: 'UNAVAILABLE', source: '' } }) as unknown as Product;
const line = (id: string, qty: number, unit: string, type: 'RAW_MATERIAL' | 'PRODUCT' = 'RAW_MATERIAL', wastagePct = 0) => ({ componentType: type, componentId: id, qty, unit, wastagePct, status: 'USER_PROVIDED', source: '' });
const md: MasterData = {
  products: new Map([
    ['base', prod('Base (sample)', 'sqm')],
    ['mat', prod('Mat (sample)', 'pcs', [50, 100])],
  ]),
  rawMaterials: new Map([
    ['ra', raw('Fibre A')],
    ['rb', raw('Filler B')],
  ]),
  boms: new Map<string, Bom>([
    ['base', { productId: 'base', notes: '', lines: [line('ra', 2, 'kg'), line('rb', 1, 'kg', 'RAW_MATERIAL', 10)] } as unknown as Bom],
    ['mat', { productId: 'mat', notes: '', lines: [line('base', 0.5, 'sqm', 'PRODUCT')] } as unknown as Bom],
  ]),
};
const entry = (p: Partial<UseEntry>): UseEntry => ({ id: 'e', on: '2026-11-02', productId: 'base', productName: 'Base (sample)', qty: 100, unit: 'sqm', lines: [], at: 't', ...p });

describe('one entry vs BOM', () => {
  it('expected incl. wastage, difference per material, missing sides kept apart', () => {
    const c = compareEntry(entry({ lines: [{ type: 'RAW_MATERIAL', id: 'ra', name: 'Fibre A', qty: 210, unit: 'kg' }] }), md);
    const a = c.rows.find((r) => r.id === 'ra')!;
    const b = c.rows.find((r) => r.id === 'rb')!;
    expect([a.expected, a.actual, a.diffPct]).toEqual([200, 210, 5]);
    expect([b.expected, b.actual, b.diffPct]).toEqual([110.00000000000001, null, null]);
  });
  it('through a made sub-product (pieces → area → base)', () => {
    // 10 mats × 0.5 sq m = 5 sq m of base → 10 kg fibre
    const c = compareEntry(entry({ productId: 'mat', qty: 10, unit: 'pcs', lines: [{ type: 'RAW_MATERIAL', id: 'ra', name: 'Fibre A', qty: 9, unit: 'kg' }] }), md);
    expect(c.rows.find((r) => r.id === 'ra')).toMatchObject({ expected: 10, actual: 9, diffPct: -10 });
    expect(directParents('mat', 'RAW_MATERIAL:ra', md)).toEqual(['base']);
  });
});

describe('totals and colours', () => {
  it('totals count only entries with both figures', () => {
    const jo = { status: 'CONFIRMED', bomSnapshot: null, materialUse: [entry({ id: '1', lines: [{ type: 'RAW_MATERIAL', id: 'ra', name: 'A', qty: 220, unit: 'kg' }] }), entry({ id: '2', lines: [{ type: 'RAW_MATERIAL', id: 'rb', name: 'B', qty: 100, unit: 'kg' }] })] } as unknown as JobOrder;
    const t = materialTotals(jo, md);
    expect(t.rows.find((r) => r.id === 'ra')).toMatchObject({ expected: 200, actual: 220, compared: 1, notEntered: 1, diffPct: 10 });
  });
  it('no thresholds = no colour; else by the absolute difference', () => {
    expect(materialTone(12, null, null)).toBeNull();
    expect(materialTone(-12, 5, 10)).toBe('bad');
    expect(materialTone(6, 5, 10)).toBe('warn');
    expect(materialTone(2, 5, 10)).toBe('ok');
  });
});

describe('report and suggestion', () => {
  const jos = (n: number, kg: number) => [{ id: 'j', joNumber: 'S-1', status: 'COMPLETED', materialUse: Array.from({ length: n }, (_, i) => entry({ id: String(i), lines: [{ type: 'RAW_MATERIAL', id: 'ra', name: 'A', qty: kg, unit: 'kg' }] })) }] as unknown as (JobOrder & { id: string })[];
  it('per unit of the BOM that lists the material; suggestion only with 5+ entries and 15%+', () => {
    const four = materialUseReport(jos(4, 240), md)[0]!;
    expect([four.bomPerUnit, four.actualPerUnit, four.diffPct, four.suggestedQty]).toEqual([2, 2.4, 19.999999999999996, null]);
    const five = materialUseReport(jos(5, 240), md)[0]!;
    expect(five.suggestedQty).toBeCloseTo(2.4);
    expect(materialUseReport(jos(5, 220), md)[0]!.suggestedQty).toBeNull();
  });
});

describe('ERP block layout', () => {
  const grid = [
    ['', '', '', '', 'WO', '1/2026', '', 'WO', '1/2026'],
    ['', '', '', '', 'Production Date', '02-11-2026', '', 'Production Date', '03-11-2026'],
    ['', 'WO: 1/2026', 'Order Qunatity Pcs', '', 'Size- Cm', 'W', 'L', 'Size- Cm', 'W', 'L'],
    ['', 'Size 50 x 100 cm', '10', '', '', '50', '100', '', '50', '100'],
    ['', '', '', '', 'Quantity -Pcs', '6', '', 'Quantity -Pcs', '4'],
    ['', '', '', '', 'Sq Mtr', '3', '', 'Sq Mtr', '2'],
    ['', 'Sl No', 'Material', '', 'Consumption-Kg', '', '', 'Consumption-Kg'],
    ['', '1', 'Fibre A', '', '6.5', '', '', '4.1'],
    ['', '2', 'Filler b', '', '3', '', '', '2'],
    ['', '', '', '', 'WO', '2 / 2026'],
    ['', '', '', '', 'Production Date', '05-11-2026'],
    ['', '', '', '', 'Sq Mtr', '1'],
    ['', 'Sl No', 'Material', '', 'Consumption-Kg'],
    ['', '1', 'Fibre A', '', '2'],
  ];
  it('reads every block with date, size, pieces, area and materials', () => {
    const p = parseUseGrid(grid, readDate);
    expect(p.map((x) => [x.joNo, x.on, x.widthCm, x.lengthCm, x.pcs, x.sqm, x.materials.length])).toEqual([
      ['1/2026', '2026-11-02', 50, 100, 6, 3, 2],
      ['1/2026', '2026-11-03', 50, 100, 4, 2, 2],
      ['2 / 2026', '2026-11-05', null, null, null, 1, 1],
    ]);
    expect(p[1]!.materials).toEqual([{ name: 'Fibre A', qty: 4.1 }, { name: 'Filler b', qty: 2 }]);
    expect(woKey('2 / 2026')).toBe(woKey('2/2026'));
  });
  it('names: remembered, ERP code, same name; duplicates not added again', () => {
    const raws = [{ id: 'ra', name: 'Fibre A' }, { id: 'rb', name: 'Filler B', erpCode: 'RM-9' }];
    expect(matchMaterial('filler  b', raws, {})).toEqual({ id: 'rb', by: 'name' });
    expect(matchMaterial('RM-9', raws, {})).toEqual({ id: 'rb', by: 'code' });
    expect(matchMaterial('Powder', raws, { powder: 'ra' })).toEqual({ id: 'ra', by: 'remembered' });
    expect(matchMaterial('Powder', raws, {})).toBeNull();
    expect(isDuplicateUse([entry({})], { on: '2026-11-02', productId: 'base', qty: 100, unit: 'sqm' })).toBe(true);
    expect(isDuplicateUse([entry({})], { on: '2026-11-03', productId: 'base', qty: 100, unit: 'sqm' })).toBe(false);
  });
});
