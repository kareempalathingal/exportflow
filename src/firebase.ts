import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  type Firestore,
} from 'firebase/firestore';

// Firebase web config is public by design; data is protected by firestore.rules.
// Project: exportflow-89597 (dedicated to ExportFlow; never reuse another app's project).
const firebaseConfig = {
  apiKey: 'AIzaSyDB67CMXuRlIsj1HJsP6l1IlBQXNT_5VVw',
  authDomain: 'exportflow-89597.firebaseapp.com',
  projectId: 'exportflow-89597',
  storageBucket: 'exportflow-89597.firebasestorage.app',
  messagingSenderId: '292425381685',
  appId: '1:292425381685:web:4ce36e2a048cdfb6cbbe7c',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

function createFirestore(): { db: Firestore; offlineCache: boolean } {
  try {
    return {
      db: initializeFirestore(app, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      }),
      offlineCache: true,
    };
  } catch {
    // e.g. IndexedDB unavailable (private window): online-only mode.
    return { db: initializeFirestore(app, { localCache: memoryLocalCache() }), offlineCache: false };
  }
}

const created = createFirestore();
export const db = created.db;
export const offlineCacheEnabled = created.offlineCache;
