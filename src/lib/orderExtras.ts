/**
 * Round 2 from the company WO files (confirmed 17 Nov 2026):
 *  - Order items: things to arrange for one order that are not in any BOM (stencil plates, plotter
 *    prints, swing tickets, care labels, shipping marks…), with supplier, PO and dates, and the process
 *    they are needed before ("Ready to start?" checks them).
 *  - Customer requirements: a checklist per order (sample approvals, fumigation certificate, booking…),
 *    each due on a date or N working days before cargo ready; written by the user, never invented.
 * Pure functions, no I/O.
 */
import { addWorkingDays, type WorkCalendar } from './calendar';
import { withExpected, type JobOrder } from './jobOrders';
import type { Product } from './masters';

export interface OrderItem {
  id: string;
  item: string;
  qty?: number | null;
  unit?: string;
  supplierId?: string | null;
  poNo?: string;
  orderedOn?: string | null;
  /** The supplier's date; earlier ones in `expectedHistory` (first = the original promise). */
  expectedOn?: string | null;
  expectedHistory?: { on: string; at: string }[];
  landedOn?: string | null;
  /** Process id it is needed before (optional). */
  neededAt?: string | null;
  note?: string;
}

export interface CheckItem {
  id: string;
  text: string;
  /** Due N working days before the cargo ready date (kept when the date changes), or a fixed date. */
  daysBefore?: number | null;
  due?: string | null;
  doneOn?: string | null;
  note?: string;
}

export type ItemState = 'LANDED' | 'LATE' | 'EXPECTED' | 'ORDERED' | 'TO_ORDER';

export const newExtraId = () => `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function itemState(it: OrderItem, today: string): ItemState {
  if (it.landedOn) return 'LANDED';
  if (it.expectedOn) return it.expectedOn < today ? 'LATE' : 'EXPECTED';
  return it.orderedOn || it.poNo || it.supplierId ? 'ORDERED' : 'TO_ORDER';
}

/** Saves an item, keeping the earlier expected date in its history. */
export function upsertItem(items: OrderItem[] | undefined, next: OrderItem, at: string): OrderItem[] {
  const list = items ?? [];
  const prev = list.find((x) => x.id === next.id);
  const merged = prev ? withExpected({ ...next, expectedOn: prev.expectedOn, expectedHistory: prev.expectedHistory }, next.expectedOn ?? null, at) : next;
  return prev ? list.map((x) => (x.id === next.id ? merged : x)) : [...list, merged];
}

/** Order items needed before a process and not landed yet. */
export function itemsMissingAt(jo: Pick<JobOrder, 'orderItems'>, processId: string | null | undefined): OrderItem[] {
  if (!processId) return [];
  return (jo.orderItems ?? []).filter((x) => x.neededAt === processId && !x.landedOn);
}

/** The due date of a requirement: its own date, or N working days before cargo ready. */
export function checkDue(c: CheckItem, jo: Pick<JobOrder, 'deliveryDate'>, cal: WorkCalendar): string | null {
  if (c.due) return c.due;
  if (c.daysBefore === null || c.daysBefore === undefined || !jo.deliveryDate) return null;
  return c.daysBefore === 0 ? jo.deliveryDate : addWorkingDays(jo.deliveryDate, -Math.abs(c.daysBefore), cal);
}

/** The requirements of the latest earlier WO of the same customer, ready to copy (not done, no notes). */
export function lastChecklist(jos: (Pick<JobOrder, 'customerId' | 'receivedDate' | 'checklist'> & { id: string })[], customerId: string, exceptId: string | null): CheckItem[] {
  const prev = jos.filter((j) => j.id !== exceptId && j.customerId === customerId && (j.checklist?.length ?? 0) > 0).sort((a, b) => b.receivedDate.localeCompare(a.receivedDate))[0];
  // Fixed dates belong to that order; the "N working days before cargo ready" rule is kept.
  return (prev?.checklist ?? []).map((c) => ({ id: newExtraId(), text: c.text, ...(c.daysBefore !== null && c.daysBefore !== undefined ? { daysBefore: c.daysBefore } : {}) }));
}

/**
 * Suggested order items from the products' design fields (the user checks them before saving):
 * stencil plates per design, and one cutting plate for each shaped design. Nothing is suggested
 * for a product without design fields.
 */
export function suggestedItems(jo: Pick<JobOrder, 'lines' | 'orderItems'>, products: Map<string, Product>, printing: string | null): OrderItem[] {
  const have = new Set((jo.orderItems ?? []).map((x) => x.item.toLowerCase()));
  const out: OrderItem[] = [];
  jo.lines.forEach((l, n) => {
    const p = products.get(l.productId);
    if (!p) return;
    const add = (item: string, qty: number) => !have.has(item.toLowerCase()) && out.push({ id: newExtraId(), item, qty, unit: 'pcs', neededAt: printing });
    if (p.stencilPlates && p.stencilPlates > 0) add(`Stencil plates - ${n + 1}. ${p.name}`, p.stencilPlates);
    if (p.shape === 'SHAPED' || p.shape === 'HALFROUND') add(`Cutting plate - ${n + 1}. ${p.name}`, 1);
  });
  return out;
}

export const SHAPES = [
  { id: 'RECTANGULAR', label: 'Rectangular' },
  { id: 'SHAPED', label: 'Shaped' },
  { id: 'HALFROUND', label: 'Half round' },
] as const;
export type Shape = (typeof SHAPES)[number]['id'];
