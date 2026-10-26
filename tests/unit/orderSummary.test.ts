import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR } from '../../src/lib/calendar';
import type { JobOrder } from '../../src/lib/jobOrders';
import type { Bom, MasterData, Product, RawMaterial } from '../../src/lib/masters';
import { lineSummaries, quantityTotals } from '../../src/lib/orderSummary';
import { buildSampleData } from '../../src/lib/sampleData';

const TODAY = '2026-10-26';
const writes = buildSampleData(TODAY);
const of = <T,>(c: string) => writes.filter((w) => w.collection === c).map((w) => ({ id: w.docId, ...(w.data as unknown as T) }));
const md: MasterData = { products: new Map(of<Product>('products').map((p) => [p.id, p])), rawMaterials: new Map(of<RawMaterial>('rawMaterials').map((p) => [p.id, p])), boms: new Map(of<Bom>('boms').map((p) => [p.id, p])) };
const m = new Map<string, JobOrder & { id: string }>();
for (const w of writes) if (w.collection === 'jobOrders') m.set(w.docId, { id: w.docId, ...(w.data as unknown as JobOrder) });
const ctx = { md, cal: DEFAULT_CALENDAR };

describe('order items at a glance', () => {
  it('lists each product with its quantity, Make/Buy and its own progress', () => {
    const rows = lineSummaries(m.get('sample_jo_102')!, md, TODAY, ctx);
    expect(rows.map((r) => [r.productName, r.qty, r.unit, r.supply])).toEqual([
      ['Coir mat 40×60 (sample)', 1200, 'pcs', 'MAKE'],
      ['Printed door mat 45×75 (sample)', 300, 'pcs', 'BUY'],
    ]);
    expect(rows.every((r) => r.pct !== null && r.pct >= 0 && r.pct <= 100)).toBe(true);
    expect(rows[0]!.baseText).toBeNull(); // same unit as the product
  });
  it('drafts have no progress yet; another unit shows the base equivalent', () => {
    const draft = m.get('sample_jo_104')!;
    expect(lineSummaries(draft, md, TODAY, ctx)[0]!.pct).toBeNull();
    const sqm = { ...draft, lines: [{ ...draft.lines[0]!, productId: 'sample_p_mat', qty: 24, unit: 'sqm' }] };
    expect(lineSummaries(sqm, md, TODAY, ctx)[0]!.baseText).toBe('= 100 pcs');
  });
  it('totals add up only within one unit', () => {
    expect(quantityTotals({ lines: [{ qty: 1200, unit: 'pcs' }, { qty: 300, unit: 'pcs' }, { qty: 500, unit: 'sqm' }] as never })).toBe('1,500 pcs + 500 sq m');
  });
});
