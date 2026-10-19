import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../../AppContext';
import {
  changedBoms,
  checkForConfirm,
  COLLECTION_JOB_ORDERS,
  computeDeadline,
  fixedSupply,
  initialSupply,
  DELIVERY_DATE_TYPES,
  findDuplicateJo,
  formatDay,
  isEditable,
  newLineId,
  reasonRequired,
  resolveLine,
  snapshotBoms,
  type BomSnapshotEntry,
  type Deadline,
  type DeliveryDateType,
  type JobOrder,
  type JoLine,
  type JoStatus,
  type SupplyMethod,
} from '../../lib/jobOrders';
import { COLLECTIONS, productContext, type Customer, type Product } from '../../lib/masters';
import { istDateKey } from '../../lib/time';
import { availableUnits, formatQty, unitLabel } from '../../lib/units';
import { saveRecord } from '../sync/records';
import { parseNum, TextField, UnitSelect } from '../masters/fields';
import { withReturnTo } from '../masters/returnTo';
import { newId, useCollection, useDocument } from '../masters/useCollection';
import { useMasterData } from '../masters/useMasterData';
import { DeadlinePill, permissionHint, StatusPill } from './OrderBits';

interface LineDraft {
  id: string;
  productId: string;
  qtyText: string;
  unit: string;
  supply: SupplyMethod | null;
}

interface Draft {
  joNumber: string;
  customerId: string;
  poNumber: string;
  receivedDate: string;
  deliveryDate: string;
  deliveryDateType: DeliveryDateType;
  notes: string;
  lines: LineDraft[];
}

const SUPPLY_SHORT = { MANUFACTURED: 'made', TRADED: 'bought', BOTH: 'made/bought' } as const;

function draftFrom(jo: JobOrder | null, today: string): Draft {
  if (!jo) return { joNumber: '', customerId: '', poNumber: '', receivedDate: today, deliveryDate: '', deliveryDateType: 'UNCONFIRMED', notes: '', lines: [] };
  return {
    joNumber: jo.joNumber,
    customerId: jo.customerId,
    poNumber: jo.poNumber,
    receivedDate: jo.receivedDate,
    deliveryDate: jo.deliveryDate,
    deliveryDateType: jo.deliveryDateType,
    notes: jo.notes,
    lines: jo.lines.map((l) => ({ id: l.id, productId: l.productId, qtyText: String(l.qty), unit: l.unit, supply: l.supply })),
  };
}

