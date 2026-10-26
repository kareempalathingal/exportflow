import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { useApp } from '../../AppContext';
import type { FieldChange } from '../../lib/audit';
import { performanceDoc } from '../../lib/docs/model';
import { logError } from '../../lib/errorLog';
import { addDays, COLLECTION_JOB_ORDERS, formatDay, type JobOrder } from '../../lib/jobOrders';
import { buildPerformance, type JoHistoryEvent } from '../../lib/performance';
import { formatDateTime, istDateKey } from '../../lib/time';
import { formatQty } from '../../lib/units';
import { useWorkCalendar } from '../calendar/useWorkCalendar';
import { DocButtons } from '../docs/DocButtons';
import { useCollection } from '../masters/useCollection';
import { useMasterData } from '../masters/useMasterData';
import { permissionHint } from '../orders/OrderBits';
import { useProfile } from '../settings/useProfile';

export type Preset = 'month' | 'last-month' | '90' | 'custom';

export function presetRange(p: Preset, today: string): { from: string; to: string } | null {
  const month = today.slice(0, 7);
  if (p === 'month') return { from: `${month}-01`, to: today };
  if (p === 'last-month') {
    const lastDay = addDays(`${month}-01`, -1)!;
    return { from: `${lastDay.slice(0, 7)}-01`, to: lastDay };
  }
  if (p === '90') return { from: addDays(today, -89)!, to: today };
  return null;
}

