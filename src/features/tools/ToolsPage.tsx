import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { convertItemAll, convertStandard, DIMENSIONS, evaluate, formatResult, showQty, unitsOf } from '../../lib/calc';
import { productContext, rawMaterialContext } from '../../lib/masters';
import { readJson, writeJson } from '../../lib/storage';
import { availableUnits, completeFacts, standardUnit, unitLabel, type Dimension } from '../../lib/units';
import { useMasterData } from '../masters/useMasterData';

/** Home → Calculator: a calculator and a unit converter (standard units, or by product / raw material). */
export function ToolsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'convert' ? 'convert' : 'calc';
  const [carry, setCarry] = useState<number | null>(null);
  return (
    <section>
      <p>
        <Link to="/" className="small">
          ← Home
        </Link>
      </p>
      <div className="tabs" role="tablist">
        {(
          [
            ['calc', 'Calculator'],
            ['convert', 'Unit converter'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setParams({ tab: id }, { replace: true })}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'calc' ? (
        <Calculator
          onConvert={(v) => {
            setCarry(v);
            setParams({ tab: 'convert' }, { replace: true });
          }}
        />
      ) : (
        <Converter initial={carry} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Calculator
// ---------------------------------------------------------------------------

const HISTORY_KEY = 'calcHistory';
type HistoryRow = { expr: string; result: string };
const KEYS = ['C', '⌫', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '(', '0', '.', ')'];

function Calculator({ onConvert }: { onConvert: (v: number) => void }) {
  const [expr, setExpr] = useState('');
  const [history, setHistory] = useState<HistoryRow[]>(() => {
    try {
      const h = readJson<HistoryRow[]>(HISTORY_KEY, []);
      return Array.isArray(h) ? h.slice(0, 10) : [];
    } catch {
      return [];
    }
  });
  const [done, setDone] = useState(false); // "=" was pressed: the next digit starts a new sum
  const live = evaluate(expr);

  function press(k: string) {
    if (k === 'C') return setExpr(''), setDone(false);
    if (k === '⌫') return setExpr((e) => e.slice(0, -1)), setDone(false);
    if (done && /[0-9.(]/.test(k)) {
      setExpr(k);
      setDone(false);
      return;
    }
    setDone(false);
    setExpr((e) => e + k);
  }
  function equals() {
    const r = evaluate(expr);
    if (!r.ok) return;
    const row = { expr, result: formatResult(r.value) };
    const next = [row, ...history.filter((h) => h.expr !== expr)].slice(0, 10);
    setHistory(next);
    writeJson(HISTORY_KEY, next);
    setExpr(String(r.value));
    setDone(true);
  }

  return (
    <div className="card calc">
      <div className="calc-display" aria-live="polite">
        <div className="calc-expr">{expr || '0'}</div>
        <div className={`calc-result ${!live.ok && expr ? 'muted' : ''}`}>{live.ok ? `= ${formatResult(live.value)}` : expr ? live.error : ' '}</div>
      </div>
      <div className="calc-keys">
        {KEYS.map((k) => (
          <button key={k} type="button" className={/[0-9.]/.test(k) ? 'calc-num' : k === 'C' ? 'calc-clear' : 'calc-op'} onClick={() => press(k)} aria-label={k === '⌫' ? 'Delete' : k}>
            {k}
          </button>
        ))}
        <button type="button" className="calc-eq" onClick={equals} disabled={!live.ok}>
          =
        </button>
      </div>
      <button type="button" className="secondary small" disabled={!live.ok} onClick={() => live.ok && onConvert(live.value)}>
        Convert this number →
      </button>
      {history.length > 0 && (
        <>
          <div className="row between">
            <strong className="small">Recent</strong>
            <button
              type="button"
              className="linkish"
              onClick={() => {
                setHistory([]);
                writeJson(HISTORY_KEY, []);
              }}
            >
              Clear
            </button>
          </div>
          <ul className="calc-history">
            {history.map((h, i) => (
              <li key={i}>
                <button type="button" className="linkish" onClick={() => (setExpr(h.expr), setDone(false))}>
                  {h.expr} = <strong>{h.result}</strong>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted small">200 + 10% = 220 · 200 × 10% = 20. Recent sums are kept on this phone only.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Converter
// ---------------------------------------------------------------------------

function Converter({ initial }: { initial: number | null }) {
  const [mode, setMode] = useState<'units' | 'item'>('units');
  const [qtyText, setQtyText] = useState(initial !== null ? String(initial) : '1');
  const q = Number(qtyText.replace(/,/g, ''));
  const qtyOk = qtyText.trim() !== '' && Number.isFinite(q);
  return (
    <div className="card">
      <div className="segmented wrap" role="radiogroup" aria-label="Converter">
        <button type="button" role="radio" aria-checked={mode === 'units'} className={mode === 'units' ? 'on' : ''} onClick={() => setMode('units')}>
          Units
        </button>
        <button type="button" role="radio" aria-checked={mode === 'item'} className={mode === 'item' ? 'on' : ''} onClick={() => setMode('item')}>
          By product
        </button>
      </div>
      <label>
        Amount
        <input inputMode="decimal" value={qtyText} onChange={(e) => setQtyText(e.target.value)} />
      </label>
      {!qtyOk && <p className="error small">Enter a number.</p>}
      {mode === 'units' ? <UnitsConverter qty={qtyOk ? q : null} /> : <ItemConverter qty={qtyOk ? q : null} />}
    </div>
  );
}

function UnitsConverter({ qty }: { qty: number | null }) {
  const [dim, setDim] = useState<Dimension>('area');
  const units = unitsOf(dim);
  const [from, setFrom] = useState('sqm');
  const f = units.includes(from) ? from : units[0]!;
  return (
    <>
      <div className="grid2">
        <label>
          Kind
          <select value={dim} onChange={(e) => setDim(e.target.value as Dimension)}>
            {DIMENSIONS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <select value={f} onChange={(e) => setFrom(e.target.value)}>
            {units.map((u) => (
              <option key={u} value={u}>
                {unitLabel(u)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {qty !== null && (
        <table className="conv-table">
          <tbody>
            {units
              .filter((u) => u !== f)
              .map((u) => {
                const r = convertStandard(qty, f, u);
                return (
                  <tr key={u}>
                    <td>{unitLabel(u)}</td>
                    <td className="num">{r.ok ? showQty(r.value) : '—'}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      )}
      {dim !== 'count' && <p className="muted small">Within one kind only. For pcs ↔ sq m ↔ kg, use “By product” (it needs the item’s size, GSM or weight).</p>}
    </>
  );
}

function ItemConverter({ qty }: { qty: number | null }) {
  const { workspaceId } = useApp();
  const master = useMasterData(workspaceId);
  const [key, setKey] = useState('');
  const [from, setFrom] = useState('');
  const items = useMemo(
    () => [
      ...master.products.items.filter((p) => p.active !== false).map((p) => ({ key: `PRODUCT:${p.id}`, name: p.name, group: 'Products', link: `/masters/products/${p.id}?tab=details`, ctx: productContext(p) })),
      ...master.rawMaterials.items.filter((r) => r.active !== false).map((r) => ({ key: `RAW_MATERIAL:${r.id}`, name: r.name, group: 'Raw materials', link: `/masters/raw-materials/${r.id}`, ctx: rawMaterialContext(r) })),
    ].sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name)),
    [master.products.items, master.rawMaterials.items],
  );
  const item = items.find((i) => i.key === key);
  const units = useMemo(() => (item ? availableUnits(completeFacts(item.ctx)) : []), [item]);
  const f = item && units.includes(from) ? from : (item?.ctx.baseUnit ?? '');
  const rows = item && qty !== null ? convertItemAll(qty, f, item.ctx, units) : [];
  const kinds = new Set(units.map((u) => standardUnit(u)?.dim ?? 'own'));

  if (master.loading) return <p className="muted small">Loading…</p>;
  return (
    <>
      <div className="grid2">
        <label>
          Product or raw material
          <select
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setFrom('');
            }}
          >
            <option value="">— choose —</option>
            {(['Products', 'Raw materials'] as const).map((g) => (
              <optgroup key={g} label={g}>
                {items
                  .filter((i) => i.group === g)
                  .map((i) => (
                    <option key={i.key} value={i.key}>
                      {i.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        {item && (
          <label>
            From
            <select value={f} onChange={(e) => setFrom(e.target.value)}>
              {units.map((u) => (
                <option key={u} value={u}>
                  {unitLabel(u)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {items.length === 0 && <p className="muted small">No products or raw materials yet (Masters).</p>}
      {item && (
        <>
          <table className="conv-table">
            <tbody>
              {rows.map((r) => (
                <tr key={r.unit}>
                  <td>
                    {r.label}
                    {r.via.length > 0 && <span className="muted small block">via {r.via.join(', ')}</span>}
                  </td>
                  <td className="num">
                    {r.value !== null ? showQty(r.value) : '—'}
                    {r.estimate && <span className="pill warn">estimate</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.some((r) => r.estimate) && <p className="warn small">“estimate” = uses a size, GSM, weight or own unit marked as an estimate or not confirmed.</p>}
          {!(kinds.has('count') && kinds.has('area') && kinds.has('mass')) && (
            <p className="muted small">
              Only these units are possible now. To convert between pieces, area and weight, add the size, GSM or weight per piece on <Link to={item.link}>{item.name}</Link>.
            </p>
          )}
        </>
      )}
    </>
  );
}
