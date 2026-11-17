/**
 * "Handled" marks on Today items (17 Nov 2026): kept on this phone only, for one day.
 * An item still there the next day comes back open, so nothing is forgotten.
 */
import { readJson, writeJson } from './storage';
import type { HandledMark } from './today';

interface Stored {
  date: string;
  marks: Record<string, HandledMark>;
}

const key = (workspaceId: string) => `todayHandled:${workspaceId}`;

/** Today's marks; marks from an earlier day are dropped. */
export function readHandled(workspaceId: string, today: string): Record<string, HandledMark> {
  const s = readJson<Stored | null>(key(workspaceId), null);
  return s && s.date === today && s.marks && typeof s.marks === 'object' ? s.marks : {};
}

/** Set (or with null, remove) one mark; returns today's marks after the change. */
export function writeHandled(workspaceId: string, today: string, itemKey: string, mark: HandledMark | null): Record<string, HandledMark> {
  const marks = { ...readHandled(workspaceId, today) };
  if (mark) marks[itemKey] = { at: mark.at, note: mark.note.trim().slice(0, 200) };
  else delete marks[itemKey];
  writeJson(key(workspaceId), { date: today, marks } satisfies Stored);
  return marks;
}
