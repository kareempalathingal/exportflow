/**
 * Phase 3b: per-Job-Order material planning with manually confirmed stock.
 * Pure and deterministic (Requirements v1.9 §31.3; CLAUDE.md Phase 3 decisions).
 *
 * Order quantity − stock set aside = balance. Balances of made products are
 * exploded through their BOM (the copy saved at confirmation); stock set aside
 * for a made sub-product is deducted before its own components are exploded.
 * Raw materials and bought products end up in To buy. Negative results are 0.
 */
import { effectiveSupply, resolveLine, type JobOrder, type StockEntry } from './jobOrders';
import { componentContext, lineComponent, needsBom, type Bom, type ComponentType, type MasterData } from './masters';
import { convert } from './units';

const FIRM = ['VERIFIED', 'USER_PROVIDED'];
export const COLLECTION_STOCK_COUNTS = 'stockCounts';

export function itemKey(type: ComponentType, id: string): string {
  return `${type}:${id}`;
}

export function parseItemKey(key: string): { type: ComponentType; id: string } | null {
  const i = key.indexOf(':');
  if (i < 0) return null;
  const type = key.slice(0, i);
  return type === 'RAW_MATERIAL' || type === 'PRODUCT' ? { type, id: key.slice(i + 1) } : null;
}

/** Firestore document id of an item's stock count. */
export function stockCountId(type: ComponentType, id: string): string {
  return `${type}_${id}`;
}

/** Latest physical stock of an item, counted manually (base unit). */
export interface StockCount {
  itemType: ComponentType;
  itemId: string;
  qty: number;
  unit: string; // the item's base unit
  countedOn: string; // YYYY-MM-DD
  notes: string;
}

/** BOMs to use for this order: the confirmation copy where one exists, else the current ones. */
export function bomsForJobOrder(jo: Pick<JobOrder, 'status' | 'bomSnapshot'>, md: MasterData): MasterData {
  if (jo.status === 'DRAFT' || !jo.bomSnapshot) return md;
  const boms = new Map<string, Bom>(md.boms);
  for (const [pid, e] of Object.entries(jo.bomSnapshot)) boms.set(pid, { productId: pid, lines: e.lines, notes: '' });
  return { ...md, boms };
}

export interface PlanRow {
  key: string;
  type: ComponentType;
  id: string;
  name: string;
  unit: string; // base unit
  gross: number; // needed for this order
  fromStock: number; // set aside (as confirmed)
  net: number; // still to make / buy, never negative
  provisional: boolean;
  /** Direct components of a made product (names, from its BOM). */
  madeFrom: string[];
  /** Ordered products this item is needed for (through any number of BOM levels). */
  usedFor: string[];
  /** Made products in between (e.g. "Coir yarn" for coir fibre). */
  via: string[];
  /** The item is itself a line of the order. */
  ordered: boolean;
}

/** One step of the BOM calculation: a made product needs this much of a component. */
export interface MaterialLink {
  parentKey: string;
  parentName: string;
  parentUnit: string;
  /** Quantity of the parent still to make (stock set aside already deducted). */
  parentQty: number;
  childKey: string;
  childName: string;
  childUnit: string;
  /** Component per one base unit of the parent, before wastage. */
  perUnit: number;
  wastagePct: number;
  qty: number;
  provisional: boolean;
}

export interface MaterialPlan {
  toProduce: PlanRow[]; // made products, including the ordered ones
  toBuy: PlanRow[]; // raw materials and bought products
  /** How each component quantity was worked out (parents before children). */
  links: MaterialLink[];
  errors: string[]; // missing data that stops part of the calculation
  notes: string[]; // things worth knowing that do not stop it
  provisional: boolean;
}

interface Need {
  type: ComponentType;
  id: string;
  name: string;
  unit: string;
  qty: number;
  provisional: boolean;
}

export function earmarksOf(jo: Pick<JobOrder, 'stock'>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, e] of Object.entries(jo.stock ?? {})) if (e && Number.isFinite(e.baseQty) && e.baseQty > 0) out[k] = e.baseQty;
  return out;
}

