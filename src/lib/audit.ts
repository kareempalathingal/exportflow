/** Pure helpers for the audit trail (Requirements §36, §75.2). */

export type AuditAction = 'CREATE' | 'UPDATE' | 'RESOLVE_CONFLICT';

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

type Plain = Record<string, unknown>;

/** Fields maintained by the system; never reported as user changes. */
export const SYSTEM_FIELDS = new Set(['rev', 'updatedAt', 'updatedBy', 'lastAuditId', 'createdAt']);

function isPlainObject(v: unknown): v is Plain {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stableEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) if (!stableEqual(a[k], b[k])) return false;
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => stableEqual(x, b[i]));
  }
  return false;
}

/** Top-level field differences between two versions of a record. */
export function diffFields(before: Plain | null, after: Plain): FieldChange[] {
  const prev = before ?? {};
  const keys = [...new Set([...Object.keys(prev), ...Object.keys(after)])].sort();
  const changes: FieldChange[] = [];
  for (const field of keys) {
    if (SYSTEM_FIELDS.has(field)) continue;
    const b = prev[field] ?? null;
    const a = after[field] ?? null;
    if (!stableEqual(b, a)) changes.push({ field, before: b, after: a });
  }
  return changes;
}

export function normalizeReason(reason: string | undefined): string | null {
  const r = (reason ?? '').trim();
  return r.length > 0 ? r.slice(0, 500) : null;
}
