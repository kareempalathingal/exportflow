import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { productionPlanDoc, todayDoc, toBuyAllDoc } from '../../lib/docs/model';
import { toBuyBySupplierDoc } from '../../lib/docs/managerDocs';
import { toBuyBySupplier } from '../../lib/managerReports';
import { readRedAt } from '../../lib/theme';
import { COLLECTION_JOB_ORDERS, type JobOrder } from '../../lib/jobOrders';
import { COLLECTIONS, suppliersOf, type Department, type Process, type Supplier } from '../../lib/masters';
import { COLLECTION_STOCK_COUNTS, toBuyAcrossOrders, type StockCount } from '../../lib/materials';
import { formatDateTime, istDateKey } from '../../lib/time';
import { COLLECTION_TASKS, type Task } from '../../lib/tasks';
import { buildToday } from '../../lib/today';
import { useWorkCalendar } from '../calendar/useWorkCalendar';
import { DocButtons } from '../docs/DocButtons';
import { useCollection } from '../masters/useCollection';
import { useMasterData } from '../masters/useMasterData';
import { permissionHint } from '../orders/OrderBits';
import { useProfile } from '../settings/useProfile';
import { TodayCard } from './TodayCard';
import { SettingSection } from '../settings/SettingSection';
import { DeliverySection, FollowUpSection, RiskSection, StockSection, SummarySection, WorkSection } from './ManagerReports';

