import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import type { Tracked } from '../../lib/dataStatus';
import type { VersionedRecord } from '../sync/records';

export interface Profile extends VersionedRecord {
  companyName: Tracked<string>;
  /** Shown as "Prepared by" on plan documents. */
  preparedByName?: string;
  preparedByDesignation?: string;
  /** Planning benchmark (received → confirmed), working days; missing = 1, null = not set. */
  planningDays?: number | null;
}

export interface ProfileState {
  profile: Profile | null;
  loading: boolean;
  pendingWrite: boolean;
  fromCache: boolean;
  error: string | null;
}

export const PROFILE_COLLECTION = 'settings';
export const PROFILE_DOC = 'profile';

export function useProfile(workspaceId: string | null): ProfileState {
  const [state, setState] = useState<ProfileState>({
    profile: null,
    loading: true,
    pendingWrite: false,
    fromCache: false,
    error: null,
  });

  useEffect(() => {
    if (!workspaceId) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    const ref = doc(db, `workspaces/${workspaceId}/${PROFILE_COLLECTION}/${PROFILE_DOC}`);
    return onSnapshot(
      ref,
      { includeMetadataChanges: true },
      (snap) =>
        setState({
          profile: snap.exists() ? (snap.data() as Profile) : null,
          loading: false,
          pendingWrite: snap.metadata.hasPendingWrites,
          fromCache: snap.metadata.fromCache,
          error: null,
        }),
      (err) => setState((s) => ({ ...s, loading: false, error: err.code })),
    );
  }, [workspaceId]);

  return state;
}
