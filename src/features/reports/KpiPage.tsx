import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { kpiDoc, kpiRows } from '../../lib/docs/kpiDoc';
import { COLLECTION_JOB_ORDERS, formatDay, type JobOrder } from '../../lib/jobOrders';
import { buildKpis, delta, fmtDays, fmtPct, fmtThroughput, KPI_TARGETS_DOC, kpiText, toneFor, type KpiReport, type KpiTargets } from '../../lib/kpi';
import { COLLECTIONS, type Department, type Process } from '../../lib/masters';
import { formatDateTime, istDateKey } from '../../lib/time';
import { formatQty } from '../../lib/units';
import { DocButtons } from '../docs/DocButtons';
import { useCollection, useDocument } from '../masters/useCollection';
import { permissionHint } from '../orders/OrderBits';
import { usePlanContext } from '../settings/usePlanContext';
import { useProfile } from '../settings/useProfile';
import { presetRange, useJoHistory, type Preset } from './PerformancePage';
import { shareText } from './TodayCard';

export function useKpiTargets(workspaceId: string | null) {
  const d = useDocument<KpiTargets>(workspaceId, 'settings', KPI_TARGETS_DOC);
  return { targets: (d.item ?? {}) as KpiTargets, record: d.item, loading: d.loading };
}

/** Everything the KPI screens need, for one period. */
export function useKpis(from: string, to: string, withHistory: boolean): { report: KpiReport | null; loading: boolean; error: string | null } {
  const { workspaceId } = useApp();
  const today = istDateKey(new Date());
  const jos = useCollection<JobOrder>(workspaceId, COLLECTION_JOB_ORDERS);
  const departments = useCollection<Department>(workspaceId, COLLECTIONS.departments);
  const processes = useCollection<Process>(workspaceId, COLLECTIONS.processes);
  const { ctx, master } = usePlanContext();
  const ctxLoading = master.loading;
  const history = useJoHistory(withHistory ? workspaceId : null);
  const loading = jos.loading || ctxLoading || departments.loading || processes.loading;
  const report = useMemo(
    () =>
      loading || from > to
        ? null
        : buildKpis({ jobOrders: jos.items, ctx, from, to, today, departments: departments.items, processNames: new Map(processes.items.map((p) => [p.id, p.name])), history: withHistory ? history.events : [] }),
    [loading, from, to, jos.items, ctx, today, departments.items, processes.items, withHistory, history.events],
  );
  return { report, loading, error: jos.error };
}

const TONE_CLS = { ok: 'ok', warn: 'warn', bad: 'error' } as const;

