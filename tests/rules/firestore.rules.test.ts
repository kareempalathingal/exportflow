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

async function deleteDocLater(db: Firestore, path: string) {
  const { deleteDoc } = await import('firebase/firestore');
  return deleteDoc(doc(db, path));
}

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
  it('masters: create, update, never delete; base unit fixed', async () => {
    const db = dbFor(ALICE);
    const ws = await createWorkspace(db, ALICE, 'ACTUAL');
    const write = (coll: string, id: string, rev: number, ev: string, data: Record<string, unknown>) => {
      const b = writeBatch(db);
      b.set(doc(db, `workspaces/${ws}/${coll}/${id}`), { ...data, rev, updatedAt: serverTimestamp(), updatedBy: ALICE, lastAuditId: ev });
      b.set(doc(db, `workspaces/${ws}/auditEvents/${ev}`), {
        entity: coll, entityPath: `workspaces/${ws}/${coll}/${id}`, entityId: id, action: rev === 1 ? 'CREATE' : 'UPDATE',
        rev, changes: [], reason: null, actorUid: ALICE, at: serverTimestamp(),
      });
      return b.commit();
    };
    const product = { name: 'Mat', active: true, baseUnit: 'pcs', supplyType: 'MANUFACTURED' };
    await assertSucceeds(write('products', 'p1', 1, 'a1', product));
    await assertSucceeds(write('products', 'p1', 2, 'a2', { ...product, active: false }));
    await assertFails(write('products', 'p1', 3, 'a3', { ...product, baseUnit: 'sqm' }));
    await assertFails(write('products', 'p2', 1, 'a4', { ...product, name: '' }));
    await assertFails(write('products', 'p3', 1, 'a5', { ...product, supplyType: 'OTHER' }));
    await assertSucceeds(write('rawMaterials', 'r1', 1, 'a6', { name: 'Fibre', active: true, baseUnit: 'kg' }));
    await assertSucceeds(write('customers', 'c1', 1, 'a7', { name: 'Buyer', active: true }));
    await assertSucceeds(write('boms', 'p1', 1, 'a8', { productId: 'p1', lines: [], notes: '' }));
    await assertFails(write('boms', 'p9', 1, 'a9', { productId: 'p1', lines: [], notes: '' }));
    await assertSucceeds(write('suppliers', 's1', 1, 'a10', { name: 'Fibre Co', active: true, items: ['RAW_MATERIAL:r1'] }));
    await assertSucceeds(write('suppliers', 's1', 2, 'a11', { name: 'Fibre Co', active: false, items: [] }));
    await assertFails(write('suppliers', 's2', 1, 'a12', { name: 'No items field', active: true }));
    await assertFails(deleteDocLater(db, `workspaces/${ws}/suppliers/s1`));
    await assertSucceeds(write('processes', 'pr1', 1, 'a13', { name: 'Bleaching', active: true, notes: '' }));
    await assertSucceeds(write('settings', 'calendar', 1, 'a16', { weeklyOff: [0], holidays: { '2026-11-08': 'Diwali' } }));
    await assertSucceeds(write('settings', 'calendar', 2, 'a17', { weeklyOff: [0], holidays: {} }));
    await assertFails(write('settings', 'calendar', 3, 'a18', { weeklyOff: [0, 1, 2, 3, 4, 5, 6], holidays: {} }));
    await assertFails(write('settings', 'calendar', 3, 'a19', { weeklyOff: 'Sunday', holidays: {} }));
    await assertFails(write('processes', 'pr2', 1, 'a14', { name: '', active: true, notes: '' }));
    await assertFails(deleteDocLater(db, `workspaces/${ws}/processes/pr1`));
    await assertSucceeds(write('products', 'p1', 3, 'a15', { ...product, route: [{ processId: 'pr1', plannedDays: { value: 2, status: 'USER_PROVIDED', source: '' } }], routeConfirmed: false }));
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, `workspaces/${ws}/products/p1`)));
    await assertFails(getDoc(doc(dbFor(BOB), `workspaces/${ws}/products/p1`)));
  });
  it('job orders: draft first, allowed transitions, reasons, no delete', async () => {
    const db = dbFor(ALICE);
    const ws = await createWorkspace(db, ALICE, 'ACTUAL');
    const write = (rev: number, ev: string, data: Record<string, unknown>, reason: string | null = null) => {
      const b = writeBatch(db);
      b.set(doc(db, `workspaces/${ws}/jobOrders/j1`), { ...data, rev, updatedAt: serverTimestamp(), updatedBy: ALICE, lastAuditId: ev });
      b.set(doc(db, `workspaces/${ws}/auditEvents/${ev}`), {
        entity: 'Job Order', entityPath: `workspaces/${ws}/jobOrders/j1`, entityId: 'j1', action: rev === 1 ? 'CREATE' : 'UPDATE',
        rev, changes: [], reason, actorUid: ALICE, at: serverTimestamp(),
      });
      return b.commit();
    };
    const jo = {
      joNumber: 'JO-1', customerId: 'c1', customerName: 'Buyer', poNumber: '', receivedDate: '2026-11-01', deliveryDate: '2026-12-30',
      deliveryDateType: 'PORT', status: 'DRAFT', lines: [], notes: '', bomSnapshot: null, confirmedOn: null,
      deadline: { orderPeriodDays: 59, bufferDays: 6, internalDeadline: '2026-12-24', ruleVersion: 'buffer-10pct-ceil-min1/v1' },
    };
    await assertFails(write(1, 'b0', { ...jo, status: 'CONFIRMED', bomSnapshot: {} })); // must start as Draft
    await assertFails(write(1, 'b1', { ...jo, deliveryDate: '2026-11-01' })); // delivery after received
    await assertFails(write(1, 'b2', { ...jo, deadline: { ...jo.deadline, internalDeadline: '2027-01-05' } }));
    await assertSucceeds(write(1, 'b3', jo));
    await assertFails(write(2, 'b4', { ...jo, status: 'COMPLETED', bomSnapshot: {} })); // Draft cannot jump to Completed
    await assertFails(write(2, 'b5', { ...jo, status: 'CONFIRMED' })); // confirm needs the BOM snapshot
    await assertSucceeds(write(2, 'b6', { ...jo, status: 'CONFIRMED', bomSnapshot: {} }));
    await assertSucceeds(write(3, 'b7', { ...jo, status: 'CONFIRMED', bomSnapshot: {}, notes: 'x' })); // edits: reason optional
    await assertSucceeds(write(4, 'b8', { ...jo, status: 'CONFIRMED', bomSnapshot: {}, notes: 'y' }, 'Customer changed date'));
    await assertSucceeds(write(5, 'b9', { ...jo, status: 'COMPLETED', bomSnapshot: {} }));
    await assertFails(write(6, 'c1', { ...jo, status: 'COMPLETED', bomSnapshot: {}, notes: 'z' }, 'x')); // completed is read-only
    await assertFails(write(6, 'c2', { ...jo, status: 'CONFIRMED', bomSnapshot: {} })); // reopen needs a reason
    await assertSucceeds(write(6, 'c3', { ...jo, status: 'CONFIRMED', bomSnapshot: {} }, 'Short shipment'));
    await assertFails(write(7, 'c4', { ...jo, status: 'CANCELLED', bomSnapshot: {} }));
    await assertSucceeds(write(7, 'c5', { ...jo, status: 'CANCELLED', bomSnapshot: {} }, 'Customer cancelled'));
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, `workspaces/${ws}/jobOrders/j1`)));
    await assertFails(getDoc(doc(dbFor(BOB), `workspaces/${ws}/jobOrders/j1`)));
  });
  it('stock counts: validated, one per item, never deleted', async () => {
    const db = dbFor(ALICE);
    const ws = await createWorkspace(db, ALICE, 'ACTUAL');
    const write = (id: string, rev: number, ev: string, data: Record<string, unknown>) => {
      const b = writeBatch(db);
      b.set(doc(db, `workspaces/${ws}/stockCounts/${id}`), { ...data, rev, updatedAt: serverTimestamp(), updatedBy: ALICE, lastAuditId: ev });
      b.set(doc(db, `workspaces/${ws}/auditEvents/${ev}`), {
        entity: 'Stock count', entityPath: `workspaces/${ws}/stockCounts/${id}`, entityId: id, action: rev === 1 ? 'CREATE' : 'UPDATE',
        rev, changes: [], reason: null, actorUid: ALICE, at: serverTimestamp(),
      });
      return b.commit();
    };
    const count = { itemType: 'RAW_MATERIAL', itemId: 'r1', qty: 1200, unit: 'kg', countedOn: '2026-10-15', notes: '' };
    await assertSucceeds(write('RAW_MATERIAL_r1', 1, 's1', count));
    await assertSucceeds(write('RAW_MATERIAL_r1', 2, 's2', { ...count, qty: 0 }));
    await assertFails(write('RAW_MATERIAL_r1', 3, 's3', { ...count, qty: -5 }));
    await assertFails(write('RAW_MATERIAL_r9', 1, 's4', count)); // id must match the item
    await assertFails(write('PRODUCT_r1', 1, 's5', { ...count, itemType: 'OTHER' }));
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, `workspaces/${ws}/stockCounts/RAW_MATERIAL_r1`)));
    await assertFails(getDoc(doc(dbFor(BOB), `workspaces/${ws}/stockCounts/RAW_MATERIAL_r1`)));
  });
  it('DEMO sample data passes every rule', async () => {
    const { buildSampleData } = await import('../../src/lib/sampleData');
    const db = dbFor(ALICE);
    const ws = await createWorkspace(db, ALICE, 'DEMO');
    let n = 0;
    for (const w of buildSampleData('2026-10-20')) {
      const rev = (w.before?.rev ?? 0) + 1;
      const ev = `sample${n++}`;
      const b = writeBatch(db);
      b.set(doc(db, `workspaces/${ws}/${w.collection}/${w.docId}`), { ...w.data, rev, updatedAt: serverTimestamp(), updatedBy: ALICE, lastAuditId: ev });
      b.set(doc(db, `workspaces/${ws}/auditEvents/${ev}`), {
        entity: w.entity, entityPath: `workspaces/${ws}/${w.collection}/${w.docId}`, entityId: w.docId, action: rev === 1 ? 'CREATE' : 'UPDATE',
        rev, changes: [], reason: w.reason ?? null, actorUid: ALICE, at: serverTimestamp(),
      });
      await assertSucceeds(b.commit());
    }
  });
  it('unknown collections are denied', async () => {
    const db = dbFor(ALICE);
    const ws = await createWorkspace(db, ALICE, 'ACTUAL');
    await assertFails(setDoc(doc(db, `workspaces/${ws}/random/x`), { a: 1 }));
  });
});
