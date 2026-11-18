import { collection, doc, getDocFromServer, getDocsFromServer, query, where, writeBatch, type DocumentReference } from 'firebase/firestore';
import { db } from '../../firebase';
import { COLLECTION_JOB_ORDERS } from '../../lib/jobOrders';
import { modeOfWorkspace } from '../../lib/mode';
import { COLLECTION_TASKS } from '../../lib/tasks';
import { readListsAgain } from '../masters/useCollection';
import { saveRecord } from '../sync/records';

const META = ['rev', 'updatedAt', 'updatedBy', 'lastAuditId', 'createdAt', 'createdBy'];

/** True only for the DEMO workspace (never ACTUAL). */
export const isDemoWorkspace = (ws: string | null | undefined): ws is string => !!ws && ws.endsWith('_demo') && modeOfWorkspace(ws) === 'DEMO';

async function deleteRefs(refs: DocumentReference[]): Promise<void> {
  for (let i = 0; i < refs.length; i += 400) {
    const b = writeBatch(db);
    for (const r of refs.slice(i, i + 400)) b.delete(r);
    await b.commit();
  }
}

/**
 * DEMO only (18 Nov 2026): deletes Work Orders with their history; Work tasks linked to them stay,
 * with the link removed (the WO number stays in the task as text). Masters, stock counts and
 * settings are not touched. `ids` = null deletes every WO of the DEMO workspace. Needs internet.
 */
export async function deleteDemoJobOrders(workspaceId: string, ids: string[] | null): Promise<{ orders: number; history: number; tasks: number }> {
  if (!isDemoWorkspace(workspaceId)) throw new Error('Only in DEMO.');
  const base = `workspaces/${workspaceId}`;
  let orderIds: string[];
  if (ids === null) {
    const snap = await getDocsFromServer(collection(db, `${base}/${COLLECTION_JOB_ORDERS}`));
    orderIds = snap.docs.map((d) => d.id);
  } else {
    orderIds = [];
    for (const id of ids) if ((await getDocFromServer(doc(db, `${base}/${COLLECTION_JOB_ORDERS}/${id}`))).exists()) orderIds.push(id);
  }
  if (!orderIds.length) return { orders: 0, history: 0, tasks: 0 };
  // Linked tasks: keep, remove the link (a normal history entry each).
  const tasks = await getDocsFromServer(collection(db, `${base}/${COLLECTION_TASKS}`));
  const set = new Set(orderIds);
  let t = 0;
  for (const d of tasks.docs) {
    const data = d.data() as Record<string, unknown>;
    if (typeof data.joId !== 'string' || !set.has(data.joId)) continue;
    const clean = Object.fromEntries(Object.entries(data).filter(([k]) => !META.includes(k)));
    saveRecord({ workspaceId, collectionName: COLLECTION_TASKS, docId: d.id, entity: `Task: ${String(data.title ?? '')}`, before: { ...data, id: d.id } as never, data: { ...clean, joId: null }, reason: `Linked Work Order ${String(data.joNumber ?? '')} deleted (DEMO)` });
    t++;
  }
  // History of the deleted orders.
  const auditRefs: DocumentReference[] = [];
  for (let i = 0; i < orderIds.length; i += 30) {
    const snap = await getDocsFromServer(query(collection(db, `${base}/auditEvents`), where('entityId', 'in', orderIds.slice(i, i + 30))));
    for (const d of snap.docs) if (String(d.data().entityPath ?? '').includes(`/${COLLECTION_JOB_ORDERS}/`)) auditRefs.push(d.ref);
  }
  await deleteRefs(auditRefs);
  await deleteRefs(orderIds.map((id) => doc(db, `${base}/${COLLECTION_JOB_ORDERS}/${id}`)));
  readListsAgain(workspaceId);
  return { orders: orderIds.length, history: auditRefs.length, tasks: t };
}
