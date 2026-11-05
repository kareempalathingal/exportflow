import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import type { DocModel } from '../../src/lib/docs/model';
import { cellValue, docSheets, renderXlsx, sheetName, xlsxFileName } from '../../src/lib/docs/xlsx';

const model: DocModel = {
  title: 'Production Plan',
  reference: 'JO-101',
  company: 'Acme Coir',
  banner: 'PRODUCTION PLAN',
  meta: [
    ['Customer', 'Buyer A'],
    ['Delivery', '10 Oct 2026'],
  ],
  tables: [
    { title: 'Products', columns: [{ label: 'Product' }, { label: 'Quantity', align: 'right' }, { label: 'Ready' }], rows: [['Mat 40 × 60', '12 345', '26 Sept 2026']], empty: 'None' },
    { title: 'Products', columns: [{ label: 'X' }], rows: [], empty: 'Nothing to buy' },
  ],
  stepRoads: { title: 'Steps for each product', afterTables: 1, counts: [], note: '', items: [{ name: 'Mat 40 × 60', sub: '', badge: { text: '', tone: 'ok' }, reached: 0, dashed: false, nodes: [{ label: 'Printing', sub: '', dates: '17 Sep → 26 Sep', state: 'now', overDays: 2 }], ready: { text: 'Ready 28 Sep', tone: 'ok' } }] },
  notes: ['Working days: Sunday off.'],
  provisional: false,
  provisionalReasons: [],
  generatedAt: '5 Nov 2026, 10:00 am IST',
  fileName: 'plan_JO-101.pdf',
};

describe('Excel copy of a document', () => {
  it('turns plain numbers, percents and dates into real values; keeps the rest as text', () => {
    expect(cellValue('12 345.5')).toEqual({ t: 'num', v: 12345.5 });
    expect(cellValue('1,23,456')).toEqual({ t: 'num', v: 123456 });
    expect(cellValue('85%')).toEqual({ t: 'pct', v: 0.85 });
    expect(cellValue('05 Nov 2026')).toEqual({ t: 'date', v: new Date(Date.UTC(2026, 10, 5)) });
    expect(cellValue('26 Sept 2026')).toEqual({ t: 'date', v: new Date(Date.UTC(2026, 8, 26)) });
    expect(cellValue('120 kg').t).toBe('text');
    expect(cellValue('007').t).toBe('text'); // codes with a leading zero stay text
    expect(cellValue('31 Feb 2026').t).toBe('text');
  });
  it('makes an About sheet, one sheet per table (unique names) and the step cards in their place', () => {
    const s = docSheets(model);
    expect(s.map((x) => x.name)).toEqual(['About', 'Products', 'Steps for each product', 'Products (2)']);
    expect(s[0]!.rows.some((r) => r[0]?.v === 'Delivery' && r[1]?.t === 'date')).toBe(true);
    expect(s[1]!.rows[1]!.map((c) => c.t)).toEqual(['text', 'num', 'date']);
    expect(s[2]!.rows[1]!.map((c) => c.v)).toEqual(['Mat 40 × 60', 'Printing', '17 Sep → 26 Sep', 'now · 2 days over']);
    expect(s[3]!.rows[1]![0]!.v).toBe('Nothing to buy');
  });
  it('limits sheet names to 31 characters without forbidden signs', () => {
    const used = new Set<string>();
    expect(sheetName('Raw materials to buy for production: [all]', used)).toBe('Raw materials to buy for produc');
    expect(sheetName('Raw materials to buy for production: [all]', used)).toHaveLength(31);
    expect(xlsxFileName('plan_JO-101.pdf')).toBe('plan_JO-101.xlsx');
  });
  it('writes a real .xlsx that opens again with the same values', async () => {
    const blob = await renderXlsx(model);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    expect(wb.worksheets.map((w) => w.name)).toEqual(['About', 'Products', 'Steps for each product', 'Products (2)']);
    const p = wb.getWorksheet('Products')!;
    expect(p.getCell('B2').value).toBe(12345);
    expect(p.getCell('C2').value).toEqual(new Date(Date.UTC(2026, 8, 26)));
  });
});
