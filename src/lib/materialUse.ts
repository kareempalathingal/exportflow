/**
 * Round 3 (18 Nov 2026): actual material use vs BOM. Entries per WO (date, made item, quantity made,
 * material used), compared with what the WO's BOMs need for that quantity. Quantities only (no prices).
 * The app never changes a BOM: the report only SUGGESTS a revision, the user decides.
 */
import type { JobOrder } from './jobOrders';
import { componentContext, explodeBom, lineComponent, needsBom, type ComponentType, type MasterData } from './masters';
import { bomsForJobOrder, itemKey } from './materials';
import { convert } from './units';

export interface UseLine {
  type: ComponentType;
  id: string;
  name: string;
  qty: number;
  unit: string;
}

export interface UseEntry {
  id: string;
  /** Production date (YYYY-MM-DD). */
  on: string;
  /** The item made (an ordered product or a made sub-product such as the base mat). */
  productId: string;
  productName: string;
  qty: number;
  unit: string;
  lines: UseLine[];
  note?: string;
  /** "Imported: <file>" or absent (entered by hand). */
  source?: string;
  at: string;
}

export interface UseRow {
  key: string;
  type: ComponentType;
  id: string;
  name: string;
  unit: string;
  /** What the BOM needs for the quantity made (incl. wastage); null = not in the BOM. */
  expected: number | null;
  /** What was entered, in the material's base unit; null = not entered. */
  actual: number | null;
  /** (actual − expected) ÷ expected × 100; null when one side is missing. */
  diffPct: number | null;
  problem?: string;
}

export interface UseComparison {
  rows: UseRow[];
  errors: string[];
  provisional: boolean;
}

export const newUseId = () => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const pct = (a: number, e: number) => (e > 0 ? ((a - e) / e) * 100 : null);

/** One entry against the BOMs of its WO (the copy saved at confirmation for confirmed WOs). */
export function compareEntry(e: Pick<UseEntry, 'productId' | 'qty' | 'unit' | 'lines'>, md: MasterData): UseComparison {
  const ex = explodeBom(e.productId, e.qty, e.unit, md);
  const rows = new Map<string, UseRow>();
  for (const l of ex.toBuy) rows.set(itemKey(l.type, l.id), { key: itemKey(l.type, l.id), type: l.type, id: l.id, name: l.name, unit: l.unit, expected: l.qty, actual: null, diffPct: null });
  for (const l of e.lines) {
    const k = itemKey(l.type, l.id);
    const comp = componentContext(l.type, l.id, md);
    const row = rows.get(k) ?? { key: k, type: l.type, id: l.id, name: comp?.name ?? l.name, unit: comp?.ctx.baseUnit ?? l.unit, expected: null, actual: null, diffPct: null };
    const c = comp ? convert(l.qty, l.unit, comp.ctx.baseUnit, comp.ctx) : null;
    if (!c || !c.ok) row.problem = comp ? `Conversion needed (${l.unit} → ${comp.ctx.baseUnit})` : 'Not in Masters';
    else row.actual = (row.actual ?? 0) + c.value;
    rows.set(k, row);
  }
  for (const r of rows.values()) r.diffPct = r.actual !== null && r.expected !== null ? pct(r.actual, r.expected) : null;
  return { rows: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name)), errors: ex.errors, provisional: ex.provisional };
}

export interface UseTotalRow extends UseRow {
  /** Entries in which this material has both sides (the totals count only these). */
  compared: number;
  /** Entries whose BOM needs it but nothing was entered. */
  notEntered: number;
}

export interface UseTotals {
  rows: UseTotalRow[];
  entries: number;
  errors: string[];
}

