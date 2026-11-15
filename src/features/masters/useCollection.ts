import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { countSnapshot } from '../../lib/readsToday';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import type { VersionedRecord } from '../sync/records';

export type WithMeta<T> = T & VersionedRecord & { id: string; pending: boolean };

/**
 * One live listener per collection for the whole app (15 Nov 2026). Screens used to open
 * their own listener and drop it when they closed; opening the screen again later made
 * Firestore read the whole collection again. Now the first screen opens it, and it stays
 * open while the app is open (a listener for the other mode closes when no screen uses it),
 * so moving between screens reads nothing new: only records that change are read.
 */
interface CollectionState {
  items: WithMeta<unknown>[];
  loading: boolean;
  error: string | null;
  fromCache: boolean;
}
interface Entry {
  state: CollectionState;
  /** When the listener failed (it is opened again on use after RETRY_MS, e.g. once rules are published). */
  failedAt?: number;
  subscribers: Set<() => void>;
  unsubscribe: () => void;
}
const store = new Map<string, Entry>();
const INITIAL: CollectionState = { items: [], loading: true, error: null, fromCache: true };
const RETRY_MS = 30_000;

function entryFor(workspaceId: string, name: string): Entry {
  const key = `${workspaceId}/${name}`;
  const e = store.get(key);
  if (e && !(e.failedAt && Date.now() - e.failedAt > RETRY_MS)) return e;
  // Close idle listeners of another workspace (DEMO / ACTUAL switch).
  for (const [k, other] of store) {
    if (!k.startsWith(`${workspaceId}/`) && other.subscribers.size === 0) {
      other.unsubscribe();
      store.delete(k);
    }
  }
  // A failed listener being replaced keeps its screens: they move to the new one on their next render.
  const entry: Entry = { state: e ? { ...e.state, loading: true } : INITIAL, subscribers: new Set(), unsubscribe: () => undefined };
  const publish = (s: CollectionState) => {
    entry.state = s;
    entry.subscribers.forEach((f) => f());
  };
  entry.unsubscribe = onSnapshot(
    collection(db, `workspaces/${workspaceId}/${name}`),
    { includeMetadataChanges: true },
    (snap) => {
      countSnapshot(snap, key, entry);
      publish({
        items: snap.docs.map((d) => ({ ...(d.data() as VersionedRecord), id: d.id, pending: d.metadata.hasPendingWrites })),
        loading: false,
        error: null,
        fromCache: snap.metadata.fromCache,
      });
    },
    (err) => {
      entry.failedAt = Date.now();
      publish({ ...entry.state, loading: false, error: err.code });
    },
  );
  store.set(key, entry);
  return entry;
}

export function useCollection<T>(workspaceId: string | null, name: string) {
  const entry = workspaceId ? entryFor(workspaceId, name) : null;
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!entry) return () => undefined;
      entry.subscribers.add(cb);
      return () => void entry.subscribers.delete(cb);
    },
    [entry],
  );
  const state = useSyncExternalStore(
    subscribe,
    () => (entry ? entry.state : INITIAL),
    () => INITIAL,
  );
  return state as { items: WithMeta<T>[]; loading: boolean; error: string | null; fromCache: boolean };
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
