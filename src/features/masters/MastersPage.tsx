import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { baseUnitGuessed, bomStatus, COLLECTIONS, normalizeName, type Customer, type Department, type ItemExtras, type Process, type Supplier } from '../../lib/masters';
import { filterItems, groupByCategory, NO_GROUP, type ItemFilter } from '../../lib/itemGroups';
import { saveRecord } from '../sync/records';
import { businessFields } from './businessFields';
import { orderedPeople } from '../../lib/contacts';
import { useMasterData } from './useMasterData';
import { BomBadge } from './ProductSummary';
import { unitLabel } from '../../lib/units';
import { useCollection, type WithMeta } from './useCollection';

type Tab = 'customers' | 'products' | 'raw-materials' | 'suppliers' | 'processes' | 'departments';
const TABS: { id: Tab; label: string }[] = [
  { id: 'products', label: 'Products' },
  { id: 'raw-materials', label: 'Raw materials' },
  { id: 'customers', label: 'Customers' },
  { id: 'suppliers', label: 'Suppliers' },
  { id: 'processes', label: 'Processes' },
  { id: 'departments', label: 'Departments' },
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
  const [filter, setFilter] = useState<ItemFilter>({ category: '', productType: '', family: '', guessedOnly: false });

  const master = useMasterData(workspaceId);
  const products = master.products;
  const rms = master.rawMaterials;
  const customers = useCollection<Customer>(workspaceId, COLLECTIONS.customers);
  const fpAll = useFiltered(products.items, q, showInactive);
  const frAll = useFiltered(rms.items, q, showInactive);
  const fp = useMemo(() => filterItems(fpAll, filter), [fpAll, filter]);
  const fr = useMemo(() => filterItems(frAll, filter), [frAll, filter]);
  const fc = useFiltered(customers.items, q, showInactive);
  const suppliers = useCollection<Supplier>(workspaceId, COLLECTIONS.suppliers);
  const fs = useFiltered(suppliers.items, q, showInactive);
  const processes = useCollection<Process>(workspaceId, COLLECTIONS.processes);
  const fpr = useFiltered(processes.items, q, showInactive);
  const departments = useCollection<Department>(workspaceId, COLLECTIONS.departments);
  const fd = useFiltered(departments.items, q, showInactive);

  const current = tab === 'products' ? products : tab === 'raw-materials' ? rms : tab === 'suppliers' ? suppliers : tab === 'processes' ? processes : tab === 'departments' ? departments : customers;
  const list = tab === 'products' ? fp : tab === 'raw-materials' ? fr : tab === 'suppliers' ? fs : tab === 'processes' ? fpr : tab === 'departments' ? fd : fc;

  return (
    <section>
      <p>
        <Link to="/settings" className="small">
          ← Settings
        </Link>
      </p>
      <div className="row between">
        <h2>Masters</h2>
        <Link className="button primary small" to={`/masters/${tab}/new`}>
          + Add
        </Link>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'on' : ''} onClick={() => {
              setParams({ tab: x.id });
              setFilter({ category: '', productType: '', family: '', guessedOnly: false });
            }}>
            {x.label}
          </button>
        ))}
      </div>
      <input className="search" type="search" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      <label className="check">
        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
      </label>
      {(tab === 'products' || tab === 'raw-materials') && (
        <ItemFilters
          all={tab === 'products' ? fpAll : frAll}
          shown={tab === 'products' ? fp : fr}
          filter={filter}
          onChange={setFilter}
          collection={tab === 'products' ? COLLECTIONS.products : COLLECTIONS.rawMaterials}
          kind={tab === 'products' ? 'Product' : 'Raw material'}
          familyLink={tab === 'products'}
        />
      )}

      {current.loading && <p className="muted">{t('loading')}</p>}
      {current.error && <p className="error">{current.error === 'permission-denied' ? t('permissionDenied') : current.error}</p>}
      {!current.loading && !current.error && list.length === 0 && (
        <p className="muted">{q ? 'No match.' : 'Nothing added yet. Tap “+ Add”.'}</p>
      )}

      <ul className="master-list">
        {tab === 'products' && (
          <Grouped
            items={fp}
            open={filter.category !== '' || filter.family !== '' || filter.guessedOnly || q !== ''}
            render={(p) => (
              <li key={p.id}>
                <Link to={`/masters/products/${p.id}`} className={`card link ${p.active === false ? 'inactive' : ''}`}>
                  <div className="row between">
                    <strong>{p.name}</strong>
                    <BomBadge status={bomStatus(p.id, master.md)} />
                  </div>
                  <p className="muted small">
                    {SUPPLY_LABEL[p.supplyType]} · {unitLabel(p.baseUnit)}
                    {baseUnitGuessed(p) && <span className="pill warn"> unit guessed</span>}
                    {p.code && ` · ${p.code}`}
                    {p.gsm?.value ? ` · ${p.gsm.value} GSM` : ''}
                    {(p.route ?? []).length > 0 ? ` · ${(p.route ?? []).length} steps` : ''}
                    {p.active === false && ' · Inactive'}
                    {p.pending && ' · Pending sync'}
                  </p>
                </Link>
              </li>
            )}
          />
        )}
        {tab === 'raw-materials' && (
          <Grouped
            items={fr}
            open={filter.category !== '' || filter.family !== '' || filter.guessedOnly || q !== ''}
            render={(r) => (
              <li key={r.id}>
                <Link to={`/masters/raw-materials/${r.id}`} className={`card link ${r.active === false ? 'inactive' : ''}`}>
                  <div className="row between">
                    <strong>{r.name}</strong>
                    <span className="muted small">
                      {unitLabel(r.baseUnit)}
                      {baseUnitGuessed(r) && <span className="pill warn"> guessed</span>}
                    </span>
                  </div>
                  {(r.active === false || r.pending || r.family) && (
                    <p className="muted small">
                      {r.family}
                      {r.active === false && ' · Inactive'} {r.pending && ' · Pending sync'}
                    </p>
                  )}
                </Link>
              </li>
            )}
          />
        )}
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
        {tab === 'suppliers' &&
          fs.map((s) => (
            <li key={s.id}>
              <Link to={`/masters/suppliers/${s.id}`} className={`card link ${s.active === false ? 'inactive' : ''}`}>
                <div className="row between">
                  <strong>{s.name}</strong>
                  <span className="muted small">{s.place}</span>
                </div>
                <p className="muted small">
                  {(s.items ?? []).length} item{(s.items ?? []).length === 1 ? '' : 's'}
                  {s.active === false && ' · Inactive'}
                  {s.pending && ' · Pending sync'}
                </p>
              </Link>
            </li>
          ))}
        {tab === 'processes' &&
          fpr.map((x) => {
            const n = products.items.filter((p) => (p.route ?? []).some((s) => s.processId === x.id)).length;
            return (
              <li key={x.id}>
                <Link to={`/masters/processes/${x.id}`} className={`card link ${x.active === false ? 'inactive' : ''}`}>
                  <div className="row between">
                    <strong>{x.name}</strong>
                    <span className="muted small">
                      {n} product{n === 1 ? '' : 's'}
                    </span>
                  </div>
                  {(x.active === false || x.pending) && (
                    <p className="muted small">
                      {x.active === false && 'Inactive'} {x.pending && 'Pending sync'}
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
        {tab === 'departments' &&
          fd.map((x) => {
            const lead = orderedPeople(x.people)[0];
            const np = (x.people ?? []).length;
            const npr = (x.processIds ?? []).length;
            return (
              <li key={x.id}>
                <Link to={`/masters/departments/${x.id}`} className={`card link ${x.active === false ? 'inactive' : ''}`}>
                  <div className="row between">
                    <strong>{x.name}</strong>
                    <span className="muted small">
                      {npr} process{npr === 1 ? '' : 'es'}
                    </span>
                  </div>
                  <p className="muted small">
                    {lead ? `${lead.name}${lead.designation ? ` (${lead.designation})` : ''}` : 'No people yet'}
                    {np > 1 && ` +${np - 1}`}
                    {x.active === false && ' · Inactive'}
                    {x.pending && ' · Pending sync'}
                  </p>
                </Link>
              </li>
            );
          })}
      </ul>
    </section>
  );
}

type Item = WithMeta<ItemExtras & { name: string; active: boolean; baseUnit: string }>;

/** Items grouped by category (confirmed 4 Nov 2026); large groups start closed. */
function Grouped<T extends Item>({ items, open, render }: { items: T[]; open: boolean; render: (x: T) => React.ReactNode }) {
  const groups = groupByCategory(items);
  if (groups.length <= 1) return <>{items.map(render)}</>;
  return (
    <>
      {groups.map((g) => (
        <li key={g.name} className="group-row">
          <details open={open || items.length <= 40}>
            <summary>
              <strong>{g.name === NO_GROUP ? 'No category' : g.name}</strong> <span className="muted small">{g.items.length}</span>
            </summary>
            <ul className="master-list">{g.items.map(render)}</ul>
          </details>
        </li>
      ))}
    </>
  );
}

/** Category / type / family filters, "unit guessed" and the family / bulk actions. */
function ItemFilters(props: { all: Item[]; shown: Item[]; filter: ItemFilter; onChange: (f: ItemFilter) => void; collection: string; kind: string; familyLink: boolean }) {
  const { workspaceId } = useApp();
  const { all, shown, filter, onChange } = props;
  const values = (k: 'category' | 'productType' | 'family', within: Item[]) =>
    [...new Set(within.map((x) => x[k]?.trim() || ''))].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  // Each list narrows by the choices above it.
  const byCat = filter.category ? all.filter((x) => (x.category ?? '') === (filter.category === NO_GROUP ? '' : filter.category)) : all;
  const byType = filter.productType ? byCat.filter((x) => (x.productType ?? '') === (filter.productType === NO_GROUP ? '' : filter.productType)) : byCat;
  const guessedCount = all.filter(baseUnitGuessed).length;
  const hasGroups = all.some((x) => x.category || x.productType || x.family);
  const sel = (k: 'category' | 'productType' | 'family', label: string, within: Item[]) => {
    const opts = values(k, within);
    if (opts.length <= 1 && !filter[k]) return null;
    return (
      <label className="small">
        {label}
        <select
          value={filter[k]}
          onChange={(e) => onChange({ ...filter, [k]: e.target.value, ...(k === 'category' ? { productType: '', family: '' } : k === 'productType' ? { family: '' } : {}) })}
        >
          <option value="">All</option>
          {opts.map((o) => (
            <option key={o || NO_GROUP} value={o || NO_GROUP}>
              {o || '(none)'}
            </option>
          ))}
        </select>
      </label>
    );
  };
  const guessedShown = shown.filter(baseUnitGuessed);
  function confirmAll() {
    if (!workspaceId) return;
    const byUnit = new Map<string, number>();
    for (const x of guessedShown) byUnit.set(x.baseUnit, (byUnit.get(x.baseUnit) ?? 0) + 1);
    const summary = [...byUnit].map(([u, n]) => `${n} × ${unitLabel(u)}`).join(', ');
    if (!window.confirm(`Confirm the base unit of these ${guessedShown.length} items (${summary})? After this they are fixed like any other base unit.`)) return;
    for (const x of guessedShown) {
      const data = businessFields(x);
      saveRecord({ workspaceId, collectionName: props.collection, docId: x.id, entity: `${props.kind}: ${x.name}`, before: x, data: { ...data, baseUnitStatus: 'USER_PROVIDED' }, reason: 'Base unit confirmed (was guessed)' });
    }
  }
  if (!hasGroups && guessedCount === 0) return null;
  return (
    <div className="item-filters">
      <div className="grid3">
        {sel('category', 'Category', all)}
        {sel('productType', 'Type', byCat)}
        {sel('family', 'Family', byType)}
      </div>
      {guessedCount > 0 && (
        <label className="check small">
          <input type="checkbox" checked={filter.guessedOnly} onChange={(e) => onChange({ ...filter, guessedOnly: e.target.checked })} /> Only units guessed ({guessedCount})
        </label>
      )}
      <p className="muted small">
        {shown.length} of {all.length} shown
      </p>
      {props.familyLink && filter.family && filter.family !== NO_GROUP && (
        <Link className="button secondary small" to={`/masters/family-steps?family=${encodeURIComponent(filter.family)}`}>
          Steps for this family ({all.filter((x) => x.family === filter.family).length})
        </Link>
      )}
      {filter.guessedOnly && guessedShown.length > 0 && (
        <button type="button" className="secondary small" onClick={confirmAll}>
          Confirm units of these {guessedShown.length}
        </button>
      )}
    </div>
  );
}
