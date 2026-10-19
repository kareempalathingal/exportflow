/** ACTUAL and DEMO data live in separate workspaces and never mix (Req. §42, §78.5). */
export type AppMode = 'ACTUAL' | 'DEMO';

export function workspaceIdFor(uid: string, mode: AppMode): string {
  if (!/^[A-Za-z0-9]+$/.test(uid)) throw new Error('Unexpected user id format');
  return `${uid}_${mode === 'ACTUAL' ? 'actual' : 'demo'}`;
}

export function modeOfWorkspace(workspaceId: string): AppMode {
  if (workspaceId.endsWith('_actual')) return 'ACTUAL';
  if (workspaceId.endsWith('_demo')) return 'DEMO';
  throw new Error('Unknown workspace');
}
