/**
 * Size of one piece in every length unit, its area and weight (confirmed
 * 4 Nov 2026). Shown on the product's Conversion tab and in the converter.
 */
import { productContext, type Product } from '../../lib/masters';
import { completeFacts, formatQty, pieceSize, unitLabel } from '../../lib/units';

export function SizeCard({ product }: { product: Pick<Product, 'size' | 'gsm' | 'weightPerPieceKg' | 'baseUnit' | 'customUnits'> }) {
  const s = pieceSize(product.size);
  if (!s) return null;
  const facts = completeFacts(productContext(product));
  const kg = facts.massPerPieceKg?.value;
  return (
    <div className="card size-card">
      <h3>
        Size of one piece {s.estimate && <span className="pill warn">estimate</span>}
      </h3>
      <table className="conv-table">
        <thead>
          <tr>
            <th scope="col"></th>
            <th scope="col" className="num">
              Length × width
            </th>
          </tr>
        </thead>
        <tbody>
          {s.rows.map((r) => (
            <tr key={r.unit}>
              <td>{unitLabel(r.unit)}</td>
              <td className="num">
                {formatQty(r.length)} × {formatQty(r.width)}
                {r.unit === 'in' && <span className="muted small block">≈ {s.inchesHalf}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small">
        Area: {s.area.map((a) => `${formatQty(a.value)} ${unitLabel(a.unit)}`).join(' · ')}
        {kg !== undefined && (
          <>
            {' '}
            · Weight: {formatQty(kg)} kg{facts.gsm ? ` (GSM ${formatQty(facts.gsm.value)})` : ''}
          </>
        )}
      </p>
    </div>
  );
}
