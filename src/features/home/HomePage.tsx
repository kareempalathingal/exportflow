import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { useProfile } from '../settings/useProfile';
import { formatDateTime, istDateKey } from '../../lib/time';
import { masterAttention, type AttentionItem } from '../../lib/masters';
import { COLLECTION_JOB_ORDERS, formatDay, isEditable, jobOrderAttention, type JoAttention, type JobOrder } from '../../lib/jobOrders';
import { useMasterData } from '../masters/useMasterData';
import { useCollection } from '../masters/useCollection';
import { permissionHint } from '../orders/OrderBits';

const KIND: Record<AttentionItem['kind'], { title: string; hint: string; cls: string; tab: string }> = {
  BOM_MISSING: { title: 'BOM missing', hint: 'Raw materials cannot be calculated for this product.', cls: 'bad', tab: 'bom' },
  BOM_PROVISIONAL: { title: 'BOM not confirmed', hint: 'Some BOM lines are estimated or pending verification.', cls: 'warn', tab: 'bom' },
  NO_CONVERSION: { title: 'Size / GSM missing', hint: 'Orders in sq m or kg cannot be converted for this product.', cls: 'warn', tab: 'details' },
};

const JO_KIND: Record<JoAttention['kind'], { title: string; cls: string }> = {
  DELIVERY_PASSED: { title: 'Delivery date passed', cls: 'bad' },
  OVERDUE: { title: 'Internal deadline passed', cls: 'bad' },
  DUE_SOON: { title: 'Deadline near', cls: 'warn' },
  UNDECIDED: { title: 'Make or buy?', cls: 'warn' },
  CONVERSION: { title: 'Conversion needed', cls: 'warn' },
  BOM_CHANGED: { title: 'BOM changed', cls: 'warn' },
};

export function HomePage() {
  const { t, workspaceId, mode } = useApp();
  const { profile } = useProfile(workspaceId);
  const master = useMasterData(workspaceId);
  const jos = useCollection<JobOrder>(workspaceId, COLLECTION_JOB_ORDERS);
  const products = master.products;
  const company = profile?.companyName?.value;
  const today = istDateKey(new Date());

  const attention = useMemo(() => masterAttention(products.items, master.md), [products.items, master.md]);
  const joAttention = useMemo(() => jobOrderAttention(jos.items, master.md, master.bomRev, today), [jos.items, master.md, master.bomRev, today]);
  const open = useMemo(
    () => jos.items.filter((j) => isEditable(j.status)).sort((a, b) => a.deadline.internalDeadline.localeCompare(b.deadline.internalDeadline)),
    [jos.items],
  );
  const loading = master.loading || jos.loading;
  const total = attention.length + joAttention.length;
  const next = open[0];

  return (
    <section>
      <h2>{t('homeTitle')}</h2>
      <p className="muted small">{formatDateTime(new Date())} IST</p>
      <div className="card">
        <p className="kicker">{mode}</p>
        <p className="lead">{company ?? t('appName')}</p>
        {jos.error && <p className="error small">{permissionHint(jos.error)}</p>}
        {!jos.loading && !jos.error && open.length === 0 && <p className="muted">{t('homeEmpty')}</p>}
        {next && (
          <p>
            <Link to="/orders">
              {open.length} open Job Order{open.length === 1 ? '' : 's'}
            </Link>
            <span className="muted small block">
              Next internal deadline: {formatDay(next.deadline.internalDeadline)} ({next.joNumber})
            </span>
          </p>
        )}
      </div>

      <div className="card">
        <div className="row between">
          <h3>Needs attention</h3>
          {!loading && <span className="muted small">{total}</span>}
        </div>
        {loading && <p className="muted small">{t('loading')}</p>}
        {!loading && products.items.length === 0 && (
          <p className="muted small">
            No products yet. <Link to="/masters/products/new">Add the first product</Link>.
          </p>
        )}
        {!loading && products.items.length > 0 && total === 0 && <p className="ok small">Nothing needs attention right now.</p>}
        <ul className="attention">
          {joAttention.map((a) => {
            const k = JO_KIND[a.kind];
            return (
              <li key={`${a.joId}-${a.kind}`}>
                <Link to={`/orders/${a.joId}`}>
                  <span className={`pill ${k.cls}`}>{k.title}</span> <strong>{a.joNumber}</strong>
                  <span className="muted small block">{a.detail}</span>
                </Link>
              </li>
            );
          })}
          {attention.map((a) => {
            const k = KIND[a.kind];
            return (
              <li key={`${a.productId}-${a.kind}`}>
                <Link to={`/masters/products/${a.productId}?tab=${k.tab}`}>
                  <span className={`pill ${k.cls}`}>{k.title}</span> <strong>{a.productName}</strong>
                  <span className="muted small block">{k.hint}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
