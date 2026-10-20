import { useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { useApp } from '../../AppContext';
import { BACKUP_COLLECTIONS, backupFileName, buildBackup, daysSinceBackup, markBackedUp, readLastBackup } from '../../lib/backup';
import { saveFile } from '../../lib/docs/pdf';
import { formatDateTime } from '../../lib/time';

/** Settings card: save everything in the current mode (ACTUAL or DEMO) as one JSON file. */
export function BackupCard() {
  const { workspaceId, mode, online } = useApp();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [last, setLast] = useState(() => (workspaceId ? readLastBackup(workspaceId) : null));
  const days = daysSinceBackup(last, new Date());

  async function run(how: 'share' | 'download') {
    if (!workspaceId) return;
    setBusy(true);
    setMsg(null);
    try {
      const collections: Record<string, { id: string; data: unknown }[]> = {};
      for (const name of BACKUP_COLLECTIONS) {
        const snap = await getDocs(collection(db, `workspaces/${workspaceId}/${name}`));
        collections[name] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
      }
      const now = new Date();
      const file = buildBackup({ workspaceId, mode, appVersion: __APP_VERSION__, now, collections });
      const blob = new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' });
      const r = await saveFile(blob, backupFileName(mode, now), 'application/json', 'ExportFlow backup', how);
      if (r !== 'cancelled') {
        markBackedUp(workspaceId, now);
        setLast(now.toISOString());
        const total = Object.values(file.counts).reduce((a, b) => a + b, 0);
        setMsg({ ok: true, text: `${r === 'shared' ? 'Passed to the share menu' : 'Saved'}: ${total} records.` });
      }
    } catch (e) {
      setMsg({ ok: false, text: `Backup failed: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>Backup</h3>
      <p className="muted small">
        Saves all {mode} data (masters, orders, stock, history) as one file. Keep it somewhere safe, e.g. send it to your own email or Google Drive.
        The free Firebase plan has no automatic backups.
      </p>
      <p className={`small ${days === null || days > 7 ? 'warn' : 'muted'}`}>
        {last ? `Last backup on this phone: ${formatDateTime(new Date(last))}${days !== null && days > 7 ? ` (${days} days ago)` : ''}` : 'No backup taken on this phone yet.'}
      </p>
      {!online && <p className="muted small">Offline: the backup will contain what this phone has stored.</p>}
      <div className="row gap">
        <button type="button" className="primary small" disabled={busy || !workspaceId} onClick={() => void run('share')}>
          {busy ? 'Preparing…' : 'Share backup'}
        </button>
        <button type="button" className="secondary small" disabled={busy || !workspaceId} onClick={() => void run('download')}>
          Download
        </button>
      </div>
      {msg && <p className={`${msg.ok ? 'ok' : 'error'} small`}>{msg.text}</p>}
      <p className="muted small">Restoring from a backup is not built yet; the file keeps everything needed for it.</p>
    </div>
  );
}
