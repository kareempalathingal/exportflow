import { useMemo } from 'react';
import { COLLECTIONS, type Bom, type MasterData, type Product, type RawMaterial } from '../../lib/masters';
import { useCollection } from './useCollection';

export function mastersNotReady(lists: { loading: boolean; error: string | null; fromCache?: boolean }[], online: boolean): string | null {
  const err = lists.find((l) => l.error)?.error;
  if (err) return `Masters could not be loaded (${err}). Figures are not calculated until they load.`;
  if (lists.some((l) => l.loading)) return 'Masters still loading - try again in a moment.';
  if (online && lists.some((l) => l.fromCache)) return 'Masters still loading from the server - try again in a moment.';
  return null;
}

/** All products, raw materials and BOMs of the workspace, as lookup maps. */
export function useMasterData(workspaceId: string | null) {
  const products = useCollection<Product>(workspaceId, COLLECTIONS.products);
  const rawMaterials = useCollection<RawMaterial>(workspaceId, COLLECTIONS.rawMaterials);
  const boms = useCollection<Bom>(workspaceId, COLLECTIONS.boms);
  const md = useMemo<MasterData>(
    () => ({
      products: new Map(products.items.map((p) => [p.id, p])),
      rawMaterials: new Map(rawMaterials.items.map((r) => [r.id, r])),
      boms: new Map(boms.items.map((b) => [b.id, b])),
    }),
    [products.items, rawMaterials.items, boms.items],
  );
  const bomRev = useMemo(() => {
    const revs = new Map(boms.items.map((b) => [b.id, b.rev]));
    return (productId: string) => revs.get(productId) ?? 0;
  }, [boms.items]);
  return {
    md,
    /** Current BOM version (record rev) of a product; 0 if it has no BOM. */
    bomRev,
    products,
    rawMaterials,
    boms,
    loading: products.loading || rawMaterials.loading || boms.loading,
    error: products.error ?? rawMaterials.error ?? boms.error,
    /**
     * Why material figures cannot be trusted yet, or null when they can (15 Nov 2026): the lists
     * are still loading, failed, or are only the phone's saved copy while the phone is online
     * (that copy can be incomplete). Offline, the saved copy is all there is: allowed.
     */
    notReady: mastersNotReady(
      [products, rawMaterials, boms],
      typeof navigator === 'undefined' || navigator.onLine !== false,
    ),
  };
}
