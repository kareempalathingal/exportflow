import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { withReturnTo } from './returnTo';
import { useApp } from '../../AppContext';
import { availableUnits, formatQty, unitLabel } from '../../lib/units';
import {
  COLLECTIONS,
  componentContext,
  createsCycle,
  explodeBom,
  lineComponent,
  needsBom,
  productContext,
  type BomLine,
  type ComponentType,
  type ExplodedLine,
  type MasterData,
  type Product,
} from '../../lib/masters';
import type { DataStatus } from '../../lib/dataStatus';
import { saveRecord } from '../sync/records';
import { parseNum, StatusSelect, UnitSelect } from './fields';
import type { WithMeta } from './useCollection';
import { useMasterData } from './useMasterData';

interface LineDraft {
  key: string; // "RAW_MATERIAL:<id>" | "PRODUCT:<id>" | ""
  qtyText: string;
  unit: string;
  wastageText: string;
  status: DataStatus;
  source: string;
}

function toDraft(l: BomLine): LineDraft {
  const c = lineComponent(l);
  return {
    key: c.id ? `${c.type}:${c.id}` : '',
    qtyText: String(l.qty),
    unit: l.unit,
    wastageText: l.wastagePct ? String(l.wastagePct) : '',
    status: l.status,
    source: l.source ?? '',
  };
}

function splitKey(key: string): { type: ComponentType; id: string } | null {
  const i = key.indexOf(':');
  if (i < 0) return null;
  return { type: key.slice(0, i) as ComponentType, id: key.slice(i + 1) };
}

const SUPPLY_SHORT = { MANUFACTURED: 'made', TRADED: 'bought', BOTH: 'made/bought' } as const;

