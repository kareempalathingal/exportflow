/**
 * Job Order import (confirmed 5 Nov 2026, mockup canvas "JO import · Excel and
 * photo"): any Excel / CSV layout, or a photo read on the phone. The app guesses
 * which column is what from the headings; the user corrects it once and the
 * layout is remembered on the phone. Every product is matched against Masters
 * (or created); the result only fills the normal "New Job Order" form, which the
 * user saves as a draft. Prices are never read. Pure functions, no I/O.
 */
import { normalizeName } from './masters';

/** A sheet as text cells (dates already as YYYY-MM-DD). */
export type Grid = string[][];

export type ItemField = 'name' | 'code' | 'size' | 'qty' | 'unit' | 'pack';
export type OrderField = 'joNumber' | 'customer' | 'poNumber' | 'receivedDate' | 'deliveryDate';
export type ColumnMap = Record<ItemField, number | null>;
export interface CellRef {
  r: number; // 0-based
  c: number;
}

export const ITEM_FIELDS: { id: ItemField; label: string }[] = [
  { id: 'name', label: 'Product name' },
  { id: 'code', label: 'Item code' },
  { id: 'size', label: 'Size' },
  { id: 'qty', label: 'Quantity' },
  { id: 'unit', label: 'Unit' },
  { id: 'pack', label: 'Pack quantity' },
];
export const ORDER_FIELDS: { id: OrderField; label: string }[] = [
  { id: 'joNumber', label: 'JO / WO number' },
  { id: 'customer', label: 'Customer' },
  { id: 'poNumber', label: 'Buyer PO' },
  { id: 'receivedDate', label: 'Received / issued' },
  { id: 'deliveryDate', label: 'Delivery / cargo ready' },
];

/** A remembered layout (kept on the phone). */
export interface ImportLayout {
  id: string;
  name: string;
  sheet: string;
  headerRow: number;
  headers: string[];
  columns: ColumnMap;
  /** Unit for every row when the sheet has no unit column (e.g. from "QTY (NOS)"). */
  unit: string | null;
  orderCells: Partial<Record<OrderField, CellRef>>;
  uses: number;
  lastUsed: string;
}

const norm = (s: string) => normalizeName(s.replace(/[×*]/g, 'x').replace(/\s*x\s*(?=\d)/g, 'x'));

// ---------------------------------------------------------------------------
// Headings

/** Price / money columns: never read (confirmed). */
export const PRICE_HEADING = /price|rate|amount|value|\bfob\b|\bcif\b|\busd\b|\binr\b|\beur\b|cost|\$|₹|€/i;

