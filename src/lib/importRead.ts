/**
 * Reads an order file on the phone (nothing is uploaded): Excel (.xlsx) with
 * exceljs, CSV as text, a photo with Tesseract (on-device OCR). The engines are
 * loaded on first use. The text read from a photo must be checked row by row.
 */
import { parseCsv, textToGrid, type Grid } from './joImport';

export interface ReadSheet {
  name: string;
  grid: Grid;
}

const MAX_ROWS = 2000;
const MAX_COLS = 60;
const pad = (n: number) => String(n).padStart(2, '0');

function isoDay(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** One cell as text: dates as YYYY-MM-DD, formulas as their result, numbers unformatted. */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return isoDay(v);
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'object') {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown; error?: unknown };
    if ('result' in o) return cellText(o.result);
    if (o.richText) return o.richText.map((x) => x.text).join('').trim();
    if ('text' in o) return cellText(o.text);
    if ('error' in o) return '';
  }
  return String(v);
}

export async function readXlsx(data: ArrayBuffer): Promise<ReadSheet[]> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  return wb.worksheets
    .filter((ws) => ws.state !== 'hidden' && ws.state !== 'veryHidden')
    .map((ws) => {
      const grid: Grid = [];
      const rows = Math.min(ws.rowCount, MAX_ROWS);
      const cols = Math.min(ws.columnCount, MAX_COLS);
      for (let r = 1; r <= rows; r++) {
        const row = ws.getRow(r);
        const out: string[] = [];
        for (let c = 1; c <= cols; c++) {
          const cell = row.getCell(c);
          // A merged area keeps its text in the first cell only (no repeated labels).
          out.push(cell.isMerged && cell.master !== cell ? '' : cellText(cell.value));
        }
        while (out.length && !out[out.length - 1]) out.pop();
        grid.push(out);
      }
      return { name: ws.name, grid };
    });
}

export type FileKind = 'xlsx' | 'csv' | 'photo' | 'old-excel' | 'unknown';

export function fileKind(f: { name: string; type: string }): FileKind {
  const n = f.name.toLowerCase();
  if (n.endsWith('.xlsx') || n.endsWith('.xlsm') || f.type.includes('spreadsheetml')) return 'xlsx';
  if (n.endsWith('.xls') || f.type === 'application/vnd.ms-excel') return 'old-excel';
  if (n.endsWith('.csv') || n.endsWith('.txt') || f.type === 'text/csv' || f.type === 'text/plain') return 'csv';
  if (f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/.test(n)) return 'photo';
  return 'unknown';
}

/** Excel / CSV → sheets. A message the user can act on for anything else. */
export async function readSheetFile(file: File): Promise<ReadSheet[]> {
  const kind = fileKind(file);
  if (kind === 'xlsx') return readXlsx(await file.arrayBuffer());
  if (kind === 'csv') return [{ name: file.name.replace(/\.[^.]+$/, ''), grid: parseCsv(await file.text()).slice(0, MAX_ROWS) }];
  if (kind === 'old-excel') throw new Error('This is an old Excel file (.xls). Open it in Excel or Google Sheets and save it as .xlsx or CSV, then choose it again.');
  if (kind === 'photo') throw new Error('This is a photo: use "From a photo".');
  throw new Error('Choose an Excel (.xlsx) or CSV file.');
}

/** Photo → text on the phone (Tesseract, English). The engine (~10 MB) is downloaded once and kept by the browser. */
export async function readPhoto(file: File, onProgress: (p: { status: string; progress: number }) => void): Promise<ReadSheet[]> {
  const { createWorker, PSM } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, { logger: (m: { status: string; progress: number }) => onProgress(m) });
  try {
    await worker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    const { data } = await worker.recognize(file);
    return [{ name: 'Photo', grid: textToGrid(data.text) }];
  } finally {
    await worker.terminate();
  }
}
