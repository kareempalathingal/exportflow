import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { planBaseUnitCopy } from '../../lib/baseUnitCopy';
import { COLLECTION_JOB_ORDERS, type JobOrder } from '../../lib/jobOrders';
import { COLLECTIONS, productContext, type Product, type Supplier } from '../../lib/masters';
import { istDateKey } from '../../lib/time';
import { availableUnits, completeFacts, STANDARD_UNITS, unitLabel } from '../../lib/units';
import { saveRecord } from '../sync/records';
import { UnitSelect } from './fields';
import { newId, useCollection, type WithMeta } from './useCollection';
import { useMasterData } from './useMasterData';

/**
 * "Wrong base unit?" — makes a copy of the product in another base unit with
 * the BOM and own units rescaled, relinks other BOMs and suppliers to the copy,
 * and sets the old product Inactive. Orders that use the old product are not changed.
 */
export function BaseUnitCopy({ product }: { product: WithMeta<Product> }) {
  const { workspaceId } = useApp();
  const navigate = useNavigate();
  const master = useMasterData(workspaceId);
  const suppliers = useCollection<Supplier>(workspaceId, COLLECTIONS.suppliers);
  const jos = useCollection<JobOrder>(workspaceId, COLLECTION_JOB_ORDERS);
  const standard = useMemo(() => new Set(STANDARD_UNITS.map((u) => u.id)), []);
  const choices = useMemo(
    () => availableUnits(completeFacts(productContext(product))).filter((u) => standard.has(u) && u !== product.baseUnit),
    [product, standard],
  );
  const [unit, setUnit] = useState('');
  const [name, setName] = useState(product.name);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copyId] = useState(() => (workspaceId ? newId(workspaceId, COLLECTIONS.products) : ''));
  const today = istDateKey(new Date());
  const loading = master.loading || suppliers.loading || jos.loading;

  const plan = useMemo(
    () =>
      unit && copyId && !loading
        ? planBaseUnitCopy({ productId: product.id, product, newUnit: unit, newName: name, md: master.md, suppliers: suppliers.items, jobOrders: jos.items, newId: copyId, today })
        : null,
    [unit, copyId, loading, product, name, master.md, suppliers.items, jos.items, today],
  );

  function run() {
    if (!workspaceId || !plan || 'error' in plan) return;
    const why = reason.trim() || `Base unit ${unitLabel(product.baseUnit)} → ${unitLabel(unit)}`;
    if (!window.confirm(`Make "${plan.product.name}" in ${unitLabel(unit)} and set "${product.name}" (${unitLabel(product.baseUnit)}) Inactive?`)) return;
    setError(null);
    try {
      saveRecord({ workspaceId, collectionName: COLLECTIONS.products, docId: copyId, entity: `Product: ${plan.product.name}`, before: null, data: { ...plan.product }, reason: `Copy of "${product.name}": ${why}` });
      if (plan.bom) saveRecord({ workspaceId, collectionName: COLLECTIONS.boms, docId: copyId, entity: `BOM: ${plan.product.name}`, before: null, data: { ...plan.bom }, reason: `Rescaled from the BOM of "${product.name}"` });
      for (const p of plan.parentBoms) {
        const before = master.boms.items.find((b) => b.id === p.productId);
        if (!before) continue;
        saveRecord({ workspaceId, collectionName: COLLECTIONS.boms, docId: p.productId, entity: `BOM: ${p.productName}`, before, data: { productId: before.productId, notes: before.notes, lines: p.lines }, reason: `Uses "${plan.product.name}" (${unitLabel(unit)}) instead of the old product` });
      }
      for (const s of plan.suppliers) {
        const before = suppliers.items.find((x) => x.id === s.id);
        if (!before) continue;
        saveRecord({ workspaceId, collectionName: COLLECTIONS.suppliers, docId: s.id, entity: `Supplier: ${s.name}`, before, data: { ...businessFields(before), items: s.items }, reason: `Also supplies "${plan.product.name}" (copy)` });
      }
      saveRecord({ workspaceId, collectionName: COLLECTIONS.products, docId: product.id, entity: `Product: ${product.name}`, before: product, data: { ...businessFields(product), active: false }, reason: `Replaced by "${plan.product.name}" in ${unitLabel(unit)}` });
      navigate(`/masters/products/${copyId}?tab=details`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <details className="card setting">
      <summary>
        <span className="setting-title">Wrong base unit?</span>
        <span className="setting-sum">Copy in another unit</span>
        <span className="setting-chev" aria-hidden="true">
          ›
        </span>
      </summary>
      <div className="setting-body">
        <p className="muted small">
          The base unit cannot be changed, because the BOM, stock and orders are written per {unitLabel(product.baseUnit)}. Instead, make a copy in another base unit: the BOM and own
          units are rescaled, other BOMs and suppliers move to the copy, and this product is set Inactive. Orders that use it are not changed.
        </p>
        {choices.length === 0 ? (
          <p className="warn small">No other unit can be converted for this product yet. Add the size, GSM or weight per piece first (Details), then come back.</p>
        ) : (
          <>
            <div className="grid2">
              <UnitSelect label="New base unit" value={unit} onChange={setUnit} units={choices} allowEmpty />
              <label>
                Name of the copy
                <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
              </label>
            </div>
            <label>
              Reason (optional)
              <input value={reason} maxLength={200} placeholder="e.g. company counts this mat in sq m" onChange={(e) => setReason(e.target.value)} />
            </label>
            {loading && unit && <p className="muted small">Loading…</p>}
            {plan && 'error' in plan && <p className="error small">{plan.error}</p>}
            {plan && !('error' in plan) && (
              <>
                <p className="small">
                  <strong>What will happen</strong>
                </p>
                <ul className="small">
                  {plan.summary.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
                <button type="button" className="primary" onClick={run}>
                  Make the copy
                </button>
              </>
            )}
            {error && <p className="error small">{error}</p>}
          </>
        )}
      </div>
    </details>
  );
}

const META = new Set(['id', 'rev', 'pending', 'updatedAt', 'updatedBy', 'lastAuditId']);
/** The record without its id and version fields (those are written by saveRecord). */
function businessFields<T extends object>(r: WithMeta<T>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(r).filter(([k]) => !META.has(k)));
}
