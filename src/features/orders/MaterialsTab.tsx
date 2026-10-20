import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../AppContext';
import { COLLECTION_JOB_ORDERS, formatDay, isEditable, type JobOrder, type StockEntry } from '../../lib/jobOrders';
import { COLLECTIONS, componentContext, suppliersOf, type ComponentType, type MasterData, type Supplier } from '../../lib/masters';
import {
  allocationFor,
  COLLECTION_STOCK_COUNTS,
  makeStockEntry,
  planMaterials,
  stockCountId,
  type PlanRow,
  type StockCount,
} from '../../lib/materials';
import { formatDateTime, istDateKey } from '../../lib/time';
import { availableUnits, formatQty, unitLabel } from '../../lib/units';
import { parseNum, UnitSelect } from '../masters/fields';
import type { WithMeta } from '../masters/useCollection';
import { saveRecord } from '../sync/records';
import { useCollection } from '../masters/useCollection';
import { DocButtons } from '../docs/DocButtons';
import { planDoc } from '../../lib/docs/model';

interface EntryDraft {
  qtyText: string;
  unit: string;
  location: string;
  remarks: string;
}

/** The business fields of a Job Order record (without sync metadata). */
export function jobOrderData(jo: JobOrder): JobOrder {
  return {
    joNumber: jo.joNumber,
    customerId: jo.customerId,
    customerName: jo.customerName,
    poNumber: jo.poNumber,
    receivedDate: jo.receivedDate,
    deliveryDate: jo.deliveryDate,
    deliveryDateType: jo.deliveryDateType,
    deadline: jo.deadline,
    status: jo.status,
    lines: jo.lines,
    notes: jo.notes,
    bomSnapshot: jo.bomSnapshot,
    confirmedOn: jo.confirmedOn,
    stock: jo.stock ?? {},
    progress: jo.progress ?? null,
    progressLog: jo.progressLog ?? [],
    completedOn: jo.completedOn ?? null,
  };
}

function draftsFrom(stock: Record<string, StockEntry> | undefined): Record<string, EntryDraft> {
  const out: Record<string, EntryDraft> = {};
  for (const [k, e] of Object.entries(stock ?? {})) out[k] = { qtyText: String(e.qty), unit: e.unit, location: e.location, remarks: e.remarks };
  return out;
}