/** Reports, summaries and printable lists in one place (History lives here too). */
export function ReportsPage() {
  const { workspaceId, t } = useApp();
  const { profile } = useProfile(workspaceId);
  const company = profile?.companyName?.value ?? '';
  const jos = useCollection<JobOrder>(workspaceId, COLLECTION_JOB_ORDERS);
  const departments = useCollection<Department>(workspaceId, COLLECTIONS.departments);
  const suppliers = useCollection<Supplier>(workspaceId, COLLECTIONS.suppliers);
  const master = useMasterData(workspaceId);
  const stockCounts = useCollection<StockCount>(workspaceId, COLLECTION_STOCK_COUNTS);
  const [bySupplier, setBySupplier] = useState(false);
  const redAt = readRedAt();
  const { cal } = useWorkCalendar();
  const today = istDateKey(new Date());
  const planningDays = profile?.planningDays;
  const ctx = useMemo(() => ({ md: master.md, cal, planningDays }), [master.md, cal, planningDays]);
  const tasks = useCollection<Task>(workspaceId, COLLECTION_TASKS);
  const deptName = useMemo(() => {
    const m = new Map(departments.items.map((d) => [d.id, d.name]));
    return (id: string) => m.get(id) ?? '';
  }, [departments.items]);
  const summary = useMemo(() => buildToday({ jobOrders: jos.items, ctx, today, tasks: tasks.items, deptName }), [jos.items, ctx, today, tasks.items, deptName]);
  const generatedAt = () => `${formatDateTime(new Date())} IST`;
  const processes = useCollection<Process>(workspaceId, COLLECTIONS.processes);
  const processMap = useMemo(() => new Map(processes.items.map((p) => [p.id, p])), [processes.items]);
  const [planJo, setPlanJo] = useState('');
  const planChoices = useMemo(
    () => jos.items.filter((j) => j.status !== 'CANCELLED').sort((a, b) => (a.status === 'COMPLETED' ? 1 : 0) - (b.status === 'COMPLETED' ? 1 : 0) || b.receivedDate.localeCompare(a.receivedDate)),
    [jos.items],
  );
  const chosen = jos.items.find((j) => j.id === planJo);
  const toBuy = useMemo(() => toBuyAcrossOrders(jos.items, master.md, false), [jos.items, master.md]);
  const counts = { OVERDUE: 0, TODAY: 0, SOON: 0 };
  for (const i of summary.items) counts[i.when]++;
  const todaySum = summary.items.length
    ? [counts.OVERDUE && `${counts.OVERDUE} overdue`, counts.TODAY && `${counts.TODAY} today`, counts.SOON && `${counts.SOON} soon`].filter(Boolean).join(' · ')
    : 'Nothing due';

  return (
    <section>
      <h2>Reports</h2>
      {jos.error && <p className="error small">{permissionHint(jos.error)}</p>}
      {jos.loading || master.loading ? (
        <p className="muted">{t('loading')}</p>
      ) : (
        <>
          <SettingSection
            title="Today"
            summary={todaySum}
            flag={counts.OVERDUE ? 'bad' : null}
            flagLabel="Overdue or running late"
          >
            <TodayCard summary={summary} company={company} departments={departments.items} />
            <div className="card doc-card">
              <DocButtons label="Daily summary (PDF)" build={() => todayDoc(summary, { company, generatedAt: generatedAt() })} />
            </div>
          </SettingSection>

          <RiskSection jos={jos.items} ctx={ctx} today={today} company={company} generatedAt={generatedAt} redAt={redAt} />
          <DeliverySection jos={jos.items} ctx={ctx} today={today} company={company} generatedAt={generatedAt} />
          <SummarySection jos={jos.items} ctx={ctx} today={today} company={company} generatedAt={generatedAt} redAt={redAt} />
          <WorkSection jos={jos.items} ctx={ctx} today={today} company={company} generatedAt={generatedAt} departments={departments.items} />

          <FollowUpSection tasks={tasks.items} departments={departments.items} company={company} today={today} generatedAt={generatedAt} />

          <SettingSection title="Plan of a Job Order" summary="To submit · PDF">
            <div className="card">
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
          </SettingSection>

          <Link to="/reports/kpi" className="card setting-link">
            <span className="setting-title">KPIs</span>
            <span className="setting-sum">Factory and departments · PDF</span>
            <span className="setting-chev" aria-hidden="true">
              ›
            </span>
          </Link>

          <Link to="/reports/performance" className="card setting-link">
            <span className="setting-title">Job Order performance</span>
            <span className="setting-sum">Any period · PDF</span>
            <span className="setting-chev" aria-hidden="true">
              ›
            </span>
          </Link>

          <StockSection jos={jos.items} md={master.md} counts={stockCounts.items} today={today} company={company} generatedAt={generatedAt} />

          <SettingSection title="To buy — all orders" summary={`${toBuy.rows.length} item${toBuy.rows.length === 1 ? '' : 's'}`}>
            <div className="card doc-card">
              <label className="check">
                <input type="checkbox" checked={bySupplier} onChange={(e) => setBySupplier(e.target.checked)} /> Group by supplier
              </label>
              {bySupplier ? (
                <DocButtons
                  label="To buy — by supplier, confirmed orders (PDF)"
                  build={() => toBuyBySupplierDoc(toBuyBySupplier(toBuy.rows, suppliers.items), toBuy.ordersWithErrors, { company, includeDrafts: false, today, generatedAt: generatedAt() })}
                />
              ) : (
                <DocButtons
                  label="To buy — all confirmed orders (PDF)"
                  build={() => toBuyAllDoc(toBuy.rows, toBuy.ordersWithErrors, { company, includeDrafts: false, today, generatedAt: generatedAt(), supplierNames: (k) => suppliersOf(k, suppliers.items).map((s) => s.name) })}
                />
              )}
              <p className="muted small">
                The working list is in <Link to="/orders?tab=to-buy">Orders → To buy</Link>. Each order’s own PDFs are on its page.
              </p>
            </div>
          </SettingSection>

          <Link to="/history" className="card setting-link">
            <span className="setting-title">{t('historyTitle')}</span>
            <span className="setting-sum">Every change</span>
            <span className="setting-chev" aria-hidden="true">
              ›
            </span>
          </Link>

        </>
      )}
    </section>
  );
}
