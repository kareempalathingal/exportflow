import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { useProfile } from '../settings/useProfile';
import { formatDateTime } from '../../lib/time';
import { COLLECTIONS, masterAttention, type AttentionItem, type Bom, type Product, type RawMaterial } from '../../lib/masters';
import { useCollection } from '../masters/useCollection';

const KIND: Record<AttentionItem['kind'], { title: string; hint: string; cls: string; tab: string }> = {
  BOM_MISSING: { title: 'BOM missing', hint: 'Raw materials cannot be calculated for this product.', cls: 'bad', tab: 'bom' },
  BOM_PROVISIONAL: { title: 'BOM not confirmed', hint: 'Some BOM lines are estimated or pending verification.', cls: 'warn', tab: 'bom' },
  NO_CONVERSION: { title: 'Size / GSM missing', hint: 'Orders in sq m or kg cannot be converted for this product.', cls: 'warn', tab: 'details' },
};

export function HomePage() {
  const { t, workspaceId, mode } = useApp();
  const { profile } = useProfile(workspaceId);
  const products = useCollection<Product>(workspaceId, COLLECTIONS.products);
  const boms = useCollection<Bom>(workspaceId, COLLECTIONS.boms);
  const rms = useCollection<RawMaterial>(workspaceId, COLLECTIONS.rawMaterials);
  const company = profile?.companyName?.value;

  const attention = useMemo(
    () =>
      masterAttention(
        products.items,
        new Map(boms.items.map((b) => [b.id, b])),
        new Map(rms.items.map((r) => [r.id, r])),
      ),
    [products.items, boms.items, rms.items],
  );
  const loading = products.loading || boms.loading || rms.loading;

  return (
    <section>
      <h2>{t('homeTitle')}</h2>
      <p className="muted small">{formatDateTime(new Date())} IST</p>
      <div className="card">
        <p className="kicker">{mode}</p>
        <p className="lead">{company ?? t('appName')}</p>
        <p className="muted">{t('homeEmpty')}</p>
      </div>

      <div className="card">
        <div className="row between">
          <h3>Needs attention</h3>
          {!loading && <span className="muted small">{attention.length}</span>}
        </div>
        {loading && <p className="muted small">{t('loading')}</p>}
        {!loading && products.items.length === 0 && (
          <p className="muted small">
            No products yet. <Link to="/masters/products/new">Add the first product</Link>.
          </p>
        )}
        {!loading && products.items.length > 0 && attention.length === 0 && (
          <p className="ok small">All active products have the data needed for calculations.</p>
        )}
        <ul className="attention">
          {attention.map((a) => {
            const k = KIND[a.kind];
            return (
              <li key={`${a.productId}-${a.kind}`}>
                <Link to={`/masters/products/${a.productId}?tab=${k.tab}`}>
                  <span className={`pill ${k.cls}`}>{k.title}</span> <strong>{a.productName}</strong>
                  <span className="muted small block">{k.hint}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
