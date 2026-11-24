import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  doc,
  getDocFromServer,
  type Firestore
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

/**
 * Initialize Firestore with:
 * - explicit databaseId from firebase-applet-config.json (mandatory)
 * - experimentalAutoDetectLongPolling: prevents [code=unavailable] WebChannel drops on
 *   mobile 4G, iOS Safari, WhatsApp in-app browser, proxies, and iframes
 * - persistentLocalCache with multi-tab manager: eliminates redundant full reads on page
 *   reloads and dramatically reduces daily Firestore read unit consumption
 */
function createResilientFirestore(): Firestore {
  const dbId = firebaseConfig.firestoreDatabaseId;
  try {
    return initializeFirestore(
      app,
      {
        experimentalAutoDetectLongPolling: true,
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      dbId
    );
  } catch {
    try {
      return initializeFirestore(
        app,
        {
          experimentalAutoDetectLongPolling: true,
          localCache: memoryLocalCache(),
        },
        dbId
      );
    } catch {
      // Already initialized (e.g. hot reload)
      return getFirestore(app, dbId);
    }
  }
}

export const db = createResilientFirestore();
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

/**
 * Validates connection to Firestore on app startup.
 * Distinguishes offline / quota states from true configuration errors.
 */
export async function testConnection(): Promise<'ok' | 'offline' | 'quota'> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'offline';
  }
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return 'ok';
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : '';
    if (code === 'resource-exhausted' || msg.includes('Quota exceeded') || msg.includes('Quota limit exceeded')) {
      return 'quota';
    }
    if (code === 'unavailable' || msg.includes('the client is offline')) {
      return 'offline';
    }
    // Expected permission-denied or not-found on unmapped 'test/connection' doc means backend is reachable
    return 'ok';
  }
}
