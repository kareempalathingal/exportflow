import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { todayDoc, toBuyAllDoc } from '../../lib/docs/model';
import { COLLECTION_JOB_ORDERS, type JobOrder } from '../../lib/jobOrders';
import { COLLECTIONS, suppliersOf, type Supplier } from '../../lib/masters';
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
  const suppliers = useCollection<Supplier>(workspaceId, COLLECTIONS.suppliers);
  const master = useMasterData(workspaceId);
  const { cal } = useWorkCalendar();
  const today = istDateKey(new Date());
  const ctx = useMemo(() => ({ md: master.md, cal }), [master.md, cal]);
  const summary = useMemo(() => buildToday({ jobOrders: jos.items, ctx, today }), [jos.items, ctx, today]);
  const generatedAt = () => `${formatDateTime(new Date())} IST`;

  return (
    <section>
      <h2>Reports</h2>
      {jos.error && <p className="error small">{permissionHint(jos.error)}</p>}
      {jos.loading || master.loading ? (
        <p className="muted">{t('loading')}</p>
      ) : (
        <>
          <TodayCard summary={summary} company={company} />
          <div className="card doc-card">
            <DocButtons label="Daily summary (PDF)" build={() => todayDoc(summary, { company, generatedAt: generatedAt() })} />
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
