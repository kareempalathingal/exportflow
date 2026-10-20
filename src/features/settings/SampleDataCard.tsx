import { useState } from 'react';
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
  if (mode !== 'DEMO' || !workspaceId) return null;
  const loaded = master.md.products.has(SAMPLE_MARKER_ID);

  function load() {
    if (!workspaceId || modeOfWorkspace(workspaceId) !== 'DEMO') return; // never into ACTUAL
    if (!window.confirm('Add sample products, BOMs, suppliers and 5 Job Orders to DEMO? They are marked "(sample)" and cannot be deleted (only set inactive or cancelled).')) return;
    const writes = buildSampleData(istDateKey(new Date()));
    for (const w of writes) saveRecord({ workspaceId, collectionName: w.collection, docId: w.docId, entity: w.entity, before: w.before, data: w.data, reason: w.reason });
    setMsg(`Added ${writes.length} sample records. Open Home to see the dashboard.`);
  }

  return (
    <div className="card">
      <h3>Sample data (DEMO)</h3>
      <p className="muted small">
        Fills DEMO with sample products, a multi-level BOM, suppliers, a stock count and 5 Job Orders in different states (late, ahead, behind, draft,
        completed), so every screen and PDF can be tried. Names end in “(sample)”. Nothing goes to ACTUAL.
      </p>
      <button type="button" className="secondary small" disabled={loaded || master.loading} onClick={load}>
        {loaded ? 'Sample data already loaded' : 'Load sample data'}
      </button>
      {msg && <p className="ok small">{msg}</p>}
    </div>
  );
}
