/**
 * Size of one piece in every length unit, exact figures (confirmed 4 Nov
 * 2026). Area and weight are in the conversion table below it.
 */
import type { Product } from '../../lib/masters';
import { formatQty, pieceSize, unitLabel } from '../../lib/units';

export function SizeCard({ product }: { product: Pick<Product, 'size'> }) {
  const s = pieceSize(product.size);
  if (!s) return null;
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
              Width × length
            </th>
          </tr>
        </thead>
        <tbody>
          {s.rows.map((r) => (
            <tr key={r.unit}>
              <td>{unitLabel(r.unit)}</td>
              <td className="num">
                {formatQty(r.width)} × {formatQty(r.length)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
