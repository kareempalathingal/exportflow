/**
 * Are the published Firestore rules as new as the app? (confirmed 26 Oct 2026)
 * Rules are published by hand, so a newly added collection is refused until
 * they are. Probing one read per newer collection tells us; the result is
 * shared by System health and the warning banner.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { collection, getDocsFromServer, limit, query } from 'firebase/firestore';
import { db } from '../../firebase';

/** Collections added to the rules over time: if one cannot be read, the published rules are older than the app. */
export const RULES_PROBES = [
  { collection: 'processes', since: 'Phase 4 (processes, calendar)' },
  { collection: 'departments', since: 'departments and contacts' },
  { collection: 'tasks', since: 'Work (tasks and follow-ups)' },
];

export const RULES_URL = 'https://raw.githubusercontent.com/kareempalathingal/exportflow/main/firestore.rules';

export type RulesState = { state: 'idle' | 'checking' | 'ok' | 'old' | 'error'; text?: string; missing?: string[] };

let current: RulesState = { state: 'idle' };
const listeners = new Set<() => void>();
const set = (s: RulesState) => {
  current = s;
  for (const l of listeners) l();
};

export function useRulesState(): RulesState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}

const serverProbe = (path: string) => getDocsFromServer(query(collection(db, path), limit(1)));

/** Reads one document from each newer collection on the server. */
export async function checkRules(workspaceId: string, probe: (path: string) => Promise<unknown> = serverProbe): Promise<RulesState> {
  set({ state: 'checking' });
  const missing: string[] = [];
  try {
    for (const p of RULES_PROBES) {
      try {
        await probe(`workspaces/${workspaceId}/${p.collection}`);
      } catch (e) {
        if ((e as { code?: string }).code === 'permission-denied') missing.push(p.since);
        else throw e;
      }
    }
    const s: RulesState = missing.length ? { state: 'old', missing, text: `The published Firestore rules are older than the app (missing ${missing.join(', ')}).` } : { state: 'ok' };
    set(s);
    return s;
  } catch (e) {
    const s: RulesState = { state: 'error', text: e instanceof Error ? e.message : String(e) };
    set(s);
    return s;
  }
}

const checked = new Set<string>();

/** Once per workspace per app start (when online), and again after a save is refused for permissions. */
export function useAutoRulesCheck(workspaceId: string | null, online: boolean, permissionFailures: number) {
  useEffect(() => {
    if (!workspaceId || !online) return;
    const key = `${workspaceId}:${permissionFailures}`;
    if (checked.has(key)) return;
    checked.add(key);
    void checkRules(workspaceId);
  }, [workspaceId, online, permissionFailures]);
}