export function planMaterials(jo: Pick<JobOrder, 'lines' | 'status' | 'bomSnapshot' | 'stock'>, liveMd: MasterData): MaterialPlan {
  const md = bomsForJobOrder(jo, liveMd);
  const stock = earmarksOf(jo);
  const errors: string[] = [];
  const notes: string[] = [];
  let provisional = false;
  const needs = new Map<string, Need>();
  const links: MaterialLink[] = [];
  const add = (n: Need) => {
    const k = itemKey(n.type, n.id);
    const prev = needs.get(k);
    needs.set(k, prev ? { ...prev, qty: prev.qty + n.qty, provisional: prev.provisional || n.provisional } : n);
    if (n.provisional) provisional = true;
  };

  // 1. Ordered lines.
  const makeRoots = new Set<string>();
  const buyRoots = new Set<string>();
  for (const line of jo.lines) {
    const r = resolveLine(line, md);
    const name = r.product?.name ?? line.productName ?? 'Unknown product';
    if (!r.product || r.baseQty === null) {
      errors.push(`${name}: ${r.problem ?? 'cannot be calculated'}`);
      provisional = true;
      continue;
    }
    const supply = effectiveSupply(line, r.product);
    if (!supply) {
      errors.push(`${name}: choose Make or Buy`);
      provisional = true;
      continue;
    }
    (supply === 'MAKE' ? makeRoots : buyRoots).add(line.productId);
    add({ type: 'PRODUCT', id: line.productId, name, unit: r.product.baseUnit, qty: r.baseQty, provisional: r.provisional });
  }
  for (const id of buyRoots)
    if (makeRoots.has(id)) {
      notes.push(`${md.products.get(id)?.name ?? id} is both made and bought in this order; it is treated as made`);
      buyRoots.delete(id);
    }

  // 2. Every product that will be made, and which made product uses which.
  const made = new Set<string>();
  const children = new Map<string, Set<string>>();
  const stack = [...makeRoots];
  while (stack.length) {
    const pid = stack.pop()!;
    if (made.has(pid)) continue;
    made.add(pid);
    const kids = new Set<string>();
    for (const bl of md.boms.get(pid)?.lines ?? []) {
      const c = lineComponent(bl);
      const sub = c.type === 'PRODUCT' ? md.products.get(c.id) : undefined;
      if (sub && needsBom(sub)) {
        kids.add(c.id);
        stack.push(c.id);
      }
    }
    children.set(pid, kids);
  }

  // 3. Parents before children (so a sub-product's total need is known before its stock is deducted).
  const indegree = new Map<string, number>([...made].map((p) => [p, 0]));
  for (const kids of children.values()) for (const k of kids) indegree.set(k, (indegree.get(k) ?? 0) + 1);
  const queue = [...made].filter((p) => indegree.get(p) === 0);
  const done = new Set<string>();
  while (queue.length) {
    const pid = queue.shift()!;
    done.add(pid);
    const p = md.products.get(pid)!;
    const key = itemKey('PRODUCT', pid);
    const need = needs.get(key);
    const net = Math.max(0, (need?.qty ?? 0) - (stock[key] ?? 0));
    const bom = md.boms.get(pid);
    if (!bom || bom.lines.length === 0) {
      if (net > 0) {
        errors.push(`BOM missing for ${p.name} — its materials cannot be calculated`);
        provisional = true;
      }
    } else if (net > 0) {
      if (jo.status !== 'DRAFT' && jo.bomSnapshot && !jo.bomSnapshot[pid]) notes.push(`${p.name}: no BOM copy was saved at confirmation; the current BOM is used`);
      for (const bl of bom.lines) {
        const c = lineComponent(bl);
        const comp = componentContext(c.type, c.id, md);
        if (!comp) {
          errors.push(`${p.name}: a BOM line points to a missing ${c.type === 'PRODUCT' ? 'product' : 'raw material'}`);
          provisional = true;
          continue;
        }
        const per = convert(bl.qty, bl.unit, comp.ctx.baseUnit, comp.ctx);
        if (!per.ok) {
          errors.push(`${p.name} → ${comp.name}: ${per.error}`);
          provisional = true;
          continue;
        }
        const wastage = Number.isFinite(bl.wastagePct) && bl.wastagePct > 0 ? bl.wastagePct : 0;
        const q = net * per.value * (1 + wastage / 100);
        const prov = (need?.provisional ?? false) || per.provisional || !FIRM.includes(bl.status);
        add({ type: c.type, id: c.id, name: comp.name, unit: comp.ctx.baseUnit, qty: q, provisional: prov });
        links.push({
          parentKey: key,
          parentName: p.name,
          parentUnit: p.baseUnit,
          parentQty: net,
          childKey: itemKey(c.type, c.id),
          childName: comp.name,
          childUnit: comp.ctx.baseUnit,
          perUnit: per.value,
          wastagePct: wastage,
          qty: q,
          provisional: prov,
        });
      }
    }
    for (const k of children.get(pid) ?? []) {
      indegree.set(k, indegree.get(k)! - 1);
      if (indegree.get(k) === 0) queue.push(k);
    }
  }
  if (done.size < made.size) {
    errors.push('Loop in BOM: some products contain each other');
    provisional = true;
  }

  // 4. Rows, with where each item comes from and what it is for.
  const roots = new Set([...makeRoots, ...buyRoots].map((id) => itemKey('PRODUCT', id)));
  const nameOfKey = new Map([...needs].map(([k, n]) => [k, n.name]));
  const parentsOf = (k: string) => [...new Set(links.filter((l) => l.childKey === k).map((l) => l.parentKey))];
  const ancestry = (k: string) => {
    const usedFor = new Set<string>();
    const via = new Set<string>();
    const seen = new Set<string>();
    const walk = (c: string) => {
      for (const pk of parentsOf(c)) {
        if (seen.has(pk)) continue;
        seen.add(pk);
        const name = nameOfKey.get(pk) ?? pk;
        if (roots.has(pk)) usedFor.add(name);
        if (parentsOf(pk).length) {
          via.add(name);
          walk(pk);
        }
      }
    };
    walk(k);
    const sorted = (x: Set<string>) => [...x].sort((a, b) => a.localeCompare(b));
    return { usedFor: sorted(usedFor), via: sorted(via) };
  };
  const toProduce: PlanRow[] = [];
  const toBuy: PlanRow[] = [];
  for (const [key, n] of needs) {
    const fromStock = stock[key] ?? 0;
    const row: PlanRow = {
      key,
      type: n.type,
      id: n.id,
      name: n.name,
      unit: n.unit,
      gross: n.qty,
      fromStock,
      net: Math.max(0, n.qty - fromStock),
      provisional: n.provisional,
      madeFrom: [...new Set(links.filter((l) => l.parentKey === key).map((l) => l.childName))].sort((a, b) => a.localeCompare(b)),
      ...ancestry(key),
      ordered: roots.has(key),
    };
    if (fromStock > n.qty + 1e-9) notes.push(`${n.name}: more stock set aside than this order needs`);
    (n.type === 'PRODUCT' && made.has(n.id) ? toProduce : toBuy).push(row);
  }
  for (const key of Object.keys(stock))
    if (!needs.has(key)) notes.push(`Stock is set aside for an item this order no longer needs (${liveMd.products.get(parseItemKey(key)?.id ?? '')?.name ?? liveMd.rawMaterials.get(parseItemKey(key)?.id ?? '')?.name ?? key})`);
  const byName = (a: PlanRow, b: PlanRow) => a.name.localeCompare(b.name);
  return { toProduce: toProduce.sort(byName), toBuy: toBuy.sort(byName), links, errors, notes, provisional };
}

