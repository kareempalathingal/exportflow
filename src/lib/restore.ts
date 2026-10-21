/**
 * Restore a whole backup file into a workspace (confirmed 20 Oct 2026).
 *
 * Nothing is ever deleted or overwritten silently. Each record in the backup
 * is written as a NEW revision with its own history entry ("Restored from
 * backup …"), so the restore itself can be seen and undone the same way.
 * Records that exist now but not in the backup are kept. History (audit
 * events) is never rewritten. Job Orders follow the normal status rules, so
 * a status the rules do not allow in one step goes through the allowed path
 * (e.g. Completed → Confirmed → Completed), each step with the restore reason.
 *
 * Pure: the caller reads the current records and performs the writes.
 */
import { BACKUP_COLLECTIONS, BACKUP_FORMAT, type BackupFile } from './backup';
import { diffFields, SYSTEM_FIELDS } from './audit';
import { TRANSITIONS, type JoStatus } from './jobOrders';
import type { SampleWrite } from './sampleData';

/** Collections that are restored (history stays as it is). */
export const RESTORE_COLLECTIONS = BACKUP_COLLECTIONS.filter((c) => c !== 'auditEvents');

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{1,200}$/;

export type ParseResult = { ok: true; file: BackupFile } | { ok: false; error: string };

/** Checks a backup file's text before anything is shown or written. */
export function parseBackup(text: string): ParseResult {
  if (text.length > MAX_FILE_BYTES) return { ok: false, error: 'The file is too large to be an ExportFlow backup.' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This is not a valid backup file (not JSON).' };
  }
  const f = raw as Partial<BackupFile>;
  if (!f || typeof f !== 'object' || f.format !== BACKUP_FORMAT || f.app !== 'ExportFlow') return { ok: false, error: 'This is not an ExportFlow backup file.' };
  if (f.mode !== 'ACTUAL' && f.mode !== 'DEMO') return { ok: false, error: 'The backup does not say whether it is ACTUAL or DEMO data.' };
  if (typeof f.workspaceId !== 'string' || typeof f.exportedAt !== 'string' || !f.collections || typeof f.collections !== 'object') return { ok: false, error: 'The backup file is incomplete.' };
  for (const name of RESTORE_COLLECTIONS) {
    const rows = (f.collections as Record<string, unknown>)[name];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) return { ok: false, error: `The backup file is damaged (${name}).` };
    for (const r of rows as { id?: unknown; data?: unknown }[]) {
      if (!r || typeof r.id !== 'string' || !ID_RE.test(r.id) || !r.data || typeof r.data !== 'object' || Array.isArray(r.data)) {
        return { ok: false, error: `The backup file is damaged (${name}).` };
      }
    }
  }
  return { ok: true, file: f as BackupFile };
}

export interface CurrentRecord {
  id: string;
  data: Record<string, unknown>; // includes rev
}

export interface RestoreSkip {
  collection: string;
  id: string;
  name: string;
  reason: string;
}

export interface RestoreCounts {
  create: number;
  update: number;
  same: number;
  skipped: number;
  keptNotInBackup: number;
}

export interface RestorePlan {
  /** Why nothing may be restored (wrong mode etc.); null when allowed. */
  blocked: string | null;
  warnings: string[];
  byCollection: Record<string, RestoreCounts>;
  total: RestoreCounts;
  skips: RestoreSkip[];
  /** Writes in order; each is one record revision plus its history entry. */
  writes: SampleWrite[];
}

/** Business fields only (rev, updatedAt… are set again by the write). */
export function businessFields(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([k]) => !SYSTEM_FIELDS.has(k)));
}

const STATUSES: JoStatus[] = ['DRAFT', 'CONFIRMED', 'COMPLETED', 'CANCELLED'];
const isStatus = (s: unknown): s is JoStatus => typeof s === 'string' && (STATUSES as string[]).includes(s);

/**
 * Statuses to write, in order, to go from `from` to `to` using only allowed
 * changes (at least one write). Null when impossible.
 */
export function statusPath(from: JoStatus, to: JoStatus): JoStatus[] | null {
  const queue: { at: JoStatus; path: JoStatus[] }[] = TRANSITIONS[from].map((s) => ({ at: s, path: [s] }));
  const seen = new Set<string>();
  while (queue.length) {
    const { at, path } = queue.shift()!;
    if (at === to) return path;
    const k = `${at}`;
    if (seen.has(k) || path.length > 4) continue;
    seen.add(k);
    for (const n of TRANSITIONS[at]) if (n !== at) queue.push({ at: n, path: [...path, n] });
  }
  return null;
}

