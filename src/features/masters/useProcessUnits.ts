import { useMemo } from 'react';
import { useApp } from '../../AppContext';
import { COLLECTIONS, type Process } from '../../lib/masters';
import { unitsMap } from '../../lib/route';
import { useCollection } from './useCollection';

/** Parallel units per process, for plan contexts (items of an order queue for a process; 5 Nov 2026). */
export function useProcessUnits(): Map<string, number> {
  const { workspaceId } = useApp();
  const processes = useCollection<Process>(workspaceId, COLLECTIONS.processes);
  return useMemo(() => unitsMap(processes.items), [processes.items]);
}
