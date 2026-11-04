import type { WithMeta } from './useCollection';

const META = new Set(['id', 'rev', 'pending', 'updatedAt', 'updatedBy', 'lastAuditId']);

/** The record without its id and version fields (those are written by saveRecord). */
export function businessFields<T extends object>(r: WithMeta<T> | T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(r).filter(([k]) => !META.has(k)));
}
