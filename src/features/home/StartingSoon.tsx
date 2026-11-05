import { Link } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { COLLECTION_JOB_ORDERS, formatDay, type JobOrder } from '../../lib/jobOrders';
import type { Department, Process, Supplier } from '../../lib/masters';
import { departmentsFor, stepMessage } from '../../lib/contacts';
import { startChecks, type StartCheck } from '../../lib/followUp';
import { tickReady, type PlanContext } from '../../lib/route';
import { saveRecord } from '../sync/records';
import { StepContacts } from '../masters/ContactButtons';
import { jobOrderData } from '../orders/MaterialsTab';
import type { WithMeta } from '../masters/useCollection';

/**
 * "Starting in N working days": each process step about to start, with what the
 * app checks itself and the process's own checklist (mockup A, confirmed 5 Nov 2026).
 */
export function StartingSoon(props: {
  jos: WithMeta<JobOrder>[];
  ctx: PlanContext;
  today: string;
  processes: Map<string, Process>;
  suppliers: Map<string, Supplier>;
  departments: Department[];
  alertDays: number;
}) {
  const { workspaceId } = useApp();
  const checks = startChecks(props.jos, props.ctx, props.today, props.processes, props.suppliers, props.alertDays);
  if (!checks.length) return null;

  function tick(c: StartCheck, item: string, on: boolean) {
    const jo = props.jos.find((j) => j.id === c.joId);
    if (!workspaceId || !jo) return;
    const line = jo.lines[c.lineIndex];
    const steps = line?.steps && tickReady(line.steps, c.stepIndex, item, on ? props.today : null);
    if (!steps) return;
    const lines = jo.lines.map((l, k) => (k === c.lineIndex ? { ...l, steps } : l));
    saveRecord({
      workspaceId,
      collectionName: COLLECTION_JOB_ORDERS,
      docId: jo.id,
      entity: `Job Order: ${jo.joNumber}`,
      before: jo,
      data: JSON.parse(JSON.stringify({ ...jobOrderData(jo), lines })) as Record<string, unknown>,
      reason: `${c.label} (${c.product}): "${item}" ${on ? 'ready' : 'not ready'}`,
    });
  }

  return (
    <section className="card" aria-label="Starting soon">
      <div className="row between">
        <h3>Starting in {props.alertDays} working day{props.alertDays === 1 ? '' : 's'}</h3>
        <span className="muted small">can they run without stopping?</span>
      </div>
      {checks.map((c) => {
        const depts = departmentsFor(c.processId, props.departments);
        return (
          <div key={`${c.joId}-${c.stepKey}`} className={`ready-check ${c.ready ? '' : 'not-ready'}`}>
            <div className="row between">
              <strong>
                {c.label} · {c.start <= props.today ? 'due to start' : `starts ${formatDay(c.start)}`}
              </strong>
              <span className={`small ${c.ready ? 'ok' : c.start <= props.today ? 'error' : 'warn'}`}>{c.ready ? 'ready' : `${c.readyCount} of ${c.total} ready`}</span>
            </div>
            <span className="muted small block">
              <Link to={`/orders/${c.joId}?tab=products&line=${c.lineId}`}>{c.joNumber}</Link> · {c.product}
            </span>
            {c.auto.length > 0 && (
              <ul className="plain-list small">
                {c.auto.map((a) => (
                  <li key={a.text}>
                    <span className={a.ok ? 'ok' : 'error'} aria-hidden="true">
                      {a.ok ? '✓' : '✗'}
                    </span>{' '}
                    {a.text}
                  </li>
                ))}
              </ul>
            )}
            {c.items.length > 0 && (
              <ul className="plain-list">
                {c.items.map((x) => (
                  <li key={x.item}>
                    <label className="check small">
                      <input type="checkbox" checked={!!x.on} onChange={(e) => tick(c, x.item, e.target.checked)} /> {x.item}
                      {x.on && <span className="muted"> · {formatDay(x.on)}</span>}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {c.items.length === 0 && c.processId && (
              <p className="muted small">
                No checklist for this process yet — <Link to={`/masters/processes/${c.processId}`}>add one</Link>.
              </p>
            )}
            <div className="row gap step-actions">
              <StepContacts departments={depts} message={(p) => stepMessage({ person: p.name, joNumber: c.joNumber, product: c.product, step: c.label, plannedFinish: null })} />
              <Link
                className="button secondary small"
                to={`/work/new?${new URLSearchParams({ title: `Ready for ${c.label}: ${c.product}`, due: c.start, jo: c.joId, joNo: c.joNumber }).toString()}`}
              >
                + Follow-up task
              </Link>
            </div>
          </div>
        );
      })}
    </section>
  );
}
