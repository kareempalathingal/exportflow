import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../../AppContext';
import {
  changedBoms,
  checkForConfirm,
  COLLECTION_JOB_ORDERS,
  bufferText,
  computeDeadline,
  deadlineUpdate,
  completedOnAfter,
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
import { COLLECTIONS, productContext, suppliersOf, type Customer, type Product, type Supplier } from '../../lib/masters';
import { istDateKey } from '../../lib/time';
import { availableUnits, formatQty, unitLabel } from '../../lib/units';
import { saveRecord } from '../sync/records';
import { parseNum, TextField, UnitSelect } from '../masters/fields';
import { withReturnTo } from '../masters/returnTo';
import { newId, useCollection, useDocument } from '../masters/useCollection';
import { useMasterData } from '../masters/useMasterData';
import { DeadlinePill, permissionHint, StatusPill } from './OrderBits';
import { MaterialsTab } from './MaterialsTab';
import { ProgressCard } from './ProgressCard';
import { ProductsTab } from './ProductsTab';
import { buildLineSteps } from '../../lib/route';
import type { Process } from '../../lib/masters';
import { DocButtons } from '../docs/DocButtons';
import { joSummaryDoc, productionPlanDoc } from '../../lib/docs/model';
import { useProfile } from '../settings/useProfile';
import { formatDateTime } from '../../lib/time';
import { COLLECTION_STOCK_COUNTS, type StockCount } from '../../lib/materials';
import { dayOff } from '../../lib/calendar';
import { useWorkCalendar } from '../calendar/useWorkCalendar';

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
  const counts = useCollection<StockCount>(workspaceId, COLLECTION_STOCK_COUNTS);
  const { profile } = useProfile(workspaceId);
  const company = profile?.companyName?.value ?? '';
  const [params, setParams] = useSearchParams();
  const processes = useCollection<Process>(workspaceId, COLLECTIONS.processes);
  const suppliers = useCollection<Supplier>(workspaceId, COLLECTIONS.suppliers);
  const processMap = useMemo(() => new Map(processes.items.map((p) => [p.id, p])), [processes.items]);
  const requestedTab = params.get('tab');
  const customers = useCollection<Customer>(workspaceId, COLLECTIONS.customers);
  const master = useMasterData(workspaceId);
  const { md, bomRev } = master;
  const { cal } = useWorkCalendar();

  const [d, setD] = useState<Draft>(() => draftFrom(isNew ? null : item, today));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
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
  const tab: 'products' | 'order' | 'materials' = isNew
    ? 'order'
    : requestedTab === 'materials' || requestedTab === 'order' || requestedTab === 'products'
      ? requestedTab
      : status === 'DRAFT'
        ? 'order'
        : 'products';
  const editable = isNew || isEditable(status);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const setLine = (i: number, patch: Partial<LineDraft>) => set({ lines: d.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const dirty = JSON.stringify(d) !== savedDraft.current;

  // Drafts always follow the current rule and calendar. Other orders keep the stored
  // deadline (and its rule version) unless the dates change or the user recalculates.
  const keepStored = !!item && status !== 'DRAFT' && item.receivedDate === d.receivedDate && item.deliveryDate === d.deliveryDate;
  const computed = computeDeadline(d.receivedDate, d.deliveryDate, cal);
  const deadlineNow: Deadline | null = keepStored ? item!.deadline : computed.ok ? computed : null;
  const deadlineError = !keepStored && !computed.ok ? computed.error : null;
  const deadlineNext = item && status === 'CONFIRMED' ? deadlineUpdate(item, cal) : null;
  const deliveryOff = d.deliveryDate ? dayOff(d.deliveryDate, cal) : null;

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
  function save(next: JoStatus, why: string, opts: { freshSnapshot?: boolean; deadline?: Deadline } = {}): boolean {
    if (!workspaceId) return false;
    if (!d.joNumber.trim()) return setError('JO number is required'), false;
    if (!d.customerId) return setError('Choose a customer'), false;
    const deadline = opts.deadline ?? deadlineNow;
    if (!deadline) return setError(deadlineError ?? 'Check the dates'), false;
    const lines = buildLines();
    if (typeof lines === 'string') return setError(lines), false;
    if (reasonRequired(isNew ? null : status, next) && !why.trim()) return setError('A reason is required for this change'), false;

    // Process steps: kept per line while the product and Make/Buy stay the same; built on confirmation.
    const linesWithSteps: JoLine[] = lines.map((l) => {
      const prev = item?.lines.find((x) => x.id === l.id);
      if (next === 'DRAFT') return l;
      if (prev?.steps && prev.productId === l.productId && prev.supply === l.supply) return { ...l, steps: prev.steps };
      if (next === 'CONFIRMED') return { ...l, steps: buildLineSteps(l, md, processMap) };
      return l;
    });

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
      lines: linesWithSteps,
      notes: d.notes.trim(),
      bomSnapshot,
      confirmedOn,
      stock: item?.stock ?? {},
      progress: item?.progress ?? null,
      progressLog: item?.progressLog ?? [],
      completedOn: completedOnAfter(isNew ? null : status, next, item?.completedOn, today),
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
    if (!isNew && !dirty && !reason.trim()) {
      setError(null);
      setInfo('No changes to save.');
      setTimeout(() => setInfo(null), 2500);
      return;
    }
    save(status, reason);
  }

  function confirmOrder() {
    const lines = buildLines();
    if (typeof lines === 'string') return setError(lines);
    if (!deadlineNow) return setError(deadlineError ?? 'Check the dates');
    const check = checkForConfirm({ lines, deliveryDateType: d.deliveryDateType, deadline: deadlineNow }, md, today);
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
            {item!.completedOn && ` · completed ${formatDay(item!.completedOn)}`}
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
                {bufferText(item!.deadline).replace('buffer ', '')}
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
          {deadlineNext && (
            <div className="card subtle">
              <p className="warn">
                <strong>Deadline can be recalculated:</strong> with the working-day calendar (Sundays and company holidays) the internal deadline would be{' '}
                <strong>{formatDay(deadlineNext.internalDeadline)}</strong> (now {formatDay(item!.deadline.internalDeadline)}).
              </p>
              <p className="small muted">This order keeps its deadline until you choose otherwise. New: {bufferText(deadlineNext)}.</p>
              <button
                type="button"
                className="secondary small"
                onClick={() =>
                  cleanFirst() &&
                  window.confirm(`Change the internal deadline to ${formatDay(deadlineNext.internalDeadline)}?`) &&
                  save(status, 'Internal deadline recalculated with the working-day calendar', { deadline: deadlineNext })
                }
              >
                Recalculate deadline
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

      {!isNew && item && <ProgressCard key={`${item.id}:${item.rev}`} jo={item} md={md} />}
      {!isNew && item && status !== 'CANCELLED' && (
        <div className="card doc-card">
          <DocButtons
            label={status === 'DRAFT' ? 'Proposed plan (PDF, to submit)' : 'Production plan (PDF, to submit)'}
            build={() =>
              productionPlanDoc({
                jo: item,
                md,
                processes: processMap,
                ctx: { md, cal, planningDays: profile?.planningDays },
                today,
                company,
                generatedAt: `${formatDateTime(new Date())} IST`,
                preparedBy: { name: profile?.preparedByName ?? '', designation: profile?.preparedByDesignation ?? '' },
                supplierNames: (k) => suppliersOf(k, suppliers.items).map((s) => s.name),
              })
            }
          />
          {!profile?.preparedByName && <p className="muted small">Add your name and designation in Settings so they appear under “Prepared by”.</p>}
          {dirty && <p className="warn small">Unsaved changes are not in the plan — save first.</p>}
        </div>
      )}
      {!isNew && (
        <div className="tabs" role="tablist">
          {(['products', 'order', 'materials'] as const).map((x) => (
            <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setParams({ tab: x }, { replace: true })}>
              {x === 'products' ? 'Products' : x === 'order' ? 'Order' : 'Materials & stock'}
            </button>
          ))}
        </div>
      )}
      {!isNew && item && tab === 'order' && (
        <div className="card doc-card">
          <DocButtons label="Job Order summary" build={() => joSummaryDoc(item, md, { company, today, cal, generatedAt: `${formatDateTime(new Date())} IST` })} />
        </div>
      )}
      {!isNew && item && tab === 'products' && <ProductsTab jo={item} md={md} processes={processMap} />}
      {!isNew && item && (
        <div hidden={tab !== 'materials'}>
          <MaterialsTab jo={item} md={md} allJos={all.items} counts={counts.items} company={company} />
        </div>
      )}
      <form className="card" onSubmit={submit} noValidate hidden={tab !== 'order'}>
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
          {deliveryOff?.off && <p className="warn small">The delivery date is a day off ({deliveryOff.reason}). It is kept as entered; the internal deadline is always a working day.</p>}
          {deadlineNow && (
            <p className="muted small">
              10% {bufferText(deadlineNow)} → internal deadline{' '}
              <strong>{formatDay(deadlineNow.internalDeadline)}</strong>
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
                <div className="qty-unit">
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
        {info && <p className="muted small">{info}</p>}
      </form>
    </section>
  );
}
