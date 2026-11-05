/**
 * Orders → Import a Job Order (confirmed 5 Nov 2026, mockup canvas "JO import ·
 * Excel and photo"): A · choose a file / photo, B · which column is what,
 * C · check before the draft is made. The result only fills the "New Job Order"
 * form; nothing is saved here except the layouts and "this text means that
 * product", which stay on the phone. Prices are never read.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../../AppContext';
import {
  aliasKey,
  cellName,
  colName,
  extractRows,
  findHeaderRow,
  findLayout,
  findOrderFields,
  guessColumns,
  importNote,
  ITEM_FIELDS,
  matchCustomer,
  matchRow,
  ORDER_FIELDS,
  orderFromCells,
  priceColumns,
  readDate,
  readQty,
  totalsByUnit,
  unitInHeading,
  type CellRef,
  type ColumnMap,
  type ImportLayout,
  type ImportRow,
  type MatchBy,
  type OrderField,
} from '../../lib/joImport';
import { fileKind, readPhoto, readSheetFile, type ReadSheet } from '../../lib/importRead';
import { initialSupply, resolveLine } from '../../lib/jobOrders';
import { COLLECTIONS, productContext, type Customer } from '../../lib/masters';
import { istDateKey } from '../../lib/time';
import { availableUnits, formatQty, unitLabel, UNIT_CHOICES } from '../../lib/units';
import { readJson, writeJson } from '../../lib/storage';
import { logError } from '../../lib/errorLog';
import { useCollection } from '../masters/useCollection';
import { useMasterData } from '../masters/useMasterData';
import { withReturnTo } from '../masters/returnTo';

const LAYOUTS_KEY = 'importLayouts';
const aliasesKey = (ws: string) => `importAliases:${ws}`;
const SESSION_KEY = 'exportflow:importSession';
/** Read by the New Job Order form (`?from=import`). */
export const IMPORT_DRAFT_KEY = 'exportflow:importDraft';

export interface ImportDraft {
  joNumber: string;
  customerId: string;
  poNumber: string;
  receivedDate: string;
  deliveryDate: string;
  notes: string;
  lines: { productId: string; qtyText: string; unit: string; supply: 'MAKE' | 'BUY' | null }[];
}

interface ReviewRow extends ImportRow {
  productId: string;
  by: MatchBy | null;
  candidates: string[];
  qtyEdit: string;
  unitEdit: string;
  remember: boolean;
}

interface Session {
  step: 'map' | 'review';
  fileName: string;
  fromPhoto: boolean;
  sheets: ReadSheet[];
  sheet: number;
  headerRow: number | null;
  columns: ColumnMap;
  unit: string | null;
  orderCells: Partial<Record<OrderField, CellRef>>;
  layoutId: string | null;
  remember: boolean;
  layoutName: string;
  order: { joNumber: string; customerText: string; customerId: string; poNumber: string; receivedDate: string; deliveryDate: string };
  rows: ReviewRow[];
}

function loadSession(): Session | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
function saveSession(s: Session | null) {
  try {
    if (s) globalThis.sessionStorage?.setItem(SESSION_KEY, JSON.stringify(s));
    else globalThis.sessionStorage?.removeItem(SESSION_KEY);
  } catch {
    /* too large or unavailable: the import simply is not kept across pages */
  }
}

/** Guesses for a sheet (or the remembered layout's settings). */
function setupSheet(sheet: ReadSheet, layout: ImportLayout | null): Pick<Session, 'headerRow' | 'columns' | 'unit' | 'orderCells' | 'layoutId'> {
  if (layout) return { headerRow: layout.headerRow, columns: layout.columns, unit: layout.unit, orderCells: layout.orderCells, layoutId: layout.id };
  const headerRow = findHeaderRow(sheet.grid);
  const header = headerRow === null ? [] : (sheet.grid[headerRow] ?? []);
  const columns = guessColumns(header);
  const found = findOrderFields(sheet.grid, headerRow);
  const orderCells = Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.at])) as Partial<Record<OrderField, CellRef>>;
  return { headerRow, columns, unit: columns.unit === null ? unitInHeading(header[columns.qty ?? -1]) : null, orderCells, layoutId: null };
}

