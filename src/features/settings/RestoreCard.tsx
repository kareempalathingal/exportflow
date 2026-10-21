import { useState, type ChangeEvent } from 'react';
import { collection, getDocsFromServer } from 'firebase/firestore';
import { db } from '../../firebase';
import { useApp } from '../../AppContext';
import type { BackupFile } from '../../lib/backup';
import { readLastBackup } from '../../lib/backup';
import { logError } from '../../lib/errorLog';
import { parseBackup, planRestore, RESTORE_COLLECTIONS, type CurrentRecord, type RestorePlan } from '../../lib/restore';
import { formatDateTime } from '../../lib/time';
import { saveRecord } from '../sync/records';
import { takeBackup } from './BackupCard';

const LABEL: Record<string, string> = {
  settings: 'Settings',
  customers: 'Customers',
  products: 'Products',
  rawMaterials: 'Raw materials',
  boms: 'BOMs',
  suppliers: 'Suppliers',
  processes: 'Processes',
  jobOrders: 'Job Orders',
  stockCounts: 'Stock counts',
};
const SAFETY_MINUTES = 30;
/** Free plan: about 20,000 writes a day; each restored revision is 2 writes. */
const WRITE_WARN = 7000;

/**
 * Settings card: restore a whole backup file into the current mode. Preview
 * first; in ACTUAL a fresh backup of the current data is required before the
 * restore button is enabled. Every restored record gets a history entry.
 */
