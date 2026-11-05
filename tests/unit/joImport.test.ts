import { describe, expect, it } from 'vitest';
import {
  aliasKey,
  cellName,
  extractRows,
  findHeaderRow,
  findLayout,
  findOrderFields,
  guessColumns,
  importNote,
  matchCustomer,
  matchRow,
  parseCsv,
  priceColumns,
  readDate,
  readQty,
  textToGrid,
  totalsByUnit,
  unitFromText,
  unitInHeading,
  type Grid,
  type ImportLayout,
} from '../../src/lib/joImport';

// A made-up order sheet (sample data only).
const sheet: Grid = [
  ['', 'WORK ORDER', '', '', '', '', ''],
  ['', 'Customer', 'Buyer A (sample)', '', '', '', ''],
  ['', 'WO No', 'WO 12/2026', '', 'Buyer PO', 'PO-778', ''],
  ['', 'Issued date', '08/09/2026', '', '', '', ''],
  ['', 'Cargo ready date', '10-Oct-26', '', '', '', ''],
  [],
  ['CODE', 'ITEM DESCRIPTION', 'SIZE (CM)', 'COLOUR', 'QTY (NOS)', 'RATE USD', 'PACK QUANTITY'],
  ['1001', 'Tufted mat printed (sample)', '40x60', 'Natural', '2,190', '3.10', '15'],
  ['1002', 'Tufted mat shaped (sample)', '45x75', 'Natural', '864', '4.20', '12'],
  [],
  ['', 'TOTAL', '', '', '3,054', '', ''],
];

describe('JO import: headings and order details', () => {
  it('finds the heading row and guesses the columns; price columns are never mapped', () => {
    const h = findHeaderRow(sheet);
    expect(h).toBe(6);
    const cols = guessColumns(sheet[6]!);
    expect(cols).toEqual({ code: 0, name: 1, size: 2, qty: 4, unit: null, pack: 6 });
    expect(priceColumns(sheet[6]!)).toEqual([5]);
    expect(unitInHeading('QTY (NOS)')).toBe('pcs');
  });
  it('finds order details next to their labels, with the cell', () => {
    const o = findOrderFields(sheet, 6);
    expect(o.customer?.value).toBe('Buyer A (sample)');
    expect(o.joNumber?.value).toBe('WO 12/2026');
    expect(o.poNumber?.value).toBe('PO-778');
    expect(o.receivedDate?.value).toBe('08/09/2026');
    expect(o.deliveryDate?.value).toBe('10-Oct-26');
    expect(cellName(o.joNumber!.at)).toBe('C3');
  });
  it('reads "Label: value" in one cell', () => {
    expect(findOrderFields([['WO No: 95'], ['Date: 05.11.2026']], null).joNumber?.value).toBe('95');
  });
});

describe('JO import: rows, quantities, units, dates', () => {
  it('takes the item rows, leaves out blank and total rows', () => {
    const rows = extractRows(sheet, 6, guessColumns(sheet[6]!), 'pcs');
    expect(rows.map((r) => [r.row, r.code, r.qty, r.unit, r.pack])).toEqual([
      [8, '1001', 2190, 'pcs', '15'],
      [9, '1002', 864, 'pcs', '12'],
    ]);
    expect(totalsByUnit(rows)).toEqual([{ unit: 'pcs', qty: 3054 }]);
  });
  it('reads quantities; photo letters are fixed only for photos and marked unclear', () => {
    expect(readQty('2 190 pcs')).toEqual({ qty: 2190, unit: 'pcs', unclear: false });
    expect(readQty('120 sqm')).toEqual({ qty: 120, unit: 'sqm', unclear: false });
    expect(readQty('5l6')).toEqual({ qty: null, unit: null, unclear: true });
    expect(readQty('5l6', true)).toEqual({ qty: 516, unit: null, unclear: true });
    expect(readQty('abc', true).qty).toBeNull();
    expect(readQty('0').unclear).toBe(true);
  });
  it('knows the usual unit words and never guesses others', () => {
    expect(['NOS', 'Pcs', 'Sq.M', 'SQM', 'kgs', 'Doz'].map(unitFromText)).toEqual(['pcs', 'pcs', 'sqm', 'sqm', 'kg', 'dozen']);
    expect(unitFromText('bale')).toBeNull();
  });
  it('reads Indian dates day first', () => {
    expect(readDate('08/09/2026')).toBe('2026-09-08');
    expect(readDate('5-11-26')).toBe('2026-11-05');
    expect(readDate('10-Oct-26')).toBe('2026-10-10');
    expect(readDate('26 Sept 2026')).toBe('2026-09-26');
    expect(readDate('Nov 5, 2026')).toBe('2026-11-05');
    expect(readDate('2026-11-05')).toBe('2026-11-05');
    expect(readDate('31/02/2026')).toBeNull();
    expect(readDate('PO-778')).toBeNull();
  });
});

