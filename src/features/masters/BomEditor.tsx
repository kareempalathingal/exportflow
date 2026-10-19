import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { availableUnits, formatQty, unitLabel } from '../../lib/units';
import { bomRequirement, COLLECTIONS, productContext, rawMaterialContext, type Bom, type BomLine, type Product, type RawMaterial } from '../../lib/masters';
import type { DataStatus } from '../../lib/dataStatus';
import { saveRecord } from '../sync/records';
import { parseNum, StatusSelect, UnitSelect } from './fields';
import { useCollection, useDocument, type WithMeta } from './useCollection';

interface LineDraft {
  rawMaterialId: string;
  qtyText: string;
  unit: string;
  wastageText: string;
  status: DataStatus;
  source: string;
}

function toDraft(l: BomLine): LineDraft {
  return { rawMaterialId: l.rawMaterialId, qtyText: String(l.qty), unit: l.unit, wastageText: l.wastagePct ? String(l.wastagePct) : '', status: l.status, source: l.source ?? '' };
}

export function BomEditor({ product }: { product: WithMeta<Product> }) {
  const { workspaceId, t } = useApp();
  const { item: bom, loading } = useDocument<Bom>(workspaceId, COLLECTIONS.boms, product.id);
  const rms = useCollection<RawMaterial>(workspaceId, COLLECTIONS.rawMaterials);
  const rmMap = useMemo(() => new Map(rms.items.map((r) => [r.id, r])), [rms.items]);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const loaded = useRef<string | null>(null);

  useEffect(() => {
    if (loading) return;
    const key = `${product.id}:${bom?.rev ?? 0}`;
    if (loaded.current === key) return;
    loaded.current = key;
    setLines((bom?.lines ?? []).map(toDraft));
    setNotes(bom?.notes ?? '');
  }, [bom, loading, product.id]);

  const set = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const activeRms = rms.items.filter((r) => r.active !== false).sort((a, b) => a.name.localeCompare(b.name));

  function parse(): BomLine[] | string {
    const out: BomLine[] = [];
    const seen = new Set<string>();
    for (const [i, l] of lines.entries()) {
      const n = i + 1;
      const rm = rmMap.get(l.rawMaterialId);
      if (!rm) return `Line ${n}: choose a raw material`;
      if (seen.has(rm.id)) return `${rm.name} is listed twice`;
      seen.add(rm.id);
      const qty = parseNum(l.qtyText);
      if (qty === null || !Number.isFinite(qty) || qty <= 0) return `Line ${n}: quantity must be a positive number`;
      const w = parseNum(l.wastageText) ?? 0;
      if (!Number.isFinite(w) || w < 0 || w >= 100) return `Line ${n}: wastage must be between 0 and 99 %`;
      if (!availableUnits(rawMaterialContext(rm)).includes(l.unit)) return `Line ${n}: ${unitLabel(l.unit)} cannot be converted to ${unitLabel(rm.baseUnit)} for ${rm.name}`;
      out.push({ rawMaterialId: rm.id, qty, unit: l.unit, wastagePct: w, status: l.status, source: l.source.trim() });
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

  if (loading || rms.loading) return <p className="muted">{t('loading')}</p>;

  return (
    <div className="card">
      <div className="row between">
        <h3>BOM — raw materials for 1 {unitLabel(product.baseUnit)}</h3>
        <span className="muted small">Version {bom?.rev ?? 0}</span>
      </div>
      {activeRms.length === 0 && (
        <p className="muted small">
          No raw materials yet. <Link to="/masters/raw-materials/new">Add a raw material</Link> first.
        </p>
      )}
      {lines.map((l, i) => {
        const rm = rmMap.get(l.rawMaterialId);
        const unitOptions = rm ? availableUnits(rawMaterialContext(rm)) : [];
        return (
          <fieldset key={i} className="tracked">
            <legend>Line {i + 1}</legend>
            <label>
              Raw material
              <select
                value={l.rawMaterialId}
                onChange={(e) => {
                  const r = rmMap.get(e.target.value);
                  set(i, { rawMaterialId: e.target.value, unit: r?.baseUnit ?? l.unit });
                }}
              >
                <option value="">— choose —</option>
                {activeRms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
                {rm && rm.active === false && <option value={rm.id}>{rm.name} (inactive)</option>}
              </select>
            </label>
            <div className="grid3">
              <label>
                Quantity
                <input inputMode="decimal" value={l.qtyText} onChange={(e) => set(i, { qtyText: e.target.value })} />
              </label>
              <UnitSelect label="Unit" value={l.unit} onChange={(unit) => set(i, { unit })} units={unitOptions.length ? unitOptions : [l.unit]} />
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
      {activeRms.length > 0 && (
        <button
          type="button"
          className="secondary small"
          onClick={() => setLines((ls) => [...ls, { rawMaterialId: '', qtyText: '', unit: 'kg', wastageText: '', status: 'PENDING_VERIFICATION', source: '' }])}
        >
          + Add raw material
        </button>
      )}
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
      {bom && bom.lines.length > 0 && <BomCalculator product={product} bom={bom} rmMap={rmMap} />}
    </div>
  );
}

function BomCalculator({ product, bom, rmMap }: { product: Product; bom: Bom; rmMap: Map<string, RawMaterial> }) {
  const [qtyText, setQty] = useState('1000');
  const [unit, setUnit] = useState(product.baseUnit);
  const qty = parseNum(qtyText);
  const result = qty !== null && Number.isFinite(qty) && qty > 0 ? bomRequirement(product, bom, rmMap, qty, unit) : null;
  const unitOptions = availableUnits(productContext(product));

  return (
    <div className="calc">
      <h3>Raw material needed (saved BOM)</h3>
      <div className="grid2">
        <label>
          Order quantity
          <input inputMode="decimal" value={qtyText} onChange={(e) => setQty(e.target.value)} />
        </label>
        <UnitSelect label="Unit" value={unitOptions.includes(unit) ? unit : product.baseUnit} onChange={setUnit} units={unitOptions} />
      </div>
      {!result && <p className="muted small">Enter a positive number.</p>}
      {result?.productError && <p className="error small">{result.productError}</p>}
      {result && result.productBaseQty !== null && (
        <>
          <p className="muted small">
            = {formatQty(result.productBaseQty)} {unitLabel(product.baseUnit)}
          </p>
          <table className="conv">
            <thead>
              <tr>
                <th>Raw material</th>
                <th className="num">Gross incl. wastage</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {result.lines.map((l) => (
                <tr key={l.rawMaterialId}>
                  <td>{l.name}</td>
                  <td className="num">{l.error ? <span className="error small">{l.error}</span> : `${formatQty(l.gross)} ${unitLabel(l.unit)}`}</td>
                  <td>{l.provisional && <span className="status-tag s-estimated">Provisional</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.provisional && (
            <p className="warn small">Provisional: some BOM lines or conversions are not Verified / User-Provided.</p>
          )}
          <p className="muted small">Before stock is deducted. Stock confirmation per Job Order comes in Phase 3.</p>
        </>
      )}
    </div>
  );
}
