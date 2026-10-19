import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import type { VersionedRecord } from '../sync/records';

export type WithMeta<T> = T & VersionedRecord & { id: string; pending: boolean };

export function useCollection<T>(workspaceId: string | null, name: string) {
  const [items, setItems] = useState<WithMeta<T>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    return onSnapshot(
      collection(db, `workspaces/${workspaceId}/${name}`),
      { includeMetadataChanges: true },
      (snap) => {
        setItems(
          snap.docs.map((d) => ({ ...(d.data() as T & VersionedRecord), id: d.id, pending: d.metadata.hasPendingWrites })),
        );
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err.code);
        setLoading(false);
      },
    );
  }, [workspaceId, name]);

  return { items, loading, error };
}

export function useDocument<T>(workspaceId: string | null, name: string, id: string | null) {
  const [item, setItem] = useState<WithMeta<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId || !id) {
      setItem(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    return onSnapshot(
      doc(db, `workspaces/${workspaceId}/${name}/${id}`),
      { includeMetadataChanges: true },
      (snap) => {
        setItem(snap.exists() ? { ...(snap.data() as T & VersionedRecord), id: snap.id, pending: snap.metadata.hasPendingWrites } : null);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err.code);
        setLoading(false);
      },
    );
  }, [workspaceId, name, id]);

  return { item, loading, error };
}

export function newId(workspaceId: string, name: string): string {
  return doc(collection(db, `workspaces/${workspaceId}/${name}`)).id;
}
