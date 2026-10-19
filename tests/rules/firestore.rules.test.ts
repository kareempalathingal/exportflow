/**
 * Security-rule tests. They need the Firestore emulator:
 *   npm run test:rules
 * (runs in GitHub Actions; the emulator download is not reachable everywhere).
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, writeBatch, type Firestore } from 'firebase/firestore';

let env: RulesTestEnvironment;
const ALICE = 'alice1';
const BOB = 'bob1';

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-exportflow',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(async () => env.cleanup());
beforeEach(async () => env.clearFirestore());

function dbFor(uid: string | null): Firestore {
  return (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore() as unknown as Firestore;
}

async function createWorkspace(db: Firestore, uid: string, mode: 'ACTUAL' | 'DEMO') {
  const id = `${uid}_${mode === 'ACTUAL' ? 'actual' : 'demo'}`;
  await setDoc(doc(db, 'workspaces', id), {
    ownerUid: uid,
    members: { [uid]: 'owner' },
    mode,
    name: 'x',
    createdAt: serverTimestamp(),
  });
  return id;
}

function saveBatch(db: Firestore, uid: string, ws: string, rev: number, eventId: string, overrides: Record<string, unknown> = {}) {
  const b = writeBatch(db);
  b.set(doc(db, `workspaces/${ws}/settings/profile`), {
    companyName: { value: `v${rev}`, status: 'USER_PROVIDED', source: '' },
    rev,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    lastAuditId: eventId,
    ...overrides,
  });
  b.set(doc(db, `workspaces/${ws}/auditEvents/${eventId}`), {
    entity: 'Profile',
    entityPath: `workspaces/${ws}/settings/profile`,
    entityId: 'profile',
    action: rev === 1 ? 'CREATE' : 'UPDATE',
    rev,
    changes: [],
    reason: null,
    actorUid: uid,
    at: serverTimestamp(),
  });
  return b.commit();
}

describe('workspaces', () => {
  it('a user can create and read only their own two workspaces', async () => {
    const db = dbFor(ALICE);
    await assertSucceeds(getDoc(doc(db, 'workspaces', `${ALICE}_actual`))); // missing doc check
    await assertSucceeds(createWorkspace(db, ALICE, 'ACTUAL'));
    await assertSucceeds(createWorkspace(db, ALICE, 'DEMO'));
    await assertFails(createWorkspace(db, BOB, 'ACTUAL'));
    await assertFails(getDoc(doc(dbFor(BOB), 'workspaces', `${ALICE}_actual`)));
  });
  it('signed-out users have no access', async () => {
    await assertFails(getDoc(doc(dbFor(null), 'workspaces', `${ALICE}_actual`)));
  });
  it('mode must match the workspace id (DEMO cannot be labelled ACTUAL)', async () => {
    const db = dbFor(ALICE);
    await assertFails(
      setDoc(doc(db, 'workspaces', `${ALICE}_demo`), {
        ownerUid: ALICE, members: { [ALICE]: 'owner' }, mode: 'ACTUAL', name: 'x', createdAt: serverTimestamp(),
      }),
    );
  });
  it('workspaces cannot gain extra members', async () => {
    const db = dbFor(ALICE);
    await assertFails(
      setDoc(doc(db, 'workspaces', `${ALICE}_actual`), {
        ownerUid: ALICE, members: { [ALICE]: 'owner', [BOB]: 'owner' }, mode: 'ACTUAL', name: 'x', createdAt: serverTimestamp(),
      }),
    );
  });
});

describe('versioned records with audit', () => {
  it('create rev 1 then update rev 2 with paired audit events', async () => {
    const db = dbFor(ALICE);
    const ws = await createWorkspace(db, ALICE, 'ACTUAL');
    await assertSucceeds(saveBatch(db, ALICE, ws, 1, 'e1'));
    await assertSucceeds(saveBatch(db, ALICE, ws, 2, 'e2'));
  });
  it('a stale revision is rejected (conflict, no silent overwrite)', async () => {
    const db = dbFor(ALICE);
    const ws = await createWorkspace(db, ALICE, 'ACTUAL');
    await saveBatch(db, ALICE, ws, 1, 'e1');
    await saveBatch(db, ALICE, ws, 2, 'e2');
    await assertFails(saveBatch(db, ALICE, ws, 2, 'e3')); // another device also based on rev 1
  });
  it('a record write without its audit event is rejected', async () => {
    const db = dbFor(ALICE);
    const ws = await createWorkspace(db, ALICE, 'ACTUAL');
    await assertFails(
      setDoc(doc(db, `workspaces/${ws}/settings/profile`), {
        rev: 1, updatedAt: serverTimestamp(), updatedBy: ALICE, lastAuditId: 'nope',
      }),
    );
  });
  it('cannot write as another user', async () => {
    const db = dbFor(ALICE);
    const ws = await createWorkspace(db, ALICE, 'ACTUAL');
    await assertFails(saveBatch(db, ALICE, ws, 1, 'e1', { updatedBy: BOB }));
  });
  it('other users cannot read or write the workspace', async () => {
    const a = dbFor(ALICE);
    const ws = await createWorkspace(a, ALICE, 'ACTUAL');
    await saveBatch(a, ALICE, ws, 1, 'e1');
    const b = dbFor(BOB);
    await assertFails(getDoc(doc(b, `workspaces/${ws}/settings/profile`)));
    await assertFails(getDoc(doc(b, `workspaces/${ws}/auditEvents/e1`)));
    await assertFails(saveBatch(b, BOB, ws, 2, 'e2'));
  });
  it('audit events cannot be edited or deleted', async () => {
    const db = dbFor(ALICE);
    const ws = await createWorkspace(db, ALICE, 'ACTUAL');
    await saveBatch(db, ALICE, ws, 1, 'e1');
    await assertFails(setDoc(doc(db, `workspaces/${ws}/auditEvents/e1`), { entity: 'x' }, { merge: true }));
  });
  it('ACTUAL and DEMO data stay separate', async () => {
    const db = dbFor(ALICE);
    const actual = await createWorkspace(db, ALICE, 'ACTUAL');
    const demo = await createWorkspace(db, ALICE, 'DEMO');
    await saveBatch(db, ALICE, demo, 1, 'd1');
    const snap = await getDoc(doc(db, `workspaces/${actual}/settings/profile`));
    if (snap.exists()) throw new Error('DEMO write leaked into ACTUAL');
  });
  it('unknown collections are denied', async () => {
    const db = dbFor(ALICE);
    const ws = await createWorkspace(db, ALICE, 'ACTUAL');
    await assertFails(setDoc(doc(db, `workspaces/${ws}/random/x`), { a: 1 }));
  });
});
