/**
 * Deterministic unit conversion (Requirements §57.2; Phase 2 decision).
 *
 * - Units of the same dimension convert with fixed factors (g↔kg, cm↔ft…).
 * - Item-specific custom units ("bale", "roll") are defined against the
 *   item's base unit by the user.
 * - Count ↔ area ↔ mass conversions come from the item's physical facts:
 *   area per piece (from size), mass per piece, and GSM (g per m²).
 * - Nothing is guessed: a missing fact returns an explicit error.
 */
import type { DataStatus } from './dataStatus';

export type Dimension = 'count' | 'mass' | 'length' | 'area' | 'volume';

interface UnitDef {
  id: string;
  label: string;
  dim: Dimension;
  /** Size of one unit in the dimension's SI unit (pcs, kg, m, m², litre). */
  si: number;
}

export const STANDARD_UNITS: readonly UnitDef[] = [
  { id: 'pcs', label: 'pcs', dim: 'count', si: 1 },
  { id: 'dozen', label: 'dozen', dim: 'count', si: 12 },
  { id: 'g', label: 'g', dim: 'mass', si: 0.001 },
  { id: 'kg', label: 'kg', dim: 'mass', si: 1 },
  { id: 't', label: 'tonne', dim: 'mass', si: 1000 },
  { id: 'lb', label: 'lb', dim: 'mass', si: 0.45359237 },
  { id: 'mm', label: 'mm', dim: 'length', si: 0.001 },
  { id: 'cm', label: 'cm', dim: 'length', si: 0.01 },
  { id: 'm', label: 'm', dim: 'length', si: 1 },
  { id: 'in', label: 'inch', dim: 'length', si: 0.0254 },
  { id: 'ft', label: 'ft', dim: 'length', si: 0.3048 },
  { id: 'sqcm', label: 'sq cm', dim: 'area', si: 0.0001 },
  { id: 'sqm', label: 'sq m', dim: 'area', si: 1 },
  { id: 'sqft', label: 'sq ft', dim: 'area', si: 0.09290304 },
  { id: 'sqyd', label: 'sq yd', dim: 'area', si: 0.83612736 },
  { id: 'ml', label: 'ml', dim: 'volume', si: 0.001 },
  { id: 'l', label: 'litre', dim: 'volume', si: 1 },
  { id: 'cbm', label: 'CBM', dim: 'volume', si: 1000 },
];

const BY_ID = new Map(STANDARD_UNITS.map((u) => [u.id, u]));

export const LENGTH_UNITS = STANDARD_UNITS.filter((u) => u.dim === 'length');

export function standardUnit(id: string): UnitDef | undefined {
  return BY_ID.get(id);
}

export function unitLabel(id: string): string {
  return BY_ID.get(id)?.label ?? id;
}

export interface Fact {
  value: number;
  status: DataStatus;
}

export interface CustomUnit {
  name: string; // e.g. "bale"
  factor: number; // 1 <name> = factor × baseUnit
  status: DataStatus;
}

/** Everything needed to convert quantities of one product or raw material. */
export interface ConversionContext {
  baseUnit: string; // a standard unit id
  customUnits: CustomUnit[];
  areaPerPieceSqm?: Fact;
  massPerPieceKg?: Fact;
  gsm?: Fact; // grams per m²
}

export type ConvertResult =
  | { ok: true; value: number; provisional: boolean; via: string[] }
  | { ok: false; error: string };

const FIRM: readonly DataStatus[] = ['VERIFIED', 'USER_PROVIDED'];
const isFirm = (s: DataStatus) => FIRM.includes(s);

function validFact(f: Fact | undefined): f is Fact {
  return !!f && Number.isFinite(f.value) && f.value > 0;
}

interface Resolved {
  dim: Dimension;
  si: number;
  firm: boolean;
}

function resolve(unit: string, ctx: ConversionContext): Resolved | string {
  const std = BY_ID.get(unit);
  if (std) return { dim: std.dim, si: std.si, firm: true };
  const custom = ctx.customUnits.find((c) => c.name.trim().toLowerCase() === unit.trim().toLowerCase());
  if (!custom) return `Unknown unit "${unit}"`;
  const base = BY_ID.get(ctx.baseUnit);
  if (!base) return `Base unit "${ctx.baseUnit}" is not a standard unit`;
  if (!(Number.isFinite(custom.factor) && custom.factor > 0)) return `Conversion for "${custom.name}" is missing`;
  return { dim: base.dim, si: custom.factor * base.si, firm: isFirm(custom.status) };
}

interface Edge {
  to: Dimension;
  ratio: number; // SI amount of `to` per SI amount of `from`
  firm: boolean;
  label: string;
}

