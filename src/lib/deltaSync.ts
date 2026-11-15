/**
 * Read only what changed (delta sync, confirmed 15 Nov 2026). Pure rules used by
 * `useCollection`; nothing here talks to Firestore, so it can be tested.
 *
 * Why: every list (masters, WOs, tasks) used to be read whole from the server each time the
 * app was opened after more than 30 minutes. With ~5 000 master records that alone can use the
 * free plan's 50 000 reads a day.
 *
 * How, with several safety nets so the phone never quietly misses a record:
 * 1. Once a day (IST), the first time a list is opened, it is read WHOLE from the server
 *    (`fullDay`). Any doubt also leads to a whole read.
 * 2. Later that day the list starts from the phone's own saved copy and asks the server only
 *    for records saved since the newest one seen (`maxMs`), minus a safety overlap
 *    (`OVERLAP_MS`). Every save writes a server time (`saveRecord()`), so a changed record is
 *    always newer than the last one seen.
 * 3. At every start the server is asked how many records the list has (a count costs about one
 *    read per 1 000 records). If the phone's copy has a different number, the list is read whole.
 * 4. Records saved on this phone are watched one by one until the server has them, so a change
 *    shows at once even offline.
 * 5. Settings → System health shows the last whole read and has "Read everything again".
 * 6. Backups are always read from the server, never from the phone's copy.
 * Writes are not changed at all: the server copy stays the single truth.
 */
import { istDateKey } from './time';
import { readJson, writeJson } from './storage';

export const OVERLAP_MS = 10 * 60 * 1000;
const KEY = 'listSync';

export interface ListSyncMeta {
  /** IST day of the last whole read from the server. */
  fullDay: string;
  /** When that whole read finished (ms). */
  fullAt: number;
  /** Newest server save time seen in this list (ms); 0 = none yet. */
  maxMs: number;
}

type MetaMap = Record<string, ListSyncMeta>;

export function readListMeta(listKey: string): ListSyncMeta | null {
  return readJson<MetaMap>(KEY, {})[listKey] ?? null;
}

export function writeListMeta(listKey: string, meta: ListSyncMeta): void {
  const all = readJson<MetaMap>(KEY, {});
  writeJson(KEY, { ...all, [listKey]: meta });
}

/** Forget one list's sync state (its next start reads it whole). */
export function removeListMeta(listKey: string): void {
  const all = readJson<MetaMap>(KEY, {});
  delete all[listKey];
  writeJson(KEY, all);
}

/** Forget the sync state, so the next start reads the list(s) whole. `prefix` = a workspace id. */
export function clearListMeta(prefix?: string): void {
  if (!prefix) return writeJson(KEY, {});
  const all = readJson<MetaMap>(KEY, {});
  writeJson(KEY, Object.fromEntries(Object.entries(all).filter(([k]) => !k.startsWith(`${prefix}/`))));
}

export function allListMeta(): MetaMap {
  return readJson<MetaMap>(KEY, {});
}

export type ListMode = 'FULL' | 'DELTA';

/** Whole read unless the phone keeps a saved copy and this list was read whole today. */
export function chooseMode(meta: ListSyncMeta | null, offlineCache: boolean, now: Date = new Date()): ListMode {
  if (!offlineCache || !meta) return 'FULL';
  if (meta.fullDay !== istDateKey(now)) return 'FULL';
  return 'DELTA';
}

/** Where the "changed since" question starts: the newest save seen, minus the overlap. */
export function deltaFrom(meta: ListSyncMeta): number {
  return Math.max(0, meta.maxMs - OVERLAP_MS);
}

/** Server time (ms) of a record's last save, or null while it is waiting to be saved. */
export function savedMs(updatedAt: unknown): number | null {
  if (updatedAt && typeof (updatedAt as { toMillis?: unknown }).toMillis === 'function') return (updatedAt as { toMillis: () => number }).toMillis();
  return null;
}

/** Newest server save time among records (ignores records still waiting to be saved). */
export function newestSave(items: readonly object[], start = 0): number {
  let m = start;
  for (const it of items) {
    const ms = savedMs((it as { updatedAt?: unknown }).updatedAt);
    if (ms !== null && ms > m) m = ms;
  }
  return m;
}

/**
 * After the count check: true = the phone's copy may be incomplete or hold extra records,
 * so the list must be read whole. Records created on this phone that the server does not have
 * yet (`pendingNew`) are allowed for.
 */
export function countMismatch(serverCount: number, phoneCount: number, pendingNew = 0): boolean {
  return serverCount !== phoneCount - pendingNew;
}

/** Reads a count costs (Firestore: one read per up to 1 000 records counted). */
export function countReads(n: number): number {
  return Math.max(1, Math.ceil(n / 1000));
}

/** System health line: how many lists of a workspace were read whole today, and the earliest time. */
export function listSyncSummary(workspaceId: string, all: Record<string, ListSyncMeta>, now: Date = new Date()): { today: number; firstAt: number | null } {
  const day = istDateKey(now);
  let today = 0;
  let firstAt: number | null = null;
  for (const [k, m] of Object.entries(all)) {
    if (!k.startsWith(`${workspaceId}/`) || m.fullDay !== day) continue;
    today++;
    if (firstAt === null || m.fullAt < firstAt) firstAt = m.fullAt;
  }
  return { today, firstAt };
}