/** All entries of a WO added up per material (only entries where both figures exist). */
export function materialTotals(jo: Pick<JobOrder, 'materialUse' | 'status' | 'bomSnapshot'>, liveMd: MasterData): UseTotals {
  const md = bomsForJobOrder(jo, liveMd);
  const acc = new Map<string, UseTotalRow>();
  const errors = new Set<string>();
  for (const e of jo.materialUse ?? []) {
    const c = compareEntry(e, md);
    c.errors.forEach((x) => errors.add(x));
    for (const r of c.rows) {
      const t = acc.get(r.key) ?? { ...r, expected: r.expected === null ? null : 0, actual: r.actual === null ? null : 0, diffPct: null, compared: 0, notEntered: 0, problem: undefined };
      if (r.expected !== null && r.actual !== null) {
        t.expected = (t.expected ?? 0) + r.expected;
        t.actual = (t.actual ?? 0) + r.actual;
        t.compared++;
      } else if (r.expected !== null) {
        t.notEntered++;
        if (t.expected === null) t.expected = 0;
      } else if (r.actual !== null) {
        t.actual = (t.actual ?? 0) + r.actual; // not in the BOM: shown as used
      }
      if (r.problem) t.problem = r.problem;
      acc.set(r.key, t);
    }
  }
  const rows = [...acc.values()].map((t) => ({ ...t, diffPct: t.compared && t.expected !== null && t.actual !== null ? pct(t.actual, t.expected) : null }));
  return { rows: rows.sort((a, b) => a.name.localeCompare(b.name)), entries: (jo.materialUse ?? []).length, errors: [...errors] };
}

/** Colour of a difference by the user's own thresholds (Settings); none set = no colour. */
export function materialTone(diffPct: number | null, warnPct: number | null | undefined, badPct: number | null | undefined): 'ok' | 'warn' | 'bad' | null {
  if (diffPct === null || (warnPct === null || warnPct === undefined) && (badPct === null || badPct === undefined)) return null;
  const d = Math.abs(diffPct);
  if (badPct !== null && badPct !== undefined && d >= badPct) return 'bad';
  if (warnPct !== null && warnPct !== undefined && d >= warnPct) return 'warn';
  return 'ok';
}

export const diffText = (d: number | null) => (d === null ? '-' : `${d > 0 ? '+' : ''}${d.toFixed(1)}%`);

/** Products in the BOM tree under `rootId` whose own BOM lists the component directly. */
export function directParents(rootId: string, key: string, md: MasterData): string[] {
  const out = new Set<string>();
  const seen = new Set<string>();
  const walk = (pid: string) => {
    if (seen.has(pid)) return;
    seen.add(pid);
    for (const l of md.boms.get(pid)?.lines ?? []) {
      const { type, id } = lineComponent(l);
      if (itemKey(type, id) === key) out.add(pid);
      const sub = type === 'PRODUCT' ? md.products.get(id) : null;
      if (sub && needsBom(sub)) walk(id);
    }
  };
  walk(rootId);
  return [...out];
}

/** Benchmark-style rule (same as step benchmarks): at least 5 entries and a median difference of 15% or more. */
export const USE_SUGGEST_MIN = 5;
export const USE_SUGGEST_PCT = 15;

