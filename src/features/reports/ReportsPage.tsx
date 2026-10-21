import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { productionPlanDoc, todayDoc, toBuyAllDoc } from '../../lib/docs/model';
import { COLLECTION_JOB_ORDERS, type JobOrder } from '../../lib/jobOrders';
import { COLLECTIONS, suppliersOf, type Department, type Process, type Supplier } from '../../lib/masters';
import { toBuyAcrossOrders } from '../../lib/materials';
import { formatDateTime, istDateKey } from '../../lib/time';
import { buildToday } from '../../lib/today';
import { useWorkCalendar } from '../calendar/useWorkCalendar';
import { DocButtons } from '../docs/DocButtons';
import { useCollection } from '../masters/useCollection';
import { useMasterData } from '../masters/useMasterData';
import { permissionHint } from '../orders/OrderBits';
import { useProfile } from '../settings/useProfile';
import { TodayCard } from './TodayCard';

/** Reports, summaries and printable lists in one place (History lives here too). */
export function ReportsPage() {
  const { workspaceId, t } = useApp();
  const { profile } = useProfile(workspaceId);
  const company = profile?.companyName?.value ?? '';
  const jos = useCollection<JobOrder>(workspaceId, COLLECTION_JOB_ORDERS);
  const departments = useCollection<Department>(workspaceId, COLLECTIONS.departments);
  const suppliers = useCollection<Supplier>(workspaceId, COLLECTIONS.suppliers);
  const master = useMasterData(workspaceId);
  const { cal } = useWorkCalendar();
  const today = istDateKey(new Date());
  const planningDays = profile?.planningDays;
  const ctx = useMemo(() => ({ md: master.md, cal, planningDays }), [master.md, cal, planningDays]);
  const summary = useMemo(() => buildToday({ jobOrders: jos.items, ctx, today }), [jos.items, ctx, today]);
  const generatedAt = () => `${formatDateTime(new Date())} IST`;
  const processes = useCollection<Process>(workspaceId, COLLECTIONS.processes);
  const processMap = useMemo(() => new Map(processes.items.map((p) => [p.id, p])), [processes.items]);
  const [planJo, setPlanJo] = useState('');
  const planChoices = useMemo(
    () => jos.items.filter((j) => j.status !== 'CANCELLED').sort((a, b) => (a.status === 'COMPLETED' ? 1 : 0) - (b.status === 'COMPLETED' ? 1 : 0) || b.receivedDate.localeCompare(a.receivedDate)),
    [jos.items],
  );
  const chosen = jos.items.find((j) => j.id === planJo);

  return (
    <section>
      <h2>Reports</h2>
      {jos.error && <p className="error small">{permissionHint(jos.error)}</p>}
      {jos.loading || master.loading ? (
        <p className="muted">{t('loading')}</p>
      ) : (
        <>
          <TodayCard summary={summary} company={company} departments={departments.items} />
          <div className="card doc-card">
            <DocButtons label="Daily summary (PDF)" build={() => todayDoc(summary, { company, generatedAt: generatedAt() })} />
          </div>

          <div className="card">
            <h3>Plan of a Job Order</h3>
            <p className="muted small">A clean plan to submit (schedule, timeline, materials, open points, “Prepared by / Approved by”), and a working plan with all calculations for you.</p>
            <label>
              Job Order
              <select value={planJo} onChange={(e) => setPlanJo(e.target.value)}>
                <option value="">— choose —</option>
                {planChoices.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.joNumber} · {j.customerName} · {j.status === 'DRAFT' ? 'draft' : j.status === 'CONFIRMED' ? 'confirmed' : 'completed'}
                  </option>
                ))}
              </select>
            </label>
            {chosen &&
              (['submit', 'working'] as const).map((variant) => (
                <DocButtons
                  key={variant}
                  label={variant === 'submit' ? `${chosen.status === 'DRAFT' ? 'Proposed' : 'Production'} plan · ${chosen.joNumber} (to submit)` : `Working plan · ${chosen.joNumber} (details)`}
                  build={() =>
                    productionPlanDoc({
                      jo: chosen,
                      md: master.md,
                      processes: processMap,
                      ctx,
                      today,
                      company,
                      generatedAt: generatedAt(),
                      preparedBy: { name: profile?.preparedByName ?? '', designation: profile?.preparedByDesignation ?? '' },
                      supplierNames: (k) => suppliersOf(k, suppliers.items).map((s) => s.name),
                      variant,
                    })
                  }
                />
              ))}
          </div>

          <Link to="/reports/performance" className="card link">
            <h3>Job Order performance</h3>
            <p className="muted small">On time vs internal deadline and delivery, buffer used, steps plan vs actual, changes after confirmation, process benchmarks. Any date range; PDF.</p>
          </Link>

          <div className="card doc-card">
            <DocButtons
              label="To buy — all confirmed orders (PDF)"
              build={() => {
                const { rows, ordersWithErrors } = toBuyAcrossOrders(jos.items, master.md, false);
                return toBuyAllDoc(rows, ordersWithErrors, { company, includeDrafts: false, today, generatedAt: generatedAt(), supplierNames: (k) => suppliersOf(k, suppliers.items).map((s) => s.name) });
              }}
            />
            <p className="muted small">
              The working list is in <Link to="/orders?tab=to-buy">Orders → To buy</Link>. Each order’s own PDFs are on its page.
            </p>
          </div>

          <Link to="/history" className="card link">
            <h3>{t('historyTitle')}</h3>
            <p className="muted small">Every change with who, when, the old and new values and the reason.</p>
          </Link>

          <p className="muted small">Department to-do lists and review summaries come here once departments are known.</p>
        </>
      )}
    </section>
  );
}
