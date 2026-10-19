/**
 * Pure state machine for tracking each local write until the server confirms
 * or rejects it (Requirements §43, §45; Tech Plan §3.3).
 *
 * Every record carries a revision number `rev`. A write sends rev = base + 1
 * and the security rules accept it only if the server copy still has rev = base.
 * A rejected write whose base revision is stale is therefore a conflict, not a
 * silent overwrite.
 */

export type SyncStatus = 'PENDING' | 'SYNCED' | 'FAILED' | 'CONFLICT';

export interface PendingOp {
  id: string; // also the audit event id written in the same batch
  workspaceId: string;
  path: string; // document path, e.g. workspaces/x/settings/profile
  entity: string;
  label: string;
  baseRev: number;
  newRev: number;
  data: Record<string, unknown>;
  createdAt: number;
  status: SyncStatus;
  error?: string;
}

export function markSynced(op: PendingOp): PendingOp {
  return { ...op, status: 'SYNCED', error: undefined };
}

/**
 * Classify a rejected write. `serverRev` is the server's current revision
 * (null if the document does not exist or could not be read).
 */
export function classifyRejection(
  op: PendingOp,
  errorCode: string,
  serverRev: number | null,
): PendingOp {
  const stale = serverRev !== null && serverRev !== op.baseRev;
  if (errorCode === 'permission-denied' && stale) {
    return { ...op, status: 'CONFLICT', error: `Changed elsewhere (now revision ${serverRev})` };
  }
  return { ...op, status: 'FAILED', error: errorCode };
}

/**
 * Reconcile an op left PENDING when the app was closed, after the device is
 * back online and all queued writes were processed.
 */
export function reconcileAfterRestart(
  op: PendingOp,
  auditEventExists: boolean,
  serverRev: number | null,
): PendingOp {
  if (op.status !== 'PENDING') return op;
  if (auditEventExists) return markSynced(op);
  return classifyRejection(op, 'permission-denied', serverRev);
}

export function summarize(ops: PendingOp[]): Record<SyncStatus, number> {
  const out: Record<SyncStatus, number> = { PENDING: 0, SYNCED: 0, FAILED: 0, CONFLICT: 0 };
  for (const op of ops) out[op.status] += 1;
  return out;
}

/** Keep unresolved ops and the most recent synced ones for display. */
export function prune(ops: PendingOp[], keepSynced = 20): PendingOp[] {
  const open = ops.filter((o) => o.status !== 'SYNCED');
  const synced = ops
    .filter((o) => o.status === 'SYNCED')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, keepSynced);
  return [...open, ...synced].sort((a, b) => b.createdAt - a.createdAt);
}
