import { useApp } from '../../AppContext';
import { formatDateTime } from '../../lib/time';
import { saveRecord } from './records';
import { syncStore, useSyncOps } from './syncStore';
import { useProfile, PROFILE_COLLECTION, PROFILE_DOC } from '../settings/useProfile';
import type { PendingOp } from '../../lib/syncState';

function ConflictActions({ op }: { op: PendingOp }) {
  const { t, workspaceId } = useApp();
  const { profile } = useProfile(op.workspaceId === workspaceId ? workspaceId : null);
  const canReapply = op.path.endsWith(`/${PROFILE_COLLECTION}/${PROFILE_DOC}`) && profile !== null;

  return (
    <div className="conflict">
      <p className="small">{t('conflictHelp')}</p>
      <p className="small">
        <span className="muted">{t('yourValue')}:</span> {JSON.stringify(op.data)}
      </p>
      <div className="row gap">
        <button className="secondary small" onClick={() => syncStore.remove(op.id)}>
          {t('keepServer')}
        </button>
        {canReapply && (
          <button
            className="primary small"
            onClick={() => {
              saveRecord({
                workspaceId: op.workspaceId,
                collectionName: PROFILE_COLLECTION,
                docId: PROFILE_DOC,
                entity: op.entity,
                before: profile,
                data: op.data,
                reason: 'Conflict resolution: re-applied my value',
                action: 'RESOLVE_CONFLICT',
              });
              syncStore.remove(op.id);
            }}
          >
            {t('applyMine')}
          </button>
        )}
      </div>
    </div>
  );
}

export function SyncPanel() {
  const { t, workspaceId } = useApp();
  const ops = useSyncOps().filter((o) => o.workspaceId === workspaceId);

  return (
    <div className="card">
      <h3>{t('sync')}</h3>
      {ops.length === 0 && <p className="muted small">{t('syncNone')}</p>}
      <ul className="sync-list">
        {ops.map((op) => (
          <li key={op.id} className={`sync-item ${op.status.toLowerCase()}`}>
            <div className="row between">
              <span>
                {op.entity} · {op.label}
              </span>
              <span className={`badge ${op.status.toLowerCase()}`}>{t(op.status)}</span>
            </div>
            <p className="muted small">
              {formatDateTime(new Date(op.createdAt))} · {t('rev')} {op.baseRev} → {op.newRev}
              {op.error && ` · ${op.error}`}
            </p>
            {op.status === 'CONFLICT' && <ConflictActions op={op} />}
            {op.status === 'FAILED' && (
              <button className="secondary small" onClick={() => syncStore.remove(op.id)}>
                {t('dismiss')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
