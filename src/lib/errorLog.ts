/**
 * Error log kept on this phone only (last 50 entries). Nothing is sent
 * anywhere; the user can copy the details and paste them for a fix.
 */
import { readJson, writeJson } from './storage';

export interface ErrorEntry {
  at: string; // ISO time
  where: string; // screen or action, e.g. "Screen", "Sync", "Backup"
  message: string;
  stack: string;
  route: string;
  appVersion: string;
}

const KEY = 'errorLog';
export const ERROR_LOG_MAX = 50;

type Listener = () => void;
const listeners = new Set<Listener>();

export function readErrors(): ErrorEntry[] {
  const v = readJson<ErrorEntry[]>(KEY, []);
  return Array.isArray(v) ? v : [];
}

export function subscribeErrors(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function describe(e: unknown): { message: string; stack: string } {
  if (e instanceof Error) return { message: `${e.name}: ${e.message}`, stack: e.stack ?? '' };
  if (e && typeof e === 'object' && 'code' in e) return { message: `${String((e as { code: unknown }).code)}: ${String((e as { message?: unknown }).message ?? '')}`, stack: '' };
  return { message: String(e), stack: '' };
}

/** Adds an entry (newest first). Never throws. */
export function logError(e: unknown, where: string, extra?: { route?: string; appVersion?: string; now?: Date }): ErrorEntry | null {
  try {
    const { message, stack } = describe(e);
    const entry: ErrorEntry = {
      at: (extra?.now ?? new Date()).toISOString(),
      where,
      message: message.slice(0, 500),
      stack: stack.slice(0, 2000),
      route: extra?.route ?? (typeof location !== 'undefined' ? location.hash || '/' : ''),
      appVersion: extra?.appVersion ?? (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : ''),
    };
    const prev = readErrors();
    // The same error repeating within a minute is kept once.
    const dup = prev[0] && prev[0].message === entry.message && prev[0].where === where && Date.parse(entry.at) - Date.parse(prev[0].at) < 60_000;
    if (!dup) writeJson(KEY, [entry, ...prev].slice(0, ERROR_LOG_MAX));
    for (const l of listeners) l();
    return entry;
  } catch {
    return null;
  }
}

export function clearErrors(): void {
  writeJson(KEY, []);
  for (const l of listeners) l();
}

/** Plain text to copy and paste when asking for a fix. */
export function errorReport(entries: ErrorEntry[], context: { userAgent?: string } = {}): string {
  const head = `ExportFlow error report · ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}${context.userAgent ? `\nDevice: ${context.userAgent}` : ''}`;
  const body = entries
    .map((e, i) => `#${i + 1} ${e.at} · ${e.where} · ${e.route} · v${e.appVersion}\n${e.message}${e.stack ? `\n${e.stack.split('\n').slice(0, 8).join('\n')}` : ''}`)
    .join('\n\n');
  return `${head}\n\n${body}`;
}

/** Quota errors mean the free plan's daily limit was reached (saves resume the next day). */
export function quotaErrors(entries: ErrorEntry[]): ErrorEntry[] {
  return entries.filter((e) => /resource-exhausted|quota/i.test(e.message));
}

/** Catches errors outside React (scripts, failed promises). */
export function installGlobalErrorHandlers(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (ev) => logError(ev.error ?? ev.message, 'Page'));
  window.addEventListener('unhandledrejection', (ev) => logError(ev.reason, 'Background task'));
}
