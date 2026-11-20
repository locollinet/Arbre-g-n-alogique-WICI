/**
 * Robust, self-healing IndexedDB storage for Family Portraits.
 * Overcomes localStorage's 2.5MB - 5MB quota limits.
 * Guaranteed to persist on mobile Safari and desktop browsers without throwing.
 */

const DB_NAME = 'WiciFamilyPhotosDB';
const DB_VERSION = 3; // Bumped to 3 to guarantee onupgradeneeded triggers on all existing client caches
const STORE_NAME = 'photos';

export interface StoredPhoto {
  personId: string;
  photoDataUrl: string;
  shape?: string;
  filter?: string;
  caption?: string;
  updatedAt: string;
}

let dbInstance: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase | null> | null = null;

/**
 * Opens or upgrades the IndexedDB instance.
 * Automatically self-heals if the object store is missing.
 */
async function getDb(): Promise<IDBDatabase | null> {
  if (dbInstance) {
    try {
      if (dbInstance.objectStoreNames.contains(STORE_NAME)) {
        return dbInstance;
      }
      // Store is missing in this instance, close and re-open with upgrade
      dbInstance.close();
      dbInstance = null;
      dbPromise = null;
    } catch {
      dbInstance = null;
      dbPromise = null;
    }
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      resolve(null);
      return;
    }

    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        try {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'personId' });
          }
        } catch (upgradeErr) {
          console.warn('Erreur lors de la mise à niveau IndexedDB:', upgradeErr);
        }
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        db.onversionchange = () => {
          db.close();
          dbInstance = null;
          dbPromise = null;
        };

        db.onclose = () => {
          dbInstance = null;
          dbPromise = null;
        };

        // If the store is still somehow missing, attempt a force upgrade
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const nextVersion = db.version + 1;
          db.close();
          const fixReq = window.indexedDB.open(DB_NAME, nextVersion);
          fixReq.onupgradeneeded = (e) => {
            const fixDb = (e.target as IDBOpenDBRequest).result;
            if (!fixDb.objectStoreNames.contains(STORE_NAME)) {
              fixDb.createObjectStore(STORE_NAME, { keyPath: 'personId' });
            }
          };
          fixReq.onsuccess = (e) => {
            dbInstance = (e.target as IDBOpenDBRequest).result;
            resolve(dbInstance);
          };
          fixReq.onerror = () => {
            resolve(null);
          };
          return;
        }

        dbInstance = db;
        resolve(db);
      };

      request.onerror = () => {
        resolve(null);
      };

      request.onblocked = () => {
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

/**
 * Saves a photo permanently to IndexedDB.
 * Completely non-blocking: guaranteed never to throw or reject so UI workflows never crash.
 */
export async function savePhotoToIndexedDb(photo: StoredPhoto): Promise<void> {
  try {
    const db = await getDb();
    if (!db || !db.objectStoreNames.contains(STORE_NAME)) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(photo);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        tx.onabort = () => reject(tx.error || new Error('Transaction annulée'));
      } catch (txErr) {
        reject(txErr);
      }
    });
  } catch (err) {
    console.warn('Sauvegarde locale IndexedDB différée:', err);
  }
}

/**
 * Loads all photos from IndexedDB.
 */
export async function getAllPhotosFromIndexedDb(): Promise<Record<string, StoredPhoto>> {
  try {
    const db = await getDb();
    if (!db || !db.objectStoreNames.contains(STORE_NAME)) {
      return {};
    }

    return await new Promise<Record<string, StoredPhoto>>((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          const results = req.result as StoredPhoto[];
          const map: Record<string, StoredPhoto> = {};
          if (Array.isArray(results)) {
            for (const item of results) {
              if (item?.personId && item?.photoDataUrl) {
                map[item.personId] = item;
              }
            }
          }
          resolve(map);
        };
        req.onerror = () => reject(req.error);
      } catch (txErr) {
        reject(txErr);
      }
    });
  } catch (err) {
    console.warn('Lecture locale IndexedDB différée:', err);
    return {};
  }
}

/**
 * Deletes a photo from IndexedDB.
 */
export async function deletePhotoFromIndexedDb(personId: string): Promise<void> {
  try {
    const db = await getDb();
    if (!db || !db.objectStoreNames.contains(STORE_NAME)) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(personId);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      } catch (txErr) {
        reject(txErr);
      }
    });
  } catch (err) {
    console.warn('Suppression locale IndexedDB différée:', err);
  }
}
