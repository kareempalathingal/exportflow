/** Master-data shapes and pure calculations (Phase 2). */
import type { DataStatus, Tracked } from './dataStatus';
import {
  areaFromSize,
  convert,
  type ConversionContext,
  type CustomUnit,
  type Fact,
} from './units';

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
}

export interface RawMaterial extends MasterBase {
  baseUnit: string;
  gsm: Tracked<number>;
  customUnits: CustomUnit[];
}

export interface BomLine {
  rawMaterialId: string;
  qty: number; // per ONE base unit of the product
  unit: string; // any unit convertible for that raw material
  wastagePct: number;
  status: DataStatus;
  source: string;
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

export interface RequirementLine {
  rawMaterialId: string;
  name: string;
  unit: string; // raw material base unit
  netPerBase: number; // per one product base unit, before wastage
  gross: number; // including wastage
  provisional: boolean;
  error?: string;
}

export interface RequirementResult {
  productBaseQty: number | null;
  productError?: string;
  lines: RequirementLine[];
  provisional: boolean;
}

const FIRM: DataStatus[] = ['VERIFIED', 'USER_PROVIDED'];

/**
 * Raw-material requirement for `qty` of a product expressed in `unit`
 * (any unit convertible for that product). Pure and deterministic.
 */
export function bomRequirement(
  product: Product,
  bom: Bom,
  rawMaterials: Map<string, RawMaterial>,
  qty: number,
  unit: string,
): RequirementResult {
  const base = convert(qty, unit, product.baseUnit, productContext(product));
  if (!base.ok) return { productBaseQty: null, productError: base.error, lines: [], provisional: true };

  let provisional = base.provisional;
  const lines: RequirementLine[] = bom.lines.map((line) => {
    const rm = rawMaterials.get(line.rawMaterialId);
    if (!rm) {
      provisional = true;
      return { rawMaterialId: line.rawMaterialId, name: '(missing raw material)', unit: '', netPerBase: 0, gross: 0, provisional: true, error: 'Raw material not found' };
    }
    const perBase = convert(line.qty, line.unit, rm.baseUnit, rawMaterialContext(rm));
    if (!perBase.ok) {
      provisional = true;
      return { rawMaterialId: line.rawMaterialId, name: rm.name, unit: rm.baseUnit, netPerBase: 0, gross: 0, provisional: true, error: perBase.error };
    }
    const wastage = Number.isFinite(line.wastagePct) && line.wastagePct > 0 ? line.wastagePct : 0;
    const lineProvisional = perBase.provisional || !FIRM.includes(line.status);
    if (lineProvisional) provisional = true;
    return {
      rawMaterialId: line.rawMaterialId,
      name: rm.name,
      unit: rm.baseUnit,
      netPerBase: perBase.value,
      gross: base.value * perBase.value * (1 + wastage / 100),
      provisional: lineProvisional,
    };
  });
  return { productBaseQty: base.value, lines, provisional };
}

export function normalizeName(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Names that would duplicate an existing active record (case/space-insensitive). */
export function findDuplicate<T extends MasterBase>(name: string, items: (T & { id: string })[], selfId?: string) {
  const n = normalizeName(name);
  return items.find((i) => i.id !== selfId && i.active && normalizeName(i.name) === n);
}
