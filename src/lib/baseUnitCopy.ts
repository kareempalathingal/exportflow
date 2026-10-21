/**
 * "Copy with another base unit" (confirmed 21 Oct 2026). The base unit of a
 * product stays fixed (BOMs, stock and order snapshots are written per base
 * unit). To correct it, a NEW product is made in the new base unit with every
 * per-unit figure rescaled; the old product is set Inactive, so orders that
 * use it stay exactly as they were. Pure and deterministic.
 */
import type { DataStatus } from './dataStatus';
import { lineComponent, productContext, type Bom, type BomLine, type MasterData, type Product, type Supplier } from './masters';
import { itemKey } from './materials';
import type { JobOrder } from './jobOrders';
import { convert, formatQty, unitLabel, type CustomUnit } from './units';

const round = (n: number) => Math.round(n * 1e6) / 1e6;
const FIRM: DataStatus[] = ['VERIFIED', 'USER_PROVIDED'];
/** A rescaled figure is only as sure as the conversion behind it. */
const downgrade = (s: DataStatus, provisional: boolean): DataStatus => (provisional && FIRM.includes(s) ? 'ESTIMATED' : s);

export interface BaseUnitCopyPlan {
  /** Old base units in ONE new base unit (e.g. 1 sq m = 4.1667 pcs). */
  factor: number;
  provisional: boolean;
  product: Product;
  bom: Bom | null;
  /** BOMs of other products that use the old product: relinked to the copy (quantities unchanged). */
  parentBoms: { productId: string; productName: string; lines: BomLine[]; problems: string[] }[];
  /** Suppliers that supply the old product: the copy is added to their items. */
  suppliers: { id: string; name: string; items: string[] }[];
  /** Open orders that use the old product: left unchanged. */
  openOrders: { id: string; joNumber: string }[];
  summary: string[];
}

export function planBaseUnitCopy(args: {
  productId: string;
  product: Product;
  newUnit: string;
  newName: string;
  md: MasterData;
  suppliers: (Pick<Supplier, 'name' | 'items' | 'active'> & { id: string })[];
  jobOrders: (Pick<JobOrder, 'joNumber' | 'status' | 'lines'> & { id: string })[];
  newId: string;
  today: string;
}): BaseUnitCopyPlan | { error: string } {
  const { product: old, newUnit, md } = args;
  if (newUnit === old.baseUnit) return { error: 'Choose a base unit different from the current one.' };
  const name = args.newName.trim().replace(/\s+/g, ' ');
  if (!name) return { error: 'Enter a name for the copy.' };
  const ctx = productContext(old);
  const c = convert(1, newUnit, old.baseUnit, ctx);
  if (!c.ok) return { error: `${unitLabel(newUnit)} cannot be converted to ${unitLabel(old.baseUnit)} for this product (${c.error}). Add the size, GSM or weight per piece first.` };
  const factor = c.value;
  if (!(factor > 0)) return { error: 'The conversion gives zero; check the size, GSM or weight.' };
  const provisional = c.provisional;

  // Own units: 1 <name> = f old base units = f / factor new base units.
  const customUnits: CustomUnit[] = (old.customUnits ?? []).map((u) => ({ ...u, factor: round(u.factor / factor), status: downgrade(u.status, provisional) }));
  const product: Product = {
    ...old,
    name,
    code: '',
    baseUnit: newUnit,
    customUnits,
    active: true,
    notes: [old.notes, `Copied from "${old.name}" (base unit ${unitLabel(old.baseUnit)}) on ${args.today}; 1 ${unitLabel(newUnit)} = ${formatQty(factor)} ${unitLabel(old.baseUnit)}.`].filter(Boolean).join('\n'),
  };

  const oldBom = md.boms.get(args.productId);
  const bom: Bom | null = oldBom
    ? {
        productId: args.newId,
        notes: oldBom.notes,
        lines: oldBom.lines.map((l) => ({ ...l, qty: round(l.qty * factor), status: downgrade(l.status, provisional), source: l.source })),
      }
    : null;

  const newCtx = productContext(product);
  const parentBoms: BaseUnitCopyPlan['parentBoms'] = [];
  for (const [pid, b] of md.boms) {
    if (pid === args.productId) continue;
    let touched = false;
    const problems: string[] = [];
    const lines = b.lines.map((l) => {
      const comp = lineComponent(l);
      if (comp.type !== 'PRODUCT' || comp.id !== args.productId) return l;
      touched = true;
      const check = convert(1, l.unit, newUnit, newCtx);
      if (!check.ok) problems.push(`${unitLabel(l.unit)} cannot be converted for the copy`);
      return { ...l, componentType: 'PRODUCT' as const, componentId: args.newId, rawMaterialId: undefined };
    });
    if (touched) parentBoms.push({ productId: pid, productName: md.products.get(pid)?.name ?? pid, lines: lines.map(stripUndefined), problems });
  }

  const oldKey = itemKey('PRODUCT', args.productId);
  const newKey = itemKey('PRODUCT', args.newId);
  const suppliers = args.suppliers.filter((s) => (s.items ?? []).includes(oldKey)).map((s) => ({ id: s.id, name: s.name, items: [...s.items, newKey] }));
  const openOrders = args.jobOrders.filter((j) => (j.status === 'DRAFT' || j.status === 'CONFIRMED') && j.lines.some((l) => l.productId === args.productId)).map((j) => ({ id: j.id, joNumber: j.joNumber }));

  const summary = [
    `New product "${name}" in ${unitLabel(newUnit)}: 1 ${unitLabel(newUnit)} = ${formatQty(factor)} ${unitLabel(old.baseUnit)}${provisional ? ' (uses estimated data - figures marked as estimates)' : ''}.`,
    bom ? `BOM copied and rescaled: ${bom.lines.length} line${bom.lines.length === 1 ? '' : 's'} (quantities × ${formatQty(factor)}).` : 'No BOM to copy.',
    ...(old.route?.length ? [`Process route copied (${old.route.length} step${old.route.length === 1 ? '' : 's'}; each step keeps its own unit).`] : []),
    ...(customUnits.length ? [`Own units rescaled: ${customUnits.map((u) => `1 ${u.name} = ${formatQty(u.factor)} ${unitLabel(newUnit)}`).join(', ')}.`] : []),
    ...parentBoms.map((p) => `BOM of ${p.productName}: now uses the copy (quantities unchanged).${p.problems.length ? ` Check: ${p.problems.join('; ')}.` : ''}`),
    ...(suppliers.length ? [`Suppliers linked to the copy too: ${suppliers.map((s) => s.name).join(', ')}.`] : []),
    `"${old.name}" (${unitLabel(old.baseUnit)}) is set Inactive and kept.`,
    ...(openOrders.length ? [`Open orders still use the old product and are not changed: ${openOrders.map((o) => o.joNumber).join(', ')}.`] : []),
    'Stock counted for the old product is not moved; count it again for the copy.',
  ];
  return { factor, provisional, product, bom, parentBoms, suppliers, openOrders, summary };
}

/** Firestore does not accept undefined fields. */
function stripUndefined(l: BomLine): BomLine {
  return Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined)) as unknown as BomLine;
}
