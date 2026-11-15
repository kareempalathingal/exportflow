/**
 * Approximate Firestore reads made by this phone today (15 Nov 2026), for System health.
 * The free plan allows 50 000 document reads a day for the whole project. Billing cannot be
 * seen from the app, so this follows Firestore's documented rules for live lists: a list that
 * (re)connects after more than 30 minutes is billed as a new query (every document); otherwise
 * only the documents that changed. One-off reads (backup, restore, history, reports that read
 * history) are not counted. Kept on the phone only.
 */
import { istDateKey } from './time';
import { readJson, writeJson } from './storage';

export const FREE_READS_PER_DAY = 50_000;
const RESUME_WINDOW_MS = 30 * 60 * 1000;
const KEY = 'readsToday';
const SYNC_KEY = 'listSynced';

interface Counter {
  day: string;
  count: number;
}

const subscribers = new Set<() => void>();
export function subscribeReads(f: () => void): () => void {
  subscribers.add(f);
  return () => subscribers.delete(f);
}

export function readsToday(now: Date = new Date()): number {
  const c = readJson<Counter>(KEY, { day: '', count: 0 });
  return c.day === istDateKey(now) ? c.count : 0;
}

export function addReads(n: number, now: Date = new Date()): void {
  if (n <= 0) return;
  const day = istDateKey(now);
  const c = readJson<Counter>(KEY, { day, count: 0 });
  writeJson(KEY, { day, count: (c.day === day ? c.count : 0) + n });
  subscribers.forEach((f) => f());
}

/** Minimal shape of a query snapshot (keeps this file free of Firestore types for tests). */
export interface SnapLike {
  size: number;
  metadata: { fromCache: boolean };
  query?: unknown;
  docChanges: (opts?: { includeMetadataChanges?: boolean }) => unknown[];
}

const connected = new WeakMap<object, boolean>();

/**
 * Called for every snapshot of a live list. `listKey` names the list (workspace/collection);
 * `owner` is the listener (a fresh one starts unconnected).
 */
export function countSnapshot(snap: SnapLike, listKey: string, owner: object, now: Date = new Date()): number {
  if (snap.metadata.fromCache) {
    connected.set(owner, false);
    return 0;
  }
  const synced = readJson<Record<string, number>>(SYNC_KEY, {});
  let n: number;
  if (!connected.get(owner)) {
    // First server answer since (re)connecting: a full re-read if the last one is too old.
    const last = synced[listKey] ?? 0;
    n = now.getTime() - last > RESUME_WINDOW_MS ? snap.size : snap.docChanges({ includeMetadataChanges: false }).length;
    connected.set(owner, true);
  } else n = snap.docChanges({ includeMetadataChanges: false }).length;
  writeJson(SYNC_KEY, { ...synced, [listKey]: now.getTime() });
  addReads(n, now);
  return n;
}
