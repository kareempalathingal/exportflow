import { useMemo } from 'react';
import { COLLECTIONS, type Process, type Product } from '../../lib/masters';
import { ORDER_FLOW_DOC, orderFlowOf, type OrderFlow } from '../../lib/milestones';
import { processOrder } from '../../lib/processBoard';
import { useCollection, useDocument } from '../masters/useCollection';

/** Settings → Order flow (18 Nov 2026): the saved flow, or the defaults with the processes in working order. */
export function useOrderFlow(workspaceId: string | null) {
  const d = useDocument<OrderFlow>(workspaceId, 'settings', ORDER_FLOW_DOC);
  const products = useCollection<Product>(workspaceId, COLLECTIONS.products);
  const processes = useCollection<Process>(workspaceId, COLLECTIONS.processes);
  const defaultProduction = useMemo(() => {
    const active = processes.items.filter((p) => p.active !== false).map((p) => p.id);
    return processOrder(
      products.items.filter((p) => p.active !== false).map((p) => (p.route ?? []).map((s) => s.processId)),
      active,
    );
  }, [products.items, processes.items]);
  const flow = useMemo(() => orderFlowOf(d.item, defaultProduction), [d.item, defaultProduction]);
  return { flow, record: d.item, saved: !!d.item, loading: d.loading || products.loading || processes.loading, products: products.items, processes: processes.items };
}
