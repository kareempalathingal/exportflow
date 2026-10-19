import { describe, expect, it } from 'vitest';
import { emailToUsername, usernameToEmail, validateUsername } from '../../src/lib/username';
import { isUsableForCalculation, tracked, unavailable } from '../../src/lib/dataStatus';
import { diffFields, normalizeReason } from '../../src/lib/audit';
import { modeOfWorkspace, workspaceIdFor } from '../../src/lib/mode';
import { istDateKey } from '../../src/lib/time';
import {
  classifyRejection,
  prune,
  reconcileAfterRestart,
  summarize,
  type PendingOp,
} from '../../src/lib/syncState';

describe('username login', () => {
  it('maps a username to the synthetic login email', () => {
    expect(usernameToEmail('kareempalathingal')).toBe('kareempalathingal@exportflow.app');
    expect(usernameToEmail('  KareemPalathingal ')).toBe('kareempalathingal@exportflow.app');
  });
  it('rejects invalid usernames', () => {
    expect(validateUsername('')).not.toBeNull();
    expect(validateUsername('kareem@gmail.com')).not.toBeNull();
    expect(validateUsername('has space')).not.toBeNull();
    expect(validateUsername('-dash')).not.toBeNull();
    expect(() => usernameToEmail('a b')).toThrow();
  });
  it('shows the username back from the email', () => {
    expect(emailToUsername('kareempalathingal@exportflow.app')).toBe('kareempalathingal');
    expect(emailToUsername(null)).toBe('');
  });
});

describe('data status', () => {
  it('requires empty values to be Unavailable or Pending Verification', () => {
    expect(() => tracked(null, 'VERIFIED')).toThrow();
    expect(tracked(null, 'PENDING_VERIFICATION').status).toBe('PENDING_VERIFICATION');
    expect(unavailable().status).toBe('UNAVAILABLE');
  });
  it('only verified or user-provided values feed calculations', () => {
    expect(isUsableForCalculation(tracked(5, 'VERIFIED'))).toBe(true);
    expect(isUsableForCalculation(tracked(5, 'USER_PROVIDED'))).toBe(true);
    expect(isUsableForCalculation(tracked(5, 'ESTIMATED'))).toBe(false);
    expect(isUsableForCalculation(unavailable())).toBe(false);
  });
  it('trims source text', () => {
    expect(tracked('x', 'VERIFIED', '  offer letter ').source).toBe('offer letter');
  });
});

describe('audit diff', () => {
  it('reports only changed business fields', () => {
    const before = { rev: 2, updatedBy: 'u', companyName: { value: 'A', status: 'VERIFIED', source: '' } };
    const after = { companyName: { value: 'B', status: 'VERIFIED', source: '' } };
    expect(diffFields(before, after)).toEqual([
      { field: 'companyName', before: before.companyName, after: after.companyName },
    ]);
  });
  it('treats a new record as changes from null', () => {
    expect(diffFields(null, { a: 1 })).toEqual([{ field: 'a', before: null, after: 1 }]);
  });
  it('ignores identical nested values and system fields', () => {
    expect(diffFields({ a: { x: [1, 2] }, rev: 1 }, { a: { x: [1, 2] }, rev: 9 })).toEqual([]);
  });
  it('makes the reason optional and bounded', () => {
    expect(normalizeReason('   ')).toBeNull();
    expect(normalizeReason(undefined)).toBeNull();
    expect(normalizeReason('x'.repeat(900))?.length).toBe(500);
  });
});

describe('ACTUAL and DEMO workspaces', () => {
  it('derives separate workspace ids', () => {
    expect(workspaceIdFor('abc123', 'ACTUAL')).toBe('abc123_actual');
    expect(workspaceIdFor('abc123', 'DEMO')).toBe('abc123_demo');
    expect(modeOfWorkspace('abc123_demo')).toBe('DEMO');
    expect(() => workspaceIdFor('../x', 'ACTUAL')).toThrow();
  });
});

describe('IST dates', () => {
  it('uses the India calendar date, not UTC', () => {
    // 2026-10-19 20:00 UTC is already 20 Oct 01:30 in IST
    expect(istDateKey(new Date('2026-10-19T20:00:00Z'))).toBe('2026-10-20');
    expect(istDateKey(new Date('2026-10-19T18:00:00Z'))).toBe('2026-10-19');
  });
});

describe('sync state', () => {
  const op: PendingOp = {
    id: 'e1', workspaceId: 'w', path: 'p', entity: 'Profile', label: 'companyName',
    baseRev: 3, newRev: 4, data: {}, createdAt: 1, status: 'PENDING',
  };
  it('a rejected write on a stale revision is a conflict', () => {
    expect(classifyRejection(op, 'permission-denied', 4).status).toBe('CONFLICT');
  });
  it('a rejection without a revision change is a failure, not a conflict', () => {
    expect(classifyRejection(op, 'permission-denied', 3).status).toBe('FAILED');
    expect(classifyRejection(op, 'unavailable', null).status).toBe('FAILED');
  });
  it('after restart, a write whose audit event reached the server is synced', () => {
    expect(reconcileAfterRestart(op, true, 4).status).toBe('SYNCED');
    expect(reconcileAfterRestart(op, false, 4).status).toBe('CONFLICT');
    expect(reconcileAfterRestart({ ...op, status: 'FAILED' }, true, 4).status).toBe('FAILED');
  });
  it('summarizes and prunes but never drops unresolved items', () => {
    const many: PendingOp[] = Array.from({ length: 30 }, (_, i) => ({ ...op, id: `s${i}`, createdAt: i, status: 'SYNCED' }));
    const conflict = { ...op, id: 'c', status: 'CONFLICT' as const };
    const kept = prune([...many, conflict]);
    expect(kept.find((o) => o.id === 'c')).toBeTruthy();
    expect(kept.filter((o) => o.status === 'SYNCED')).toHaveLength(20);
    expect(summarize(kept)).toEqual({ PENDING: 0, SYNCED: 20, FAILED: 0, CONFLICT: 1 });
  });
});
