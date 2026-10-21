/**
 * Calculator and converter helpers (Home → Calculator, confirmed 21 Oct 2026).
 * The expression is parsed by hand (no eval): numbers, + − × ÷, brackets,
 * unary minus and % like a phone calculator:
 *   200 + 10%  = 220   (percent of the left side)
 *   200 × 10%  = 20    (10% = 0.1)
 *   50%        = 0.5
 */
import { convert, STANDARD_UNITS, unitLabel, type ConversionContext, type Dimension } from './units';

export type CalcResult = { ok: true; value: number } | { ok: false; error: string };

type Tok = { t: 'num'; v: number } | { t: 'op'; v: '+' | '-' | '*' | '/' } | { t: '(' } | { t: ')' } | { t: '%' };

function tokenize(s: string): Tok[] | string {
  const out: Tok[] = [];
  const src = s.replace(/×/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/,/g, '');
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === ' ') {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      const text = src.slice(i, j);
      if ((text.match(/\./g) ?? []).length > 1 || text === '.') return `Bad number "${text}"`;
      out.push({ t: 'num', v: Number(text) });
      i = j;
      continue;
    }
    if (c === '+' || c === '-' || c === '*' || c === '/') out.push({ t: 'op', v: c });
    else if (c === '(') out.push({ t: '(' });
    else if (c === ')') out.push({ t: ')' });
    else if (c === '%') out.push({ t: '%' });
    else return `Unknown sign "${c}"`;
    i++;
  }
  return out;
}

interface Val {
  v: number;
  pct: boolean; // written as N% (meaning depends on where it is used)
}
const plain = (x: Val) => (x.pct ? x.v / 100 : x.v);

export function evaluate(expr: string): CalcResult {
  if (!expr.trim()) return { ok: false, error: 'Empty' };
  const toks = tokenize(expr);
  if (typeof toks === 'string') return { ok: false, error: toks };
  let p = 0;
  const peek = () => toks[p];
  const fail = (m: string): never => {
    throw new Error(m);
  };

  function primary(): Val {
    const k = peek();
    if (!k) return fail('Incomplete');
    if (k.t === 'op' && (k.v === '-' || k.v === '+')) {
      p++;
      const x = primary();
      return k.v === '-' ? { v: -x.v, pct: x.pct } : x;
    }
    let x: Val;
    if (k.t === 'num') {
      p++;
      x = { v: k.v, pct: false };
    } else if (k.t === '(') {
      p++;
      x = { v: expr0(), pct: false };
      if (peek()?.t !== ')') fail('Missing )');
      p++;
    } else return fail('Incomplete');
    if (peek()?.t === '%') {
      p++;
      x = { v: plain(x), pct: true };
    }
    return x;
  }

  function term(): Val {
    let left = primary();
    for (;;) {
      const k = peek();
      if (!k || k.t !== 'op' || (k.v !== '*' && k.v !== '/')) return left;
      p++;
      const r = plain(primary());
      if (k.v === '/' && r === 0) fail('Cannot divide by 0');
      left = { v: k.v === '*' ? plain(left) * r : plain(left) / r, pct: false };
    }
  }

  function expr0(): number {
    let left = plain(term());
    for (;;) {
      const k = peek();
      if (!k || k.t !== 'op' || (k.v !== '+' && k.v !== '-')) return left;
      p++;
      const r = term();
      const amount = r.pct ? (left * r.v) / 100 : r.v;
      left = k.v === '+' ? left + amount : left - amount;
    }
  }

  try {
    const v = expr0();
    if (p < toks.length) return { ok: false, error: toks[p]!.t === ')' ? 'Extra )' : 'Incomplete' };
    if (!Number.isFinite(v)) return { ok: false, error: 'Too large' };
    return { ok: true, value: Math.round(v * 1e10) / 1e10 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** A result for the display: up to 10 decimals, no float noise, grouped in the Indian style. */
export function formatResult(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const r = Number(v.toPrecision(12));
  return r.toLocaleString('en-IN', { maximumFractionDigits: 10 });
}

// ---------------------------------------------------------------------------
// Converter
// ---------------------------------------------------------------------------

export const DIMENSIONS: { id: Dimension; label: string }[] = [
  { id: 'length', label: 'Length' },
  { id: 'area', label: 'Area' },
  { id: 'mass', label: 'Weight' },
  { id: 'volume', label: 'Volume' },
  { id: 'count', label: 'Count' },
];

export const unitsOf = (dim: Dimension) => STANDARD_UNITS.filter((u) => u.dim === dim).map((u) => u.id);

const PLAIN: ConversionContext = { baseUnit: 'pcs', customUnits: [] };

/** Same-kind conversion (cm ↔ inch, sq m ↔ sq ft, kg ↔ lb…). */
export function convertStandard(qty: number, from: string, to: string): CalcResult {
  const r = convert(qty, from, to, PLAIN);
  return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error };
}

export interface ItemConversionRow {
  unit: string;
  label: string;
  value: number | null;
  estimate: boolean;
  via: string[];
  error: string | null;
}

/** The amount in every unit the item can be expressed in (standard units of the item's kinds, plus its own units). */
export function convertItemAll(qty: number, from: string, ctx: ConversionContext, units: string[]): ItemConversionRow[] {
  return units
    .filter((u) => u !== from)
    .map((u) => {
      const r = convert(qty, from, u, ctx);
      return r.ok
        ? { unit: u, label: unitLabel(u), value: r.value, estimate: r.provisional, via: r.via, error: null }
        : { unit: u, label: unitLabel(u), value: null, estimate: false, via: [], error: r.error };
    });
}

/** Converter figures: a little more precise than order quantities. */
export function showQty(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs > 0 && abs < 0.001) return v.toPrecision(3);
  return v.toLocaleString('en-IN', { maximumFractionDigits: abs >= 1000 ? 2 : 4 });
}
