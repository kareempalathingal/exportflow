/**
 * "Steps for a family" (confirmed 4 Nov 2026): set the process steps once for
 * every product of a family (e.g. one design in many sizes). Preview first;
 * each product gets a normal history entry. Single products can still be
 * changed on their own form afterwards.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { commonRoute, familyMembers, planFamilyRoute } from '../../lib/itemGroups';
import { COLLECTIONS, productContext, type Process } from '../../lib/masters';
import { availableUnits, completeFacts } from '../../lib/units';
import { saveRecord } from '../sync/records';
import { businessFields } from './businessFields';
import { draftsFromRoute, RouteEditor, routeFromDrafts, type RouteDraft } from './RouteEditor';
import { useCollection } from './useCollection';
import { useMasterData } from './useMasterData';

export function FamilyStepsPage() {
  const { workspaceId, t } = useApp();
  const [params] = useSearchParams();
  const family = params.get('family') ?? '';
  const master = useMasterData(workspaceId);
  const processes = useCollection<Process>(workspaceId, COLLECTIONS.processes);
  const members = useMemo(() => familyMembers(master.products.items, family).sort((a, b) => a.name.localeCompare(b.name)), [master.products.items, family]);
  const baseUnit = members[0]?.baseUnit ?? 'pcs';
  // Units every member can convert to (output per day must work for each product).
  const units = useMemo(() => {
    const lists = members.map((m) => availableUnits(completeFacts(productContext(m))));
    return lists.length ? lists.reduce((a, b) => a.filter((u) => b.includes(u))) : [baseUnit];
  }, [members, baseUnit]);

  const [rows, setRows] = useState<RouteDraft[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [onlyWithout, setOnlyWithout] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current || master.loading || !members.length) return;
    started.current = true;
    setRows(draftsFromRoute(commonRoute(members), baseUnit));
    setConfirmed(members.length > 0 && members.every((m) => m.routeConfirmed === true));
  }, [master.loading, members, baseUnit]);

  if (master.loading) return <p className="muted">{t('loading')}</p>;
  const back = (
    <p>
      <Link to="/masters?tab=products" className="small">
        ← Products
      </Link>
    </p>
  );
  if (!family || !members.length) {
    return (
      <section>
        {back}
        <p className="muted">No active products in this family.</p>
      </section>
    );
  }

  const route = routeFromDrafts(rows);
  const steps = typeof route === 'string' ? [] : route;
  const plan = typeof route === 'string' ? null : planFamilyRoute(members, route, confirmed, onlyWithout);
  const withSteps = members.filter((m) => (m.route ?? []).length > 0).length;
  const name = (id: string) => processes.items.find((p) => p.id === id)?.name ?? '?';

  function apply() {
    if (!workspaceId || !plan || typeof route === 'string' || !plan.change.length) return;
    const text = !route.length
      ? `Remove the steps of ${plan.change.length} product${plan.change.length === 1 ? '' : 's'} in this family?`
      : `Give these ${route.length} step${route.length === 1 ? '' : 's'} to ${plan.change.length} product${plan.change.length === 1 ? '' : 's'}${plan.replaced ? ` (${plan.replaced} lose their current, different steps)` : ''}? Orders already confirmed keep the steps they were confirmed with.`;
    if (!window.confirm(text)) return;
    for (const p of plan.change) {
      saveRecord({
        workspaceId,
        collectionName: COLLECTIONS.products,
        docId: p.id,
        entity: `Product: ${p.name}`,
        before: p,
        data: { ...businessFields(p), route, routeConfirmed: confirmed },
        reason: `Steps set for the family "${family}"`,
      });
    }
    setMsg(`Saved for ${plan.change.length} product${plan.change.length === 1 ? '' : 's'}.`);
  }

  return (
    <section>
      {back}
      <h2>Steps for a family</h2>
      <p>
        <strong>{family}</strong>
        <span className="muted small block">
          {members.length} active product{members.length === 1 ? '' : 's'} · {withSteps} with steps now
        </span>
      </p>
      <div className="card">
        <RouteEditor rows={rows} onChange={setRows} confirmed={confirmed} onConfirmedChange={setConfirmed} units={units} baseUnit={baseUnit} />
        {withSteps > 0 && withSteps < members.length && (
          <label className="check small">
            <input type="checkbox" checked={onlyWithout} onChange={(e) => setOnlyWithout(e.target.checked)} /> Only products without steps ({members.length - withSteps})
          </label>
        )}
        {typeof route === 'string' && <p className="error small">{route}</p>}
        {plan && (
          <div className="small">
            <p>
              {plan.change.length ? (
                <>
                  <strong>{plan.change.length}</strong> will get {steps.length ? steps.map((x) => name(x.processId)).join(' → ') : 'no steps (cleared)'}
                  {plan.replaced > 0 && <span className="warn"> · {plan.replaced} have different steps now (replaced)</span>}
                </>
              ) : (
                'Nothing to change.'
              )}
              {plan.same.length > 0 && <span className="muted"> · {plan.same.length} already have these</span>}
              {plan.kept.length > 0 && <span className="muted"> · {plan.kept.length} kept as they are</span>}
            </p>
            <details>
              <summary className="muted">Products in this family</summary>
              <ul className="plain-list">
                {members.map((m) => (
                  <li key={m.id}>
                    <Link to={`/masters/products/${m.id}?tab=details`}>{m.name}</Link>
                    <span className="muted">
                      {' '}
                      · {(m.route ?? []).length ? `${(m.route ?? []).length} steps` : 'no steps'}
                      {plan.change.includes(m) ? ' → changes' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
        <button type="button" className="primary" disabled={!plan || !plan.change.length} onClick={apply}>
          Save for {plan?.change.length ?? 0} product{plan?.change.length === 1 ? '' : 's'}
        </button>
        {msg && <p className="ok small">{msg}</p>}
        <p className="muted small">One product with a difference can still be changed on its own form afterwards. Orders already confirmed keep their steps.</p>
      </div>
    </section>
  );
}
