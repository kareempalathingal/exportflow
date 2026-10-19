import { useMemo } from 'react';
import { COLLECTIONS, type Bom, type MasterData, type Product, type RawMaterial } from '../../lib/masters';
import { useCollection } from './useCollection';

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
  };
}
