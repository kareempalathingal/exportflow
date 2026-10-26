import { useState } from 'react';
import { availableUnits, convert, formatQty, UNIT_CHOICES, unitLabel, type ConversionContext } from '../../lib/units';
import { parseNum } from './fields';

/** Shows what one quantity equals in every unit this item can be converted to. */
export function ConversionCheck({ ctx }: { ctx: ConversionContext }) {
  const reachable = availableUnits(ctx);
  const [qtyText, setQtyText] = useState('1');
  const [from, setFrom] = useState(ctx.baseUnit);
  const unit = reachable.includes(from) ? from : ctx.baseUnit;
  const qty = parseNum(qtyText);
  const blocked = UNIT_CHOICES.filter((u) => !reachable.includes(u.id) && ['count', 'mass', 'area'].includes(u.dim));

  return (
    <div className="card">
      <h3>Conversion check</h3>
      <div className="grid2">
        <label>
          Quantity
          <input inputMode="decimal" value={qtyText} onChange={(e) => setQtyText(e.target.value)} />
        </label>
        <label>
          Unit
          <select value={unit} onChange={(e) => setFrom(e.target.value)}>
            {reachable.map((u) => (
              <option key={u} value={u}>
                {unitLabel(u)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {qty === null || !Number.isFinite(qty) ? (
        <p className="muted small">Enter a number.</p>
      ) : (
        <table className="conv">
          <tbody>
            {reachable
              .filter((u) => u !== unit)
              .map((u) => {
                const r = convert(qty, unit, u, ctx);
                return (
                  <tr key={u}>
                    <td>{unitLabel(u)}</td>
                    <td className="num">{r.ok ? formatQty(r.value) : '—'}</td>
                    <td>{r.ok && r.provisional && <span className="status-tag s-estimated">Provisional</span>}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      )}
      {blocked.length > 0 && (
        <p className="muted small">
          Not convertible yet: {[...new Set(blocked.map((u) => u.dim))].join(', ')} — add size, GSM or weight per piece to enable.
        </p>
      )}
    </div>
  );
}
