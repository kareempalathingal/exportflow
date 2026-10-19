import { useSyncExternalStore } from 'react';
import { readJson, writeJson } from '../../lib/storage';
import { prune, type PendingOp } from '../../lib/syncState';

const KEY = 'syncOps';
type Listener = () => void;

let ops: PendingOp[] = readJson<PendingOp[]>(KEY, []);
const listeners = new Set<Listener>();

function emit() {
  ops = prune(ops);
  writeJson(KEY, ops);
  listeners.forEach((l) => l());
}

export const syncStore = {
  all(): PendingOp[] {
    return ops;
  },
  upsert(op: PendingOp) {
    ops = [op, ...ops.filter((o) => o.id !== op.id)];
    emit();
  },
  update(id: string, fn: (op: PendingOp) => PendingOp) {
    ops = ops.map((o) => (o.id === id ? fn(o) : o));
    emit();
  },
  remove(id: string) {
    ops = ops.filter((o) => o.id !== id);
    emit();
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useSyncOps(): PendingOp[] {
  return useSyncExternalStore(syncStore.subscribe, syncStore.all, syncStore.all);
}
