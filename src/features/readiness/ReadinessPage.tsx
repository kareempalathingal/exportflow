import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { READINESS_DOC, READINESS_ITEMS, readinessSummary, readinessWorkspace, stateOf, type ReadinessDoc, type ReadinessStatus } from '../../lib/readiness';
import { istDateKey } from '../../lib/time';
import { formatDay } from '../../lib/jobOrders';
import { useDocument } from '../masters/useCollection';
import { saveRecord } from '../sync/records';

const LABEL: Record<ReadinessStatus, string> = { PENDING: 'Waiting', RECEIVED: 'Received', NOT_NEEDED: 'Not needed' };
const CLS: Record<ReadinessStatus, string> = { PENDING: 'neutral', RECEIVED: 'ok', NOT_NEEDED: 'neutral' };

/** Company information still needed, and what each piece unlocks in the app. */
export function ReadinessPage() {
  const app = useApp();
  const { t } = app;
  const workspaceId = readinessWorkspace(app.user?.uid, app.workspaceId);
  const { item, loading, error } = useDocument<ReadinessDoc>(workspaceId, 'settings', READINESS_DOC);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const sum = readinessSummary(item);

  function update(id: string, status: ReadinessStatus, noteText: string) {
    if (!workspaceId) return;
    const items = { ...(item?.items ?? {}), [id]: { status, note: noteText.trim(), on: istDateKey(new Date()) } };
    saveRecord({ workspaceId, collectionName: 'settings', docId: READINESS_DOC, entity: 'Data checklist', before: item, data: { items } });
  }

  if (loading) return <p className="muted">{t('loading')}</p>;
  return (
    <section>
      <p>
        <Link to="/settings" className="small">
          ← Settings
        </Link>
      </p>
      <h2>Waiting for company data</h2>
      <p className="muted small">What to collect after joining, and what each piece turns on in ExportFlow. Mark items as you receive them. (Always saved in ACTUAL, also when the app is in DEMO mode.)</p>
      {error && <p className="error small">{error}</p>}
      <div className="counts readiness-counts">
        <div style={{ boxShadow: 'inset 0 4px 0 var(--ok)' }}>
          <span className="mono count">{sum.received}</span>
          <span className="muted small">Received</span>
        </div>
        <div style={{ boxShadow: 'inset 0 4px 0 var(--line)' }}>
          <span className="mono count">{sum.pending}</span>
          <span className="muted small">Waiting</span>
        </div>
        <div style={{ boxShadow: 'inset 0 4px 0 var(--line)' }}>
          <span className="mono count">{sum.notNeeded}</span>
          <span className="muted small">Not needed</span>
        </div>
      </div>
      <ul className="master-list">
        {READINESS_ITEMS.map((it) => {
          const st = stateOf(item, it.id);
          const editing = open === it.id;
          return (
            <li key={it.id} className={`card edge${st.status === 'NOT_NEEDED' ? ' inactive' : ''}`} style={{ ['--edge' as string]: st.status === 'RECEIVED' ? 'var(--ok)' : 'transparent' }}>
              <div className="row between">
                <strong>{it.need}</strong>
                <span className={`pill ${CLS[st.status]}`}>{LABEL[st.status]}</span>
              </div>
              <span className="small block">
                <span className="muted">Unlocks:</span> {it.unlocks}
              </span>
              <span className="muted small block">
                Ask: {it.ask} · {it.phase}
                {st.on && ` · updated ${formatDay(st.on)}`}
              </span>
              {st.note && !editing && <p className="small">{st.note}</p>}
              {!editing ? (
                <button
                  type="button"
                  className="linkish"
                  onClick={() => {
                    setOpen(it.id);
                    setNote(st.note);
                  }}
                >
                  Update
                </button>
              ) : (
                <div className="readiness-edit">
                  <label>
                    Note (where it is, who gave it, what is missing)
                    <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
                  </label>
                  <div className="row gap">
                    {(['RECEIVED', 'PENDING', 'NOT_NEEDED'] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={s === 'RECEIVED' ? 'primary small' : 'secondary small'}
                        onClick={() => {
                          update(it.id, s, note);
                          setOpen(null);
                        }}
                      >
                        {LABEL[s]}
                      </button>
                    ))}
                    <button type="button" className="secondary small" onClick={() => setOpen(null)}>
                      Close
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