export function KpiPage() {
  const { workspaceId, t } = useApp();
  const { profile } = useProfile(workspaceId);
  const company = profile?.companyName?.value ?? '';
  const today = istDateKey(new Date());
  const [preset, setPreset] = useState<Preset>('month');
  const [custom, setCustom] = useState(() => presetRange('90', today)!);
  const range = preset === 'custom' ? custom : presetRange(preset, today)!;
  const { report: r, loading, error } = useKpis(range.from, range.to, true);
  const { targets } = useKpiTargets(workspaceId);
  const [msg, setMsg] = useState<string | null>(null);

  async function share() {
    if (!r) return;
    const res = await shareText('KPIs', kpiText(r, company, formatDay));
    if (res !== 'cancelled') {
      setMsg(res === 'shared' ? 'Passed to the share menu.' : 'Copied — paste it where you need it.');
      setTimeout(() => setMsg(null), 3000);
    }
  }

  return (
    <section>
      <p>
        <Link to="/reports" className="small">
          ← Reports
        </Link>
      </p>
      <h2>KPIs</h2>
      <div className="segmented wrap" role="radiogroup" aria-label="Period">
        {(
          [
            ['month', 'This month'],
            ['last-month', 'Last month'],
            ['90', 'Last 90 days'],
            ['custom', 'Custom'],
          ] as [Preset, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={preset === id} className={preset === id ? 'on' : ''} onClick={() => setPreset(id)}>
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
      {range.from > range.to && <p className="error small">“From” must be on or before “To”.</p>}
      {error && <p className="error small">{permissionHint(error)}</p>}
      {loading && <p className="muted">{t('loading')}</p>}
      {r && (
        <>
          <p className="muted small">
            {formatDay(r.from)} – {formatDay(r.to)} · compared with {formatDay(r.prevFrom)} – {formatDay(r.prevTo)} · {r.steps} step{r.steps === 1 ? '' : 's'} finished
          </p>
          <div className="card doc-card">
            <div className="row gap wrap">
              <button type="button" className="secondary small" onClick={() => void share()}>
                Share as text
              </button>
              {msg && <span className="ok small">{msg}</span>}
            </div>
            <DocButtons label="KPI report (PDF)" build={() => kpiDoc(r, targets, { company, generatedAt: `${formatDateTime(new Date())} IST` })} />
            <p className="muted small">
              Targets: <Link to="/settings">Settings → KPI targets</Link>
            </p>
          </div>

          <h3>Factory</h3>
          <div className="kpi-grid">
            {kpiRows(targets).map((k) => {
              const cur = k.get(r.factory);
              const prev = k.get(r.prev);
              const d = delta(cur, prev);
              const tone = toneFor(cur, k.target, k.higher);
              const better = d === null || d === 0 ? null : k.higher ? d > 0 : d < 0;
              return (
                <div key={k.label} className={`card kpi-tile ${tone ? `tone-${tone}` : ''}`}>
                  <span className="kpi-label small">{k.label}</span>
                  <strong className={`kpi-value ${tone ? TONE_CLS[tone] : ''}`}>{k.fmt(cur)}</strong>
                  <span className="muted small">
                    {d !== null && d !== 0 && (
                      <span className={better ? 'ok' : 'error'}>
                        {d > 0 ? '↑' : '↓'} {formatQty(Math.abs(d))}
                        {k.unit}
                      </span>
                    )}
                    {d === 0 && 'no change'}
                    {k.target !== null && k.target !== undefined && ` · target ${k.higher ? '≥' : '≤'} ${k.fmt(k.target)}`}
                  </span>
                </div>
              );
            })}
          </div>

          <h3>Planning</h3>
          <div className="card">
            <p className="small">
              {r.factory.planningConfirmed} order{r.factory.planningConfirmed === 1 ? '' : 's'} confirmed in the period · average {fmtDays(r.factory.avgPlanningDays)}
              {r.planningBenchmark !== null ? ` · benchmark ${formatQty(r.planningBenchmark)} working day${r.planningBenchmark === 1 ? '' : 's'}` : ' · no benchmark set (Settings → Profile)'}
            </p>
            {r.planning.filter((p) => p.over).length > 0 ? (
              <ul className="today-list">
                {r.planning
                  .filter((p) => p.over)
                  .map((p) => (
                    <li key={p.joId}>
                      <Link to={`/orders/${p.joId}`}>
                        {p.joNumber}: {formatQty(p.days)} working days (received {formatDay(p.received)}, confirmed {formatDay(p.confirmed)})
                      </Link>
                    </li>
                  ))}
              </ul>
            ) : (
              r.factory.planningConfirmed > 0 && r.planningBenchmark !== null && <p className="ok small">All confirmed within the benchmark.</p>
            )}
          </div>

          <h3>Departments</h3>
          {r.worstGroup && (
            <p className="warn small">
              Needs most attention: <strong>{r.worstGroup}</strong>
            </p>
          )}
          {r.groups.length === 0 && <p className="muted small">No process steps finished in this period.</p>}
          <ul className="master-list">
            {r.groups.map((g) => {
              const p = r.prevGroups.get(g.id);
              const tOn = toneFor(g.onTimePct, targets.onTimeStepPct, true);
              const tEff = toneFor(g.efficiencyPct, targets.efficiencyPct, true);
              return (
                <li key={g.id} className="card">
                  <div className="row between">
                    <strong>{g.name}</strong>
                    <span className="muted small">{g.steps} steps</span>
                  </div>
                  <dl className="kv small">
                    <dt>Steps on time</dt>
                    <dd className={tOn ? TONE_CLS[tOn] : ''}>
                      {fmtPct(g.onTimePct)}
                      {p && g.onTimePct !== null && p.onTimePct !== null && g.onTimePct !== p.onTimePct && <span className="muted"> (was {p.onTimePct}%)</span>}
                    </dd>
                    <dt>Efficiency</dt>
                    <dd className={tEff ? TONE_CLS[tEff] : ''}>{fmtPct(g.efficiencyPct)}</dd>
                    <dt>Avg delay</dt>
                    <dd>{fmtDays(g.avgDelay)}</dd>
                    <dt>Avg wait</dt>
                    <dd>
                      {fmtDays(g.avgWait)}
                      {g.steps > 0 && g.startCoverage < 1 && <span className="muted"> · start recorded for {Math.round(g.startCoverage * 100)}%</span>}
                    </dd>
                    <dt>Avg days / step</dt>
                    <dd>{fmtDays(g.avgDays)}</dd>
                    {g.lateOrderShare > 0 && (
                      <>
                        <dt>Late orders</dt>
                        <dd className="error">
                          main delay in {g.lateOrderShare} late order{g.lateOrderShare === 1 ? '' : 's'}
                        </dd>
                      </>
                    )}
                    {g.runningNow > 0 && (
                      <>
                        <dt>Running now</dt>
                        <dd>
                          {g.runningNow}
                          {g.overNow > 0 && <span className="error"> · {g.overNow} over plan</span>}
                        </dd>
                      </>
                    )}
                  </dl>
                  {g.processes.length > 0 && (
                    <details className="small">
                      <summary>By process (on time, efficiency, quantity)</summary>
                      <table className="conv-table">
                        <tbody>
                          {g.processes.map((pr) => (
                            <tr key={pr.id}>
                              <td>
                                {pr.label} <span className="muted">({pr.steps})</span>
                              </td>
                              <td className="num">{fmtPct(pr.onTimePct)} on time</td>
                              <td className="num">{fmtPct(pr.efficiencyPct)} eff.</td>
                              <td className="num">{fmtThroughput(pr.throughput)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="muted small">
            Steps on time = finished within planned working days. Efficiency = planned ÷ actual days. Wait = from the previous step finishing to this step starting (only where “started” was recorded; otherwise
            the step time includes waiting). Targets are your own.
          </p>
        </>
      )}
    </section>
  );
}

/** Home: four key figures for the last 30 days; tap for the full KPI page. Always shown (a note when there is no data yet). */
export function KpiStrip() {
  const { workspaceId } = useApp();
  const today = istDateKey(new Date());
  const from = useMemo(() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 29);
    return d.toISOString().slice(0, 10);
  }, [today]);
  const { report: r } = useKpis(from, today, false);
  const { targets } = useKpiTargets(workspaceId);
  const empty = !r || (r.steps === 0 && r.factory.completed === 0);
  const tile = (label: string, value: string, tone: ReturnType<typeof toneFor>) => (
    <Link to="/reports/kpi" className={`kpi-mini ${tone ? `tone-${tone}` : ''}`}>
      <strong className={tone ? TONE_CLS[tone] : ''}>{value}</strong>
      <span className="muted small">{label}</span>
    </Link>
  );
  return (
    <section className="card kpi-strip" aria-label="KPIs, last 30 days">
      <div className="row between">
        <h3>KPIs · last 30 days</h3>
        <Link to="/reports/kpi" className="small">
          All KPIs ›
        </Link>
      </div>
      {empty || !r ? (
        <p className="muted small">{r ? 'No steps finished in the last 30 days yet — KPIs appear as orders move.' : 'Loading…'}</p>
      ) : (
        <div className="kpi-mini-row">
          {tile('On-time delivery', fmtPct(r.factory.onTimeDeliveryPct), toneFor(r.factory.onTimeDeliveryPct, targets.onTimeDeliveryPct, true))}
          {tile('Steps on time', fmtPct(r.factory.onTimeStepPct), toneFor(r.factory.onTimeStepPct, targets.onTimeStepPct, true))}
          {tile('Efficiency', fmtPct(r.factory.efficiencyPct), toneFor(r.factory.efficiencyPct, targets.efficiencyPct, true))}
          {tile('Needs attention', r.worstGroup ?? 'None', r.worstGroup ? 'warn' : null)}
        </div>
      )}
    </section>
  );
}