/** Fill in the third physical fact when two are known. */
export function completeFacts(ctx: ConversionContext): ConversionContext {
  let { areaPerPieceSqm: a, massPerPieceKg: m, gsm: g } = ctx;
  const worst = (x: Fact, y: Fact): DataStatus => (isFirm(x.status) && isFirm(y.status) ? 'USER_PROVIDED' : 'ESTIMATED');
  if (!validFact(m) && validFact(a) && validFact(g)) m = { value: (a.value * g.value) / 1000, status: worst(a, g) };
  if (!validFact(g) && validFact(a) && validFact(m)) g = { value: (m.value / a.value) * 1000, status: worst(a, m) };
  if (!validFact(a) && validFact(m) && validFact(g)) a = { value: (m.value / g.value) * 1000, status: worst(m, g) };
  return { ...ctx, areaPerPieceSqm: a, massPerPieceKg: m, gsm: g };
}

function edges(ctx: ConversionContext): Map<Dimension, Edge[]> {
  const out = new Map<Dimension, Edge[]>();
  const add = (from: Dimension, to: Dimension, ratio: number, firm: boolean, label: string) => {
    out.set(from, [...(out.get(from) ?? []), { to, ratio, firm, label }]);
    out.set(to, [...(out.get(to) ?? []), { to: from, ratio: 1 / ratio, firm, label }]);
  };
  const c = completeFacts(ctx);
  if (validFact(c.areaPerPieceSqm)) add('count', 'area', c.areaPerPieceSqm.value, isFirm(c.areaPerPieceSqm.status), 'size');
  if (validFact(c.massPerPieceKg)) add('count', 'mass', c.massPerPieceKg.value, isFirm(c.massPerPieceKg.status), 'weight per piece');
  if (validFact(c.gsm)) add('area', 'mass', c.gsm.value / 1000, isFirm(c.gsm.status), 'GSM');
  return out;
}

const NEEDS: Record<string, string> = {
  'count>area': 'size (length × width)',
  'count>mass': 'weight per piece or size + GSM',
  'area>mass': 'GSM',
};

function missingFor(a: Dimension, b: Dimension): string {
  return NEEDS[`${a}>${b}`] ?? NEEDS[`${b}>${a}`] ?? `a ${a}↔${b} conversion`;
}

export function convert(qty: number, from: string, to: string, ctx: ConversionContext): ConvertResult {
  if (!Number.isFinite(qty)) return { ok: false, error: 'Quantity is not a number' };
  const f = resolve(from, ctx);
  if (typeof f === 'string') return { ok: false, error: f };
  const t = resolve(to, ctx);
  if (typeof t === 'string') return { ok: false, error: t };

  const siFrom = qty * f.si;
  if (f.dim === t.dim) {
    return { ok: true, value: siFrom / t.si, provisional: !(f.firm && t.firm), via: [] };
  }

  // Breadth-first search across count / area / mass links.
  const graph = edges(ctx);
  const queue: { dim: Dimension; amount: number; firm: boolean; via: string[] }[] = [
    { dim: f.dim, amount: siFrom, firm: f.firm && t.firm, via: [] },
  ];
  const seen = new Set<Dimension>([f.dim]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of graph.get(cur.dim) ?? []) {
      if (seen.has(e.to)) continue;
      const next = { dim: e.to, amount: cur.amount * e.ratio, firm: cur.firm && e.firm, via: [...cur.via, e.label] };
      if (e.to === t.dim) return { ok: true, value: next.amount / t.si, provisional: !next.firm, via: next.via };
      seen.add(e.to);
      queue.push(next);
    }
  }
  return { ok: false, error: `Conversion needed: add ${missingFor(f.dim, t.dim)}` };
}

/** Units this item can be expressed in, given the facts available. */
export function availableUnits(ctx: ConversionContext): string[] {
  const out: string[] = [];
  for (const u of STANDARD_UNITS) if (convert(1, ctx.baseUnit, u.id, ctx).ok) out.push(u.id);
  for (const c of ctx.customUnits) if (convert(1, ctx.baseUnit, c.name, ctx).ok) out.push(c.name);
  return out;
}

/** Area of one piece from its size, in m². */
export function areaFromSize(length: number, width: number, lengthUnit: string): number | null {
  const u = BY_ID.get(lengthUnit);
  if (!u || u.dim !== 'length' || !(length > 0) || !(width > 0)) return null;
  return length * u.si * (width * u.si);
}

export function formatQty(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 0 : abs >= 10 ? 2 : 3;
  return v.toLocaleString('en-IN', { maximumFractionDigits: digits });
}
