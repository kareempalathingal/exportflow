/**
 * Excel copy of any document (confirmed 5 Nov 2026): the same DocModel the PDF
 * is drawn from, so the Excel follows the chosen version ("to submit" /
 * "working"). One "About" sheet (title, reference, details, notes) and one
 * sheet per table, plus the step cards and the road map as plain tables.
 * Real numbers and dates where a cell is just a number / percent / date;
 * everything else stays text. No charts. exceljs is loaded on first use.
 */
import type { DocModel } from './model';

export type XCell = { t: 'text'; v: string } | { t: 'num'; v: number } | { t: 'pct'; v: number } | { t: 'date'; v: Date };

export interface XSheet {
  name: string;
  /** Rows of cells; the first row is the heading when `head` is true. */
  rows: XCell[][];
  head: boolean;
  /** Column widths in characters. */
  widths: number[];
  /** Right-aligned (number) columns. */
  right: boolean[];
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/** A PDF cell as an Excel value: "12 345.5" → 12345.5, "85%" → 0.85, "05 Nov 2026" → a date; otherwise text. */
export function cellValue(raw: string): XCell {
  const s = raw.trim();
  const plain = s.replace(/[\u202F\u00A0\u2009 ,]/g, '');
  if (/^-?\d+(\.\d+)?$/.test(plain) && !/^-?0\d/.test(plain) && plain.replace(/^-/, '').length <= 15) return { t: 'num', v: Number(plain) };
  const pct = /^(-?\d+(?:\.\d+)?)\s?%$/.exec(plain);
  if (pct) return { t: 'pct', v: Number(pct[1]) / 100 };
  const d = /^(\d{1,2}) ([A-Za-z]{3,4}) (\d{4})$/.exec(s);
  if (d && MONTHS[d[2]!.toLowerCase()] !== undefined) {
    const date = new Date(Date.UTC(Number(d[3]), MONTHS[d[2]!.toLowerCase()]!, Number(d[1])));
    if (date.getUTCDate() === Number(d[1])) return { t: 'date', v: date };
  }
  return { t: 'text', v: s };
}

const text = (v: string): XCell => ({ t: 'text', v });

/** Excel sheet names: at most 31 characters, none of []:*?/\, unique. */
export function sheetName(title: string, used: Set<string>): string {
  const base = (title.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'Sheet').slice(0, 31);
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 31 - ` (${i})`.length)} (${i})`;
  used.add(name.toLowerCase());
  return name;
}

function widthsOf(rows: XCell[][]): number[] {
  const n = Math.max(0, ...rows.map((r) => r.length));
  return Array.from({ length: n }, (_, c) => Math.min(60, Math.max(8, ...rows.map((r) => (r[c] ? (r[c]!.t === 'text' ? (r[c]!.v as string).length : 12) : 0) + 2))));
}

/** The sheets of a document, without exceljs (tested). */
export function docSheets(model: DocModel): XSheet[] {
  const used = new Set<string>();
  const about: XCell[][] = [[text(model.title)], [text(model.reference)]];
  if (model.company) about.push([text('Company'), text(model.company)]);
  if (model.banner) about.push([text(model.banner)]);
  about.push([]);
  for (const [k, v] of model.meta) about.push([text(k), cellValue(v)]);
  if (model.roadMap?.summary) about.push([], [text('In short'), text(model.roadMap.summary)]);
  if (model.provisional && model.provisionalReasons.length) {
    about.push([], [text('PROVISIONAL - data still missing')]);
    for (const r of model.provisionalReasons) about.push([text(''), text(r)]);
  }
  if (model.notes.length) {
    about.push([], [text('Notes')]);
    for (const n of model.notes) about.push([text(''), text(n)]);
  }
  if (model.signature) about.push([], [text('Prepared by'), text([model.signature.preparedBy, model.signature.designation].filter(Boolean).join(', '))], [text('Date'), cellValue(model.signature.date)], [text('Reviewed / approved by'), text('')]);
  about.push([], [text('Made'), text(model.generatedAt)]);
  const sheets: XSheet[] = [{ name: sheetName('About', used), rows: about, head: false, widths: [24, 70], right: [] }];

  if (model.roadMap && model.roadMap.stops.length) {
    const rows: XCell[][] = [['Stage', 'Date', 'Note'].map(text), ...model.roadMap.stops.map((s) => [text(s.label), cellValue(s.date), text(s.note)])];
    sheets.push({ name: sheetName(model.roadMap.title || 'Key dates', used), rows, head: true, widths: widthsOf(rows), right: [] });
  }

  const tableSheets = model.tables.map((t) => {
    const head = !t.noHead && t.columns.length > 0;
    const rows: XCell[][] = [...(head ? [t.columns.map((c) => text(c.label))] : []), ...t.rows.map((r) => r.map(cellValue))];
    if (t.rows.length === 0) rows.push([text(t.empty)]);
    return { name: sheetName(t.title, used), rows, head, widths: widthsOf(rows), right: t.columns.map((c) => c.align === 'right') };
  });
  const roads = model.stepRoads;
  const at = roads ? Math.min(roads.afterTables, tableSheets.length) : tableSheets.length;
  sheets.push(...tableSheets.slice(0, at));
  if (roads && roads.items.length) {
    const rows: XCell[][] = [['Product', 'Step', 'Dates', 'Status'].map(text)];
    for (const it of roads.items) {
      for (const n of it.nodes) rows.push([text(it.name), text(n.sub ? `${n.label} (${n.sub})` : n.label), text(n.dates), text(n.overDays > 0 ? `${n.state} · ${n.overDays} days over` : n.state)]);
      rows.push([text(it.name), text('Ready'), text(it.ready.text), text('')]);
    }
    sheets.push({ name: sheetName(roads.title || 'Steps', used), rows, head: true, widths: widthsOf(rows), right: [] });
  }
  sheets.push(...tableSheets.slice(at));
  return sheets;
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function xlsxFileName(pdfName: string): string {
  return pdfName.replace(/\.pdf$/i, '') + '.xlsx';
}

/** Builds the .xlsx file on the phone. */
export async function renderXlsx(model: DocModel): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ExportFlow';
  wb.created = new Date();
  for (const sh of docSheets(model)) {
    const ws = wb.addWorksheet(sh.name, sh.head ? { views: [{ state: 'frozen', ySplit: 1 }] } : {});
    sh.rows.forEach((r, i) => {
      const row = ws.addRow(r.map((c) => c.v));
      r.forEach((c, j) => {
        const cell = row.getCell(j + 1);
        if (c.t === 'pct') cell.numFmt = '0%';
        if (c.t === 'date') cell.numFmt = 'dd mmm yyyy';
        if (c.t === 'num' && !Number.isInteger(c.v)) cell.numFmt = '#,##0.###';
        if (c.t === 'num' && Number.isInteger(c.v) && Math.abs(c.v) >= 10000) cell.numFmt = '#,##0';
        if (sh.right[j] && i > 0) cell.alignment = { horizontal: 'right' };
        if (c.t === 'text') cell.alignment = { ...(cell.alignment ?? {}), wrapText: c.v.length > 60, vertical: 'top' };
      });
      if (sh.head && i === 0) row.font = { bold: true };
    });
    if (!sh.head && sh.rows[0]) ws.getRow(1).font = { bold: true, size: 14 };
    sh.widths.forEach((w, j) => (ws.getColumn(j + 1).width = w));
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: XLSX_MIME });
}
