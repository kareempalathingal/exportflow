import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { addReads, countSnapshot } from '../../lib/readsToday';
import {
  collection,
  doc,
  getCountFromServer,
  getDocsFromCache,
  onSnapshot,
  query,
  Timestamp,
  where,
  type DocumentSnapshot,
} from 'firebase/firestore';
import { db, offlineCacheEnabled } from '../../firebase';
import { setLocalWriteHook, type VersionedRecord } from '../sync/records';
import { chooseMode, clearListMeta, removeListMeta, countMismatch, countReads, deltaFrom, newestSave, readListMeta, writeListMeta, type ListMode } from '../../lib/deltaSync';
import { istDateKey } from '../../lib/time';
import { logError } from '../../lib/errorLog';

export type WithMeta<T> = T & VersionedRecord & { id: string; pending: boolean };

/**
 * One live listener per collection for the whole app (15 Nov 2026). Screens used to open
 * their own listener and drop it when they closed; opening the screen again later made
 * Firestore read the whole collection again. Now the first screen opens it, and it stays
 * open while the app is open (a listener for the other mode closes when no screen uses it),
 * so moving between screens reads nothing new: only records that change are read.
 *
 * Delta sync (15 Nov 2026, rules in `src/lib/deltaSync.ts`): the first open of the day reads
 * the list whole; later opens start from the phone's saved copy, check the record count with
 * the server and listen only to records saved since the newest one seen. Any doubt (count
 * differs, saved copy unreadable, query refused) falls back to a whole read.
 */
interface CollectionState {
  items: WithMeta<unknown>[];
  loading: boolean;
  error: string | null;
  fromCache: boolean;
}
interface Entry {
  key: string;
  workspaceId: string;
  name: string;
  mode: ListMode;
  docs: Map<string, WithMeta<unknown>>;
  state: CollectionState;
  /** When the listener failed (it is opened again on use after RETRY_MS, e.g. once rules are published). */
  failedAt?: number;
  subscribers: Set<() => void>;
  unsubscribe: () => void;
  /** Records saved on this phone, watched until the server has them (delta mode). */
  watching: Map<string, () => void>;
  /** Changes with each (re)start, so answers of an older start are ignored. */
  generation: number;
}
const store = new Map<string, Entry>();
const INITIAL: CollectionState = { items: [], loading: true, error: null, fromCache: true };
const RETRY_MS = 30_000;

const toItem = (d: DocumentSnapshot): WithMeta<unknown> => ({ ...(d.data() as VersionedRecord), id: d.id, pending: d.metadata.hasPendingWrites });

function publish(entry: Entry, patch: Partial<CollectionState>) {
  entry.state = { ...entry.state, items: [...entry.docs.values()], ...patch };
  entry.subscribers.forEach((f) => f());
}

function rememberFullRead(entry: Entry) {
  const now = new Date();
  writeListMeta(entry.key, { fullDay: istDateKey(now), fullAt: now.getTime(), maxMs: newestSave([...entry.docs.values()]) });
  listSyncChanged();
}

function rememberNewest(entry: Entry) {
  const meta = readListMeta(entry.key);
  if (!meta) return;
  const maxMs = newestSave([...entry.docs.values()], meta.maxMs);
  if (maxMs !== meta.maxMs) writeListMeta(entry.key, { ...meta, maxMs });
}

function stop(entry: Entry) {
  entry.unsubscribe();
  entry.unsubscribe = () => undefined;
  entry.watching.forEach((u) => u());
  entry.watching.clear();
}

function onListError(entry: Entry, err: { code?: string }) {
  entry.failedAt = Date.now();
  publish(entry, { loading: false, error: err.code ?? 'unknown' });
}

/** The whole list, live (the only mode before 15 Nov 2026; still used once a day and on any doubt). */
function startFull(entry: Entry) {
  stop(entry);
  entry.mode = 'FULL';
  const gen = ++entry.generation;
  entry.unsubscribe = onSnapshot(
    collection(db, `workspaces/${entry.workspaceId}/${entry.name}`),
    { includeMetadataChanges: true },
    (snap) => {
      if (gen !== entry.generation) return;
      countSnapshot(snap, entry.key, entry);
      entry.docs = new Map(snap.docs.map((d) => [d.id, toItem(d)]));
      if (!snap.metadata.fromCache) {
        const meta = readListMeta(entry.key);
        if (!meta || meta.fullDay !== istDateKey(new Date())) rememberFullRead(entry);
        else rememberNewest(entry);
      }
      publish(entry, { loading: false, error: null, fromCache: snap.metadata.fromCache });
    },
    (err) => gen === entry.generation && onListError(entry, err),
  );
}

