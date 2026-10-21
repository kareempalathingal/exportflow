/** Master-data shapes and pure calculations (Phase 2). */
import type { DataStatus, Tracked } from './dataStatus';
import {
  areaFromSize,
  convert,
  type ConversionContext,
  type CustomUnit,
  type Fact,
} from './units';

const FIRM: DataStatus[] = ['VERIFIED', 'USER_PROVIDED'];

export type SupplyType = 'MANUFACTURED' | 'TRADED' | 'BOTH';
export type CustomerType = 'DIRECT' | 'AGENT';

export interface MasterBase {
  name: string;
  active: boolean;
  notes: string;
}

export interface Customer extends MasterBase {
  country: string;
  customerType: CustomerType;
  contactPerson: string;
  phone: string;
  email: string;
}

export interface ProductSize {
  length: number | null;
  width: number | null;
  unit: string; // length unit id
  status: DataStatus;
}

export interface Product extends MasterBase {
  code: string;
  baseUnit: string;
  supplyType: SupplyType;
  specifications: string;
  size: ProductSize;
  thicknessMm: Tracked<number>;
  gsm: Tracked<number>;
  weightPerPieceKg: Tracked<number>;
  customUnits: CustomUnit[];
  /** For BOTH only: what usually happens; pre-fills Make/Buy on Job Order lines. */
  usualSupply?: 'MAKE' | 'BUY' | null;
  /** Processes / treatments this product goes through, in order (Phase 4). */
  route?: RouteStep[];
  /** False until the order of the steps is confirmed with the company. */
  routeConfirmed?: boolean;
}

/** A process or treatment (weaving, bleaching, packing…), shared by many products. */
export type Process = MasterBase;

/**
 * One step of a product's route. Time is a benchmark, never invented:
 * planned days = quantity ÷ output per working day + fixed days.
 * Both empty = time not known yet ("time pending").
 */
export interface RouteStep {
  processId: string;
  /** Output per working day, in `perDayUnit` (e.g. 400 pcs/day). */
  perDay: number | null;
  perDayUnit: string;
  /** Days that do not depend on quantity (drying, curing, a batch). */
  fixedDays: number | null;
  /** Also count stock set aside for the order (e.g. packing, labelling); default: only what is made. */
  alsoForStock?: boolean;
  status: DataStatus;
  source: string;
}

/** A supplier we can buy raw materials or traded products from. */
export interface Supplier extends MasterBase {
  place: string;
  contactPerson: string;
  phone: string;
  email: string;
  gstin: string;
  /** What this supplier can supply: item keys "RAW_MATERIAL:<id>" / "PRODUCT:<id>". The only place the link is stored. */
  items: string[];
}

/** Suppliers linked to an item (by item key). */
export function suppliersOf<T extends Pick<Supplier, 'items' | 'active'>>(key: string, suppliers: T[], includeInactive = false): T[] {
  return suppliers.filter((s) => (includeInactive || s.active !== false) && (s.items ?? []).includes(key));
}

export function validGstin(s: string): boolean {
  return /^[0-9]{2}[A-Z0-9]{13}$/.test(s.trim().toUpperCase());
}

export interface RawMaterial extends MasterBase {
  baseUnit: string;
  gsm: Tracked<number>;
  customUnits: CustomUnit[];
}

export type ComponentType = 'RAW_MATERIAL' | 'PRODUCT';

export interface BomLine {
  /** RAW_MATERIAL (bought, never sold) or PRODUCT (made or traded; may have its own BOM). */
  componentType?: ComponentType; // absent on early records = RAW_MATERIAL
  componentId?: string;
  /** Legacy field from the first Phase 2 release; read via lineComponent(). */
  rawMaterialId?: string;
  qty: number; // per ONE base unit of the parent product
  unit: string; // any unit convertible for the component
  wastagePct: number;
  status: DataStatus;
  source: string;
}

export function lineComponent(l: BomLine): { type: ComponentType; id: string } {
  return { type: l.componentType ?? 'RAW_MATERIAL', id: l.componentId ?? l.rawMaterialId ?? '' };
}

export interface Bom {
  productId: string;
  lines: BomLine[];
  notes: string;
}

export const COLLECTIONS = {
  customers: 'customers',
  products: 'products',
  rawMaterials: 'rawMaterials',
  boms: 'boms',
  suppliers: 'suppliers',
  processes: 'processes',
} as const;

function fact(t: Tracked<number> | undefined): Fact | undefined {
  return t && typeof t.value === 'number' && t.value > 0 ? { value: t.value, status: t.status } : undefined;
}

