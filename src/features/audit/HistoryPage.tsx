import { useApp } from '../../AppContext';
import { formatDateTime } from '../../lib/time';
import { useAuditEvents } from './useAuditEvents';

function show(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('value' in o && 'status' in o) {
      const val = o.value === null ? '—' : String(o.value);
      return `${val} · ${String(o.status).replace(/_/g, ' ').toLowerCase()}`;
    }
    // Long structures (order lines, BOM snapshots) are shortened here; the audit record keeps them in full.
    const s = JSON.stringify(v);
    return s.length > 160 ? `${s.slice(0, 157)}…` : s;
  }
  return String(v);
}

export function HistoryPage() {
  const { t, workspaceId } = useApp();
  const { events, loading, error } = useAuditEvents(workspaceId);

  return (
    <section>
      <h2>{t('historyTitle')}</h2>
      {loading && <p className="muted">{t('loading')}</p>}
      {error && <p className="error">{error === 'permission-denied' ? t('permissionDenied') : error}</p>}
      {!loading && !error && events.length === 0 && <p className="muted">{t('historyEmpty')}</p>}
      <ul className="timeline">
        {events.map((e) => (
          <li key={e.id} className="card">
            <div className="row between">
              <strong>
                {e.entity} · {e.action.replace('_', ' ').toLowerCase()}
              </strong>
              <span className="muted small">
                {t('rev')} {e.rev}
              </span>
            </div>
            <p className="muted small">
              {formatDateTime(e.at)}
              {e.pending && <span className="badge pending inline">{t('PENDING')}</span>}
            </p>
            {e.changes.map((c) => (
              <p key={c.field} className="change">
                <span className="field">{c.field}</span>
                <span className="old">{show(c.before)}</span>
                <span aria-hidden="true">→</span>
                <span className="new">{show(c.after)}</span>
              </p>
            ))}
            {e.reason && (
              <p className="small">
                <span className="muted">{t('reason')}:</span> {e.reason}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
