import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { fileKind, readXlsx } from '../../src/lib/importRead';
import { extractRows, findHeaderRow, findOrderFields, guessColumns } from '../../src/lib/joImport';

async function sampleXlsx(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Planning').addRow(['not this one']);
  const ws = wb.addWorksheet('WO Details');
  ws.addRow(['Customer', 'Buyer A (sample)']);
  ws.mergeCells('B1:C1');
  ws.addRow(['WO No', 'WO 12/2026']);
  ws.addRow(['Cargo ready date', new Date(Date.UTC(2026, 9, 10))]);
  ws.addRow([]);
  ws.addRow(['CODE', 'ITEM DESCRIPTION', 'QTY (NOS)', 'RATE']);
  ws.addRow(['1001', 'Mat (sample)', 2190, 3.1]);
  ws.addRow(['1002', 'Rug (sample)', { formula: 'C6/2', result: 1095 }, 4]);
  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

describe('Reading an Excel order file', () => {
  it('reads every sheet as text: dates as YYYY-MM-DD, formulas as results, merged text once', async () => {
    const sheets = await readXlsx(await sampleXlsx());
    expect(sheets.map((s) => s.name)).toEqual(['Planning', 'WO Details']);
    const g = sheets[1]!.grid;
    expect(g[0]).toEqual(['Customer', 'Buyer A (sample)']);
    expect(g[2]).toEqual(['Cargo ready date', '2026-10-10']);
    expect(g[6]).toEqual(['1002', 'Rug (sample)', '1095', '4']);
    const h = findHeaderRow(g)!;
    const rows = extractRows(g, h, guessColumns(g[h]!), 'pcs');
    expect(rows.map((r) => [r.name, r.qty])).toEqual([
      ['Mat (sample)', 2190],
      ['Rug (sample)', 1095],
    ]);
    expect(findOrderFields(g, h).deliveryDate?.value).toBe('2026-10-10');
  });
  it('knows the file kinds', () => {
    expect(fileKind({ name: 'wo.XLSX', type: '' })).toBe('xlsx');
    expect(fileKind({ name: 'wo.xls', type: '' })).toBe('old-excel');
    expect(fileKind({ name: 'wo.csv', type: '' })).toBe('csv');
    expect(fileKind({ name: 'IMG_1.jpg', type: 'image/jpeg' })).toBe('photo');
  });
});
