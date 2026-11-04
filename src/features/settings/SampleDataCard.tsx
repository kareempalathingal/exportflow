import { useState } from 'react';
import { collection, doc, getDoc, getDocsFromServer, writeBatch } from 'firebase/firestore';
import { BACKUP_COLLECTIONS } from '../../lib/backup';
import { logError } from '../../lib/errorLog';
import { db } from '../../firebase';
import { useApp } from '../../AppContext';
import { modeOfWorkspace } from '../../lib/mode';
import { buildSampleData, SAMPLE_MARKER_ID } from '../../lib/sampleData';
import { istDateKey } from '../../lib/time';
import { useMasterData } from '../masters/useMasterData';
import { saveRecord } from '../sync/records';

/** DEMO only: fill the practice space with clearly marked sample records. */
export function SampleDataCard() {
  const { workspaceId, mode } = useApp();
  const master = useMasterData(workspaceId);
  const [msg, setMsg] = useState<string | null>(null);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  if (mode !== 'DEMO' || !workspaceId) return null;
  const loaded = master.md.products.has(SAMPLE_MARKER_ID);

  function load() {
    if (!workspaceId || modeOfWorkspace(workspaceId) !== 'DEMO') return; // never into ACTUAL
    if (!window.confirm('Add sample products, BOMs, suppliers and 5 Job Orders to DEMO? They are marked "(sample)"; "Clear DEMO" below removes everything in DEMO.')) return;
    const writes = buildSampleData(istDateKey(new Date()));
    for (const w of writes) saveRecord({ workspaceId, collectionName: w.collection, docId: w.docId, entity: w.entity, before: w.before, data: w.data, reason: w.reason });
    setMsg(`Added ${writes.length} sample records. Open Home to see the dashboard.`);
  }

  /** After an app update: add only sample records that do not exist yet (existing ones are never changed). */
  async function addNew() {
    if (!workspaceId || modeOfWorkspace(workspaceId) !== 'DEMO') return;
    setMsg('Checking…');
    try {
      const writes = buildSampleData(istDateKey(new Date()));
      const keys = [...new Set(writes.map((w) => `${w.collection}/${w.docId}`))];
      const missing = new Set<string>();
      for (const k of keys) if (!(await getDoc(doc(db, `workspaces/${workspaceId}/${k}`))).exists()) missing.add(k);
      const todo = writes.filter((w) => missing.has(`${w.collection}/${w.docId}`));
      for (const w of todo) saveRecord({ workspaceId, collectionName: w.collection, docId: w.docId, entity: w.entity, before: w.before, data: w.data, reason: w.reason });
      setMsg(missing.size ? `Added ${missing.size} new sample record${missing.size === 1 ? '' : 's'} (existing ones unchanged).` : 'Nothing new — all sample records are already here.');
    } catch (e) {
      setMsg(`Could not check: ${e instanceof Error ? e.message : String(e)} (needs internet).`);
    }
  }

  /** Clear DEMO (confirmed 4 Nov 2026): deletes every record and its history in DEMO only. */
  async function clearDemo() {
    if (!workspaceId || modeOfWorkspace(workspaceId) !== 'DEMO' || !workspaceId.endsWith('_demo')) return; // never ACTUAL
    setBusy(true);
    setMsg('Clearing DEMO…');
    let n = 0;
    try {
      for (const name of BACKUP_COLLECTIONS) {
        const snap = await getDocsFromServer(collection(db, `workspaces/${workspaceId}/${name}`));
        for (let i = 0; i < snap.docs.length; i += 400) {
          const b = writeBatch(db);
          for (const d of snap.docs.slice(i, i + 400)) b.delete(d.ref);
          await b.commit();
          n += Math.min(400, snap.docs.length - i);
        }
      }
      setWord('');
      setMsg(`DEMO cleared: ${n} records deleted. ACTUAL was not touched.`);
    } catch (e) {
      logError(e, 'clear-demo');
      const text = e instanceof Error ? e.message : String(e);
      setMsg(
        /permission/i.test(text)
          ? `Stopped after ${n} records: the Firestore rules do not allow clearing yet. Publish the latest rules, then try again.`
          : `Stopped after ${n} records: ${text} (needs internet). Try again to finish.`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>Sample data (DEMO)</h3>
      <p className="muted small">
        Fills DEMO with sample products, a multi-level BOM, suppliers, a stock count and 5 Job Orders in different states (late, ahead, behind, draft,
        completed), so every screen and PDF can be tried. Names end in “(sample)”. Nothing goes to ACTUAL. After an app update, “Add new sample records” adds only what is new (e.g. Work tasks); existing records stay as they are.
      </p>
      <button type="button" className="secondary small" disabled={loaded || master.loading} onClick={load}>
        {loaded ? 'Sample data already loaded' : 'Load sample data'}
      </button>
      {loaded && (
        <button type="button" className="secondary small" onClick={() => void addNew()}>
          Add new sample records
        </button>
      )}
      <details className="clear-demo">
        <summary className="small">Clear DEMO (start fresh)</summary>
        <p className="small">
          Deletes <strong>everything</strong> in DEMO — products, raw materials, BOMs, orders, tasks, settings and their history — so DEMO can start fresh (e.g.
          from an ERP import). ACTUAL is never touched. Make a DEMO backup first if you may want it back. Needs internet.
        </p>
        <label className="small">
          Type CLEAR DEMO to confirm
          <input value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" />
        </label>
        <button type="button" className="danger small" disabled={busy || word.trim().toUpperCase() !== 'CLEAR DEMO'} onClick={() => void clearDemo()}>
          {busy ? 'Clearing…' : 'Delete all DEMO data'}
        </button>
      </details>
      {msg && <p className="ok small">{msg}</p>}
    </div>
  );
}
