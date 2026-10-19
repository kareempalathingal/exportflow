import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { COLLECTION_JOB_ORDERS, formatDay, type JobOrder, type JoStatus } from '../../lib/jobOrders';
import { COLLECTIONS, normalizeName, type Supplier } from '../../lib/masters';
import { istDateKey } from '../../lib/time';
import { useCollection } from '../masters/useCollection';
import { DeadlinePill, permissionHint, StatusPill } from './OrderBits';
import { ToBuyList } from './ToBuyList';
import { useProfile } from '../settings/useProfile';
import { useMasterData } from '../masters/useMasterData';
import { COLLECTION_STOCK_COUNTS, type StockCount } from '../../lib/materials';

type Tab = 'open' | 'to-buy' | 'completed' | 'cancelled';
const TABS: { id: Tab; label: string; statuses: JoStatus[] }[] = [
  { id: 'open', label: 'Open', statuses: ['DRAFT', 'CONFIRMED'] },
  { id: 'to-buy', label: 'To buy', statuses: [] },
  { id: 'completed', label: 'Completed', statuses: ['COMPLETED'] },
  { id: 'cancelled', label: 'Cancelled', statuses: ['CANCELLED'] },
];

export function OrdersPage() {
  const { workspaceId, t } = useApp();
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((x) => x.id === params.get('tab')) ?? TABS[0]!;
  const [q, setQ] = useState('');
  const jos = useCollection<JobOrder>(workspaceId, COLLECTION_JOB_ORDERS);
  const today = istDateKey(new Date());
  const master = useMasterData(workspaceId);
  const counts = useCollection<StockCount>(workspaceId, COLLECTION_STOCK_COUNTS);
  const { profile } = useProfile(workspaceId);
  const suppliers = useCollection<Supplier>(workspaceId, COLLECTIONS.suppliers);

  const list = useMemo(() => {
    const n = normalizeName(q);
    const rows = jos.items
      .filter((j) => tab.statuses.includes(j.status))
      .filter((j) => !n || normalizeName(`${j.joNumber} ${j.customerName} ${j.poNumber}`).includes(n));
    // Open orders: nearest internal deadline first. Closed: most recent first.
    return rows.sort((a, b) =>
      tab.id === 'open'
        ? a.deadline.internalDeadline.localeCompare(b.deadline.internalDeadline)
        : b.deliveryDate.localeCompare(a.deliveryDate),
    );
  }, [jos.items, q, tab]);

  return (
    <section>
      <div className="row between">
        <h2>Job Orders</h2>
        <Link className="button primary small" to="/orders/new">
          + New JO
        </Link>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab.id === x.id} className={tab.id === x.id ? 'on' : ''} onClick={() => setParams({ tab: x.id })}>
            {x.label}
          </button>
        ))}
      </div>
      {jos.loading && <p className="muted">{t('loading')}</p>}
      {jos.error && <p className="error">{permissionHint(jos.error)}</p>}
      {tab.id === 'to-buy' && !jos.loading && !jos.error && <ToBuyList jos={jos.items} md={master.md} counts={counts.items} company={profile?.companyName?.value ?? ''} suppliers={suppliers.items} />}
      {tab.id !== 'to-buy' && (
        <input className="search" type="search" placeholder="Search JO number, customer, PO" value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      {tab.id !== 'to-buy' && !jos.loading && !jos.error && list.length === 0 && (
        <p className="muted">{q ? 'No matching Job Orders.' : tab.id === 'open' ? 'No open Job Orders. Tap “+ New JO” to add one.' : 'None.'}</p>
      )}
      <ul className="master-list">
        {list.map((j) => (
          <li key={j.id}>
            <Link to={`/orders/${j.id}`} className={`card link ${j.status === 'CANCELLED' ? 'inactive' : ''}`}>
              <div className="row between">
                <strong>{j.joNumber}</strong>
                <span className="row gap">
                  <DeadlinePill jo={j} today={today} />
                  <StatusPill status={j.status} />
                </span>
              </div>
              <span className="block">{j.customerName}</span>
              <span className="muted small block">
                Internal deadline {formatDay(j.deadline.internalDeadline)} · Delivery {formatDay(j.deliveryDate)} · {j.lines.length} line{j.lines.length === 1 ? '' : 's'}
                {j.pending && <span className="badge pending inline">{t('PENDING')}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