export function productContext(p: Pick<Product, 'baseUnit' | 'customUnits' | 'size' | 'gsm' | 'weightPerPieceKg'>): ConversionContext {
  const area =
    p.size.length !== null && p.size.width !== null
      ? areaFromSize(p.size.length, p.size.width, p.size.unit)
      : null;
  return {
    baseUnit: p.baseUnit,
    customUnits: p.customUnits ?? [],
    areaPerPieceSqm: area ? { value: area, status: p.size.status } : undefined,
    gsm: fact(p.gsm),
    massPerPieceKg: fact(p.weightPerPieceKg),
  };
}

export function rawMaterialContext(r: Pick<RawMaterial, 'baseUnit' | 'customUnits' | 'gsm'>): ConversionContext {
  return { baseUnit: r.baseUnit, customUnits: r.customUnits ?? [], gsm: fact(r.gsm) };
}

export function normalizeName(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Names that would duplicate an existing active record (case/space-insensitive). */
export function findDuplicate<T extends MasterBase>(name: string, items: (T & { id: string })[], selfId?: string) {
  const n = normalizeName(name);
  return items.find((i) => i.id !== selfId && i.active && normalizeName(i.name) === n);
}

export type BomStatus = 'NOT_NEEDED' | 'MISSING' | 'PROVISIONAL' | 'READY';

export interface MasterData {
  products: Map<string, Product>;
  rawMaterials: Map<string, RawMaterial>;
  boms: Map<string, Bom>;
}

export function needsBom(p: Pick<Product, 'supplyType'>): boolean {
  return p.supplyType === 'MANUFACTURED' || p.supplyType === 'BOTH';
}

const MAX_DEPTH = 20;

/** Conversion context of a BOM component, or null if it does not exist. */
export function componentContext(type: ComponentType, id: string, md: MasterData): { name: string; ctx: ConversionContext } | null {
  if (type === 'RAW_MATERIAL') {
    const r = md.rawMaterials.get(id);
    return r ? { name: r.name, ctx: rawMaterialContext(r) } : null;
  }
  const p = md.products.get(id);
  return p ? { name: p.name, ctx: productContext(p) } : null;
}

/**
 * Would adding `componentId` to `parentId`'s BOM create a loop?
 * True if parentId is the component itself or appears anywhere below it.
 */
export function createsCycle(parentId: string, componentId: string, md: MasterData): boolean {
  const seen = new Set<string>();
  const stack = [componentId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === parentId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const l of md.boms.get(id)?.lines ?? []) {
      const c = lineComponent(l);
      if (c.type === 'PRODUCT') stack.push(c.id);
    }
  }
  return false;
}

/**
 * READY: every line exists, converts without a guessed factor, has a Verified /
 * User-Provided quantity, and every manufactured sub-product is itself READY.
 */
export function bomStatus(productId: string, md: MasterData, depth = 0, path: Set<string> = new Set()): BomStatus {
  const product = md.products.get(productId);
  if (!product || !needsBom(product)) return 'NOT_NEEDED';
  const bom = md.boms.get(productId);
  if (!bom || bom.lines.length === 0) return 'MISSING';
  if (depth > MAX_DEPTH || path.has(productId)) return 'PROVISIONAL';
  const nextPath = new Set(path).add(productId);
  for (const line of bom.lines) {
    const { type, id } = lineComponent(line);
    const comp = componentContext(type, id, md);
    if (!comp || !FIRM.includes(line.status)) return 'PROVISIONAL';
    const c = convert(line.qty, line.unit, comp.ctx.baseUnit, comp.ctx);
    if (!c.ok || c.provisional) return 'PROVISIONAL';
    if (type === 'PRODUCT') {
      const sub = bomStatus(id, md, depth + 1, nextPath);
      if (sub === 'MISSING' || sub === 'PROVISIONAL') return 'PROVISIONAL';
    }
  }
  return 'READY';
}

export interface ExplodedLine {
  type: ComponentType;
  id: string;
  name: string;
  unit: string; // component base unit
  qty: number; // total, including wastage
  provisional: boolean;
}

export interface Explosion {
  productBaseQty: number | null;
  /** Manufactured sub-products that must be made (BOTH is assumed made; decided per Job Order later). */
  toProduce: ExplodedLine[];
  /** Raw materials and traded products to buy. */
  toBuy: ExplodedLine[];
  errors: string[];
  provisional: boolean;
}

