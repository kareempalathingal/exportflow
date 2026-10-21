/**
 * Full backup of one workspace (ACTUAL or DEMO) as a JSON file the user keeps.
 * Pure helpers here; reading Firestore happens in the feature layer.
 */
import { readPref, writePref } from './storage';

export const BACKUP_COLLECTIONS = [
  'settings',
  'customers',
  'products',
  'rawMaterials',
  'boms',
  'suppliers',
  'processes',
  'departments',
  'jobOrders',
  'stockCounts',
  'auditEvents',
] as const;

export const BACKUP_FORMAT = 'exportflow-backup/v1';

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  app: 'ExportFlow';
  appVersion: string;
  workspaceId: string;
  mode: 'ACTUAL' | 'DEMO';
  exportedAt: string; // ISO
  counts: Record<string, number>;
  collections: Record<string, { id: string; data: unknown }[]>;
}

/** Firestore values to plain JSON: Timestamps become ISO strings. */
export function toPlain(v: unknown): unknown {
  if (v === null || v === undefined) return v ?? null;
  if (Array.isArray(v)) return v.map(toPlain);
  if (typeof v === 'object') {
    const o = v as { toDate?: () => Date };
    if (typeof o.toDate === 'function') return o.toDate().toISOString();
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, toPlain(x)]));
  }
  return v;
}

export function buildBackup(args: {
  workspaceId: string;
  mode: 'ACTUAL' | 'DEMO';
  appVersion: string;
  now: Date;
  collections: Record<string, { id: string; data: unknown }[]>;
}): BackupFile {
  const collections: BackupFile['collections'] = {};
  const counts: Record<string, number> = {};
  for (const name of BACKUP_COLLECTIONS) {
    const rows = (args.collections[name] ?? []).map((r) => ({ id: r.id, data: toPlain(r.data) })).sort((a, b) => a.id.localeCompare(b.id));
    collections[name] = rows;
    counts[name] = rows.length;
  }
  return {
    format: BACKUP_FORMAT,
    app: 'ExportFlow',
    appVersion: args.appVersion,
    workspaceId: args.workspaceId,
    mode: args.mode,
    exportedAt: args.now.toISOString(),
    counts,
    collections,
  };
}

export function backupFileName(mode: 'ACTUAL' | 'DEMO', now: Date): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return `exportflow-${mode.toLowerCase()}-backup-${stamp}.json`;
}

// Last backup date, per workspace, on this phone.
const key = (workspaceId: string) => `lastBackup:${workspaceId}`;
export function readLastBackup(workspaceId: string): string | null {
  return readPref(key(workspaceId));
}
export function markBackedUp(workspaceId: string, at: Date): void {
  writePref(key(workspaceId), at.toISOString());
}

export const BACKUP_REMIND_DAYS = 7;

/** Days since the last backup on this phone, or null if never. */
export function daysSinceBackup(last: string | null, now: Date): number | null {
  if (!last) return null;
  const t = Date.parse(last);
  return Number.isFinite(t) ? Math.floor((now.getTime() - t) / 86_400_000) : null;
}

/** Backup reminder: ACTUAL only, once real data exists, after BACKUP_REMIND_DAYS (or never). */
export function backupReminder(mode: 'ACTUAL' | 'DEMO', workspaceId: string | null, hasData: boolean, now: Date): { days: number | null } | null {
  if (mode !== 'ACTUAL' || !workspaceId || !hasData) return null;
  const days = daysSinceBackup(readLastBackup(workspaceId), now);
  return days === null || days > BACKUP_REMIND_DAYS ? { days } : null;
}