export function JobOrderPage() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const { workspaceId, t } = useApp();
  const navigate = useNavigate();
  const today = istDateKey(new Date());
  const { item, loading, error: loadError } = useDocument<JobOrder>(workspaceId, COLLECTION_JOB_ORDERS, isNew ? null : id);
  const all = useCollection<JobOrder>(workspaceId, COLLECTION_JOB_ORDERS);
  const customers = useCollection<Customer>(workspaceId, COLLECTIONS.customers);
  const master = useMasterData(workspaceId);
  const { md, bomRev } = master;

  const [d, setD] = useState<Draft>(() => draftFrom(isNew ? null : item, today));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const loaded = useRef<string | null>(isNew ? 'new' : item ? `${item.id}:${item.rev}` : null);
  const savedDraft = useRef(JSON.stringify(d));

  useEffect(() => {
    if (!item) return;
    const key = `${item.id}:${item.rev}`;
    if (loaded.current === key) return;
    loaded.current = key;
    const next = draftFrom(item, today);
    setD(next);
    savedDraft.current = JSON.stringify(next);
  }, [item, today]);

  const activeProducts = useMemo(
    () => master.products.items.filter((p) => p.active !== false).sort((a, b) => a.name.localeCompare(b.name)),
    [master.products.items],
  );
  const activeCustomers = useMemo(
    () => customers.items.filter((c) => c.active !== false).sort((a, b) => a.name.localeCompare(b.name)),
    [customers.items],
  );

  if (!isNew && loading) return <p className="muted">{t('loading')}</p>;
  if (!isNew && loadError) return <p className="error">{permissionHint(loadError)}</p>;
  if (!isNew && !item) return <p className="error">Job Order not found.</p>;

  const status: JoStatus = item?.status ?? 'DRAFT';
  const editable = isNew || isEditable(status);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const setLine = (i: number, patch: Partial<LineDraft>) => set({ lines: d.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const dirty = JSON.stringify(d) !== savedDraft.current;

  // Keep the stored deadline (and its rule version) unless the dates change.
  const datesUnchanged = !!item && item.receivedDate === d.receivedDate && item.deliveryDate === d.deliveryDate;
  const computed = computeDeadline(d.receivedDate, d.deliveryDate);
  const deadline: Deadline | null = datesUnchanged ? item!.deadline : computed.ok ? computed : null;
  const deadlineError = !datesUnchanged && !computed.ok ? computed.error : null;

  const dup = d.joNumber.trim() ? findDuplicateJo(d.joNumber, all.items, isNew ? undefined : id) : undefined;
  const customer = customers.items.find((c) => c.id === d.customerId);

  function buildLines(): JoLine[] | string {
    const out: JoLine[] = [];
    for (const [i, l] of d.lines.entries()) {
      if (!l.productId) return `Line ${i + 1}: choose a product`;
      const qty = parseNum(l.qtyText);
      if (qty === null || !Number.isFinite(qty) || qty <= 0) return `Line ${i + 1}: enter a quantity above 0`;
      const p = md.products.get(l.productId);
      out.push({ id: l.id, productId: l.productId, productName: p?.name ?? item?.lines.find((x) => x.id === l.id)?.productName ?? '', qty, unit: l.unit, supply: p ? (fixedSupply(p) ?? l.supply) : l.supply });
    }
    return out;
  }

  /** Validate and save the form with the given status. Returns true when saved. */
  function save(next: JoStatus, why: string, opts: { freshSnapshot?: boolean } = {}): boolean {
    if (!workspaceId) return false;
    if (!d.joNumber.trim()) return setError('JO number is required'), false;
    if (!d.customerId) return setError('Choose a customer'), false;
    if (!deadline) return setError(deadlineError ?? 'Check the dates'), false;
    const lines = buildLines();
    if (typeof lines === 'string') return setError(lines), false;
    if (reasonRequired(isNew ? null : status, next) && !why.trim()) return setError('A reason is required for this change'), false;

    let bomSnapshot: Record<string, BomSnapshotEntry> | null = item?.bomSnapshot ?? null;
    let confirmedOn = item?.confirmedOn ?? null;
    if (next === 'CONFIRMED' && status === 'DRAFT') {
      bomSnapshot = snapshotBoms(lines, md, bomRev);
      confirmedOn = today;
    } else if (next === 'CONFIRMED') {
      bomSnapshot = snapshotBoms(lines, md, bomRev, opts.freshSnapshot ? null : bomSnapshot);
    } else if (next === 'DRAFT') {
      bomSnapshot = null;
      confirmedOn = null;
    }

    const data: JobOrder = {
      joNumber: d.joNumber.trim(),
      customerId: d.customerId,
      customerName: customer?.name ?? item?.customerName ?? '',
      poNumber: d.poNumber.trim(),
      receivedDate: d.receivedDate,
      deliveryDate: d.deliveryDate,
      deliveryDateType: d.deliveryDateType,
      deadline: { orderPeriodDays: deadline.orderPeriodDays, bufferDays: deadline.bufferDays, internalDeadline: deadline.internalDeadline, ruleVersion: deadline.ruleVersion },
      status: next,
      lines,
      notes: d.notes.trim(),
      bomSnapshot,
      confirmedOn,
    };
    setError(null);
    const docId = isNew ? newId(workspaceId, COLLECTION_JOB_ORDERS) : id;
    saveRecord({
      workspaceId,
      collectionName: COLLECTION_JOB_ORDERS,
      docId,
      entity: `Job Order: ${data.joNumber}`,
      before: isNew ? null : item,
      data: JSON.parse(JSON.stringify(data)) as Record<string, unknown>,
      reason: why,
    });
    savedDraft.current = JSON.stringify(d);
    setReason('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    if (isNew) navigate(`/orders/${docId}`, { replace: true });
    return true;
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    save(status, reason);
  }

  function confirmOrder() {
    const lines = buildLines();
    if (typeof lines === 'string') return setError(lines);
    if (!deadline) return setError(deadlineError ?? 'Check the dates');
    const check = checkForConfirm({ lines, deliveryDateType: d.deliveryDateType, deadline }, md, today);
    if (check.blocking.length) return setError(`Cannot confirm yet:\n• ${check.blocking.join('\n• ')}`);
    const msg = check.warnings.length
      ? `Confirm this Job Order?\n\nPlease note:\n• ${check.warnings.join('\n• ')}\n\nThe current BOMs will be saved with the order.`
      : 'Confirm this Job Order? The current BOMs will be saved with the order.';
    if (window.confirm(msg)) save('CONFIRMED', reason);
  }

  // Status buttons must not carry unsaved edits of a confirmed order past the reason check.
  function cleanFirst(): boolean {
    if (status !== 'DRAFT' && dirty) {
      setError('Save (or undo) your changes first, then change the status.');
      return false;
    }
    return true;
  }

  function withReason(next: JoStatus, question: string, opts?: { freshSnapshot?: boolean }) {
    if (!cleanFirst()) return;
    const r = window.prompt(question, reason);
    if (r === null) return;
    if (!r.trim()) return setError('A reason is required for this change');
    save(next, r, opts);
  }

  function guard(e: MouseEvent<HTMLAnchorElement>) {
    if (dirty && !window.confirm('You have unsaved changes on this Job Order. Leave without saving them?')) e.preventDefault();
  }
  const here = isNew ? '/orders/new' : `/orders/${id}`;
  const changed = item && status === 'CONFIRMED' ? changedBoms(item.bomSnapshot, md, bomRev) : [];
  const snapCount = item?.bomSnapshot ? Object.keys(item.bomSnapshot).length : 0;
  const editReasonNeeded = !isNew && reasonRequired(status, status);

  return (
    <section>
      <p>
        <Link to="/orders" className="small" onClick={guard}>
          ← Orders
        </Link>
      </p>
      {isNew ? (
        <h2>New Job Order</h2>
      ) : (
        <>
          <div className="row between">
            <h2>{item!.joNumber}</h2>
            <StatusPill status={status} />
          </div>
          <p className="muted small">
            {item!.customerName}
            {item!.poNumber && ` · PO ${item!.poNumber}`}
            {item!.confirmedOn && ` · confirmed ${formatDay(item!.confirmedOn)}`}
          </p>
          <div className="summary-grid">
            <div>
              <span className="kicker">Internal deadline</span>
              <span>
                <strong>{formatDay(item!.deadline.internalDeadline)}</strong> <DeadlinePill jo={item!} today={today} />
              </span>
            </div>
            <div>
              <span className="kicker">Customer delivery</span>
              <span>{formatDay(item!.deliveryDate)}</span>
              <span className="muted small">{DELIVERY_DATE_TYPES.find((x) => x.id === item!.deliveryDateType)?.label}</span>
            </div>
            <div>
              <span className="kicker">Buffer</span>
              <span>
                {item!.deadline.bufferDays} day{item!.deadline.bufferDays === 1 ? '' : 's'} of {item!.deadline.orderPeriodDays}
              </span>
              <span className="muted small">10% rounded up · {item!.deadline.ruleVersion}</span>
            </div>
          </div>

          {changed.length > 0 && (
            <div className="card subtle">
              <p className="warn">
                <strong>BOM changed after confirmation:</strong> {changed.map((pid) => md.products.get(pid)?.name ?? pid).join(', ')}.
              </p>
              <p className="small muted">This order keeps the BOM it was confirmed with until you choose otherwise.</p>
              <button type="button" className="secondary small" onClick={() => withReason('CONFIRMED', 'Reason for using the latest BOMs on this order', { freshSnapshot: true })}>
                Use latest BOMs
              </button>
            </div>
          )}
          {status !== 'DRAFT' && status !== 'CANCELLED' && (
            <p className="muted small">BOM saved with this order: {snapCount ? `${snapCount} product${snapCount === 1 ? '' : 's'}` : 'none (no BOM existed at confirmation)'}.</p>
          )}

          <div className="row gap actions">
            {status === 'DRAFT' && (
              <button type="button" className="primary" onClick={confirmOrder}>
                Confirm order
              </button>
            )}
            {status === 'CONFIRMED' && (
              <button type="button" className="primary" onClick={() => cleanFirst() && window.confirm('Mark this Job Order as completed?') && save('COMPLETED', reason)}>
                Mark completed
              </button>
            )}
            {status === 'COMPLETED' && (
              <button type="button" className="secondary" onClick={() => withReason('CONFIRMED', 'Reason for reopening this order')}>
                Reopen
              </button>
            )}
            {status === 'CANCELLED' && (
              <button type="button" className="secondary" onClick={() => withReason('DRAFT', 'Reason for reopening this order as a draft')}>
                Reopen as draft
              </button>
            )}
            {(status === 'DRAFT' || status === 'CONFIRMED') && (
              <button type="button" className="secondary danger" onClick={() => withReason('CANCELLED', 'Reason for cancelling this order')}>
                Cancel order
              </button>
            )}
          </div>
        </>
      )}

      <form className="card" onSubmit={submit} noValidate>
        <fieldset className="plain" disabled={!editable}>
          {!editable && <p className="muted small">This order is {status.toLowerCase()} and read-only. Reopen it to make changes.</p>}
          <div className="grid2">
            <TextField label="JO number" required value={d.joNumber} onChange={(joNumber) => set({ joNumber })} max={60} placeholder="as on the company Job Order" />
            <TextField label="Customer PO number (optional)" value={d.poNumber} onChange={(poNumber) => set({ poNumber })} max={60} />
          </div>
          <label>
            Customer<span className="req"> *</span>
            <select value={d.customerId} onChange={(e) => set({ customerId: e.target.value })}>
              <option value="">— choose —</option>
              {activeCustomers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.country ? ` (${c.country})` : ''}
                </option>
              ))}
              {d.customerId && !activeCustomers.some((c) => c.id === d.customerId) && <option value={d.customerId}>{customer?.name ?? item?.customerName ?? '(missing customer)'}</option>}
            </select>
          </label>
          {editable && (
            <p className="small create-links">
              Not in the list?{' '}
              <Link to={withReturnTo('/masters/customers/new', here)} onClick={guard}>
                + New customer
              </Link>
            </p>
          )}
          <div className="grid2">
            <label>
              JO received on<span className="req"> *</span>
              <input type="date" value={d.receivedDate} onChange={(e) => set({ receivedDate: e.target.value })} />
            </label>
            <label>
              Customer delivery date<span className="req"> *</span>
              <input type="date" value={d.deliveryDate} onChange={(e) => set({ deliveryDate: e.target.value })} />
            </label>
          </div>
          <label>
            Delivery date means
            <select value={d.deliveryDateType} onChange={(e) => set({ deliveryDateType: e.target.value as DeliveryDateType })}>
              {DELIVERY_DATE_TYPES.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          {deadlineError && d.deliveryDate && <p className="error small">{deadlineError}</p>}
          {deadline && (
            <p className="muted small">
              Order period {deadline.orderPeriodDays} days · buffer {deadline.bufferDays} day{deadline.bufferDays === 1 ? '' : 's'} → internal deadline{' '}
              <strong>{formatDay(deadline.internalDeadline)}</strong>
            </p>
          )}

          <h3 className="section-title">Products</h3>
          {d.lines.length === 0 && <p className="muted small">No lines yet.</p>}
          {d.lines.map((l, i) => {
            const p: (Product & { id: string }) | undefined = master.products.items.find((x) => x.id === l.productId);
            const units = p ? availableUnits(productContext(p)) : [];
            const qty = parseNum(l.qtyText);
            const r = p && qty !== null && Number.isFinite(qty) && qty > 0 ? resolveLine({ productId: p.id, qty, unit: l.unit }, md) : null;
            return (
              <fieldset key={l.id} className="tracked">
                <legend>Line {i + 1}</legend>
                <label>
                  Product
                  <select
                    value={l.productId}
                    onChange={(e) => {
                      const np = md.products.get(e.target.value);
                      setLine(i, { productId: e.target.value, unit: np?.baseUnit ?? l.unit, supply: np ? initialSupply(np) : null });
                    }}
                  >
                    <option value="">— choose —</option>
                    {activeProducts.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} ({SUPPLY_SHORT[x.supplyType]})
                      </option>
                    ))}
                    {l.productId && !activeProducts.some((x) => x.id === l.productId) && (
                      <option value={l.productId}>{p ? `${p.name} (inactive)` : (item?.lines.find((x) => x.id === l.id)?.productName ?? '(missing product)')}</option>
                    )}
                  </select>
                </label>
                <div className="grid2">
                  <label>
                    Quantity
                    <input inputMode="decimal" value={l.qtyText} onChange={(e) => setLine(i, { qtyText: e.target.value })} />
                  </label>
                  <UnitSelect label="Unit" value={l.unit} onChange={(unit) => setLine(i, { unit })} units={units.length ? units : [l.unit]} />
                </div>
                {p?.supplyType === 'BOTH' ? (
                  <label>
                    Make or buy?<span className="req"> *</span>
                    {p.usualSupply && <span className="muted"> (usually {p.usualSupply === 'MAKE' ? 'made' : 'bought'})</span>}
                    <select value={l.supply ?? ''} onChange={(e) => setLine(i, { supply: (e.target.value || null) as SupplyMethod | null })}>
                      <option value="">— decide —</option>
                      <option value="MAKE">Make in our factory</option>
                      <option value="BUY">Buy from outside</option>
                    </select>
                  </label>
                ) : (
                  p && <p className="muted small">{p.supplyType === 'MANUFACTURED' ? 'Make (manufactured product)' : 'Buy (traded product)'}</p>
                )}
                {r && r.problem && <p className="warn small">{r.problem}</p>}
                {r && r.baseQty !== null && l.unit !== r.baseUnit && (
                  <p className="muted small">
                    = {formatQty(r.baseQty)} {unitLabel(r.baseUnit!)}
                    {r.provisional && <span className="pill warn"> estimated conversion</span>}
                  </p>
                )}
                {editable && (
                  <button type="button" className="secondary small" onClick={() => set({ lines: d.lines.filter((_, j) => j !== i) })}>
                    Remove line
                  </button>
                )}
              </fieldset>
            );
          })}
          {editable && (
            <>
              <button type="button" className="secondary small" onClick={() => set({ lines: [...d.lines, { id: newLineId(), productId: '', qtyText: '', unit: 'pcs', supply: null }] })}>
                + Add product line
              </button>
              <p className="small create-links">
                Not in the list?{' '}
                <Link to={withReturnTo('/masters/products/new', here)} onClick={guard}>
                  + New product
                </Link>
              </p>
            </>
          )}

          <TextField label="Notes" multiline value={d.notes} onChange={(notes) => set({ notes })} />
          {!isNew && editable && (
            <label>
              {editReasonNeeded ? (
                <>
                  Reason for the change<span className="req"> *</span>
                </>
              ) : (
                t('reasonOptional')
              )}
              <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
            </label>
          )}
        </fieldset>
        {dup && <p className="warn small">Another Job Order already uses the number “{dup.joNumber}”.</p>}
        {error && (
          <p className="error pre" role="alert">
            {error}
          </p>
        )}
        {editable && (
          <div className="row between">
            <span className="muted small">
              {!isNew && `${t('rev')} ${item?.rev ?? 0}`}
              {item?.pending && <span className="badge pending inline">{t('PENDING')}</span>}
            </span>
            <button className="primary" type="submit">
              {isNew ? 'Save as draft' : t('save')}
            </button>
          </div>
        )}
        {saved && <p className="ok small">{t('saved')}</p>}
      </form>
    </section>
  );
}
