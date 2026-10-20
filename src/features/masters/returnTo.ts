/** Safe in-app return path from ?returnTo= (only /masters/... and /orders/... paths are allowed). */
export function safeReturnTo(params: URLSearchParams): string | null {
  const r = params.get('returnTo');
  return r && /^\/(masters|orders)\/[A-Za-z0-9/_?=&-]*$/.test(r) && !r.includes('//') ? r : null;
}

export function withReturnTo(path: string, returnTo: string): string {
  return `${path}?returnTo=${encodeURIComponent(returnTo)}`;
}

/** After creating an item from another page, tell that page which item was added. */
export function withAdded(path: string, key: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}added=${encodeURIComponent(key)}`;
}
