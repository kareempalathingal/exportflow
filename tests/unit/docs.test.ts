import { describe, expect, it } from 'vitest';
import { joSummaryDoc, pdfSafe, planDoc, safeFileName, toBuyAllDoc } from '../../src/lib/docs/model';
import { renderPdf } from '../../src/lib/docs/pdf';
import { computeDeadline, type JobOrder } from '../../src/lib/jobOrders';
import type { MasterData, Product } from '../../src/lib/masters';
import { planMaterials } from '../../src/lib/materials';

const na = { value: null, status: 'UNAVAILABLE' as const, source: '' };
const mat: Product = {
  name: 'Coir Mat 40×60', code: '', active: true, notes: '', baseUnit: 'pcs', supplyType: 'MANUFACTURED', specifications: '',
  size: { length: 40, width: 60, unit: 'cm', status: 'VERIFIED' }, thicknessMm: na, gsm: { value: 1500, status: 'VERIFIED', source: '' }, weightPerPieceKg: na, customUnits: [],
};
const md: MasterData = {
  products: new Map([['p1', mat]]),
  rawMaterials: new Map([['r1', { name: 'Coir fibre', active: true, notes: '', baseUnit: 'kg', gsm: na, customUnits: [] }]]),
  boms: new Map([['p1', { productId: 'p1', notes: '', lines: [{ componentType: 'RAW_MATERIAL', componentId: 'r1', qty: 300, unit: 'g', wastagePct: 5, status: 'VERIFIED', source: '' }] }]]),
};
const d = computeDeadline('2026-11-01', '2026-12-30');
if (!d.ok) throw new Error();
const jo: JobOrder = {
  joNumber: 'JO 1042/A', customerId: 'c', customerName: 'Hansa Floor GmbH', poNumber: 'PO-9', receivedDate: '2026-11-01', deliveryDate: '2026-12-30',
  deliveryDateType: 'PORT', deadline: d, status: 'CONFIRMED', notes: '', confirmedOn: '2026-11-02',
  lines: [{ id: 'l1', productId: 'p1', productName: 'Coir Mat 40×60', qty: 24, unit: 'sqm', supply: 'MAKE' }],
  bomSnapshot: { p1: { rev: 1, lines: md.boms.get('p1')!.lines } },
  stock: { 'RAW_MATERIAL:r1': { qty: 10, unit: 'kg', baseQty: 10, location: '', remarks: '', changedAt: 'x', prevBaseQty: null } },
};
const opts = { company: 'Acme Coir', today: '2026-11-20', generatedAt: '20 Nov 2026, 10:00 am IST' };

describe('document models', () => {
  it('JO summary lists lines with base-unit conversion and the deadline rule', () => {
    const m = joSummaryDoc(jo, md, opts);
    expect(m.tables[0]!.rows[0]).toEqual(['Coir Mat 40×60', '24 sq m', '100 pcs', 'Make']);
    expect(m.meta.find(([k]) => k === 'Internal deadline')![1]).toContain('buffer 6 of 51 working days');
    expect(m.provisional).toBe(false);
    expect(m.fileName).toBe('JO-1042-A_summary.pdf');
  });
  it('draft orders and missing data are marked provisional', () => {
    const m = joSummaryDoc({ ...jo, status: 'DRAFT', lines: [{ ...jo.lines[0]!, unit: 'kg' }] }, { ...md, products: new Map([['p1', { ...mat, gsm: na }]]) }, opts);
    expect(m.provisional).toBe(true);
    expect(m.provisionalReasons[0]).toBe('This order is still a draft');
    expect(m.provisionalReasons.some((r) => r.includes('Conversion needed'))).toBe(true);
  });
  it('To buy shows needed, from stock and still to buy', () => {
    const m = planDoc('TO_BUY', jo, planMaterials(jo, md), opts);
    expect(m.tables[0]!.rows[0]).toEqual(['Coir fibre', 'Raw material', '31.5 kg', '10 kg', '21.5 kg', '—']);
    const withSup = planDoc('TO_BUY', jo, planMaterials(jo, md), { ...opts, supplierNames: (k) => (k === 'RAW_MATERIAL:r1' ? ['Fibre Co', 'Coir Hub'] : []) });
    expect(withSup.tables[0]!.rows[0]![5]).toBe('Fibre Co, Coir Hub');
    expect(withSup.tables[0]!.columns.map((c) => c.label)).toContain('Suppliers');
    expect(m.title).toBe('To Buy');
  });
  it('all-orders To buy flags incomplete orders', () => {
    const m = toBuyAllDoc([], ['JO-7'], { ...opts, includeDrafts: false });
    expect(m.provisional).toBe(true);
    expect(m.provisionalReasons[0]).toContain('JO-7');
  });
  it('keeps PDF text and file names safe', () => {
    expect(pdfSafe('A → B — “x” ½ 40×60 മാറ്റ്')).toBe('A -> B - "x" ½ 40×60 ?');
    expect(safeFileName('JO 1042/A')).toBe('JO-1042-A');
  });
});

describe('PDF output', () => {
  it('renders a real A4 PDF with every section', async () => {
    const blob = await renderPdf(planDoc('TO_BUY', jo, planMaterials(jo, md), opts));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toMatch(/MediaBox \[0 0 595\.2\d* 841\.8\d*\]/); // A4
    expect(bytes.length).toBeGreaterThan(2000);
  });
});