const HEADING: [ItemField, RegExp][] = [
  ['pack', /pack|inner|per\s*(carton|ctn|box)|\/\s*ctn|\bctn\b|carton/i],
  ['code', /code|\bart(icle)?\.?\s*(no|#)|\bitem\s*(no|#)|\bsku\b|\bref\b|style\s*no/i],
  ['unit', /^\s*(unit|uom|u\/m)\b/i],
  ['size', /size|dimension|\bdim\b/i],
  ['qty', /qty|quantity|\bnos\b|\bpcs\b|order\s*(qty|quantity)/i],
  ['name', /desc|item|product|article|particular|design|quality|name|mat\b/i],
];

/** Guesses the item columns from a heading row; price columns are left out. */
export function guessColumns(header: string[]): ColumnMap {
  const map: ColumnMap = { name: null, code: null, size: null, qty: null, unit: null, pack: null };
  const used = new Set<number>();
  for (const [field, re] of HEADING) {
    const c = header.findIndex((h, i) => !used.has(i) && h.trim() !== '' && !PRICE_HEADING.test(h) && re.test(h));
    if (c >= 0) {
      map[field] = c;
      used.add(c);
    }
  }
  return map;
}

export function priceColumns(header: string[]): number[] {
  return header.flatMap((h, i) => (h.trim() && PRICE_HEADING.test(h) ? [i] : []));
}

/** The heading row: the one (in the first 40) naming the most item fields, with a name or quantity. */
export function findHeaderRow(grid: Grid): number | null {
  let best: { r: number; n: number } | null = null;
  for (let r = 0; r < Math.min(grid.length, 40); r++) {
    const m = guessColumns(grid[r] ?? []);
    const n = Object.values(m).filter((v) => v !== null).length;
    if ((m.name !== null || m.qty !== null) && n >= 2 && (!best || n > best.n)) best = { r, n };
  }
  return best?.r ?? null;
}

// ---------------------------------------------------------------------------
// Units, quantities, dates

const UNIT_WORDS: [RegExp, string][] = [
  [/^(nos?|pcs?|pieces?|numbers?|units?|ea|each)$/, 'pcs'],
  [/^(sq\.?\s?m(tr|trs|eters?|etres?)?|m2|m²|sqm)$/, 'sqm'],
  [/^(sq\.?\s?f(ee)?t|ft2|sqft)$/, 'sqft'],
  [/^(kgs?|kilos?|kilograms?)$/, 'kg'],
  [/^(doz|dozens?)$/, 'dozen'],
  [/^(m|mtrs?|meters?|metres?|rmt)$/, 'm'],
  [/^(tonnes?|tons?|mt)$/, 't'],
];

/** "NOS" → pcs, "Sq.M" → sq m … null when not known (the user chooses). */
export function unitFromText(s: string | undefined): string | null {
  const t = (s ?? '').toLowerCase().replace(/[()[\].]+$/g, '').replace(/^[([]/, '').trim();
  if (!t) return null;
  for (const [re, u] of UNIT_WORDS) if (re.test(t)) return u;
  return null;
}

/** A unit written in a heading, e.g. "QTY (NOS)" → pcs. */
export function unitInHeading(h: string | undefined): string | null {
  const m = /\(([^)]+)\)|\bin\s+(\w+)/i.exec(h ?? '');
  return unitFromText(m?.[1] ?? m?.[2]);
}

export interface QtyRead {
  qty: number | null;
  unit: string | null;
  /** Characters were guessed (photo: l → 1, O → 0 …): the user must check. */
  unclear: boolean;
}

const OCR_DIGIT: Record<string, string> = { l: '1', I: '1', '|': '1', i: '1', O: '0', o: '0', S: '5', s: '5', B: '8', Z: '2' };

/**
 * "2,190" / "2 190 pcs" → a number. From a photo (`ocr`), letters read inside
 * one number are fixed ("5l6" → 516) and marked unclear; never a silent guess.
 */
export function readQty(raw: string, ocr = false): QtyRead {
  const s = raw.trim();
  if (!s) return { qty: null, unit: null, unclear: false };
  const done = (digits: string, unit: string | undefined, unclear: boolean): QtyRead => {
    const d = digits.replace(/[\s\u202F\u00A0,]/g, '');
    if (!/^\d+(\.\d+)?$/.test(d)) return { qty: null, unit: null, unclear: true };
    const qty = Number(d);
    return { qty: qty > 0 ? qty : null, unit: unitFromText(unit), unclear: unclear || qty <= 0 };
  };
  const plain = /^(\d[\d.,\s\u202F\u00A0]*?)\s*([A-Za-z][A-Za-z.²]*)?$/.exec(s);
  if (plain) return done(plain[1]!, plain[2], false);
  if (ocr) {
    const m = /^([0-9lIi|OoSsBZ.,]*\d[0-9lIi|OoSsBZ.,]*)(?:\s+([A-Za-z][A-Za-z.²]*))?$/.exec(s);
    if (m) return done(m[1]!.replace(/[lIi|OoSsBZ]/g, (ch) => OCR_DIGIT[ch] ?? ch), m[2], true);
  }
  return { qty: null, unit: null, unclear: true };
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, '0');
function ymd(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** Dates as written in India: 05/11/2026, 5-11-26, 05.11.2026, 5 Nov 2026, 5-Nov-26, 2026-11-05 (day first). */
export function readDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return ymd(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(s);
  if (m) return ymd(+m[3]!, +m[2]!, +m[1]!);
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s./-]*([A-Za-z]{3,9})[\s.,/-]*(\d{2}|\d{4})$/.exec(s);
  if (m && MONTHS[m[2]!.slice(0, 4).toLowerCase()] !== undefined) return ymd(+m[3]!, MONTHS[m[2]!.slice(0, 4).toLowerCase()]!, +m[1]!);
  if (m && MONTHS[m[2]!.slice(0, 3).toLowerCase()] !== undefined) return ymd(+m[3]!, MONTHS[m[2]!.slice(0, 3).toLowerCase()]!, +m[1]!);
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  const mo = m ? (MONTHS[m[1]!.slice(0, 4).toLowerCase()] ?? MONTHS[m[1]!.slice(0, 3).toLowerCase()]) : undefined;
  if (m && mo !== undefined) return ymd(+m[3]!, mo, +m[2]!);
  return null;
}

// ---------------------------------------------------------------------------
// Order details (label → value next to it)

const LABEL: [OrderField, RegExp][] = [
  ['poNumber', /\b(buyer'?s?\s*)?p\.?\s?o\.?\b|purchase\s*order|order\s*ref/i],
  ['joNumber', /\b(w\.?\s?o|j\.?\s?o)\.?\b|work\s*order|job\s*order|\bwo#|\bjo#/i],
  ['deliveryDate', /deliver|cargo|ready|ship|dispatch|\betd\b|ex[\s.-]?factory|due\s*date/i],
  ['receivedDate', /issue|received|order\s*date|wo\s*date|jo\s*date|date\s*of\s*order|^\s*date\s*:?\s*$/i],
  ['customer', /customer|buyer|client|consignee|party/i],
];

function valueAt(grid: Grid, r: number, c: number): { value: string; at: CellRef } | null {
  const cell = grid[r]?.[c] ?? '';
  const after = /[:#-]\s*(.+)$/.exec(cell);
  // "WO No: 95" in one cell
  if (after && after[1]!.trim() && cell.indexOf(after[0]) > 1) return { value: after[1]!.trim(), at: { r, c } };
  for (let k = c + 1; k <= c + 3; k++) {
    const v = (grid[r]?.[k] ?? '').trim();
    if (v && v !== ':') return { value: v, at: { r, c: k } };
  }
  const below = (grid[r + 1]?.[c] ?? '').trim();
  return below ? { value: below, at: { r: r + 1, c } } : null;
}

export type OrderValues = Partial<Record<OrderField, { value: string; at: CellRef }>>;

/** Order details found above the item rows (or anywhere when there is no heading row). */
export function findOrderFields(grid: Grid, headerRow: number | null): OrderValues {
  const out: OrderValues = {};
  const used = new Set<string>(); // cells already taken as a value are not labels
  const last = headerRow ?? Math.min(grid.length, 40);
  const onlyLabel = (v: string) => LABEL.some(([, re]) => re.test(v) && !v.replace(re, '').replace(/\b(no|number|name|date|ref)\b|[:#.\s]/gi, ''));
  for (let r = 0; r < last; r++) {
    (grid[r] ?? []).forEach((cell, c) => {
      const t = cell.trim();
      if (!t || t.length > 40 || used.has(`${r}:${c}`)) return;
      const label = t.replace(/[:#-]\s*.+$/, '');
      for (const [field, re] of LABEL) {
        if (!re.test(label)) continue;
        if (out[field]) break;
        // "Buyer PO" is the PO, not the customer; a WO date is not the WO number.
        if (field === 'customer' && LABEL[0]![1].test(label)) continue;
        if (field === 'joNumber' && /date/i.test(label)) continue;
        if ((field === 'receivedDate' || field === 'deliveryDate') && !/date|ready|deliver|ship|etd|dispatch/i.test(label)) continue;
        const v = valueAt(grid, r, c);
        if (v && !onlyLabel(v.value)) {
          out[field] = v;
          used.add(`${v.at.r}:${v.at.c}`);
        }
        break;
      }
    });
  }
  return out;
}

/** Reads a remembered cell (layout). */
export function orderFromCells(grid: Grid, cells: Partial<Record<OrderField, CellRef>>): OrderValues {
  const out: OrderValues = {};
  for (const [k, at] of Object.entries(cells) as [OrderField, CellRef][]) {
    const v = (grid[at.r]?.[at.c] ?? '').trim();
    const after = /[:#]\s*(.+)$/.exec(v);
    if (v) out[k] = { value: after ? after[1]!.trim() : v, at };
  }
  return out;
}

export function cellName(at: CellRef): string {
  let c = at.c;
  let s = '';
  do {
    s = String.fromCharCode(65 + (c % 26)) + s;
    c = Math.floor(c / 26) - 1;
  } while (c >= 0);
  return `${s}${at.r + 1}`;
}
export const colName = (c: number) => cellName({ r: 0, c }).replace(/\d+$/, '');

// ---------------------------------------------------------------------------
// Item rows

export interface ImportRow {
  /** 1-based row in the sheet (or line of the photo text). */
  row: number;
  name: string;
  code: string;
  size: string;
  qtyText: string;
  qty: number | null;
  unit: string | null;
  pack: string;
  unclear: boolean;
}

const TOTAL_ROW = /\b(grand\s*)?total\b|\bsub\s*total\b/i;

/** Item rows under the heading; blank rows and total rows are left out. */
export function extractRows(grid: Grid, headerRow: number | null, cols: ColumnMap, fixedUnit: string | null, fromPhoto = false): ImportRow[] {
  const out: ImportRow[] = [];
  const get = (r: string[], c: number | null) => (c === null ? '' : (r[c] ?? '').trim());
  for (let r = (headerRow ?? -1) + 1; r < grid.length; r++) {
    const cells = grid[r] ?? [];
    if (cells.every((x) => !x.trim())) continue;
    if (cells.some((x) => TOTAL_ROW.test(x))) continue;
    const name = get(cells, cols.name);
    const qtyText = get(cells, cols.qty);
    if (!name && !qtyText) continue;
    const q = readQty(qtyText, fromPhoto);
    if (!name && q.qty === null) continue;
    out.push({
      row: r + 1,
      name,
      code: get(cells, cols.code),
      size: get(cells, cols.size),
      qtyText,
      qty: q.qty,
      unit: unitFromText(get(cells, cols.unit)) ?? q.unit ?? fixedUnit,
      pack: get(cells, cols.pack),
      unclear: q.unclear || (fromPhoto && q.qty === null),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Product matching

export interface MatchItem {
  id: string;
  name: string;
  code?: string;
  erpCode?: string;
  family?: string;
}

export type MatchBy = 'remembered' | 'code' | 'name';
export interface RowMatch {
  productId: string | null;
  by: MatchBy | null;
  /** Closest first (ids), for the "Match to a product" list. */
  candidates: string[];
}

/** The text remembered for "this text means that product". */
export function aliasKey(row: Pick<ImportRow, 'name' | 'code' | 'size'>): string {
  return norm([row.code, row.name, row.size].filter(Boolean).join(' | '));
}

const words = (s: string) => new Set(norm(s).split(/[^a-z0-9.x]+/).filter((w) => w.length > 1 || /\d/.test(w)));

export function matchRow(row: Pick<ImportRow, 'name' | 'code' | 'size'>, items: MatchItem[], aliases: Record<string, string>): RowMatch {
  const ids = new Set(items.map((i) => i.id));
  const remembered = aliases[aliasKey(row)];
  const scored = rank(row, items);
  if (remembered && ids.has(remembered)) return { productId: remembered, by: 'remembered', candidates: scored };
  const code = norm(row.code);
  if (code) {
    const hit = items.filter((i) => norm(i.code ?? '') === code || norm(i.erpCode ?? '') === code);
    if (hit.length === 1) return { productId: hit[0]!.id, by: 'code', candidates: scored };
  }
  const full = norm([row.name, row.size].filter(Boolean).join(' '));
  const name = norm(row.name);
  const exact = items.filter((i) => norm(i.name) === name || (row.size && norm(i.name) === full));
  if (exact.length === 1) return { productId: exact[0]!.id, by: 'name', candidates: scored };
  return { productId: null, by: null, candidates: scored };
}

/** Closest products by shared words (a size like 45x75 counts double). */
function rank(row: Pick<ImportRow, 'name' | 'code' | 'size'>, items: MatchItem[]): string[] {
  const want = words([row.name, row.size, row.code].join(' '));
  if (want.size === 0) return [];
  return items
    .map((i) => {
      const have = words([i.name, i.family ?? '', i.code ?? '', i.erpCode ?? ''].join(' '));
      let s = 0;
      for (const w of want) if (have.has(w)) s += /\d+x\d+/.test(w) ? 2 : 1;
      return { id: i.id, s, name: i.name };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.name.localeCompare(b.name))
    .slice(0, 8)
    .map((x) => x.id);
}

/** Customer by name (exact, then one that contains the text or the other way round). */
export function matchCustomer(text: string, customers: { id: string; name: string }[]): string | null {
  const t = norm(text);
  if (!t) return null;
  const exact = customers.filter((c) => norm(c.name) === t);
  if (exact.length === 1) return exact[0]!.id;
  const part = customers.filter((c) => norm(c.name).includes(t) || t.includes(norm(c.name)));
  return part.length === 1 ? part[0]!.id : null;
}

// ---------------------------------------------------------------------------
// Totals, layouts, text sources

/** "3 items · 3 570 pcs + 120 sq m": totals only within one unit. */
export function totalsByUnit(rows: { qty: number | null; unit: string | null }[]): { unit: string; qty: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) if (r.qty !== null && r.unit) m.set(r.unit, (m.get(r.unit) ?? 0) + r.qty);
  return [...m].map(([unit, qty]) => ({ unit, qty }));
}

/** A remembered layout that fits this file: same sheet name and the same headings in the same row. */
export function findLayout(layouts: ImportLayout[], sheets: { name: string; grid: Grid }[]): { layout: ImportLayout; sheet: number } | null {
  for (const l of [...layouts].sort((a, b) => b.lastUsed.localeCompare(a.lastUsed))) {
    const idx = sheets.findIndex((s) => norm(s.name) === norm(l.sheet) || sheets.length === 1);
    if (idx < 0) continue;
    const row = (sheets[idx]!.grid[l.headerRow] ?? []).map(norm);
    if (l.headers.length && l.headers.every((h, i) => !h || row[i] === h)) return { layout: l, sheet: idx };
  }
  return null;
}

/** Simple CSV (quotes, commas / semicolons / tabs). */
export function parseCsv(text: string): Grid {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = [',', ';', '\t'].map((d) => ({ d, n: first.split(d).length })).sort((a, b) => b.n - a.n)[0]!.d;
  const rows: Grid = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) endCell();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endCell();
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell || row.length) {
    endCell();
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim()));
}

/** Text read from a photo → rows; columns where there are 2+ spaces or a tab. */
export function textToGrid(text: string): Grid {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/\t| {2,}|\s\|\s/).map((c) => c.trim()));
}

export interface ImportedLine {
  productId: string;
  qty: number;
  unit: string;
}

/** Note on the draft: where it came from and the pack quantities (no field for them yet). */
export function importNote(fileName: string, today: string, packs: { name: string; pack: string }[]): string {
  const p = packs.filter((x) => x.pack);
  return [`Imported from ${fileName} on ${today} - check against the original.`, p.length ? `Pack quantity (as on the order): ${p.map((x) => `${x.name} ${x.pack}`).join(' · ')}` : ''].filter(Boolean).join('\n');
}
