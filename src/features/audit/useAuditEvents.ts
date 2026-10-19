import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../firebase';
import type { FieldChange } from '../../lib/audit';

export interface AuditEventView {
  id: string;
  entity: string;
  action: string;
  rev: number;
  changes: FieldChange[];
  reason: string | null;
  at: Date | null;
  pending: boolean;
}

export function useAuditEvents(workspaceId: string | null, max = 100) {
  const [events, setEvents] = useState<AuditEventView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    const q = query(
      collection(db, `workspaces/${workspaceId}/auditEvents`),
      orderBy('at', 'desc'),
      limit(max),
    );
    return onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        setEvents(
          snap.docs.map((d) => {
            const at = d.get('at', { serverTimestamps: 'estimate' });
            return {
              id: d.id,
              entity: String(d.get('entity') ?? ''),
              action: String(d.get('action') ?? ''),
              rev: Number(d.get('rev') ?? 0),
              changes: (d.get('changes') as FieldChange[] | undefined) ?? [],
              reason: (d.get('reason') as string | null | undefined) ?? null,
              at: at && typeof at.toDate === 'function' ? at.toDate() : null,
              pending: d.metadata.hasPendingWrites,
            };
          }),
        );
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err.code);
        setLoading(false);
      },
    );
  }, [workspaceId, max]);

  return { events, loading, error };
}