export function RestoreCard() {
  const { workspaceId, mode, online } = useApp();
  const [file, setFile] = useState<BackupFile | null>(null);
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [safetyAt, setSafetyAt] = useState<string | null>(() => (workspaceId ? readLastBackup(workspaceId) : null));
  const safetyFresh = !!safetyAt && Date.now() - Date.parse(safetyAt) < SAFETY_MINUTES * 60_000;
  const needsSafety = mode === 'ACTUAL';

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    setMsg(null);
    setFile(null);
    setPlan(null);
    if (!f || !workspaceId) return;
    if (!online) return setMsg({ ok: false, text: 'Restore needs the internet, so it can compare with the saved data. Try again when online.' });
    setBusy(true);
    try {
      const parsed = parseBackup(await f.text());
      if (!parsed.ok) return setMsg({ ok: false, text: parsed.error });
      const current: Record<string, CurrentRecord[]> = {};
      for (const name of RESTORE_COLLECTIONS) {
        const snap = await getDocsFromServer(collection(db, `workspaces/${workspaceId}/${name}`));
        current[name] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
      }
      setFile(parsed.file);
      setPlan(planRestore(parsed.file, current, { workspaceId, mode }));
    } catch (err) {
      logError(err, 'Restore preview');
      setMsg({ ok: false, text: `Could not read the current data: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(false);
    }
  }

  async function safety() {
    if (!workspaceId) return;
    setBusy(true);
    try {
      const r = await takeBackup(workspaceId, mode, 'download');
      if (r.result === 'shared' || r.result === 'downloaded') setSafetyAt(r.at.toISOString());
    } catch (err) {
      logError(err, 'Backup before restore');
      setMsg({ ok: false, text: `Backup failed: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(false);
    }
  }

  function restore() {
    if (!workspaceId || !plan || !file || plan.blocked) return;
    const changes = plan.total.create + plan.total.update;
    if (!window.confirm(`Restore ${changes} record${changes === 1 ? '' : 's'} from the backup of ${formatDateTime(new Date(file.exportedAt))} into ${mode}?\n\nEach one is saved as a new version with a history entry. Records not in the backup are kept.`)) return;
    try {
      for (const w of plan.writes) saveRecord({ workspaceId, collectionName: w.collection, docId: w.docId, entity: w.entity, before: w.before, data: w.data, reason: w.reason });
      setMsg({ ok: true, text: `${plan.writes.length} change${plan.writes.length === 1 ? '' : 's'} sent. Watch “Sync” below: anything that fails is listed there and in History.` });
      setPlan(null);
      setFile(null);
    } catch (err) {
      logError(err, 'Restore');
      setMsg({ ok: false, text: `Restore stopped: ${err instanceof Error ? err.message : String(err)}. Part of it may have been sent; check Sync and History.` });
    }
  }

  const changes = plan ? plan.total.create + plan.total.update : 0;
  return (
    <div className="card">
      <h3>Restore from a backup</h3>
      <p className="muted small">
        Puts the data of a backup file back into {mode}. You see what will change before anything is saved. Nothing is deleted: records that are not in
        the backup stay, and history is kept. Try it in DEMO first with an ACTUAL backup if you like.
      </p>
      <label className="file-pick">
        <span className="button secondary small">{busy ? 'Reading…' : 'Choose backup file'}</span>
        <input type="file" accept="application/json,.json" disabled={busy || !workspaceId} onChange={(e) => void choose(e)} hidden />
      </label>
      {msg && <p className={`${msg.ok ? 'ok' : 'error'} small`}>{msg.text}</p>}

      {file && plan && (
        <div className="restore-preview">
          <p className="small">
            Backup of <strong>{file.mode}</strong> from <strong>{formatDateTime(new Date(file.exportedAt))}</strong> (app {file.appVersion}).
          </p>
          {plan.blocked && <p className="error small">{plan.blocked}</p>}
          {plan.warnings.map((w) => (
            <p key={w} className="warn small">
              {w}
            </p>
          ))}
          {!plan.blocked && (
            <>
              <table className="mini-table small">
                <thead>
                  <tr>
                    <th scope="col"></th>
                    <th scope="col">New</th>
                    <th scope="col">Changed</th>
                    <th scope="col">Same</th>
                    <th scope="col">Kept</th>
                  </tr>
                </thead>
                <tbody>
                  {RESTORE_COLLECTIONS.map((c) => {
                    const n = plan.byCollection[c]!;
                    if (!n.create && !n.update && !n.same && !n.keptNotInBackup && !n.skipped) return null;
                    return (
                      <tr key={c}>
                        <th scope="row">{LABEL[c] ?? c}</th>
                        <td>{n.create || '—'}</td>
                        <td>{n.update || '—'}</td>
                        <td>{n.same || '—'}</td>
                        <td>{n.keptNotInBackup || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="muted small">“Kept” = exists now but not in the backup; it stays as it is.</p>
              {plan.skips.length > 0 && (
                <details>
                  <summary className="warn small">
                    {plan.skips.length} record{plan.skips.length === 1 ? '' : 's'} cannot be restored
                  </summary>
                  <ul className="small">
                    {plan.skips.map((s) => (
                      <li key={`${s.collection}/${s.id}`}>
                        {s.name}: {s.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {plan.writes.length * 2 > WRITE_WARN && (
                <p className="warn small">This is a large restore ({plan.writes.length} changes). The free plan allows about 20,000 writes a day; if it stops part-way, the rest can be restored tomorrow by running it again.</p>
              )}
              {changes === 0 ? (
                <p className="ok small">Everything in the backup is the same as now. Nothing to restore.</p>
              ) : (
                <>
                  {needsSafety && (
                    <div className="card subtle">
                      <p className="small">
                        <strong>Step 1:</strong> save a backup of the data as it is now, so this restore can be undone.
                        {safetyFresh && safetyAt && <span className="ok"> Done at {formatDateTime(new Date(safetyAt))}.</span>}
                      </p>
                      <button type="button" className="secondary small" disabled={busy} onClick={() => void safety()}>
                        {safetyFresh ? 'Back up again' : 'Back up current data'}
                      </button>
                    </div>
                  )}
                  <button type="button" className="primary small" disabled={busy || !online || (needsSafety && !safetyFresh)} onClick={restore}>
                    {needsSafety ? 'Step 2: ' : ''}Restore {changes} record{changes === 1 ? '' : 's'}
                  </button>
                  {needsSafety && !safetyFresh && <p className="muted small">Restore is enabled after the backup in step 1 (valid for {SAFETY_MINUTES} minutes).</p>}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
