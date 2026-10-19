import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { JobOrder } from '../../lib/jobOrders';
import type { MasterData } from '../../lib/masters';
import { allocationFor, stockCountId, toBuyAcrossOrders, type StockCount } from '../../lib/materials';
import { formatQty, unitLabel } from '../../lib/units';
import type { WithMeta } from '../masters/useCollection';

/** What must still be bought for all open orders, after the stock set aside on each. */
export function ToBuyList({ jos, md, counts }: { jos: WithMeta<JobOrder>[]; md: MasterData; counts: WithMeta<StockCount>[] }) {
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const { rows, ordersWithErrors } = useMemo(() => toBuyAcrossOrders(jos, md, includeDrafts), [jos, md, includeDrafts]);
  const countMap = useMemo(() => new Map(counts.map((c) => [stockCountId(c.itemType, c.itemId), c])), [counts]);

  return (
    <section>
      <p className="muted small">Total still to buy for {includeDrafts ? 'confirmed and draft' : 'confirmed'} orders, after the stock set aside on each order.</p>
      <label className="check">
        <input type="checkbox" checked={includeDrafts} onChange={(e) => setIncludeDrafts(e.target.checked)} /> Include draft orders
      </label>
      {ordersWithErrors.length > 0 && (
        <p className="warn small">
          Incomplete for {ordersWithErrors.join(', ')} (missing BOM, conversion or Make/Buy) — open the order’s Materials tab.
        </p>
      )}
      {rows.length === 0 && <p className="muted">Nothing to buy.</p>}
      <ul className="master-list">
        {rows.map((r) => {
          const a = allocationFor(r.key, jos, countMap.get(stockCountId(r.type, r.id)));
          return (
            <li key={r.key} className="card">
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
        })}
      </ul>
    </section>
  );
}
