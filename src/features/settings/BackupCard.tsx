import { useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { useApp } from '../../AppContext';
import { BACKUP_COLLECTIONS, BACKUP_REMIND_DAYS, backupFileName, buildBackup, daysSinceBackup, markBackedUp, readLastBackup } from '../../lib/backup';
import { logError } from '../../lib/errorLog';
import { saveFile, type SaveResult } from '../../lib/docs/pdf';
import { formatDateTime } from '../../lib/time';

/** Reads every backed-up collection of a workspace and passes the JSON file to the share menu or a download. */
export async function takeBackup(
  workspaceId: string,
  mode: 'ACTUAL' | 'DEMO',
  how: 'share' | 'download',
): Promise<{ result: SaveResult; total: number; at: Date; file: { blob: Blob; name: string } }> {
  const collections: Record<string, { id: string; data: unknown }[]> = {};
  for (const name of BACKUP_COLLECTIONS) {
    const snap = await getDocs(collection(db, `workspaces/${workspaceId}/${name}`));
    collections[name] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  }
  const now = new Date();
  const file = buildBackup({ workspaceId, mode, appVersion: __APP_VERSION__, now, collections });
  // Android Chrome only shares some file types (not .json), so a shared backup is a .txt file
  // with the same JSON inside; a download stays .json. Restore accepts both.
  const asText = how === 'share';
  const mime = asText ? 'text/plain' : 'application/json';
  const blob = new Blob([JSON.stringify(file, null, 1)], { type: mime });
  const name = asText ? backupFileName(mode, now).replace(/\.json$/, '.txt') : backupFileName(mode, now);
  const r = await saveFile(blob, name, mime, 'ExportFlow backup', how);
  if (r === 'shared' || r === 'downloaded') markBackedUp(workspaceId, now);
  return { result: r, total: Object.values(file.counts).reduce((a, b) => a + b, 0), at: now, file: { blob, name } };
}

/** Settings card: save everything in the current mode (ACTUAL or DEMO) as one JSON file. */
export function BackupCard() {
  const { workspaceId, mode, online } = useApp();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [last, setLast] = useState(() => (workspaceId ? readLastBackup(workspaceId) : null));
  const [ready, setReady] = useState<{ blob: Blob; name: string; total: number; at: Date } | null>(null);

  async function shareReady() {
    if (!ready || !workspaceId) return;
    let r = await saveFile(ready.blob, ready.name, ready.blob.type, 'ExportFlow backup', 'share');
    // Still refused: save it to Downloads instead of doing nothing.
    if (r === 'needs-tap') r = await saveFile(ready.blob, ready.name, ready.blob.type, 'ExportFlow backup', 'download');
    if (r === 'shared' || r === 'downloaded') {
      markBackedUp(workspaceId, ready.at);
      setLast(ready.at.toISOString());
      setMsg({
        ok: true,
        text: r === 'shared' ? `Passed to the share menu: ${ready.total} records.` : `This phone would not share the file, so it was saved to Downloads (${ready.name}). Upload it to Google Drive from there.`,
      });
      setReady(null);
    }
  }
  const days = daysSinceBackup(last, new Date());

  async function run(how: 'share' | 'download') {
    if (!workspaceId) return;
    setBusy(true);
    setMsg(null);
    try {
      setReady(null);
      const r = await takeBackup(workspaceId, mode, how);
      if (r.result === 'needs-tap') setReady({ ...r.file, total: r.total, at: r.at });
      else if (r.result !== 'cancelled') {
        setLast(r.at.toISOString());
        setMsg({ ok: true, text: `${r.result === 'shared' ? 'Passed to the share menu' : 'Saved'}: ${r.total} records.` });
      }
    } catch (e) {
      logError(e, 'Backup');
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
      <p className={`small ${days === null || days > BACKUP_REMIND_DAYS ? 'warn' : 'muted'}`}>
        {last ? `Last backup on this phone: ${formatDateTime(new Date(last))}${days !== null && days > BACKUP_REMIND_DAYS ? ` (${days} days ago)` : ''}` : 'No backup taken on this phone yet.'}
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
      {ready && (
        <div className="card subtle">
          <p className="small">
            Backup ready ({ready.total} records). The phone needs one more tap to open the share menu.
          </p>
          <button type="button" className="primary small" onClick={() => void shareReady()}>
            Share now
          </button>
        </div>
      )}
      {msg && <p className={`${msg.ok ? 'ok' : 'error'} small`}>{msg.text}</p>}
    </div>
  );
}