/** Saved copy + records saved since the newest one seen + a count check with the server. */
function startDelta(entry: Entry) {
  stop(entry);
  entry.mode = 'DELTA';
  const gen = ++entry.generation;
  const meta = readListMeta(entry.key)!;
  const coll = collection(db, `workspaces/${entry.workspaceId}/${entry.name}`);
  const fallBack = (why: string) => {
    if (gen !== entry.generation) return;
    logError(new Error(`${entry.name}: ${why} - reading the whole list again`), 'List sync');
    removeListMeta(entry.key);
    startFull(entry);
  };

  getDocsFromCache(coll).then(
    (cached) => {
      if (gen !== entry.generation) return;
      // Records that arrived from the server meanwhile are newer than the saved copy: keep them.
      const fresh = entry.docs;
      entry.docs = new Map(cached.docs.map((d) => [d.id, toItem(d)]));
      fresh.forEach((v, k) => entry.docs.set(k, v));
      // fromCache is left as it is: if the server already answered, the list stays "from the server".
      publish(entry, { loading: false, error: null });

      const pendingNew = cached.docs.filter((d) => d.metadata.hasPendingWrites && d.get('rev') === 1).length;
      getCountFromServer(coll).then(
        (c) => {
          if (gen !== entry.generation) return;
          const n = c.data().count;
          addReads(countReads(n));
          if (countMismatch(n, entry.docs.size, pendingNew)) fallBack(`phone had ${entry.docs.size}, server has ${n}`);
        },
        (err: { code?: string }) => {
          // Offline: the saved copy is used, as before. Anything else: read the whole list.
          if (err.code !== 'unavailable') fallBack(`count check failed (${err.code ?? 'error'})`);
        },
      );
    },
    () => fallBack('saved copy could not be read'),
  );

  const unsub = onSnapshot(
    query(coll, where('updatedAt', '>=', Timestamp.fromMillis(deltaFrom(meta)))),
    { includeMetadataChanges: true },
    (snap) => {
      if (gen !== entry.generation) return;
      countSnapshot(snap, entry.key, entry);
      for (const ch of snap.docChanges({ includeMetadataChanges: true })) {
        // "removed" only means the record no longer matches "saved since" (e.g. a save on this
        // phone waiting for its server time); the record itself is kept.
        if (ch.type !== 'removed') entry.docs.set(ch.doc.id, toItem(ch.doc));
      }
      if (!snap.metadata.fromCache) rememberNewest(entry);
      publish(entry, { loading: false, error: null, fromCache: snap.metadata.fromCache });
    },
    (err) => {
      if (gen !== entry.generation) return;
      if (err.code === 'permission-denied') return onListError(entry, err);
      fallBack(`changes could not be read (${err.code})`);
    },
  );
  entry.unsubscribe = unsub;
}

/** A record saved on this phone: show it at once and until the server has it (delta mode). */
function watchLocalWrite(path: string) {
  const parts = path.split('/'); // workspaces/{ws}/{name}/{id}
  if (parts.length !== 4) return;
  const entry = store.get(`${parts[1]}/${parts[2]}`);
  if (!entry || entry.mode !== 'DELTA' || entry.watching.has(parts[3]!)) return;
  const id = parts[3]!;
  const u = onSnapshot(
    doc(db, path),
    { includeMetadataChanges: true },
    (snap) => {
      if (snap.exists()) {
        entry.docs.set(id, toItem(snap));
        publish(entry, {});
      }
      if (!snap.metadata.hasPendingWrites && !snap.metadata.fromCache) {
        entry.watching.get(id)?.();
        entry.watching.delete(id);
      }
    },
    () => {
      entry.watching.get(id)?.();
      entry.watching.delete(id);
    },
  );
  entry.watching.set(id, u);
}
setLocalWriteHook(watchLocalWrite);

function entryFor(workspaceId: string, name: string): Entry {
  const key = `${workspaceId}/${name}`;
  const e = store.get(key);
  if (e && !(e.failedAt && Date.now() - e.failedAt > RETRY_MS)) return e;
  // Close idle listeners of another workspace (DEMO / ACTUAL switch).
  for (const [k, other] of store) {
    if (!k.startsWith(`${workspaceId}/`) && other.subscribers.size === 0) {
      stop(other);
      store.delete(k);
    }
  }
  // A failed listener being replaced keeps its screens: they move to the new one on their next render.
  const entry: Entry = {
    key,
    workspaceId,
    name,
    mode: 'FULL',
    docs: e ? e.docs : new Map(),
    state: e ? { ...e.state, loading: true } : INITIAL,
    subscribers: new Set(),
    unsubscribe: () => undefined,
    watching: new Map(),
    generation: 0,
  };
  store.set(key, entry);
  if (chooseMode(readListMeta(key), offlineCacheEnabled) === 'DELTA') startDelta(entry);
  else startFull(entry);
  return entry;
}

/**
 * "Read everything again" (System health) and after Clear DEMO: forget the sync state and read
 * every open list whole from the server. `workspaceId` limits it to one workspace.
 */
export function readListsAgain(workspaceId?: string) {
  clearListMeta(workspaceId);
  for (const entry of store.values()) if (!workspaceId || entry.workspaceId === workspaceId) startFull(entry);
  listSyncChanged();
}

const syncListeners = new Set<() => void>();
function listSyncChanged() {
  syncListeners.forEach((f) => f());
}
/** For System health: re-render when a whole read finishes. */
export function subscribeListSync(f: () => void): () => void {
  syncListeners.add(f);
  return () => void syncListeners.delete(f);
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