// ---------------------------------------------------------------------------
// No double allocation (Requirements §31.3)
// ---------------------------------------------------------------------------

export type AllocationState = 'OK' | 'OVER' | 'MANUAL_ONLY';

export interface Allocation {
  confirmed: number; // set aside on Confirmed orders
  draft: number; // set aside on Draft orders (information only)
  counted: number | null;
  countedOn: string | null;
  state: AllocationState;
}

export function allocationFor(key: string, jos: Pick<JobOrder, 'status' | 'stock'>[], count: StockCount | undefined): Allocation {
  let confirmed = 0;
  let draft = 0;
  for (const jo of jos) {
    const q = jo.stock?.[key]?.baseQty ?? 0;
    if (!(q > 0)) continue;
    if (jo.status === 'CONFIRMED') confirmed += q;
    else if (jo.status === 'DRAFT') draft += q;
  }
  if (!count) return { confirmed, draft, counted: null, countedOn: null, state: 'MANUAL_ONLY' };
  return { confirmed, draft, counted: count.qty, countedOn: count.countedOn, state: confirmed > count.qty + 1e-9 ? 'OVER' : 'OK' };
}

/** Items whose Confirmed earmarks exceed the last count. */
export function overAllocated(jos: Pick<JobOrder, 'status' | 'stock'>[], counts: Map<string, StockCount>): { key: string; allocation: Allocation }[] {
  const keys = new Set<string>();
  for (const jo of jos) if (jo.status === 'CONFIRMED') for (const k of Object.keys(jo.stock ?? {})) keys.add(k);
  const out: { key: string; allocation: Allocation }[] = [];
  for (const key of keys) {
    const p = parseItemKey(key);
    const a = allocationFor(key, jos, p ? counts.get(stockCountId(p.type, p.id)) : undefined);
    if (a.state === 'OVER') out.push({ key, allocation: a });
  }
  return out;
}

