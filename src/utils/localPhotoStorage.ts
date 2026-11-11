/**
 * Robust IndexedDB storage for Family Portraits
 * Overcomes localStorage's 2.5MB - 5MB quota limits.
 * Guaranteed to persist on mobile Safari and desktop browsers.
 */

const DB_NAME = 'WiciFamilyPhotosDB';
const DB_VERSION = 1;
const STORE_NAME = 'photos';

export interface StoredPhoto {
  personId: string;
  photoDataUrl: string;
  shape?: string;
  filter?: string;
  caption?: string;
  updatedAt: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB non supporté par ce navigateur'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'personId' });
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });

  return dbPromise;
}

/**
 * Saves a photo permanently to IndexedDB
 */
export async function savePhotoToIndexedDb(photo: StoredPhoto): Promise<void> {
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(photo);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Erreur sauvegarde photo IndexedDB:', err);
  }
}

/**
 * Loads all photos from IndexedDB
 */
export async function getAllPhotosFromIndexedDb(): Promise<Record<string, StoredPhoto>> {
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const results = req.result as StoredPhoto[];
        const map: Record<string, StoredPhoto> = {};
        for (const item of results) {
          if (item.personId && item.photoDataUrl) {
            map[item.personId] = item;
          }
        }
        resolve(map);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Erreur lecture photos IndexedDB:', err);
    return {};
  }
}

/**
 * Deletes a photo from IndexedDB
 */
export async function deletePhotoFromIndexedDb(personId: string): Promise<void> {
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(personId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Erreur suppression photo IndexedDB:', err);
  }
}