export function ImportPage() {
  const { workspaceId } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const today = istDateKey(new Date());
  const master = useMasterData(workspaceId);
  const customers = useCollection<Customer>(workspaceId, COLLECTIONS.customers);
  const [layouts, setLayouts] = useState<ImportLayout[]>(() => readJson<ImportLayout[]>(LAYOUTS_KEY, []));
  const [s, setS] = useState<Session | null>(() => loadSession());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const update = (next: Session | null) => {
    setS(next);
    saveSession(next);
  };

  // Back from "+ New product": put the new product on that row.
  useEffect(() => {
    const added = params.get('added');
    const row = Number(params.get('row'));
    if (!added?.startsWith('PRODUCT:') || !s || !Number.isInteger(row)) return;
    const id = added.slice('PRODUCT:'.length);
    const p = master.md.products.get(id);
    if (!p) return; // wait until the new product has arrived
    update({ ...s, rows: s.rows.map((r, i) => (i === row ? { ...r, productId: id, by: null, unitEdit: r.unitEdit || p.baseUnit } : r)) });
    setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, master.md.products]);

  async function open(file: File, photo: boolean) {
    setError(null);
    setBusy(photo ? 'Reading the photo… (first time: downloading the reading engine)' : 'Reading the file…');
    try {
      const sheets = photo ? await readPhoto(file, (m) => setBusy(`${m.status}${m.progress ? ` ${Math.round(m.progress * 100)}%` : ''}`)) : await readSheetFile(file);
      if (!sheets.length || sheets.every((x) => x.grid.length === 0)) throw new Error(photo ? 'No text could be read from this photo. Try a sharper, straight photo in good light.' : 'The file has no rows.');
      const hit = photo ? null : findLayout(layouts, sheets);
      let sheet = hit?.sheet ?? 0;
      if (!hit) {
        // The sheet that has item rows.
        const withItems = sheets.findIndex((x) => findHeaderRow(x.grid) !== null);
        if (withItems >= 0) sheet = withItems;
      }
      update({
        step: 'map',
        fileName: file.name || (photo ? 'photo' : 'file'),
        fromPhoto: photo,
        sheets,
        sheet,
        ...setupSheet(sheets[sheet]!, hit?.layout ?? null),
        remember: !photo,
        layoutName: hit?.layout.name ?? '',
        order: { joNumber: '', customerText: '', customerId: '', poNumber: '', receivedDate: '', deliveryDate: '' },
        rows: [],
      });
    } catch (e) {
      logError(e, 'Import: read file');
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const products = useMemo(() => master.products.items.filter((p) => p.active !== false), [master.products.items]);

  function toReview(cur: Session) {
    const grid = cur.sheets[cur.sheet]!.grid;
    const aliases = workspaceId ? readJson<Record<string, string>>(aliasesKey(workspaceId), {}) : {};
    const raw = extractRows(grid, cur.headerRow, cur.columns, cur.unit, cur.fromPhoto);
    if (raw.length === 0) return setError('No item rows found with these columns. Check "Product name" and "Quantity".');
    const vals = orderFromCells(grid, cur.orderCells);
    const items = products.map((p) => ({ id: p.id, name: p.name, code: p.code, erpCode: p.erpCode, family: p.family }));
    const rows: ReviewRow[] = raw.map((r) => {
      const m = matchRow(r, items, aliases);
      const p = m.productId ? master.md.products.get(m.productId) : undefined;
      return { ...r, productId: m.productId ?? '', by: m.by, candidates: m.candidates, qtyEdit: r.qty !== null ? String(r.qty) : r.qtyText, unitEdit: r.unit ?? p?.baseUnit ?? '', remember: true };
    });
    const customerText = vals.customer?.value ?? '';
    if (cur.remember && !cur.fromPhoto) {
      const header = (grid[cur.headerRow ?? -1] ?? []).map((h) => h.trim().toLowerCase().replace(/\s+/g, ' '));
      const existing = layouts.find((l) => l.id === cur.layoutId);
      const l: ImportLayout = {
        id: existing?.id ?? `l${Date.now().toString(36)}`,
        name: cur.layoutName.trim() || existing?.name || cur.sheets[cur.sheet]!.name,
        sheet: cur.sheets[cur.sheet]!.name,
        headerRow: cur.headerRow ?? 0,
        headers: header,
        columns: cur.columns,
        unit: cur.unit,
        orderCells: cur.orderCells,
        uses: (existing?.uses ?? 0) + 1,
        lastUsed: today,
      };
      const next = [l, ...layouts.filter((x) => x.id !== l.id)].slice(0, 20);
      setLayouts(next);
      writeJson(LAYOUTS_KEY, next);
    }
    setError(null);
    update({
      ...cur,
      step: 'review',
      rows,
      order: {
        joNumber: vals.joNumber?.value ?? '',
        customerText,
        customerId: matchCustomer(customerText, customers.items.filter((c) => c.active !== false)) ?? '',
        poNumber: vals.poNumber?.value ?? '',
        receivedDate: readDate(vals.receivedDate?.value ?? '') ?? '',
        deliveryDate: readDate(vals.deliveryDate?.value ?? '') ?? '',
      },
    });
  }

  function createDraft(cur: Session) {
    const bad = cur.rows.findIndex((r) => !r.productId || !(readQty(r.qtyEdit).qty! > 0) || !r.unitEdit);
    if (bad >= 0) return setError(`Row ${bad + 1}: choose the product, a quantity and a unit.`);
    if (workspaceId) {
      const aliases = readJson<Record<string, string>>(aliasesKey(workspaceId), {});
      for (const r of cur.rows) if (r.remember && r.by !== 'remembered' && r.by !== 'code' && r.by !== 'name') aliases[aliasKey(r)] = r.productId;
      const keys = Object.keys(aliases);
      writeJson(aliasesKey(workspaceId), keys.length > 500 ? Object.fromEntries(keys.slice(-500).map((k) => [k, aliases[k]])) : aliases);
    }
    const draft: ImportDraft = {
      joNumber: cur.order.joNumber.trim(),
      customerId: cur.order.customerId,
      poNumber: cur.order.poNumber.trim(),
      receivedDate: cur.order.receivedDate,
      deliveryDate: cur.order.deliveryDate,
      notes: importNote(cur.fileName, today, cur.rows.map((r) => ({ name: master.md.products.get(r.productId)?.name ?? r.name, pack: r.pack }))),
      lines: cur.rows.map((r) => {
        const p = master.md.products.get(r.productId);
        return { productId: r.productId, qtyText: String(readQty(r.qtyEdit).qty), unit: r.unitEdit, supply: p ? initialSupply(p) : null };
      }),
    };
    try {
      globalThis.sessionStorage?.setItem(IMPORT_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      return setError('The phone could not hold the draft. Close other tabs and try again.');
    }
    update(null);
    navigate('/orders/new?from=import');
  }

  return (
    <section>
      <div className="row between">
        <h2>Import a Job Order</h2>
        <Link to="/orders" className="muted small">
          Back to orders
        </Link>
      </div>
      {busy && <p className="muted">{busy}</p>}
      {error && <p className="error small">{error}</p>}
      {!s && !busy && <StartStep layouts={layouts} onOpen={(f, photo) => void open(f, photo)} onForget={(id) => {
        const next = layouts.filter((l) => l.id !== id);
        setLayouts(next);
        writeJson(LAYOUTS_KEY, next);
      }} />}
      {s?.step === 'map' && <MapStep s={s} layouts={layouts} onChange={update} onNext={() => toReview(s)} onCancel={() => update(null)} />}
      {s?.step === 'review' && (
        <ReviewStep
          s={s}
          customers={customers.items.filter((c) => c.active !== false)}
          products={products}
          md={master.md}
          onChange={update}
          onBack={() => update({ ...s, step: 'map' })}
          onCreate={() => createDraft(s)}
          newProductLink={(i, name) => `${withReturnTo('/masters/products/new', `/orders/import?row=${i}`)}&name=${encodeURIComponent(name)}`}
        />
      )}
    </section>
  );
}

function StartStep({ layouts, onOpen, onForget }: { layouts: ImportLayout[]; onOpen: (f: File, photo: boolean) => void; onForget: (id: string) => void }) {
  const pick = (photo: boolean) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) onOpen(f, photo || fileKind(f) === 'photo');
  };
  return (
    <>
      <div className="card import-card">
        <strong>From an Excel or CSV file</strong>
        <p className="muted small">Any layout. The app guesses which column is what; you correct it once and it remembers that layout.</p>
        <label className="button primary file-button">
          Choose Excel / CSV file
          <input type="file" accept=".xlsx,.xlsm,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={pick(false)} hidden />
        </label>
      </div>
      <div className="card import-card dashed">
        <div className="row between">
          <strong>From a photo</strong>
          <span className="pill warn">extra · check every row</span>
        </div>
        <p className="muted small">The phone reads the printed text itself (the photo is not sent anywhere). Tables in photos are often read wrongly — every row is shown for you to correct.</p>
        <div className="row gap">
          <label className="button secondary file-button">
            Take photo
            <input type="file" accept="image/*" capture="environment" onChange={pick(true)} hidden />
          </label>
          <label className="button secondary file-button">
            Choose photo
            <input type="file" accept="image/*" onChange={pick(true)} hidden />
          </label>
        </div>
        <p className="muted small">First use downloads the reading engine once (about 10 MB, Wi-Fi recommended).</p>
      </div>
      {layouts.length > 0 && (
        <div className="card">
          <strong>Remembered layouts</strong>
          {layouts.map((l) => (
            <div key={l.id} className="row between small">
              <span>{l.name}</span>
              <span className="muted">
                used {l.uses === 1 ? 'once' : `${l.uses} times`} ·{' '}
                <button type="button" className="linkish small" onClick={() => window.confirm(`Forget the layout “${l.name}”?`) && onForget(l.id)}>
                  forget
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="muted small">Always makes a DRAFT order; nothing is confirmed until you check it. The file stays on the phone; prices in it are never read.</p>
    </>
  );
}

function MapStep({ s, layouts, onChange, onNext, onCancel }: { s: Session; layouts: ImportLayout[]; onChange: (s: Session) => void; onNext: () => void; onCancel: () => void }) {
  const grid = s.sheets[s.sheet]!.grid;
  const header = s.headerRow === null ? [] : (grid[s.headerRow] ?? []);
  const width = Math.max(header.length, ...grid.slice(0, 50).map((r) => r.length));
  const prices = new Set(priceColumns(header));
  const vals = orderFromCells(grid, s.orderCells);
  const preview = extractRows(grid, s.headerRow, s.columns, s.unit, s.fromPhoto).slice(0, 5);
  const layout = layouts.find((l) => l.id === s.layoutId);
  const colLabel = (c: number) => `${colName(c)} · ${header[c] ? `“${header[c]}”` : '(no heading)'}`;
  return (
    <>
      <div className="card">
        <p className="muted small">
          {s.fileName}
          {layout && <> · layout “{layout.name}” used</>}
        </p>
        {s.sheets.length > 1 && (
          <label>
            Sheet
            <select value={s.sheet} onChange={(e) => {
              const i = Number(e.target.value);
              onChange({ ...s, sheet: i, ...setupSheet(s.sheets[i]!, null) });
            }}>
              {s.sheets.map((x, i) => (
                <option key={x.name + i} value={i}>
                  {x.name}
                  {findHeaderRow(x.grid) !== null ? ' (has item rows)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Heading row
          <select value={s.headerRow ?? ''} onChange={(e) => {
            const r = e.target.value === '' ? null : Number(e.target.value);
            const h = r === null ? [] : (grid[r] ?? []);
            const columns = guessColumns(h);
            onChange({ ...s, headerRow: r, columns, unit: columns.unit === null ? unitInHeading(h[columns.qty ?? -1]) ?? s.unit : null });
          }}>
            <option value="">No heading row</option>
            {grid.slice(0, 40).map((r, i) => (
              <option key={i} value={i}>
                Row {i + 1}: {r.filter(Boolean).slice(0, 4).join(' · ').slice(0, 60) || '(empty)'}
              </option>
            ))}
          </select>
        </label>
        {s.fromPhoto && <p className="warn small">Read from a photo: columns are split where there are wide gaps. Check every row on the next screen.</p>}
      </div>

      <div className="card">
        <strong>Order details</strong>
        <dl className="kv small">
          {ORDER_FIELDS.map((f) => (
            <div key={f.id}>
              <dt className="muted">{f.label}</dt>
              <dd>{vals[f.id] ? <><strong>{vals[f.id]!.value}</strong> <span className="ok">· {cellName(vals[f.id]!.at)}</span></> : <span className="warn">not found · type it on the next screen</span>}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="card">
        <strong>Item columns</strong>
        <p className="muted small">Guessed from the headings; change any that are wrong.</p>
        <div className="grid2">
          {ITEM_FIELDS.map((f) => (
            <label key={f.id}>
              {f.label}
              {(f.id === 'name' || f.id === 'qty') && <span className="req"> *</span>}
              <select value={s.columns[f.id] ?? ''} onChange={(e) => onChange({ ...s, columns: { ...s.columns, [f.id]: e.target.value === '' ? null : Number(e.target.value) } })}>
                <option value="">— none —</option>
                {Array.from({ length: width }, (_, c) => c)
                  .filter((c) => !prices.has(c))
                  .map((c) => (
                    <option key={c} value={c}>
                      {colLabel(c)}
                    </option>
                  ))}
              </select>
            </label>
          ))}
          {s.columns.unit === null && (
            <label>
              Unit for every row
              <select value={s.unit ?? ''} onChange={(e) => onChange({ ...s, unit: e.target.value || null })}>
                <option value="">— choose per row —</option>
                {UNIT_CHOICES.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {prices.size > 0 && <p className="muted small">Price columns ({[...prices].map((c) => colName(c)).join(', ')}): ignored, never read.</p>}
      </div>

      <div className="card">
        <strong>First rows as read</strong>
        {preview.length === 0 ? (
          <p className="warn small">No item rows with these columns yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="small">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Code</th>
                  <th>Item</th>
                  <th>Size</th>
                  <th className="num">Qty</th>
                  <th>Pack</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{r.code}</td>
                    <td>{r.name}</td>
                    <td>{r.size}</td>
                    <td className="num">
                      {r.qtyText}
                      {r.unit ? ` ${unitLabel(r.unit)}` : ''}
                    </td>
                    <td>{r.pack}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        {!s.fromPhoto && (
          <>
            <label className="inline">
              <input type="checkbox" checked={s.remember} onChange={(e) => onChange({ ...s, remember: e.target.checked })} /> Remember this layout
            </label>
            {s.remember && (
              <label>
                Name
                <input value={s.layoutName} maxLength={60} placeholder="e.g. Boss's WO sheet" onChange={(e) => onChange({ ...s, layoutName: e.target.value })} />
              </label>
            )}
          </>
        )}
        <div className="row gap wrap">
          <button type="button" className="primary" disabled={s.columns.name === null || s.columns.qty === null} onClick={onNext}>
            Next: check the items
          </button>
          <button type="button" className="secondary" onClick={() => window.confirm('Stop this import?') && onCancel()}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}

function ReviewStep({
  s,
  customers,
  products,
  md,
  onChange,
  onBack,
  onCreate,
  newProductLink,
}: {
  s: Session;
  customers: { id: string; name: string }[];
  products: { id: string; name: string; baseUnit: string }[];
  md: ReturnType<typeof useMasterData>['md'];
  onChange: (s: Session) => void;
  onBack: () => void;
  onCreate: () => void;
  newProductLink: (i: number, name: string) => string;
}) {
  const setRow = (i: number, patch: Partial<ReviewRow>) => onChange({ ...s, rows: s.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const setOrder = (patch: Partial<Session['order']>) => onChange({ ...s, order: { ...s.order, ...patch } });
  const notFound = s.rows.filter((r) => !r.productId).length;
  const unclear = s.rows.filter((r) => r.unclear).length;
  const qtys = s.rows.map((r) => ({ qty: readQty(r.qtyEdit).qty, unit: r.unitEdit || null }));
  const bad = s.rows.some((r, i) => !r.productId || !(qtys[i]!.qty! > 0) || !r.unitEdit);
  const sorted = useMemo(() => [...products].sort((a, b) => a.name.localeCompare(b.name)), [products]);
  const nameOf = (id: string) => products.find((p) => p.id === id)?.name ?? md.products.get(id)?.name ?? id;
  const checks = [notFound && `${notFound} product${notFound === 1 ? '' : 's'} not found in Masters`, unclear && `${unclear} quantit${unclear === 1 ? 'y' : 'ies'} unclear`, s.fromPhoto && 'read from a photo: check every row'].filter(Boolean);

  return (
    <>
      {checks.length > 0 && (
        <div className="card notice warn">
          <strong>{checks.length} thing{checks.length === 1 ? '' : 's'} to check</strong>
          <p className="small">{checks.join(' · ')}</p>
        </div>
      )}
      <div className="card">
        <div className="grid2">
          <label>
            JO number
            <input value={s.order.joNumber} maxLength={60} onChange={(e) => setOrder({ joNumber: e.target.value })} />
          </label>
          <label>
            Customer
            <select value={s.order.customerId} onChange={(e) => setOrder({ customerId: e.target.value })}>
              <option value="">{s.order.customerText ? `— “${s.order.customerText}”: choose —` : '— choose —'}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Received
            <input type="date" value={s.order.receivedDate} onChange={(e) => setOrder({ receivedDate: e.target.value })} />
          </label>
          <label>
            Delivery
            <input type="date" value={s.order.deliveryDate} onChange={(e) => setOrder({ deliveryDate: e.target.value })} />
          </label>
          <label>
            Buyer PO
            <input value={s.order.poNumber} maxLength={60} onChange={(e) => setOrder({ poNumber: e.target.value })} />
          </label>
        </div>
        {!s.order.customerId && <p className="muted small">No match? Add the customer in Masters → Customers, or choose it later in the order form.</p>}
      </div>

      <div className="card">
        {s.rows.map((r, i) => {
          const p = r.productId ? md.products.get(r.productId) : undefined;
          const q = qtys[i]!.qty;
          const resolved = p && q !== null && q > 0 && r.unitEdit ? resolveLine({ productId: r.productId, qty: q, unit: r.unitEdit }, md) : null;
          const units = p ? availableUnits(productContext(p)) : UNIT_CHOICES.map((u) => u.id);
          const label = [r.code, r.name, r.size].filter(Boolean).join(' · ');
          return (
            <div key={r.row} className="import-row">
              <div className="row between">
                <strong>
                  {i + 1} · {p ? p.name : `“${label}”`}
                </strong>
                {!r.productId ? <span className="pill bad">not found</span> : r.unclear ? <span className="pill warn">check qty</span> : <span className="pill ok">matched</span>}
              </div>
              {p && <span className="muted small block">Row {r.row}: {label}{r.by ? ` · matched by ${r.by === 'remembered' ? 'remembered text' : r.by === 'code' ? 'item code' : 'name'}` : ''}</span>}
              <label>
                {r.productId ? 'Product' : 'Match to a product'}
                <select value={r.productId} onChange={(e) => {
                  const np = md.products.get(e.target.value);
                  setRow(i, { productId: e.target.value, by: null, unitEdit: r.unitEdit && np && availableUnits(productContext(np)).includes(r.unitEdit) ? r.unitEdit : (np?.baseUnit ?? r.unitEdit) });
                }}>
                  <option value="">— choose · closest first —</option>
                  {r.candidates.length > 0 && (
                    <optgroup label="Closest">
                      {r.candidates.filter((id) => products.some((x) => x.id === id)).map((id) => (
                        <option key={`c-${id}`} value={id}>
                          {nameOf(id)}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="All products">
                    {sorted.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>
              {!r.productId && (
                <Link className="button secondary small" to={newProductLink(i, [r.name, r.size].filter(Boolean).join(' '))}>
                  + New product with this name
                </Link>
              )}
              <div className="qty-unit">
                <label>
                  Quantity{r.unclear && r.qtyText ? ` (read “${r.qtyText}”)` : ''}
                  <input inputMode="decimal" className={r.unclear ? 'warn-input' : ''} value={r.qtyEdit} onChange={(e) => setRow(i, { qtyEdit: e.target.value, unclear: false })} />
                </label>
                <label>
                  Unit
                  <select value={r.unitEdit} onChange={(e) => setRow(i, { unitEdit: e.target.value })}>
                    <option value="">— choose —</option>
                    {units.map((u) => (
                      <option key={u} value={u}>
                        {unitLabel(u)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {resolved?.problem && <p className="warn small">{resolved.problem}</p>}
              {resolved && resolved.baseQty !== null && r.unitEdit !== resolved.baseUnit && (
                <p className="muted small">
                  = {formatQty(resolved.baseQty)} {unitLabel(resolved.baseUnit!)}
                </p>
              )}
              {p && <p className="muted small">{p.supplyType === 'MANUFACTURED' ? 'Make' : p.supplyType === 'TRADED' ? 'Buy' : 'Make or buy: decide in the order form'}{r.pack ? ` · pack ${r.pack}` : ''}</p>}
              {r.productId && r.by !== 'remembered' && r.by !== 'code' && r.by !== 'name' && (
                <label className="inline small">
                  <input type="checkbox" checked={r.remember} onChange={(e) => setRow(i, { remember: e.target.checked })} /> Remember: this text means that product
                </label>
              )}
            </div>
          );
        })}
      </div>

      <div className="card">
        <strong>Totals as read</strong>
        <p className="mono small">
          {s.rows.length} item{s.rows.length === 1 ? '' : 's'} ·{' '}
          {totalsByUnit(qtys)
            .map((t) => `${formatQty(t.qty)} ${unitLabel(t.unit)}`)
            .join(' + ') || '—'}
        </p>
        <p className="muted small">Compare with the total on the sheet before you go on.</p>
      </div>

      <div className="row gap wrap">
        <button type="button" className="primary" disabled={bad} onClick={onCreate}>
          Create draft JO
        </button>
        <button type="button" className="secondary" onClick={onBack}>
          Back to columns
        </button>
      </div>
      {bad && <p className="muted small">“Create draft JO” works once every row has a product, a quantity and a unit. The draft opens for you to check and save as usual.</p>}
    </>
  );
}