export interface UseReportRow {
  /** The BOM (product) whose line is compared. */
  parentId: string;
  parentName: string;
  parentUnit: string;
  key: string;
  material: string;
  unit: string;
  entries: number;
  wos: string[];
  /** Current BOM per parent unit, incl. wastage (live Masters). */
  bomPerUnit: number;
  /** Median of the actual use per parent unit. */
  actualPerUnit: number;
  diffPct: number | null;
  /** Suggested BOM line quantity (per parent unit, before wastage); only when the rule is met. */
  suggestedQty: number | null;
  wastagePct: number;
  /** Why no comparison is possible (e.g. used in two BOMs of the tree). */
  note?: string;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Across WOs: actual use per unit of the BOM that lists each material directly (e.g. kg of coir yarn per
 * sq m of base mat), against the current BOM. A suggestion is shown only when the rule above is met.
 */
export function materialUseReport(jos: (Pick<JobOrder, 'joNumber' | 'materialUse' | 'status'> & { id: string })[], md: MasterData): UseReportRow[] {
  const groups = new Map<string, { parentId: string; key: string; name: string; unit: string; per: number[]; wos: Set<string>; note?: string }>();
  for (const jo of jos) {
    if (jo.status === 'CANCELLED') continue;
    for (const e of jo.materialUse ?? []) {
      const ex = explodeBom(e.productId, e.qty, e.unit, md);
      for (const l of e.lines) {
        const key = itemKey(l.type, l.id);
        const comp = componentContext(l.type, l.id, md);
        if (!comp) continue;
        const parents = directParents(e.productId, key, md);
        if (parents.length !== 1) {
          const gk = `?|${key}`;
          if (parents.length > 1 && !groups.has(gk)) groups.set(gk, { parentId: '', key, name: comp.name, unit: comp.ctx.baseUnit, per: [], wos: new Set([jo.joNumber]), note: 'Listed in more than one BOM of this product: not compared' });
          continue;
        }
        const pid = parents[0]!;
        const parentQty = pid === e.productId ? ex.productBaseQty : (ex.toProduce.find((x) => x.type === 'PRODUCT' && x.id === pid)?.qty ?? null);
        const c = convert(l.qty, l.unit, comp.ctx.baseUnit, comp.ctx);
        if (!parentQty || !(parentQty > 0) || !c.ok) continue;
        const gk = `${pid}|${key}`;
        const g = groups.get(gk) ?? { parentId: pid, key, name: comp.name, unit: comp.ctx.baseUnit, per: [], wos: new Set<string>() };
        g.per.push(c.value / parentQty);
        g.wos.add(jo.joNumber);
        groups.set(gk, g);
      }
    }
  }
  const out: UseReportRow[] = [];
  for (const g of groups.values()) {
    const parent = md.products.get(g.parentId);
    const line = md.boms.get(g.parentId)?.lines.find((l) => {
      const { type, id } = lineComponent(l);
      return itemKey(type, id) === g.key;
    });
    const comp = line ? componentContext(lineComponent(line).type, lineComponent(line).id, md) : null;
    const perBase = line && comp ? convert(line.qty, line.unit, comp.ctx.baseUnit, comp.ctx) : null;
    const w = line && Number.isFinite(line.wastagePct) && line.wastagePct > 0 ? line.wastagePct : 0;
    const bomPerUnit = perBase?.ok ? perBase.value * (1 + w / 100) : 0;
    const actualPerUnit = g.per.length ? median(g.per) : 0;
    const diff = g.per.length && bomPerUnit > 0 ? pct(actualPerUnit, bomPerUnit) : null;
    const suggest = g.per.length >= USE_SUGGEST_MIN && diff !== null && Math.abs(diff) >= USE_SUGGEST_PCT;
    out.push({
      parentId: g.parentId,
      parentName: parent?.name ?? '-',
      parentUnit: parent?.baseUnit ?? '',
      key: g.key,
      material: g.name,
      unit: g.unit,
      entries: g.per.length,
      wos: [...g.wos].sort(),
      bomPerUnit,
      actualPerUnit,
      diffPct: diff,
      suggestedQty: suggest ? actualPerUnit / (1 + w / 100) : null,
      wastagePct: w,
      ...(g.note ? { note: g.note } : !line ? { note: 'Not in the current BOM' } : {}),
    });
  }
  return out.sort((a, b) => a.parentName.localeCompare(b.parentName) || a.material.localeCompare(b.material));
}

/* ---------- ERP production data (any sheet in the same block layout) ---------- */

export interface ParsedUse {
  joNo: string;
  on: string | null;
  widthCm: number | null;
  lengthCm: number | null;
  pcs: number | null;
  sqm: number | null;
  unit: string;
  materials: { name: string; qty: number }[];
}

const num = (s: string | undefined) => {
  if (!s) return null;
  const n = Number(s.replace(/[\s,]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * Reads blocks like the ERP "production data" sheet: a row with "WO | 12/2026" (one block per "WO" label),
 * then "Production Date", "Size- Cm | W | L" (values on the next row), "Quantity -Pcs", "Sq Mtr", a
 * "Material … Consumption-Kg" heading and one row per material. Dates are read day first.
 */
export function parseUseGrid(grid: string[][], readDate: (s: string) => string | null): ParsedUse[] {
  const out: ParsedUse[] = [];
  const isWo = (s: string | undefined) => !!s && /^w\.?\s*o\.?$/i.test(s.trim());
  let r = 0;
  while (r < grid.length) {
    const row = grid[r] ?? [];
    const cols = row.map((v, c) => (isWo(v) && (row[c + 1] ?? '').trim() ? c : -1)).filter((c) => c >= 0);
    if (!cols.length) {
      r++;
      continue;
    }
    const blocks = cols.map((c) => ({ c, b: { joNo: row[c + 1]!.trim(), on: null as string | null, widthCm: null as number | null, lengthCm: null as number | null, pcs: null as number | null, sqm: null as number | null, unit: 'kg', materials: [] as { name: string; qty: number }[] }, kgCol: c }));
    const blockAt = (col: number) => [...blocks].reverse().find((x) => x.c <= col) ?? null;
    let matCol = -1;
    let r2 = r + 1;
    for (; r2 < grid.length; r2++) {
      const g = grid[r2] ?? [];
      if (g.some((v, c) => isWo(v) && (g[c + 1] ?? '').trim())) break;
      if (matCol >= 0) {
        const name = (g[matCol] ?? '').trim();
        if (!name) {
          if (g.every((v) => !v.trim())) continue;
          break;
        }
        for (const x of blocks) {
          const q = num(g[x.kgCol]);
          if (q !== null) x.b.materials.push({ name, qty: q });
        }
        continue;
      }
      g.forEach((v, c) => {
        const t = v.trim();
        if (!t) return;
        const x = blockAt(c);
        if (/^material$/i.test(t)) matCol = c;
        if (!x) return;
        if (/production\s*date/i.test(t)) x.b.on = readDate(g[c + 1] ?? '') ?? null;
        else if (/^size/i.test(t) && x.c === c) {
          const next = grid[r2 + 1] ?? [];
          x.b.widthCm = num(next[c + 1]);
          x.b.lengthCm = num(next[c + 2]);
        } else if (/quantity/i.test(t) && /pcs|nos/i.test(t)) x.b.pcs = num(g[c + 1]);
        else if (/sq\.?\s*m/i.test(t)) x.b.sqm = num(g[c + 1]);
        else if (/consumption/i.test(t)) {
          x.kgCol = c;
          x.b.unit = /lt|litre|liter/i.test(t) ? 'l' : 'kg';
        }
      });
    }
    for (const x of blocks) if (x.b.materials.length) out.push(x.b);
    r = r2;
  }
  return out;
}

/** "12 / 2026" and "12/2026" are the same WO. */
export const woKey = (s: string) => s.replace(/\s+/g, '').toUpperCase();

/** An imported entry that is already there (same date, item and quantity) is not added again. */
export function isDuplicateUse(list: UseEntry[] | undefined, e: Pick<UseEntry, 'on' | 'productId' | 'qty' | 'unit'>): boolean {
  return (list ?? []).some((x) => x.on === e.on && x.productId === e.productId && x.unit === e.unit && Math.abs(x.qty - e.qty) < 1e-9);
}

/** A material name in the file → a raw material: remembered text, ERP code or the same name. */
export function matchMaterial(name: string, raws: { id: string; name: string; erpCode?: string; active?: boolean }[], aliases: Record<string, string>): { id: string; by: 'remembered' | 'code' | 'name' } | null {
  const n = name.trim().replace(/\s+/g, ' ').toLowerCase();
  const rem = aliases[n];
  if (rem && raws.some((r) => r.id === rem)) return { id: rem, by: 'remembered' };
  const code = raws.find((r) => r.erpCode && r.erpCode.trim().toLowerCase() === n);
  if (code) return { id: code.id, by: 'code' };
  const same = raws.filter((r) => r.name.trim().replace(/\s+/g, ' ').toLowerCase() === n);
  const act = same.find((r) => r.active !== false) ?? same[0];
  return act ? { id: act.id, by: 'name' } : null;
}

export const materialAliasKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
