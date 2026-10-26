import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { JobOrder } from '../../lib/jobOrders';
import type { MasterData } from '../../lib/masters';
import { lineSummaries } from '../../lib/orderSummary';
import type { PlanContext } from '../../lib/route';
import { formatQty, unitLabel } from '../../lib/units';

const SHOW = 5;

/** Top of a Job Order: each product with its quantity and its own progress (tap → Products tab). */
export function ItemsCard({ jo, id, md, ctx, today }: { jo: JobOrder; id: string; md: MasterData; ctx: PlanContext; today: string }) {
  const [all, setAll] = useState(false);
  const rows = lineSummaries(jo, md, today, ctx);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, SHOW);
  return (
    <section className="card items-card" aria-label="Products on this order">
      <ol className="items-list">
        {shown.map((r, i) => (
          <li key={r.id}>
            <Link to={`/orders/${id}?tab=products&line=${r.id}`} className="items-row">
              <span className="items-no mono">{i + 1}.</span>
              <span className="items-main">
                <span className="items-name">{r.productName}</span>
                <span className="muted small block">
                  <strong className="items-qty">
                    {formatQty(r.qty)} {unitLabel(r.unit)}
                  </strong>
                  {r.baseText && ` (${r.baseText})`}
                  {r.supply && ` · ${r.supply === 'MAKE' ? 'Make' : 'Buy'}`}
                  {r.now && !r.done && ` · now ${r.now}`}
                </span>
              </span>
              <span className="items-pct small">
                {r.pct === null ? (
                  <span className="muted">{jo.status === 'DRAFT' ? 'draft' : '—'}</span>
                ) : (
                  <>
                    <span className="items-bar" aria-hidden="true">
                      <span style={{ width: `${r.pct}%` }} />
                    </span>
                    {r.done ? 'Done' : `${r.pct}%`}
                  </>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ol>
      {rows.length > SHOW && (
        <button type="button" className="linkish" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `+${rows.length - SHOW} more`}
        </button>
      )}
    </section>
  );
}
