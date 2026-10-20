/**
 * "When we get this information, we can build/turn on that": the company
 * information still needed after joining, and what each piece unlocks.
 */

export type ReadinessStatus = 'PENDING' | 'RECEIVED' | 'NOT_NEEDED';

export interface ReadinessItem {
  id: string;
  need: string; // what to collect
  ask: string; // whom / where to ask (a hint)
  unlocks: string; // what it enables in ExportFlow
  phase: string;
}

export const READINESS_ITEMS: ReadinessItem[] = [
  { id: 'data-policy', need: 'Company policy on keeping work data in a personal app', ask: 'HR / IT / your manager', unlocks: 'Using ACTUAL mode with real customers, orders and recipes', phase: 'Before real use' },
  { id: 'jo-sample', need: 'A few sample Job Orders (Excel / PDF / photo) as the director sends them', ask: 'Director / order desk', unlocks: 'Job Order import, Share → ExportFlow', phase: 'Import' },
  { id: 'delivery-meaning', need: 'What the delivery date on a JO means (ex-factory, port loading, arrival)', ask: 'Director / export documentation', unlocks: 'Correct internal deadlines (10% buffer, working days)', phase: 'Job Orders' },
  { id: 'products', need: 'Product list: sizes, GSM / weight, and units like bale or roll', ask: 'Production / sales', unlocks: 'Unit conversion (pcs ↔ sq m ↔ kg) on orders and BOMs', phase: 'Masters' },
  { id: 'bom', need: 'Recipes (BOM) per product, with wastage %', ask: 'Production manager', unlocks: 'Raw materials to buy, To produce lists', phase: 'Masters' },
  { id: 'processes', need: 'Treatments / processes each product goes through, in order', ask: 'Production floor', unlocks: 'Stage tracking per order; real % progress instead of the slider', phase: 'Phase 4' },
  { id: 'departments', need: 'Departments and which processes each one handles', ask: 'Production / HR', unlocks: 'Department-wise daily to-do and target lists', phase: 'Phase 4–5' },
  { id: 'holidays', need: 'Weekly off day(s) and the company holiday list for the year', ask: 'HR / admin', unlocks: 'Working-day deadlines and step plans (dashboard calendar)', phase: 'Job Orders' },
  { id: 'benchmarks', need: 'Output per day for each process (and fixed days such as drying), and daily output per department', ask: 'Production manager / past records', unlocks: 'Planning, daily targets, performance reports', phase: 'Phase 4–5' },
  { id: 'approvals', need: 'Who approves what (purchases, overtime, dispatch) and how', ask: 'Management', unlocks: 'Approval records with on-time / late tracking', phase: 'Phase 4' },
  { id: 'suppliers', need: 'Supplier list, what each supplies, usual lead times', ask: 'Purchase department', unlocks: 'Purchase planning, supplier suggestions on To buy', phase: 'Procurement' },
  { id: 'po-rfq', need: 'Purchase order and quotation-request formats; PO approval rules', ask: 'Purchase / accounts', unlocks: 'Draft RFQ letters and purchase orders (PDF)', phase: 'Procurement' },
  { id: 'qc', need: 'QC checks per product and how rejections / rework are recorded', ask: 'QC in-charge', unlocks: 'QC tracking and rework in performance reports', phase: 'Later' },
  { id: 'packing', need: 'Packing norms (pcs per bale/carton) and container loading norms', ask: 'Packing / logistics', unlocks: 'Packing and container estimates', phase: 'Later' },
  { id: 'letterhead', need: 'Company logo and address for documents', ask: 'Admin', unlocks: 'Letterhead on PDFs', phase: 'Documents' },
  { id: 'erp-export', need: 'Whether an ERP / Excel already holds orders, stock or masters, and if it can export', ask: 'IT / accounts', unlocks: 'Import instead of typing the same data twice', phase: 'Import' },
];

export interface ReadinessState {
  status: ReadinessStatus;
  note: string;
  on: string | null; // date of the last change (YYYY-MM-DD)
}

export interface ReadinessDoc {
  items: Record<string, ReadinessState>;
}

export const READINESS_DOC = 'readiness';

export function stateOf(doc: ReadinessDoc | null | undefined, id: string): ReadinessState {
  return doc?.items?.[id] ?? { status: 'PENDING', note: '', on: null };
}

export function readinessSummary(doc: ReadinessDoc | null | undefined): { received: number; notNeeded: number; pending: number; total: number } {
  let received = 0;
  let notNeeded = 0;
  for (const it of READINESS_ITEMS) {
    const s = stateOf(doc, it.id).status;
    if (s === 'RECEIVED') received += 1;
    if (s === 'NOT_NEEDED') notNeeded += 1;
  }
  const total = READINESS_ITEMS.length;
  return { received, notNeeded, pending: total - received - notNeeded, total };
}

/** The checklist is about real progress, so it always lives in the ACTUAL workspace. */
export function readinessWorkspace(uid: string | undefined, fallback: string | null): string | null {
  return uid && /^[A-Za-z0-9]+$/.test(uid) ? `${uid}_actual` : fallback;
}