/**
 * Multi-level BOM explosion for `qty` of a product in `unit`. Quantities of
 * the same component reached by different paths are added together.
 * Pure and deterministic; stock is not deducted here (Phase 3).
 */
export function explodeBom(productId: string, qty: number, unit: string, md: MasterData): Explosion {
  const out: Explosion = { productBaseQty: null, toProduce: [], toBuy: [], errors: [], provisional: false };
  const product = md.products.get(productId);
  if (!product) return { ...out, errors: ['Product not found'], provisional: true };
  const base = convert(qty, unit, product.baseUnit, productContext(product));
  if (!base.ok) return { ...out, errors: [base.error], provisional: true };
  out.productBaseQty = base.value;
  out.provisional = base.provisional;

  const produce = new Map<string, ExplodedLine>();
  const buy = new Map<string, ExplodedLine>();
  const add = (bucket: Map<string, ExplodedLine>, l: ExplodedLine) => {
    const key = `${l.type}:${l.id}`;
    const prev = bucket.get(key);
    bucket.set(key, prev ? { ...prev, qty: prev.qty + l.qty, provisional: prev.provisional || l.provisional } : l);
  };

  const walk = (pid: string, parentQty: number, depth: number, path: string[], inheritedProvisional: boolean) => {
    const p = md.products.get(pid)!;
    if (depth > MAX_DEPTH) {
      out.errors.push(`BOM is nested too deeply under ${p.name}`);
      out.provisional = true;
      return;
    }
    const bom = md.boms.get(pid);
    if (!bom || bom.lines.length === 0) {
      out.errors.push(`BOM missing for ${p.name}`);
      out.provisional = true;
      return;
    }
    for (const line of bom.lines) {
      const { type, id } = lineComponent(line);
      const comp = componentContext(type, id, md);
      if (!comp) {
        out.errors.push(`${p.name}: a BOM line points to a missing ${type === 'PRODUCT' ? 'product' : 'raw material'}`);
        out.provisional = true;
        continue;
      }
      if (type === 'PRODUCT' && path.includes(id)) {
        out.errors.push(`Loop in BOM: ${[...path.map((x) => md.products.get(x)?.name ?? x), comp.name].join(' → ')}`);
        out.provisional = true;
        continue;
      }
      const perBase = convert(line.qty, line.unit, comp.ctx.baseUnit, comp.ctx);
      if (!perBase.ok) {
        out.errors.push(`${p.name} → ${comp.name}: ${perBase.error}`);
        out.provisional = true;
        continue;
      }
      const wastage = Number.isFinite(line.wastagePct) && line.wastagePct > 0 ? line.wastagePct : 0;
      const need = parentQty * perBase.value * (1 + wastage / 100);
      const provisional = inheritedProvisional || perBase.provisional || !FIRM.includes(line.status);
      if (provisional) out.provisional = true;
      const row: ExplodedLine = { type, id, name: comp.name, unit: comp.ctx.baseUnit, qty: need, provisional };
      const sub = type === 'PRODUCT' ? md.products.get(id)! : null;
      if (sub && needsBom(sub)) {
        add(produce, row);
        walk(id, need, depth + 1, [...path, id], provisional);
      } else {
        add(buy, row);
      }
    }
  };
  walk(productId, base.value, 0, [productId], base.provisional);

  out.toProduce = [...produce.values()].sort((a, b) => a.name.localeCompare(b.name));
  out.toBuy = [...buy.values()].sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** True when the product can be converted between pieces, area and weight. */
export function hasPhysicalFacts(p: Product): boolean {
  const ctx = productContext(p);
  return convert(1, 'pcs', 'kg', ctx).ok || convert(1, 'sqm', 'kg', ctx).ok;
}

export interface AttentionItem {
  kind: 'BOM_MISSING' | 'BOM_PROVISIONAL' | 'NO_CONVERSION';
  productId: string;
  productName: string;
}

export function masterAttention(products: (Product & { id: string })[], md: MasterData): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const p of products) {
    if (p.active === false) continue;
    const s = bomStatus(p.id, md);
    if (s === 'MISSING') out.push({ kind: 'BOM_MISSING', productId: p.id, productName: p.name });
    if (s === 'PROVISIONAL') out.push({ kind: 'BOM_PROVISIONAL', productId: p.id, productName: p.name });
    if (!hasPhysicalFacts(p)) out.push({ kind: 'NO_CONVERSION', productId: p.id, productName: p.name });
  }
  return out;
}