describe('JO import: matching', () => {
  const items = [
    { id: 'p1', name: 'Tufted mat printed 40 × 60 (sample)', code: '', erpCode: '1001' },
    { id: 'p2', name: 'Tufted mat shaped 45 × 75 natural (sample)' },
    { id: 'p3', name: 'Woven mat 40 × 60 (sample)' },
  ];
  it('matches by remembered text, then code / ERP code, then exact name; else lists the closest', () => {
    expect(matchRow({ name: 'x', code: '1001', size: '' }, items, {})).toMatchObject({ productId: 'p1', by: 'code' });
    const shaped = { name: 'Tufted mat shaped', code: '', size: '45x75' };
    const m = matchRow(shaped, items, {});
    expect(m.productId).toBeNull();
    expect(m.candidates[0]).toBe('p2');
    expect(matchRow(shaped, items, { [aliasKey(shaped)]: 'p2' })).toMatchObject({ productId: 'p2', by: 'remembered' });
    expect(matchRow({ name: 'Woven mat 40 x 60 (sample)', code: '', size: '' }, items, {})).toMatchObject({ productId: 'p3', by: 'name' });
  });
  it('matches the customer by name', () => {
    const cs = [{ id: 'c1', name: 'Buyer A (sample)' }, { id: 'c2', name: 'Buyer B' }];
    expect(matchCustomer('buyer a (sample)', cs)).toBe('c1');
    expect(matchCustomer('Buyer', cs)).toBeNull();
  });
  it('uses a remembered layout when the same headings are in the same row', () => {
    const l: ImportLayout = { id: 'l1', name: 'Boss sheet', sheet: 'WO Details', headerRow: 6, headers: sheet[6]!.map((h) => h.toLowerCase()), columns: guessColumns(sheet[6]!), unit: 'pcs', orderCells: {}, uses: 1, lastUsed: '2026-11-01' };
    expect(findLayout([l], [{ name: 'Planning', grid: [] }, { name: 'WO Details', grid: sheet }])).toMatchObject({ sheet: 1 });
    expect(findLayout([l], [{ name: 'WO Details', grid: [['other']] }])).toBeNull();
  });
});

describe('JO import: CSV and photo text', () => {
  it('parses CSV with quotes and semicolons', () => {
    expect(parseCsv('a,"b, c",d\r\n1,"say ""hi""",3\n')).toEqual([
      ['a', 'b, c', 'd'],
      ['1', 'say "hi"', '3'],
    ]);
    expect(parseCsv('x;y\n1;2')).toEqual([
      ['x', 'y'],
      ['1', '2'],
    ]);
  });
  it('splits photo text into columns at 2+ spaces', () => {
    expect(textToGrid('ITEM   SIZE   QTY\nMat (sample)   40x60   5l6\n')).toEqual([
      ['ITEM', 'SIZE', 'QTY'],
      ['Mat (sample)', '40x60', '5l6'],
    ]);
  });
  it('notes where the draft came from and the pack quantities', () => {
    expect(importNote('wo.xlsx', '2026-11-05', [{ name: 'Mat', pack: '15' }, { name: 'Rug', pack: '' }])).toBe('Imported from wo.xlsx on 2026-11-05 - check against the original.\nPack quantity (as on the order): Mat 15');
  });
});