export function MaterialsTab(props: {
  jo: WithMeta<JobOrder>;
  md: MasterData;
  allJos: WithMeta<JobOrder>[];
  counts: WithMeta<StockCount>[];
  company: string;
}) {
  const { jo, md, allJos, counts, company } = props;
  const { workspaceId, t } = useApp();
  const suppliers = useCollection<Supplier>(workspaceId, COLLECTIONS.suppliers);
  const editable = isEditable(jo.status);
  const [drafts, setDrafts] = useState<Record<string, EntryDraft>>(() => draftsFrom(jo.stock));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [countFor, setCountFor] = useState<string | null>(null);
  const loaded = useRef(`${jo.id}:${jo.rev}`);
  const savedDrafts = useRef(JSON.stringify(draftsFrom(jo.stock)));

  useEffect(() => {
    const key = `${jo.id}:${jo.rev}`;
    if (loaded.current === key) return;
    loaded.current = key;
    const next = draftsFrom(jo.stock);
    setDrafts(next);
    savedDrafts.current = JSON.stringify(next);
  }, [jo]);

  const now = new Date().toISOString();
  // Live preview: the plan follows what is typed, before saving.
  const preview = useMemo(() => {
    const stock: Record<string, StockEntry> = {};
    const problems: Record<string, string> = {};
    for (const [key, d] of Object.entries(drafts)) {
      const q = parseNum(d.qtyText);
      if (q === null) continue;
      const [type, id] = [key.slice(0, key.indexOf(':')) as ComponentType, key.slice(key.indexOf(':') + 1)];
      const e = makeStockEntry({ qty: q, unit: d.unit, location: d.location, remarks: d.remarks }, type, id, md, jo.stock?.[key], now);
      if (typeof e === 'string') problems[key] = e;
      else stock[key] = e;
    }
    return { stock, problems };
  }, [drafts, md, jo.stock, now]);

  const plan = useMemo(() => planMaterials({ ...jo, stock: preview.stock }, md), [jo, preview.stock, md]);
  const othersAndThis = useMemo(() => allJos.map((j) => (j.id === jo.id ? { ...j, stock: preview.stock } : j)), [allJos, jo.id, preview.stock]);
  const countMap = useMemo(() => new Map(counts.map((c) => [stockCountId(c.itemType, c.itemId), c])), [counts]);
  const dirty = JSON.stringify(drafts) !== savedDrafts.current;

  function setDraft(key: string, unit: string, patch: Partial<EntryDraft>) {
    setDrafts((ds) => ({ ...ds, [key]: { ...(ds[key] ?? { qtyText: '', unit, location: '', remarks: '' }), ...patch } }));
  }

  function save() {
    if (!workspaceId) return;
    const bad = Object.entries(preview.problems)[0];
    if (bad) return setError(`${nameOf(bad[0], md)}: ${bad[1]}`);
    setError(null);
    saveRecord({
      workspaceId,
      collectionName: COLLECTION_JOB_ORDERS,
      docId: jo.id,
      entity: `Job Order: ${jo.joNumber}`,
      before: jo,
      data: JSON.parse(JSON.stringify({ ...jobOrderData(jo), stock: preview.stock })) as Record<string, unknown>,
      reason,
    });
    savedDrafts.current = JSON.stringify(drafts);
    setReason('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  const rowView = (r: PlanRow, verb: string) => {
    const comp = componentContext(r.type, r.id, md);
    const units = comp ? availableUnits(comp.ctx) : [r.unit];
    const d = drafts[r.key] ?? { qtyText: '', unit: r.unit, location: '', remarks: '' };
    const prev = jo.stock?.[r.key];
    const alloc = allocationFor(r.key, othersAndThis, countMap.get(stockCountId(r.type, r.id)));
    return (
      <fieldset key={r.key} className="tracked mat-row">
        <legend>
          {r.name}
          {r.provisional && <span className="pill warn inline-pill">provisional</span>}
        </legend>
        <div className="mat-figures">
          <span>
            <span className="kicker">Needed</span>
            {formatQty(r.gross)} {unitLabel(r.unit)}
          </span>
          <span>
            <span className="kicker">{verb}</span>
            <strong className={r.net > 0 ? '' : 'ok'}>
              {formatQty(r.net)} {unitLabel(r.unit)}
            </strong>
          </span>
        </div>
        <div className="qty-unit">
          <label>
            From stock for this order
            <input inputMode="decimal" placeholder="0" value={d.qtyText} disabled={!editable} onChange={(e) => setDraft(r.key, r.unit, { qtyText: e.target.value })} />
          </label>
          <UnitSelect label="Unit" value={d.unit} onChange={(unit) => setDraft(r.key, r.unit, { unit })} units={units.length ? units : [r.unit]} />
        </div>
        {preview.problems[r.key] && <p className="warn small">{preview.problems[r.key]}</p>}
        <details>
          <summary className="small">Location / remarks</summary>
          <div className="grid2">
            <label>
              Location / source
              <input value={d.location} maxLength={80} disabled={!editable} onChange={(e) => setDraft(r.key, r.unit, { location: e.target.value })} />
            </label>
            <label>
              Remarks
              <input value={d.remarks} maxLength={200} disabled={!editable} onChange={(e) => setDraft(r.key, r.unit, { remarks: e.target.value })} />
            </label>
          </div>
        </details>
        {prev && (
          <p className="muted small">
            Last changed {formatDateTime(new Date(prev.changedAt))}
            {prev.prevBaseQty !== null && ` (was ${formatQty(prev.prevBaseQty)} ${unitLabel(r.unit)})`}
          </p>
        )}
        <AllocationLine alloc={alloc} unit={r.unit} onCount={() => setCountFor(countFor === r.key ? null : r.key)} />
        {countFor === r.key && (
          <CountEditor
            type={r.type}
            id={r.id}
            name={r.name}
            unit={r.unit}
            existing={countMap.get(stockCountId(r.type, r.id))}
            onDone={() => setCountFor(null)}
          />
        )}
      </fieldset>
    );
  };

  return (
    <section>
      <p className="muted small">
        Enter the stock you have checked and set aside for this order. Balances are made or bought.
        {jo.status !== 'DRAFT' && jo.bomSnapshot ? ' BOMs: the copy saved at confirmation.' : ' BOMs: current versions (a copy is saved when the order is confirmed).'}
      </p>
      {plan.errors.length > 0 && (
        <div className="card subtle">
          <p className="warn">
            <strong>Insufficient data</strong>
          </p>
          <ul className="small plain-list">
            {plan.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {plan.notes.length > 0 && (
        <ul className="small muted plain-list">
          {plan.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <div className="card doc-card">
        {dirty && <p className="warn small">PDFs show saved stock only — save your changes first.</p>}
        <DocButtons label="To produce" build={() => planDoc('TO_PRODUCE', jo, planMaterials(jo, md), { company, generatedAt: `${formatDateTime(new Date())} IST` })} />
        <DocButtons label="To buy (this order)" build={() => planDoc('TO_BUY', jo, planMaterials(jo, md), { company, generatedAt: `${formatDateTime(new Date())} IST`, supplierNames: (k) => suppliersOf(k, suppliers.items).map((s) => s.name) })} />
      </div>

      <h3 className="section-title">To produce</h3>
      {plan.toProduce.length === 0 ? <p className="muted small">Nothing to make in this order.</p> : plan.toProduce.map((r) => rowView(r, 'To produce'))}

      <h3 className="section-title">To buy</h3>
      {plan.toBuy.length === 0 ? <p className="muted small">Nothing to buy yet.</p> : plan.toBuy.map((r) => rowView(r, 'To buy'))}

      {editable && (plan.toProduce.length > 0 || plan.toBuy.length > 0) && (
        <div className="card">
          <label>
            {t('reasonOptional')}
            <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row between">
            <span className="muted small">{dirty ? 'Unsaved stock changes' : `${t('rev')} ${jo.rev}`}</span>
            <button type="button" className="primary" disabled={!dirty} onClick={save}>
              Save stock
            </button>
          </div>
          {saved && <p className="ok small">{t('saved')}</p>}
        </div>
      )}
    </section>
  );
}

function nameOf(key: string, md: MasterData): string {
  const id = key.slice(key.indexOf(':') + 1);
  return md.products.get(id)?.name ?? md.rawMaterials.get(id)?.name ?? key;
}

function AllocationLine({ alloc, unit, onCount }: { alloc: ReturnType<typeof allocationFor>; unit: string; onCount: () => void }) {
  const u = unitLabel(unit);
  return (
    <div className="alloc small">
      {alloc.state === 'MANUAL_ONLY' && <span className="muted">No stock count · check is manual only</span>}
      {alloc.state === 'OK' && (
        <span className="muted">
          Counted {formatQty(alloc.counted!)} {u} on {formatDay(alloc.countedOn)} · {formatQty(alloc.confirmed)} {u} set aside on confirmed orders
        </span>
      )}
      {alloc.state === 'OVER' && (
        <span className="error">
          Over-allocated: {formatQty(alloc.confirmed)} {u} set aside on confirmed orders, {formatQty(alloc.counted!)} {u} counted on {formatDay(alloc.countedOn)}
        </span>
      )}
      {alloc.draft > 0 && (
        <span className="muted block">
          + {formatQty(alloc.draft)} {u} planned on draft orders
        </span>
      )}
      <button type="button" className="linkish" onClick={onCount}>
        {alloc.state === 'MANUAL_ONLY' ? 'Add stock count' : 'Update count'}
      </button>
    </div>
  );
}

function CountEditor(props: { type: ComponentType; id: string; name: string; unit: string; existing: WithMeta<StockCount> | undefined; onDone: () => void }) {
  const { workspaceId } = useApp();
  const [qtyText, setQty] = useState(props.existing ? String(props.existing.qty) : '');
  const [date, setDate] = useState(istDateKey(new Date()));
  const [err, setErr] = useState<string | null>(null);

  function save() {
    if (!workspaceId) return;
    const q = parseNum(qtyText);
    if (q === null || !Number.isFinite(q) || q < 0) return setErr('Enter the counted quantity (0 or more)');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setErr('Enter the date of the count');
    const docId = stockCountId(props.type, props.id);
    const data: StockCount = { itemType: props.type, itemId: props.id, qty: q, unit: props.unit, countedOn: date, notes: '' };
    saveRecord({ workspaceId, collectionName: COLLECTION_STOCK_COUNTS, docId, entity: `Stock count: ${props.name}`, before: props.existing ?? null, data: { ...data } });
    props.onDone();
  }

  return (
    <div className="card subtle count-editor">
      <p className="small">
        <strong>Physical stock of {props.name}</strong> (all orders together)
      </p>
      <div className="grid2">
        <label>
          Counted ({unitLabel(props.unit)})
          <input inputMode="decimal" value={qtyText} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label>
          Counted on
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      {err && <p className="error small">{err}</p>}
      <div className="row gap">
        <button type="button" className="primary small" onClick={save}>
          Save count
        </button>
        <button type="button" className="secondary small" onClick={props.onDone}>
          Close
        </button>
      </div>
    </div>
  );
}
