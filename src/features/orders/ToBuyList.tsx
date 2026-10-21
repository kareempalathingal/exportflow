import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { JobOrder } from '../../lib/jobOrders';
import { suppliersOf, type MasterData, type Supplier } from '../../lib/masters';
import { allocationFor, stockCountId, toBuyAcrossOrders, type StockCount } from '../../lib/materials';
import { formatQty, unitLabel } from '../../lib/units';
import type { WithMeta } from '../masters/useCollection';
import { DocButtons } from '../docs/DocButtons';
import { toBuyAllDoc } from '../../lib/docs/model';
import { toBuyBySupplierDoc } from '../../lib/docs/managerDocs';
import { toBuyBySupplier } from '../../lib/managerReports';
import type { BuyTotal } from '../../lib/materials';
import { formatDateTime, istDateKey } from '../../lib/time';

/** What must still be bought for all open orders, after the stock set aside on each. */
export function ToBuyList({ jos, md, counts, company, suppliers }: { jos: WithMeta<JobOrder>[]; md: MasterData; counts: WithMeta<StockCount>[]; company: string; suppliers: WithMeta<Supplier>[] }) {
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [bySupplier, setBySupplier] = useState(false);
  const { rows, ordersWithErrors } = useMemo(() => toBuyAcrossOrders(jos, md, includeDrafts), [jos, md, includeDrafts]);
  const countMap = useMemo(() => new Map(counts.map((c) => [stockCountId(c.itemType, c.itemId), c])), [counts]);
  const groups = useMemo(() => (bySupplier ? toBuyBySupplier(rows, suppliers) : null), [bySupplier, rows, suppliers]);

  return (
    <section>
      <p className="muted small">Total still to buy for {includeDrafts ? 'confirmed and draft' : 'confirmed'} orders, after the stock set aside on each order.</p>
      <label className="check">
        <input type="checkbox" checked={includeDrafts} onChange={(e) => setIncludeDrafts(e.target.checked)} /> Include draft orders
      </label>
      <label className="check">
        <input type="checkbox" checked={bySupplier} onChange={(e) => setBySupplier(e.target.checked)} /> Group by supplier
      </label>
      {ordersWithErrors.length > 0 && (
        <p className="warn small">
          Incomplete for {ordersWithErrors.join(', ')} (missing BOM, conversion or Make/Buy) — open the order’s Materials tab.
        </p>
      )}
      <div className="card doc-card">
        {groups ? (
          <DocButtons
            label={`To buy — by supplier, ${includeDrafts ? 'confirmed and draft' : 'confirmed'} orders`}
            build={() => toBuyBySupplierDoc(groups, ordersWithErrors, { company, includeDrafts, today: istDateKey(new Date()), generatedAt: `${formatDateTime(new Date())} IST` })}
          />
        ) : (
        <DocButtons
          label={`To buy — all ${includeDrafts ? 'confirmed and draft' : 'confirmed'} orders`}
          build={() => toBuyAllDoc(rows, ordersWithErrors, { company, includeDrafts, today: istDateKey(new Date()), generatedAt: `${formatDateTime(new Date())} IST`, supplierNames: (k) => suppliersOf(k, suppliers).map((s) => s.name) })}
        />
        )}
      </div>
      {rows.length === 0 && <p className="muted">Nothing to buy.</p>}
      {groups ? (
        groups.map((g) => (
          <div key={g.id ?? 'none'} className="today-group">
            <h3>
              {g.id ? <Link to={`/masters/suppliers/${g.id}`}>{g.name}</Link> : g.name} <span className="muted small">· {g.rows.length} item{g.rows.length === 1 ? '' : 's'}</span>
            </h3>
            <ul className="master-list">
              {g.rows.map(({ row, others }) => (
                <BuyRow key={row.key} r={row} jos={jos} countMap={countMap} suppliers={suppliers} others={others} grouped />
              ))}
            </ul>
          </div>
        ))
      ) : (
        <ul className="master-list">
          {rows.map((r) => (
            <BuyRow key={r.key} r={r} jos={jos} countMap={countMap} suppliers={suppliers} others={[]} grouped={false} />
          ))}
        </ul>
      )}
    </section>
  );
}

function BuyRow({ r, jos, countMap, suppliers, others, grouped }: { r: BuyTotal; jos: WithMeta<JobOrder>[]; countMap: Map<string, StockCount>; suppliers: WithMeta<Supplier>[]; others: string[]; grouped: boolean }) {
  const a = allocationFor(r.key, jos, countMap.get(stockCountId(r.type, r.id)));
  const sup = suppliersOf(r.key, suppliers);
  return (
    <li className="card">
      <div className="row between">
        <strong>{r.name}</strong>
        <strong>
          {formatQty(r.net)} {unitLabel(r.unit)}
        </strong>
      </div>
      <span className="muted small block">
        {r.type === 'PRODUCT' ? 'Bought product' : 'Raw material'}
        {r.provisional && ' · provisional (estimated data)'}
        {a.state === 'OVER' && <span className="error"> · stock over-allocated</span>}
      </span>
      {grouped ? (
        others.length > 0 && <span className="small block muted">Also from: {others.join(', ')} — buy it once</span>
      ) : (
        <span className="small block">
          {sup.length ? (
            <>
              Suppliers:{' '}
              {sup.map((s, i) => (
                <span key={s.id}>
                  {i > 0 && ', '}
                  <Link to={`/masters/suppliers/${s.id}`}>{s.name}</Link>
                </span>
              ))}
            </>
          ) : (
            <span className="muted">No supplier linked</span>
          )}
        </span>
      )}
      <span className="small block">
        {r.orders.map((o, i) => (
          <span key={o.joId}>
            {i > 0 && ' · '}
            <Link to={`/orders/${o.joId}?tab=materials`}>{o.joNumber}</Link> {formatQty(o.net)}
          </span>
        ))}
      </span>
    </li>
  );
}