// ---------------------------------------------------------------------------
// To buy across orders
// ---------------------------------------------------------------------------

export interface BuyTotal {
  key: string;
  type: ComponentType;
  id: string;
  name: string;
  unit: string;
  net: number;
  provisional: boolean;
  orders: { joId: string; joNumber: string; net: number }[];
}

export function toBuyAcrossOrders(
  jos: (Pick<JobOrder, 'joNumber' | 'lines' | 'status' | 'bomSnapshot' | 'stock'> & { id: string })[],
  md: MasterData,
  includeDrafts: boolean,
): { rows: BuyTotal[]; ordersWithErrors: string[] } {
  const totals = new Map<string, BuyTotal>();
  const ordersWithErrors: string[] = [];
  for (const jo of jos) {
    if (!(jo.status === 'CONFIRMED' || (includeDrafts && jo.status === 'DRAFT'))) continue;
    const plan = planMaterials(jo, md);
    if (plan.errors.length) ordersWithErrors.push(jo.joNumber);
    for (const r of plan.toBuy) {
      if (!(r.net > 0)) continue;
      const t = totals.get(r.key) ?? { key: r.key, type: r.type, id: r.id, name: r.name, unit: r.unit, net: 0, provisional: false, orders: [] };
      t.net += r.net;
      t.provisional = t.provisional || r.provisional;
      t.orders.push({ joId: jo.id, joNumber: jo.joNumber, net: r.net });
      totals.set(r.key, t);
    }
  }
  return { rows: [...totals.values()].sort((a, b) => a.name.localeCompare(b.name)), ordersWithErrors };
}

/** Build a stock entry from what the user typed, converting to the item's base unit. */
export function makeStockEntry(
  input: { qty: number; unit: string; location: string; remarks: string },
  type: ComponentType,
  id: string,
  md: MasterData,
  prev: StockEntry | undefined,
  now: string,
): StockEntry | string {
  if (!Number.isFinite(input.qty) || input.qty < 0) return 'Enter a quantity of 0 or more';
  const comp = componentContext(type, id, md);
  if (!comp) return 'Item not found';
  const c = convert(input.qty, input.unit, comp.ctx.baseUnit, comp.ctx);
  if (!c.ok) return c.error;
  const same = prev && prev.qty === input.qty && prev.unit === input.unit;
  return {
    qty: input.qty,
    unit: input.unit,
    baseQty: c.value,
    location: input.location.trim(),
    remarks: input.remarks.trim(),
    changedAt: same ? prev.changedAt : now,
    prevBaseQty: same ? prev.prevBaseQty : (prev?.baseQty ?? null),
  };
}
