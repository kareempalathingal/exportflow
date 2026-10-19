/**
 * Per-device preferences. Keys are prefixed because other apps may share the
 * same origin (username.github.io). Every access is guarded: storage can be
 * unavailable in private windows or when site data is cleared.
 */
const PREFIX = 'exportflow:';

export function readPref(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(PREFIX + key) ?? null;
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(PREFIX + key);
    else globalThis.localStorage?.setItem(PREFIX + key, value);
  } catch {
    /* storage unavailable: preference simply not remembered */
  }
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = readPref(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  writePref(key, JSON.stringify(value));
}
