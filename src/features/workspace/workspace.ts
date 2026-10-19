import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { workspaceIdFor, type AppMode } from '../../lib/mode';

/** Create the user's ACTUAL and DEMO workspaces on first sign-in. */
export async function ensureWorkspaces(uid: string): Promise<void> {
  for (const mode of ['ACTUAL', 'DEMO'] as AppMode[]) {
    const id = workspaceIdFor(uid, mode);
    const ref = doc(db, 'workspaces', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ownerUid: uid,
        members: { [uid]: 'owner' },
        mode,
        name: mode === 'ACTUAL' ? 'ExportFlow' : 'ExportFlow (Demo)',
        createdAt: serverTimestamp(),
      });
    }
  }
}