export function BomEditor({ product }: { product: WithMeta<Product> }) {
  const { workspaceId, t } = useApp();
  const { md, loading, boms, rawMaterials, products } = useMasterData(workspaceId);
  const bom = boms.items.find((b) => b.id === product.id) ?? null;
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const loaded = useRef<string | null>(null);
  const savedDraft = useRef<string>('[]');

  useEffect(() => {
    if (loading) return;
    const key = `${product.id}:${bom?.rev ?? 0}`;
    if (loaded.current === key) return;
    loaded.current = key;
    const initial = (bom?.lines ?? []).map(toDraft);
    savedDraft.current = JSON.stringify(initial);
    setLines(initial);
    setNotes(bom?.notes ?? '');
  }, [bom, loading, product.id]);

  const set = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const activeRms = rawMaterials.items.filter((r) => r.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const otherProducts = products.items
    .filter((p) => p.id !== product.id && p.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name));

  function unitsFor(key: string): string[] {
    const c = splitKey(key);
    const comp = c ? componentContext(c.type, c.id, md) : null;
    return comp ? availableUnits(comp.ctx) : [];
  }

  function parse(): BomLine[] | string {
    const out: BomLine[] = [];
    const seen = new Set<string>();
    for (const [i, l] of lines.entries()) {
      const n = i + 1;
      const c = splitKey(l.key);
      const comp = c ? componentContext(c.type, c.id, md) : null;
      if (!c || !comp) return `Line ${n}: choose a raw material or product`;
      if (seen.has(l.key)) return `${comp.name} is listed twice`;
      seen.add(l.key);
      if (c.type === 'PRODUCT' && createsCycle(product.id, c.id, md)) {
        return `Line ${n}: ${comp.name} already uses ${product.name} — this would create a loop`;
      }
      const qty = parseNum(l.qtyText);
      if (qty === null || !Number.isFinite(qty) || qty <= 0) return `Line ${n}: quantity must be a positive number`;
      const w = parseNum(l.wastageText) ?? 0;
      if (!Number.isFinite(w) || w < 0 || w >= 100) return `Line ${n}: wastage must be between 0 and 99 %`;
      if (!availableUnits(comp.ctx).includes(l.unit)) {
        return `Line ${n}: ${unitLabel(l.unit)} cannot be converted to ${unitLabel(comp.ctx.baseUnit)} for ${comp.name}`;
      }
      out.push({ componentType: c.type, componentId: c.id, qty, unit: l.unit, wastagePct: w, status: l.status, source: l.source.trim() });
    }
    return out;
  }

  function save() {
    if (!workspaceId) return;
    const parsed = parse();
    if (typeof parsed === 'string') return setError(parsed);
    setError(null);
    saveRecord({
      workspaceId,
      collectionName: COLLECTIONS.boms,
      docId: product.id,
      entity: `BOM: ${product.name}`,
      before: bom,
      data: { productId: product.id, lines: parsed, notes: notes.trim() },
      reason,
    });
    setReason('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  const here = `/masters/products/${product.id}?tab=bom`;
  const dirty = JSON.stringify(lines) !== savedDraft.current;
  // Leaving to create an item drops unsaved BOM edits, so ask first.
  function guard(e: React.MouseEvent<HTMLAnchorElement>) {
    if (dirty && !window.confirm('You have unsaved BOM changes. Leave without saving them?')) e.preventDefault();
  }

  if (loading) return <p className="muted">{t('loading')}</p>;

  return (
    <div className="card">
      <div className="row between">
        <h3>BOM — components for 1 {unitLabel(product.baseUnit)}</h3>
        <span className="muted small">Version {bom?.rev ?? 0}</span>
      </div>
      <p className="muted small">
        Components can be raw materials or other products (for example yarn made in-house).
      </p>
      {activeRms.length === 0 && otherProducts.length === 0 && (
        <p className="muted small">Nothing to choose from yet — add a raw material or product below.</p>
      )}
      {lines.map((l, i) => {
        const units = unitsFor(l.key);
        const c = splitKey(l.key);
        const current = c ? componentContext(c.type, c.id, md) : null;
        return (
          <fieldset key={i} className="tracked">
            <legend>Line {i + 1}</legend>
            <label>
              Component
              <select
                value={l.key}
                onChange={(e) => {
                  const k = e.target.value;
                  const sc = splitKey(k);
                  const comp = sc ? componentContext(sc.type, sc.id, md) : null;
                  set(i, { key: k, unit: comp?.ctx.baseUnit ?? l.unit });
                }}
              >
                <option value="">— choose —</option>
                <optgroup label="Raw materials">
                  {activeRms.length === 0 && (
                    <option value="" disabled>
                      none yet — use “+ New raw material” below
                    </option>
                  )}
                  {activeRms.map((r) => (
                    <option key={r.id} value={`RAW_MATERIAL:${r.id}`}>
                      {r.name}
                    </option>
                  ))}
                </optgroup>
                {otherProducts.length > 0 && (
                  <optgroup label="Products">
                    {otherProducts.map((p) => {
                      const loop = createsCycle(product.id, p.id, md);
                      return (
                        <option key={p.id} value={`PRODUCT:${p.id}`} disabled={loop}>
                          {p.name} ({SUPPLY_SHORT[p.supplyType]}){loop ? ' — would create a loop' : ''}
                        </option>
                      );
                    })}
                  </optgroup>
                )}
                {l.key && !current && <option value={l.key}>(missing item)</option>}
              </select>
            </label>
            <div className="grid3">
              <label>
                Quantity
                <input inputMode="decimal" value={l.qtyText} onChange={(e) => set(i, { qtyText: e.target.value })} />
              </label>
              <UnitSelect label="Unit" value={l.unit} onChange={(unit) => set(i, { unit })} units={units.length ? units : [l.unit]} />
              <label>
                Wastage %
                <input inputMode="decimal" value={l.wastageText} placeholder="0" onChange={(e) => set(i, { wastageText: e.target.value })} />
              </label>
            </div>
            <div className="grid2">
              <StatusSelect value={l.status} onChange={(status) => set(i, { status })} />
              <label>
                Source
                <input value={l.source} maxLength={120} onChange={(e) => set(i, { source: e.target.value })} />
              </label>
            </div>
            <button type="button" className="secondary small" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
              Remove line
            </button>
          </fieldset>
        );
      })}
      <div className="row gap">
        <button
          type="button"
          className="secondary small"
          onClick={() => setLines((ls) => [...ls, { key: '', qtyText: '', unit: 'kg', wastageText: '', status: 'PENDING_VERIFICATION', source: '' }])}
        >
          + Add component
        </button>
      </div>
      <p className="small create-links">
        Not in the list?{' '}
        <Link to={withReturnTo('/masters/raw-materials/new', here)} onClick={guard}>
          + New raw material
        </Link>{' '}
        ·{' '}
        <Link to={withReturnTo('/masters/products/new', here)} onClick={guard}>
          + New product
        </Link>
      </p>
      <label>
        BOM notes
        <textarea rows={2} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
      </label>
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
        <span className="muted small">{bom?.pending && <span className="badge pending">{t('PENDING')}</span>}</span>
        <button className="primary" type="button" onClick={save}>
          Save BOM
        </button>
      </div>
      {saved && <p className="ok small">{t('saved')}</p>}
      {bom && bom.lines.length > 0 && <BomCalculator product={product} productId={product.id} md={md} />}
    </div>
  );
}

function ResultTable({ title, rows, empty }: { title: string; rows: ExplodedLine[]; empty: string }) {
  return (
    <>
      <h4>{title}</h4>
      {rows.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <table className="conv">
          <tbody>
            {rows.map((l) => (
              <tr key={`${l.type}:${l.id}`}>
                <td>
                  {l.name}
                  {l.type === 'PRODUCT' && <span className="muted small"> · product</span>}
                </td>
                <td className="num">
                  {formatQty(l.qty)} {unitLabel(l.unit)}
                </td>
                <td>{l.provisional && <span className="status-tag s-estimated">Provisional</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function BomCalculator({ product, productId, md }: { product: Product; productId: string; md: MasterData }) {
  const [qtyText, setQty] = useState('1000');
  const [unit, setUnit] = useState(product.baseUnit);
  const qty = parseNum(qtyText);
  const unitOptions = availableUnits(productContext(product));
  const u = unitOptions.includes(unit) ? unit : product.baseUnit;
  const result = qty !== null && Number.isFinite(qty) && qty > 0 ? explodeBom(productId, qty, u, md) : null;
  const hasBoth = result?.toProduce.some((l) => md.products.get(l.id)?.supplyType === 'BOTH');

  return (
    <div className="calc">
      <h3>Requirement for an order (saved BOM)</h3>
      <div className="grid2">
        <label>
          Order quantity
          <input inputMode="decimal" value={qtyText} onChange={(e) => setQty(e.target.value)} />
        </label>
        <UnitSelect label="Unit" value={u} onChange={setUnit} units={unitOptions} />
      </div>
      {!result && <p className="muted small">Enter a positive number.</p>}
      {result && result.productBaseQty !== null && (
        <>
          <p className="muted small">
            = {formatQty(result.productBaseQty)} {unitLabel(product.baseUnit)}
          </p>
          {(result.toProduce.length > 0 || needsBom(product)) && (
            <ResultTable title="To produce (sub-products)" rows={result.toProduce} empty="No sub-products — made directly from raw materials." />
          )}
          <ResultTable title="To buy" rows={result.toBuy} empty="Nothing to buy." />
        </>
      )}
      {result && result.errors.length > 0 && (
        <ul className="error small">
          {result.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {result?.provisional && <p className="warn small">Provisional: some data is missing, estimated or not yet verified.</p>}
      {hasBoth && <p className="muted small">Sub-products marked “made/bought” are assumed made here; the choice is made per Job Order.</p>}
      <p className="muted small">Includes wastage. Stock is not deducted yet — stock confirmation per Job Order comes in Phase 3.</p>
    </div>
  );
}
