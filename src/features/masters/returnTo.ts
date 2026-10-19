/** Safe in-app return path from ?returnTo= (only /masters/... and /orders/... paths are allowed). */
export function safeReturnTo(params: URLSearchParams): string | null {
  const r = params.get('returnTo');
  return r && /^\/(masters|orders)\/[A-Za-z0-9/_?=&-]*$/.test(r) && !r.includes('//') ? r : null;
}

export function withReturnTo(path: string, returnTo: string): string {
  return `${path}?returnTo=${encodeURIComponent(returnTo)}`;
}
