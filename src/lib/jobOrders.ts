/**
 * Job Order core (Phase 3a): shapes and pure, deterministic calculations.
 * Requirements v1.9 §31.4 (10% buffer) and CLAUDE.md phase-plan decisions.
 */
import type { ProgressEntry } from './progress';
import {
  bomStatus,
  lineComponent,
  needsBom,
  productContext,
  type BomLine,
  type MasterData,
  type Product,
} from './masters';
import { convert } from './units';

export const COLLECTION_JOB_ORDERS = 'jobOrders';

// ---------------------------------------------------------------------------
// Calendar dates (YYYY-MM-DD, no time zone; the user's IST calendar day)
// ---------------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Day number of a YYYY-MM-DD date, or null if it is not a real date. */
export function dayNumber(date: string): number | null {
  const m = DATE_RE.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return Math.round(t / 86_400_000);
}

export function dateFromDayNumber(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

/** Calendar days from a to b (b − a). Null if either date is invalid. */
export function daysBetween(a: string, b: string): number | null {
  const x = dayNumber(a);
  const y = dayNumber(b);
  return x === null || y === null ? null : y - x;
}

export function addDays(date: string, n: number): string | null {
  const x = dayNumber(date);
  return x === null ? null : dateFromDayNumber(x + n);
}

const dayFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
export function formatDay(date: string | null | undefined): string {
  const n = date ? dayNumber(date) : null;
  return n === null ? '—' : dayFmt.format(new Date(n * 86_400_000));
}

// ---------------------------------------------------------------------------
// Internal deadline (10% buffer, rounded up, minimum 1 day)
// ---------------------------------------------------------------------------

/** Stored on every Job Order; a later rule change never rewrites old orders. */
export const DEADLINE_RULE_VERSION = 'buffer-10pct-ceil-min1/v1';

export interface Deadline {
  orderPeriodDays: number;
  bufferDays: number;
  internalDeadline: string;
  ruleVersion: string;
}

export type DeadlineResult = ({ ok: true } & Deadline) | { ok: false; error: string };

/**
 * Order Period = calendar days from received date to customer delivery date.
 * Buffer = ceiling(period × 10%), at least 1. Internal deadline = delivery − buffer.
 * Integer arithmetic only (no floating-point rounding surprises).
 */
export function computeDeadline(receivedDate: string, deliveryDate: string): DeadlineResult {
  if (dayNumber(receivedDate) === null) return { ok: false, error: 'Enter the date the Job Order was received' };
  if (dayNumber(deliveryDate) === null) return { ok: false, error: 'Enter the customer delivery date' };
  const period = daysBetween(receivedDate, deliveryDate)!;
  if (period <= 0) return { ok: false, error: 'The delivery date must be after the received date' };
  const buffer = Math.max(1, Math.floor((period + 9) / 10));
  return {
    ok: true,
    orderPeriodDays: period,
    bufferDays: buffer,
    internalDeadline: addDays(deliveryDate, -buffer)!,
    ruleVersion: DEADLINE_RULE_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Job Order shapes
// ---------------------------------------------------------------------------

export type DeliveryDateType = 'UNCONFIRMED' | 'FACTORY_DISPATCH' | 'PORT' | 'CUSTOMER_DESTINATION';
export const DELIVERY_DATE_TYPES: { id: DeliveryDateType; label: string }[] = [
  { id: 'UNCONFIRMED', label: 'Not confirmed yet' },
  { id: 'FACTORY_DISPATCH', label: 'Factory dispatch (ex-factory)' },
  { id: 'PORT', label: 'Port / container loading' },
  { id: 'CUSTOMER_DESTINATION', label: 'Arrival at customer' },
];

export type JoStatus = 'DRAFT' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
export const JO_STATUS_LABEL: Record<JoStatus, string> = {
  DRAFT: 'Draft',
  CONFIRMED: 'Confirmed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

/** Allowed status changes (also enforced in firestore.rules). */
export const TRANSITIONS: Record<JoStatus, JoStatus[]> = {
  DRAFT: ['DRAFT', 'CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CONFIRMED', 'COMPLETED', 'CANCELLED'],
  COMPLETED: ['CONFIRMED'], // reopen
  CANCELLED: ['DRAFT'], // reopen
};

export function canTransition(from: JoStatus, to: JoStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** A reason is required to cancel or reopen (also enforced in rules); edits only record what changed. */
export function reasonRequired(from: JoStatus | null, to: JoStatus): boolean {
  if (from === null) return false;
  return to === 'CANCELLED' || from === 'COMPLETED' || from === 'CANCELLED';
}

export function isEditable(s: JoStatus): boolean {
  return s === 'DRAFT' || s === 'CONFIRMED';
}

export type SupplyMethod = 'MAKE' | 'BUY';

export interface JoLine {
  id: string;
  productId: string;
  productName: string; // name at the time of saving (for print/history)
  qty: number;
  unit: string;
  /** MAKE / BUY; null only while a BOTH product is undecided. */
  supply: SupplyMethod | null;
}

export interface BomSnapshotEntry {
  rev: number;
  lines: BomLine[];
}

export interface JobOrder {
  joNumber: string;
  customerId: string;
  customerName: string;
  poNumber: string;
  receivedDate: string;
  deliveryDate: string;
  deliveryDateType: DeliveryDateType;
  deadline: Deadline;
  status: JoStatus;
  lines: JoLine[];
  notes: string;
  /** BOMs used, taken when the order is confirmed (product id → BOM). */
  bomSnapshot: Record<string, BomSnapshotEntry> | null;
  confirmedOn: string | null;
  /** Stock set aside for this order, by item key ("RAW_MATERIAL:id" / "PRODUCT:id"). Phase 3b. */
  stock?: Record<string, StockEntry>;
  /** Manual % complete until stage tracking exists (dashboard). */
  progress?: ProgressEntry | null;
  /** Every progress update with its time, oldest first (for performance reports). */
  progressLog?: ProgressEntry[];
  /** Date the order was marked completed (cleared if reopened). */
  completedOn?: string | null;
}

/** Completion date after a status change: set on completion, cleared on reopen, else kept. */
export function completedOnAfter(from: JoStatus | null, to: JoStatus, previous: string | null | undefined, today: string): string | null {
  if (to === 'COMPLETED') return from === 'COMPLETED' ? (previous ?? today) : today;
  if (from === 'COMPLETED') return null;
  return previous ?? null;
}

/** Stock earmarked for one Job Order (Requirements §31.3), confirmed manually. */
export interface StockEntry {
  qty: number; // as entered
  unit: string; // as entered
  baseQty: number; // in the item's base unit (deterministic conversion at entry)
  location: string;
  remarks: string;
  changedAt: string; // ISO time of the last change (client clock)
  prevBaseQty: number | null; // value before the last change
}

/** Fixed by the product master: MANUFACTURED is always made, TRADED always bought. */
export function fixedSupply(p: Pick<Product, 'supplyType'>): SupplyMethod | null {
  return p.supplyType === 'MANUFACTURED' ? 'MAKE' : p.supplyType === 'TRADED' ? 'BUY' : null;
}

/** Pre-filled choice for a new line: fixed, or the usual choice of a BOTH product (changeable). */
export function initialSupply(p: Pick<Product, 'supplyType' | 'usualSupply'>): SupplyMethod | null {
  return fixedSupply(p) ?? p.usualSupply ?? null;
}

/** Make/Buy is only a choice for BOTH products; the others are fixed by the master. */
export function effectiveSupply(line: Pick<JoLine, 'supply'>, p: Pick<Product, 'supplyType'> | undefined): SupplyMethod | null {
  if (!p) return line.supply;
  return fixedSupply(p) ?? line.supply;
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

export interface ResolvedLine {
  product: Product | null;
  baseQty: number | null;
  baseUnit: string | null;
  provisional: boolean;
  problem: string | null; // conversion or product problem (not blocking)
}

export function resolveLine(line: Pick<JoLine, 'productId' | 'qty' | 'unit'>, md: MasterData): ResolvedLine {
  const product = md.products.get(line.productId) ?? null;
  if (!product) return { product, baseQty: null, baseUnit: null, provisional: true, problem: 'Product not found' };
  const c = convert(line.qty, line.unit, product.baseUnit, productContext(product));
  if (!c.ok) return { product, baseQty: null, baseUnit: product.baseUnit, provisional: true, problem: c.error };
  return { product, baseQty: c.value, baseUnit: product.baseUnit, provisional: c.provisional, problem: null };
}

export interface ConfirmCheck {
  blocking: string[];
  warnings: string[];
}

/** What stops a Job Order from being confirmed, and what only needs a warning. */
export function checkForConfirm(jo: Pick<JobOrder, 'lines' | 'deliveryDateType' | 'deadline'>, md: MasterData, today: string): ConfirmCheck {
  const blocking: string[] = [];
  const warnings: string[] = [];
  if (jo.lines.length === 0) blocking.push('Add at least one product line');
  jo.lines.forEach((l, i) => {
    const n = `Line ${i + 1}`;
    const p = md.products.get(l.productId);
    if (!p) return void blocking.push(`${n}: choose a product`);
    if (!(l.qty > 0)) blocking.push(`${n}: quantity must be more than 0`);
    const supply = effectiveSupply(l, p);
    if (!supply) blocking.push(`${n} (${p.name}): choose Make or Buy`);
    const r = resolveLine(l, md);
    if (r.problem) warnings.push(`${n} (${p.name}): ${r.problem}`);
    if (supply === 'MAKE') {
      const s = bomStatus(l.productId, md);
      if (s === 'MISSING') warnings.push(`${n} (${p.name}): BOM missing — raw materials cannot be calculated yet`);
      if (s === 'PROVISIONAL') warnings.push(`${n} (${p.name}): BOM not fully confirmed`);
    }
  });
  if (jo.deliveryDateType === 'UNCONFIRMED') warnings.push('Delivery date type is not confirmed yet');
  if (jo.deadline.internalDeadline < today) warnings.push('The internal deadline has already passed');
  return { blocking, warnings };
}

// ---------------------------------------------------------------------------
// BOM snapshot (taken at confirmation)
// ---------------------------------------------------------------------------

function copyLines(lines: BomLine[]): BomLine[] {
  return JSON.parse(JSON.stringify(lines)) as BomLine[];
}

/**
 * Snapshot every BOM reachable from the MAKE lines (sub-products included).
 * Entries already in `existing` are kept as they are; only missing ones are added.
 */
export function snapshotBoms(
  lines: JoLine[],
  md: MasterData,
  revOf: (productId: string) => number,
  existing: Record<string, BomSnapshotEntry> | null = null,
): Record<string, BomSnapshotEntry> {
  const out: Record<string, BomSnapshotEntry> = { ...(existing ?? {}) };
  const stack = lines.filter((l) => effectiveSupply(l, md.products.get(l.productId)) === 'MAKE').map((l) => l.productId);
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const p = md.products.get(id);
    if (!p || !needsBom(p)) continue;
    const entry = out[id] ?? (md.boms.get(id) ? { rev: revOf(id), lines: copyLines(md.boms.get(id)!.lines) } : undefined);
    if (!entry) continue; // BOM missing: nothing to snapshot yet
    out[id] = entry;
    for (const bl of entry.lines) {
      const c = lineComponent(bl);
      if (c.type === 'PRODUCT') stack.push(c.id);
    }
  }
  return out;
}

/** Products whose BOM changed (or disappeared) after it was snapshotted. */
export function changedBoms(snapshot: Record<string, BomSnapshotEntry> | null, md: MasterData, revOf: (productId: string) => number): string[] {
  if (!snapshot) return [];
  return Object.entries(snapshot)
    .filter(([id, e]) => !md.boms.has(id) || revOf(id) !== e.rev)
    .map(([id]) => id);
}

// ---------------------------------------------------------------------------
// Deadline state and attention items
// ---------------------------------------------------------------------------

export const DUE_SOON_DAYS = 7;

export type DeadlineState = 'DELIVERY_PASSED' | 'OVERDUE' | 'DUE_SOON' | 'ON_TRACK' | 'CLOSED';

export function deadlineState(jo: Pick<JobOrder, 'status' | 'deadline' | 'deliveryDate'>, today: string): DeadlineState {
  if (jo.status === 'COMPLETED' || jo.status === 'CANCELLED') return 'CLOSED';
  if (jo.deliveryDate < today) return 'DELIVERY_PASSED';
  if (jo.deadline.internalDeadline < today) return 'OVERDUE';
  const left = daysBetween(today, jo.deadline.internalDeadline);
  return left !== null && left <= DUE_SOON_DAYS ? 'DUE_SOON' : 'ON_TRACK';
}

export interface JoAttention {
  kind: 'DELIVERY_PASSED' | 'OVERDUE' | 'DUE_SOON' | 'UNDECIDED' | 'BOM_CHANGED' | 'CONVERSION';
  joId: string;
  joNumber: string;
  detail: string;
}

export function jobOrderAttention(
  jos: (JobOrder & { id: string })[],
  md: MasterData,
  revOf: (productId: string) => number,
  today: string,
): JoAttention[] {
  const out: JoAttention[] = [];
  for (const jo of jos) {
    if (!isEditable(jo.status)) continue;
    const base = { joId: jo.id, joNumber: jo.joNumber };
    const st = deadlineState(jo, today);
    if (st === 'DELIVERY_PASSED') out.push({ ...base, kind: st, detail: `Delivery date was ${formatDay(jo.deliveryDate)}` });
    if (st === 'OVERDUE') out.push({ ...base, kind: st, detail: `Internal deadline was ${formatDay(jo.deadline.internalDeadline)}` });
    if (st === 'DUE_SOON') {
      const left = daysBetween(today, jo.deadline.internalDeadline)!;
      out.push({ ...base, kind: st, detail: left === 0 ? 'Internal deadline is today' : `Internal deadline in ${left} day${left === 1 ? '' : 's'}` });
    }
    const undecided = jo.lines.filter((l) => !effectiveSupply(l, md.products.get(l.productId))).length;
    if (undecided) out.push({ ...base, kind: 'UNDECIDED', detail: `${undecided} line${undecided === 1 ? '' : 's'} need Make or Buy` });
    const conv = jo.lines.filter((l) => resolveLine(l, md).problem).length;
    if (conv) out.push({ ...base, kind: 'CONVERSION', detail: `${conv} line${conv === 1 ? '' : 's'} cannot be converted to the base unit` });
    if (jo.status === 'CONFIRMED' && changedBoms(jo.bomSnapshot, md, revOf).length)
      out.push({ ...base, kind: 'BOM_CHANGED', detail: 'A BOM changed after this order was confirmed' });
  }
  return out;
}

export function normalizeJoNumber(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toUpperCase();
}

export function findDuplicateJo(joNumber: string, all: (Pick<JobOrder, 'joNumber' | 'status'> & { id: string })[], selfId?: string) {
  const n = normalizeJoNumber(joNumber);
  return all.find((j) => j.id !== selfId && j.status !== 'CANCELLED' && normalizeJoNumber(j.joNumber) === n);
}

export function newLineId(): string {
  return Math.random().toString(36).slice(2, 10);
}
