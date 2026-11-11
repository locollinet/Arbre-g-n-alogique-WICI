/**
 * Deep browser cache scanner & photo recovery tool.
 * Scans all available localStorage and IndexedDB stores (including Firestore offline caches)
 * to salvage any photos previously loaded by the user or family members.
 */

import { Person } from '../data/wiciFamily';
import { savePhotoToIndexedDb } from './localPhotoStorage';

export interface RecoveredPhoto {
  personId: string;
  photoDataUrl: string;
  source: string;
}

/**
 * Searches localStorage for any base64 images or legacy family tree structures.
 */
export function scanLocalStorageForPhotos(): Record<string, string> {
  const recovered: Record<string, string> = {};
  if (typeof window === 'undefined' || !window.localStorage) return recovered;

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const val = localStorage.getItem(key);
      if (!val) continue;

      // 1. Direct JSON parse of people arrays
      try {
        const parsed = JSON.parse(val);
        const list = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.people)
          ? parsed.people
          : null;

        if (list) {
          for (const item of list) {
            if (item && item.id && typeof item.photo === 'string' && item.photo.startsWith('data:image/')) {
              recovered[item.id] = item.photo;
            }
          }
        }
      } catch {
        // Not a JSON object, check for embedded data URLs
      }
    }
  } catch (err) {
    console.warn('Scan localStorage error:', err);
  }

  return recovered;
}

/**
 * Deep scan across all browser IndexedDB databases (including internal Firebase/Firestore caches)
 */
export async function deepScanIndexedDbForPhotos(): Promise<Record<string, string>> {
  const recovered: Record<string, string> = {};
  if (typeof window === 'undefined' || !window.indexedDB) return recovered;

  try {
    // If supported, list all databases
    let dbNames: string[] = ['WiciFamilyPhotosDB'];
    if (typeof indexedDB.databases === 'function') {
      try {
        const dbs = await indexedDB.databases();
        for (const d of dbs) {
          if (d.name && !dbNames.includes(d.name)) {
            dbNames.push(d.name);
          }
        }
      } catch {
        // Fallback
      }
    }

    // Inspect each database
    for (const name of dbNames) {
      await new Promise<void>((resolve) => {
        try {
          const req = indexedDB.open(name);
          req.onsuccess = async () => {
            const db = req.result;
            const storeNames = Array.from(db.objectStoreNames);
            for (const sName of storeNames) {
              await new Promise<void>((resStore) => {
                try {
                  const tx = db.transaction(sName, 'readonly');
                  const store = tx.objectStore(sName);
                  const getAllReq = store.getAll();
                  getAllReq.onsuccess = () => {
                    const items = getAllReq.result;
                    if (Array.isArray(items)) {
                      for (const it of items) {
                        if (!it) continue;
                        // Match personPhotos schema
                        if (it.personId && typeof it.photoDataUrl === 'string' && it.photoDataUrl.startsWith('data:image/')) {
                          recovered[it.personId] = it.photoDataUrl;
                        }
                        // Match person object schema
                        if (it.id && typeof it.photo === 'string' && it.photo.startsWith('data:image/')) {
                          recovered[it.id] = it.photo;
                        }
                        // Match raw Firestore document cache representation
                        if (it.data && typeof it.data === 'object') {
                          const d = it.data;
                          if (d.personId && typeof d.photoDataUrl === 'string') {
                            recovered[d.personId] = d.photoDataUrl;
                          }
                        }
                      }
                    }
                    resStore();
                  };
                  getAllReq.onerror = () => resStore();
                } catch {
                  resStore();
                }
              });
            }
            db.close();
            resolve();
          };
          req.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    }
  } catch (err) {
    console.warn('Scan IndexedDB error:', err);
  }

  return recovered;
}

/**
 * Runs a complete recovery pass, salvages every photo found, and persists them into IndexedDB.
 */
export async function runFullPhotoRecovery(
  currentPeople: Person[]
): Promise<{ recoveredCount: number; updatedPeople: Person[] }> {
  const localPhotos = scanLocalStorageForPhotos();
  const idbPhotos = await deepScanIndexedDbForPhotos();

  const allFound: Record<string, string> = { ...localPhotos, ...idbPhotos };
  const foundKeys = Object.keys(allFound);

  if (foundKeys.length === 0) {
    return { recoveredCount: 0, updatedPeople: currentPeople };
  }

  // Persist into our robust IndexedDB
  for (const personId of foundKeys) {
    await savePhotoToIndexedDb({
      personId,
      photoDataUrl: allFound[personId],
      updatedAt: new Date().toISOString(),
    });
  }

  // Update current people
  let count = 0;
  const updated = currentPeople.map((p) => {
    const salvaged = allFound[p.id];
    if (salvaged && !p.photo) {
      count++;
      return { ...p, photo: salvaged };
    }
    return p;
  });

  return { recoveredCount: count, updatedPeople: updated };
}