/** Job Order history (all orders) for "changes after confirmation"; read once per visit. */
export function useJoHistory(workspaceId: string | null) {
  const [events, setEvents] = useState<JoHistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    const prefix = `workspaces/${workspaceId}/${COLLECTION_JOB_ORDERS}/`;
    getDocs(query(collection(db, `workspaces/${workspaceId}/auditEvents`), where('entityPath', '>=', prefix), where('entityPath', '<', `${prefix}`)))
      .then((snap) => {
        if (!live) return;
        setEvents(
          snap.docs.map((d) => {
            const at = d.get('at', { serverTimestamps: 'estimate' }) as { toDate?: () => Date } | null;
            return {
              entityPath: String(d.get('entityPath') ?? ''),
              at: at && typeof at.toDate === 'function' ? at.toDate().toISOString() : null,
              action: String(d.get('action') ?? ''),
              changes: (d.get('changes') as FieldChange[] | undefined) ?? [],
            };
          }),
        );
        setLoading(false);
      })
      .catch((e: unknown) => {
        logError(e, 'Performance report history');
        if (live) {
          setError((e as { code?: string }).code ?? String(e));
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, [workspaceId]);
  return { events, loading, error };
}

const signed = (n: number) => (n > 0 ? `${formatQty(n)} late` : n < 0 ? `${formatQty(-n)} early` : 'on the day');

export function PerformancePage() {
  const { workspaceId, t } = useApp();
  const { profile } = useProfile(workspaceId);
  const company = profile?.companyName?.value ?? '';
  const today = istDateKey(new Date());
  const jos = useCollection<JobOrder>(workspaceId, COLLECTION_JOB_ORDERS);
  const master = useMasterData(workspaceId);
  const { cal } = useWorkCalendar();
  const history = useJoHistory(workspaceId);
  const [preset, setPreset] = useState<Preset>('90');
  const [custom, setCustom] = useState(() => presetRange('90', today)!);
  const range = preset === 'custom' ? custom : presetRange(preset, today)!;
  const valid = range.from <= range.to;
  const planningDays = profile?.planningDays;
  const ctx = useMemo(() => ({ md: master.md, cal, planningDays }), [master.md, cal, planningDays]);
  const report = useMemo(
    () => (valid ? buildPerformance({ jobOrders: jos.items, ctx, from: range.from, to: range.to, today, history: history.events }) : null),
    [valid, jos.items, ctx, range.from, range.to, today, history.events],
  );
  const loading = jos.loading || master.loading;
  const maxDays = report ? Math.max(1, ...report.completed.flatMap((c) => [c.allowedDays, c.actualDays])) : 1;

  return (
    <section>
      <p>
        <Link to="/reports" className="small">
          ← Reports
        </Link>
      </p>
      <h2>Job Order performance</h2>
      <div className="segmented wrap" role="radiogroup" aria-label="Period">
        {(
          [
            ['month', 'This month'],
            ['last-month', 'Last month'],
            ['90', 'Last 90 days'],
            ['custom', 'Custom'],
          ] as [Preset, string][]
        ).map(([id, label]) => (
          <button key={id} role="radio" aria-checked={preset === id} className={preset === id ? 'on' : ''} onClick={() => setPreset(id)}>
            {label}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="grid2">
          <label>
            From
            <input type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
          </label>
          <label>
            To
            <input type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </label>
        </div>
      )}
      <p className="muted small">
        {formatDay(range.from)} – {formatDay(range.to)} · working days
      </p>
      {!valid && <p className="error small">“From” must be on or before “To”.</p>}
      {jos.error && <p className="error small">{permissionHint(jos.error)}</p>}
      {history.error && <p className="warn small">History could not be read ({history.error}); “changes after confirmation” are not counted.</p>}
      {loading && <p className="muted">{t('loading')}</p>}

      {report && !loading && (
        <>
          <div className="card doc-card">
            <DocButtons label="Performance report (PDF)" build={() => performanceDoc(report, { company, generatedAt: `${formatDateTime(new Date())} IST` })} />
          </div>

          <section className="tiles perf-tiles" aria-label="Summary">
            <div className="card">
              <span className="muted small">Completed</span>
              <span className="mono tile-num">{report.summary.completed}</span>
            </div>
            <div className="card">
              <span className="muted small">On time · internal</span>
              <span className="mono tile-num">{report.summary.completed ? `${report.summary.onTimeInternal}/${report.summary.completed}` : '—'}</span>
            </div>
            <div className="card">
              <span className="muted small">On time · delivery</span>
              <span className="mono tile-num">{report.summary.completed ? `${report.summary.onTimeDelivery}/${report.summary.completed}` : '—'}</span>
            </div>
            <div className="card">
              <span className="muted small">Avg delay (late ones)</span>
              <span className="mono tile-num">{report.summary.avgLateDays === null ? '—' : `${formatQty(report.summary.avgLateDays)}d`}</span>
            </div>
          </section>

          {report.completed.length > 0 && (
            <section className="card" aria-label="Allowed vs actual days">
              <h3>Allowed vs actual working days</h3>
              <p className="muted small legend">
                <span>
                  <span className="perf-key allowed" aria-hidden="true" /> Allowed (to internal deadline)
                </span>
                <span>
                  <span className="perf-key actual" aria-hidden="true" /> Actual
                </span>
              </p>
              <ul className="perf-bars">
                {report.completed.map((c) => (
                  <li key={c.id}>
                    <span className="perf-label mono small">{c.joNumber}</span>
                    <span className="perf-pair">
                      <span className="perf-bar allowed" style={{ width: `${(c.allowedDays / maxDays) * 100}%` }}>
                        <span className="mono small">{c.allowedDays}</span>
                      </span>
                      <span className={`perf-bar actual ${c.actualDays > c.allowedDays ? 'late' : ''}`} style={{ width: `${(c.actualDays / maxDays) * 100}%` }}>
                        <span className="mono small">{c.actualDays}</span>
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <h3 className="section-title">Completed orders</h3>
          {report.completed.length === 0 && <p className="muted small">No orders completed in this period.</p>}
          <ul className="master-list">
            {report.completed.map((c) => (
              <li key={c.id}>
                <Link to={`/orders/${c.id}`} className="card link">
                  <div className="row between">
                    <strong>{c.joNumber}</strong>
                    <span className={`pill ${c.vsInternal > 0 ? 'bad' : 'ok'}`}>{c.vsInternal > 0 ? `${formatQty(c.vsInternal)}d late` : 'On time'}</span>
                  </div>
                  <span className="muted small block">
                    {c.customerName} · completed {formatDay(c.completedOn)}
                  </span>
                  <span className="small block">
                    Internal deadline: {signed(c.vsInternal)} · Delivery: {signed(c.vsDelivery)} · Buffer used {formatQty(c.bufferUsed)} of {c.bufferDays}
                  </span>
                  <span className="small block">
                    Planning {c.planningDays === null ? '—' : `${formatQty(c.planningDays)}d`} · Days: plan {c.plannedDays === null ? '—' : formatQty(c.plannedDays)} · actual {formatQty(c.actualDays)} · allowed {c.allowedDays}
                  </span>
                  {c.slowest && (
                    <span className="small block warn">
                      Slowest: {c.slowest.product} · {c.slowest.label} +{formatQty(c.slowest.overrun!)}d
                    </span>
                  )}
                  {c.worstGap && (
                    <span className="small block muted">
                      Furthest behind: {Math.round(-c.worstGap.gap)}% on {formatDay(c.worstGap.on)}
                    </span>
                  )}
                  <span className="small block muted">
                    Changes after confirmation: {c.changes.count ? `${c.changes.count} (${Object.entries(c.changes.fields).map(([k, n]) => `${k} ×${n}`).join(', ')})` : 'none'}
                  </span>
                  {c.ruleNote && <span className="small block muted">{c.ruleNote}</span>}
                </Link>
              </li>
            ))}
          </ul>

          <h3 className="section-title">Processes</h3>
          {report.processes.length === 0 ? (
            <p className="muted small">No process steps finished in this period.</p>
          ) : (
            <ul className="master-list">
              {report.processes.map((p) => (
                <li key={p.key} className="card">
                  <div className="row between">
                    <strong>{p.label}</strong>
                    <span className={`pill ${p.ratio !== null && p.ratio > 1.15 ? 'bad' : p.ratio !== null && p.ratio < 0.85 ? 'ok' : 'neutral'}`}>
                      {p.ratio === null ? 'no plan' : `${Math.round(p.ratio * 100)}% of plan`}
                    </span>
                  </div>
                  <span className="muted small block">
                    {p.steps} step{p.steps === 1 ? '' : 's'} · planned {formatQty(p.plannedTotal)}d · actual {formatQty(p.actualTotal)}d
                  </span>
                  {p.suggestion && (
                    <span className="small block suggestion">
                      Suggestion: {p.suggestion}. Not applied — change the product route if you agree.
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          <h3 className="section-title">Still open</h3>
          {report.open.length === 0 ? (
            <p className="muted small">No open orders.</p>
          ) : (
            <ul className="attention">
              {report.open.map((o) => (
                <li key={o.id}>
                  <Link to={`/orders/${o.id}`}>
                    <span className={`pill ${o.late ? 'bad' : o.gap !== null && o.gap < 0 ? 'warn' : 'ok'}`}>
                      {o.late ? 'Late' : o.gap === null ? 'Not tracked' : o.gap < 0 ? `${-o.gap}% behind` : 'On plan'}
                    </span>{' '}
                    <strong>{o.joNumber}</strong>
                    <span className="muted small block">
                      {o.customerName} · internal deadline {formatDay(o.internalDeadline)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {report.cancelled > 0 && <p className="muted small">Cancelled (received in this period): {report.cancelled}</p>}
          <p className="muted small">Suggestions need at least 5 finished steps that differ from the plan by 15% or more. Benchmarks are never changed automatically.</p>
        </>
      )}
    </section>
  );
}
