/**
 * ExportFlow uses username + password login. Firebase Authentication needs an
 * email, so each username maps to a synthetic, non-deliverable address.
 */
export const LOGIN_EMAIL_DOMAIN = 'exportflow.app';

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._-]{0,38}[a-z0-9])?$/;

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

export function validateUsername(input: string): string | null {
  const u = normalizeUsername(input);
  if (u.length === 0) return 'Enter your username';
  if (u.includes('@')) return 'Enter only the username, without @';
  if (!USERNAME_RE.test(u)) return 'Use letters, numbers, dot, dash or underscore';
  return null;
}

export function usernameToEmail(input: string): string {
  const error = validateUsername(input);
  if (error) throw new Error(error);
  return `${normalizeUsername(input)}@${LOGIN_EMAIL_DOMAIN}`;
}

export function emailToUsername(email: string | null | undefined): string {
  if (!email) return '';
  const suffix = `@${LOGIN_EMAIL_DOMAIN}`;
  return email.endsWith(suffix) ? email.slice(0, -suffix.length) : email;
}
