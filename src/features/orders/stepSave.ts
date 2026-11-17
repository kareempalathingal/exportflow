/**
 * Saving a WO's step and material updates (17 Nov 2026): one place, used by the WO page
 * (Products / Materials tabs) and the Today card, so both write the same record, progress
 * and history entry.
 */
import { COLLECTION_JOB_ORDERS, type JobOrder, type JoLine, type MaterialDates } from '../../lib/jobOrders';
import { appendProgress } from '../../lib/progress';
import { orderStepProgress, type PlanContext } from '../../lib/route';
import { saveRecord } from '../sync/records';
import type { WithMeta } from '../masters/useCollection';

type Jo = WithMeta<JobOrder>;

/** The business fields of a Work Order record (without sync metadata). */
export function jobOrderData(jo: JobOrder): JobOrder {
  return {
    joNumber: jo.joNumber,
    customerId: jo.customerId,
    customerName: jo.customerName,
    poNumber: jo.poNumber,
    receivedDate: jo.receivedDate,
    deliveryDate: jo.deliveryDate,
    deliveryDateType: jo.deliveryDateType,
    deadline: jo.deadline,
    status: jo.status,
    lines: jo.lines,
    notes: jo.notes,
    bomSnapshot: jo.bomSnapshot,
    confirmedOn: jo.confirmedOn,
    stock: jo.stock ?? {},
    progress: jo.progress ?? null,
    progressLog: jo.progressLog ?? [],
    completedOn: jo.completedOn ?? null,
    ...(jo.materialDates ? { materialDates: jo.materialDates } : {}),
    ...(jo.itemOrderRule ? { itemOrderRule: jo.itemOrderRule } : {}),
    ...(jo.baselines ? { baselines: jo.baselines } : {}),
  };
}

/** Saves new lines (step changes) with the order's progress, as one history entry. */
export function saveJoLines(workspaceId: string | null, jo: Jo, lines: JoLine[], what: string, today: string, ctx: PlanContext): void {
  if (!workspaceId) return;
  const next = { ...jobOrderData(jo), lines };
  const p = orderStepProgress(next, today, ctx);
  const at = new Date().toISOString();
  const data = p ? { ...next, progress: { pct: p.actual, on: today, at }, progressLog: appendProgress(jo.progressLog, { pct: p.actual, on: today, at }) } : next;
  saveRecord({ workspaceId, collectionName: COLLECTION_JOB_ORDERS, docId: jo.id, entity: `Work Order: ${jo.joNumber}`, before: jo, data: JSON.parse(JSON.stringify(data)) as Record<string, unknown>, reason: what });
}

/** Saves the material arrival dates of a WO. */
export function saveMaterialDates(workspaceId: string | null, jo: Jo, materialDates: Record<string, MaterialDates>, what: string): void {
  if (!workspaceId) return;
  saveRecord({ workspaceId, collectionName: COLLECTION_JOB_ORDERS, docId: jo.id, entity: `Work Order: ${jo.joNumber}`, before: jo, data: JSON.parse(JSON.stringify({ ...jobOrderData(jo), materialDates })) as Record<string, unknown>, reason: what });
}

export { canEnterOutput, doneUpdate, outputUpdate, withLineSteps } from '../../lib/stepUpdates';