const nameOf = (collection: string, id: string, d: Record<string, unknown>): string =>
  typeof d.name === 'string' ? d.name : typeof d.joNumber === 'string' ? d.joNumber : `${collection}/${id}`;

const ENTITY: Record<string, string> = {
  settings: 'Settings',
  customers: 'Customer',
  products: 'Product',
  rawMaterials: 'Raw material',
  boms: 'BOM',
  suppliers: 'Supplier',
  processes: 'Process',
  departments: 'Department',
  jobOrders: 'Job Order',
  stockCounts: 'Stock count',
};

export function planRestore(
  file: BackupFile,
  current: Record<string, CurrentRecord[]>,
  target: { workspaceId: string; mode: 'ACTUAL' | 'DEMO' },
): RestorePlan {
  const zero = (): RestoreCounts => ({ create: 0, update: 0, same: 0, skipped: 0, keptNotInBackup: 0 });
  const plan: RestorePlan = { blocked: null, warnings: [], byCollection: {}, total: zero(), skips: [], writes: [] };
  if (file.mode === 'DEMO' && target.mode === 'ACTUAL') {
    plan.blocked = 'This is a DEMO backup. DEMO data is never written to ACTUAL. Switch to DEMO mode to restore it.';
    return plan;
  }
  if (file.mode === 'ACTUAL' && target.mode === 'DEMO') plan.warnings.push('This ACTUAL backup will be restored into DEMO (good for a practice run). ACTUAL is not touched.');
  const owner = (ws: string) => ws.replace(/_(actual|demo)$/, '');
  if (owner(file.workspaceId) !== owner(target.workspaceId)) plan.warnings.push('This backup was made by another login (or before the account was re-created).');
  const reason = `Restored from backup of ${file.exportedAt.slice(0, 16).replace('T', ' ')} UTC`;

  for (const collection of RESTORE_COLLECTIONS) {
    const counts = zero();
    plan.byCollection[collection] = counts;
    const now = new Map((current[collection] ?? []).map((r) => [r.id, r]));
    const rows = file.collections[collection] ?? [];
    const inBackup = new Set(rows.map((r) => r.id));
    counts.keptNotInBackup = [...now.keys()].filter((id) => !inBackup.has(id)).length;

    for (const row of rows) {
      const data = businessFields(row.data as Record<string, unknown>);
      const cur = now.get(row.id);
      const curData = cur ? businessFields(cur.data) : null;
      const curRev = cur && typeof cur.data.rev === 'number' ? cur.data.rev : 0;
      const name = nameOf(collection, row.id, data);
      const skip = (why: string) => {
        counts.skipped++;
        plan.skips.push({ collection, id: row.id, name, reason: why });
      };
      if (cur && diffFields(curData, data).length === 0) {
        counts.same++;
        continue;
      }
      if (cur && (collection === 'products' || collection === 'rawMaterials') && curData!.baseUnit !== data.baseUnit) {
        skip(`base unit is ${String(curData!.baseUnit)} now but ${String(data.baseUnit)} in the backup (it cannot change)`);
        continue;
      }
      const entity = `${ENTITY[collection] ?? collection}: ${name}`;
      if (collection !== 'jobOrders') {
        plan.writes.push({ collection, docId: row.id, entity, before: cur ? { ...curData!, rev: curRev } : null, data, reason });
        if (cur) counts.update++;
        else counts.create++;
        continue;
      }
      // Job Orders: only allowed status changes, one revision per step.
      const to = data.status;
      if (!isStatus(to)) {
        skip('unknown status in the backup');
        continue;
      }
      const from = cur ? cur.data.status : null;
      if (cur && !isStatus(from)) {
        skip('unknown current status');
        continue;
      }
      const steps: JoStatus[] = [];
      if (!cur) {
        steps.push('DRAFT'); // new orders always start as drafts
        if (to !== 'DRAFT') {
          const p = statusPath('DRAFT', to);
          if (!p) {
            skip(`cannot reach status ${to}`);
            continue;
          }
          steps.push(...p);
        }
      } else {
        const p = statusPath(from as JoStatus, to);
        if (!p) {
          skip(`cannot change status from ${String(from)} to ${to}`);
          continue;
        }
        steps.push(...p);
      }
      let before: SampleWrite['before'] = cur ? { ...curData!, rev: curRev } : null;
      for (const status of steps) {
        const d = { ...data, status };
        plan.writes.push({ collection, docId: row.id, entity, before, data: d, reason });
        before = { ...d, rev: (before?.rev ?? 0) + 1 };
      }
      if (cur) counts.update++;
      else counts.create++;
    }
    for (const k of Object.keys(plan.total) as (keyof RestoreCounts)[]) plan.total[k] += counts[k];
  }
  return plan;
}
