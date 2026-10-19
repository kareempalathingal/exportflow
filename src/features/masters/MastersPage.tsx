import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { COLLECTIONS, normalizeName, type Customer, type Product, type RawMaterial } from '../../lib/masters';
import { unitLabel } from '../../lib/units';
import { useCollection, type WithMeta } from './useCollection';

type Tab = 'customers' | 'products' | 'raw-materials';
const TABS: { id: Tab; label: string }[] = [
  { id: 'products', label: 'Products' },
  { id: 'raw-materials', label: 'Raw materials' },
  { id: 'customers', label: 'Customers' },
];

const SUPPLY_LABEL = { MANUFACTURED: 'Manufactured', TRADED: 'Traded', BOTH: 'Manufactured + Traded' } as const;

function useFiltered<T extends { name: string; active: boolean }>(items: WithMeta<T>[], q: string, showInactive: boolean) {
  return useMemo(() => {
    const n = normalizeName(q);
    return items
      .filter((i) => (showInactive ? true : i.active !== false))
      .filter((i) => !n || normalizeName(i.name).includes(n))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items, q, showInactive]);
}

export function MastersPage() {
  const { workspaceId, t } = useApp();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((x) => x.id === params.get('tab'))?.id ?? 'products') as Tab;
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const products = useCollection<Product>(workspaceId, COLLECTIONS.products);
  const rms = useCollection<RawMaterial>(workspaceId, COLLECTIONS.rawMaterials);
  const customers = useCollection<Customer>(workspaceId, COLLECTIONS.customers);
  const fp = useFiltered(products.items, q, showInactive);
  const fr = useFiltered(rms.items, q, showInactive);
  const fc = useFiltered(customers.items, q, showInactive);

  const current = tab === 'products' ? products : tab === 'raw-materials' ? rms : customers;
  const list = tab === 'products' ? fp : tab === 'raw-materials' ? fr : fc;

  return (
    <section>
      <div className="row between">
        <h2>Masters</h2>
        <Link className="button primary small" to={`/masters/${tab}/new`}>
          + Add
        </Link>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'on' : ''} onClick={() => setParams({ tab: x.id })}>
            {x.label}
          </button>
        ))}
      </div>
      <input className="search" type="search" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      <label className="check">
        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
      </label>

      {current.loading && <p className="muted">{t('loading')}</p>}
      {current.error && <p className="error">{current.error === 'permission-denied' ? t('permissionDenied') : current.error}</p>}
      {!current.loading && !current.error && list.length === 0 && (
        <p className="muted">{q ? 'No match.' : 'Nothing added yet. Tap “+ Add”.'}</p>
      )}

      <ul className="master-list">
        {tab === 'products' &&
          fp.map((p) => (
            <li key={p.id}>
              <Link to={`/masters/products/${p.id}`} className={`card link ${p.active === false ? 'inactive' : ''}`}>
                <div className="row between">
                  <strong>{p.name}</strong>
                  <span className="muted small">{unitLabel(p.baseUnit)}</span>
                </div>
                <p className="muted small">
                  {SUPPLY_LABEL[p.supplyType]}
                  {p.code && ` · ${p.code}`}
                  {p.gsm?.value ? ` · ${p.gsm.value} GSM` : ''}
                  {p.active === false && ' · Inactive'}
                  {p.pending && ' · Pending sync'}
                </p>
              </Link>
            </li>
          ))}
        {tab === 'raw-materials' &&
          fr.map((r) => (
            <li key={r.id}>
              <Link to={`/masters/raw-materials/${r.id}`} className={`card link ${r.active === false ? 'inactive' : ''}`}>
                <div className="row between">
                  <strong>{r.name}</strong>
                  <span className="muted small">{unitLabel(r.baseUnit)}</span>
                </div>
                {(r.active === false || r.pending) && (
                  <p className="muted small">
                    {r.active === false && 'Inactive'} {r.pending && 'Pending sync'}
                  </p>
                )}
              </Link>
            </li>
          ))}
        {tab === 'customers' &&
          fc.map((c) => (
            <li key={c.id}>
              <Link to={`/masters/customers/${c.id}`} className={`card link ${c.active === false ? 'inactive' : ''}`}>
                <div className="row between">
                  <strong>{c.name}</strong>
                  <span className="muted small">{c.country}</span>
                </div>
                <p className="muted small">
                  {c.customerType === 'AGENT' ? 'Agent / trading company' : 'Direct customer'}
                  {c.active === false && ' · Inactive'}
                  {c.pending && ' · Pending sync'}
                </p>
              </Link>
            </li>
          ))}
      </ul>
    </section>
  );
}
