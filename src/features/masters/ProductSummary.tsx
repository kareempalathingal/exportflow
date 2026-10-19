import { Link } from 'react-router-dom';
import { productContext, type BomStatus, type Product } from '../../lib/masters';
import { completeFacts, formatQty, unitLabel } from '../../lib/units';

const SUPPLY = { MANUFACTURED: 'Manufactured', TRADED: 'Traded', BOTH: 'Manufactured + Traded' } as const;

export const BOM_BADGE: Record<Exclude<BomStatus, 'NOT_NEEDED'>, { text: string; cls: string }> = {
  READY: { text: 'BOM ready', cls: 'ok' },
  PROVISIONAL: { text: 'BOM provisional', cls: 'warn' },
  MISSING: { text: 'BOM missing', cls: 'bad' },
};

export function BomBadge({ status }: { status: BomStatus }) {
  if (status === 'NOT_NEEDED') return null;
  const b = BOM_BADGE[status];
  return <span className={`pill ${b.cls}`}>{b.text}</span>;
}

export function ProductSummary({ product, bomStatus, bomVersion }: { product: Product & { id: string }; bomStatus: BomStatus; bomVersion: number }) {
  const facts = completeFacts(productContext(product));
  const perPiece: string[] = [];
  if (product.baseUnit === 'pcs') {
    if (facts.areaPerPieceSqm) perPiece.push(`${formatQty(facts.areaPerPieceSqm.value)} sq m`);
    if (facts.massPerPieceKg) perPiece.push(`${formatQty(facts.massPerPieceKg.value)} kg`);
  }

  return (
    <section className="summary">
      <p>
        <Link to="/masters?tab=products" className="small">
          ← Products
        </Link>
      </p>
      <h2>{product.name}</h2>
      <p className="muted small">
        {SUPPLY[product.supplyType]}
        {product.supplyType === 'BOTH' && product.usualSupply && ` (usually ${product.usualSupply === 'MAKE' ? 'made' : 'bought'})`} · base unit {unitLabel(product.baseUnit)}
        {product.code && ` · ${product.code}`}
        {product.active === false && ' · Inactive'}
      </p>
      <div className="summary-grid">
        <div>
          <span className="kicker">Per 1 {unitLabel(product.baseUnit)}</span>
          <span>{perPiece.length ? perPiece.join(' · ') : facts.gsm ? `${formatQty(facts.gsm.value)} GSM` : 'Size / GSM not set'}</span>
        </div>
        {bomStatus !== 'NOT_NEEDED' && (
          <div>
            <span className="kicker">BOM</span>
            <span>
              <BomBadge status={bomStatus} />
              {bomVersion > 0 && <span className="muted small"> version {bomVersion}</span>}
            </span>
          </div>
        )}
        <div>
          <span className="kicker">Production time</span>
          <span className="muted">Not established</span>
        </div>
      </div>
    </section>
  );
}
