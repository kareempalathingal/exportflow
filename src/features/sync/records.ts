import {
  collection,
  doc,
  getDocFromServer,
  serverTimestamp,
  waitForPendingWrites,
  writeBatch,
  type FirestoreError,
} from 'firebase/firestore';
import { auth, db } from '../../firebase';
import { diffFields, normalizeReason, type AuditAction } from '../../lib/audit';
import {
  classifyRejection,
  markSynced,
  reconcileAfterRestart,
  type PendingOp,
} from '../../lib/syncState';
import { syncStore } from './syncStore';

export interface VersionedRecord {
  rev: number;
  [field: string]: unknown;
}

export interface SaveArgs {
  workspaceId: string;
  collectionName: string; // must be allowed in firestore.rules
  docId: string;
  entity: string; // human label for history, e.g. "Profile"
  before: VersionedRecord | null; // the version the user edited (null = new)
  data: Record<string, unknown>; // business fields only
  reason?: string;
  action?: AuditAction;
}

/**
 * Write a record and its audit event in one atomic batch. The batch is queued
 * locally when offline; the returned op is tracked until the server confirms
 * or rejects it. The UI never waits for the server.
 */
export function saveRecord(args: SaveArgs): PendingOp {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');

  const baseRev = args.before?.rev ?? 0;
  const newRev = baseRev + 1;
  const path = `workspaces/${args.workspaceId}/${args.collectionName}/${args.docId}`;
  const recordRef = doc(db, path);
  const auditRef = doc(collection(db, `workspaces/${args.workspaceId}/auditEvents`));

  const changes = diffFields(args.before, args.data);
  const batch = writeBatch(db);
  batch.set(recordRef, {
    ...args.data,
    rev: newRev,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    lastAuditId: auditRef.id,
  });
  batch.set(auditRef, {
    entity: args.entity,
    entityPath: path,
    entityId: args.docId,
    action: args.action ?? (args.before ? 'UPDATE' : 'CREATE'),
    rev: newRev,
    changes: JSON.parse(JSON.stringify(changes)),
    reason: normalizeReason(args.reason),
    actorUid: uid,
    at: serverTimestamp(),
  });

  const op: PendingOp = {
    id: auditRef.id,
    workspaceId: args.workspaceId,
    path,
    entity: args.entity,
    label: changes.map((c) => c.field).join(', ') || args.entity,
    baseRev,
    newRev,
    data: JSON.parse(JSON.stringify(args.data)),
    createdAt: Date.now(),
    status: 'PENDING',
  };
  syncStore.upsert(op);

  batch.commit().then(
    () => syncStore.update(op.id, markSynced),
    async (err: FirestoreError) => {
      const serverRev = await readServerRev(path);
      syncStore.update(op.id, (o) => classifyRejection(o, err.code, serverRev));
    },
  );
  return op;
}

async function readServerRev(path: string): Promise<number | null> {
  try {
    const snap = await getDocFromServer(doc(db, path));
    const rev = snap.exists() ? snap.get('rev') : null;
    return typeof rev === 'number' ? rev : null;
  } catch {
    return null;
  }
}

/**
 * Ops left PENDING when the app was closed: once online, let Firestore flush
 * its queue, then check whether each op's audit event reached the server.
 */
export async function reconcileStaleOps(): Promise<void> {
  const stale = syncStore.all().filter((o) => o.status === 'PENDING');
  if (stale.length === 0 || !navigator.onLine) return;
  try {
    await waitForPendingWrites(db);
  } catch {
    return;
  }
  for (const op of stale) {
    try {
      const audit = await getDocFromServer(doc(db, `workspaces/${op.workspaceId}/auditEvents/${op.id}`));
      const serverRev = await readServerRev(op.path);
      syncStore.update(op.id, (o) => reconcileAfterRestart(o, audit.exists(), serverRev));
    } catch {
      /* still unreachable; try again next time */
    }
  }
}
