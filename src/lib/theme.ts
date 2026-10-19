/** Appearance preferences kept on this phone only (per-device conveniences). */
import { readPref, writePref } from './storage';

export type ThemePref = 'auto' | 'light' | 'dark';

export function readTheme(): ThemePref {
  const v = readPref('theme');
  return v === 'light' || v === 'dark' ? v : 'auto';
}

/** Applies the theme to <html data-theme>; "auto" follows the phone setting. */
export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  const dark = pref === 'dark' || (pref === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f141a' : '#ffffff');
}

export function saveTheme(pref: ThemePref): void {
  writePref('theme', pref === 'auto' ? null : pref);
  applyTheme(pref);
}

/** How far behind plan (percentage points) the colour reaches full red. */
export const DEFAULT_RED_AT = 20;

export function readRedAt(): number {
  const n = Number(readPref('redAt'));
  return Number.isFinite(n) && n >= 5 && n <= 50 ? n : DEFAULT_RED_AT;
}

export function saveRedAt(n: number): void {
  writePref('redAt', n === DEFAULT_RED_AT ? null : String(n));
}
