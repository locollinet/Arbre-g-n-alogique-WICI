import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  getDoc,
  onSnapshot,
  query,
  where,
  runTransaction
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { OperationType, handleFirestoreError, isQuotaExceededError } from './errors';
import { Person, TreeSettings, DEFAULT_SETTINGS } from '../data/wiciFamily';
import {
  ArchiveState,
  SyncOperation,
  reconcileArchiveWithOutbox,
  stripPeopleForStorage
} from '../utils/syncEngine';

export interface PersonPhotoRecord {
  personId: string;
  photoDataUrl: string;
  shape?: 'circle' | 'oval' | 'portrait' | 'square';
  filter?: 'none' | 'sepia' | 'bw' | 'warm';
  caption?: string;
  updatedAt: string;
  uploadedBy?: string;
}

export interface FamilyArchiveRecord {
  people: Person[];
  settings?: Partial<TreeSettings>;
  updatedAt: string;
}

const COLLECTION_NAME = 'personPhotos';
const ARCHIVE_COLLECTION = 'familyArchive';
const ARCHIVE_DOC_ID = 'main';

// Circuit breaker: once Firestore reports daily quota exhaustion, pause automatic background
// writes so the SDK never enters an infinite backoff retry loop. Can be explicitly reset
// by the user via manual retry or after cooldown.
let firestoreWriteQuotaExceeded = false;
let quotaExceededAtMs = 0;
const QUOTA_AUTO_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes before allowing automatic retry

export function isFirestoreWriteQuotaExceeded(): boolean {
  if (firestoreWriteQuotaExceeded && Date.now() - quotaExceededAtMs > QUOTA_AUTO_COOLDOWN_MS) {
    firestoreWriteQuotaExceeded = false;
    quotaExceededAtMs = 0;
  }
  return firestoreWriteQuotaExceeded;
}

export function markFirestoreQuotaExceeded(): void {
  firestoreWriteQuotaExceeded = true;
  quotaExceededAtMs = Date.now();
}

export function resetFirestoreQuotaBreaker(): void {
  firestoreWriteQuotaExceeded = false;
  quotaExceededAtMs = 0;
}

function assertWriteQuotaAvailable(path: string): void {
  if (isFirestoreWriteQuotaExceeded()) {
    throw new Error(`FIRESTORE_WRITE_QUOTA_EXCEEDED (${path})`);
  }
}

/**
 * Validates personId matches security requirements (alphanumeric, dash, underscore, max 128)
 */
function sanitizePersonId(personId: string): string {
  const clean = personId.trim();
  if (!/^[a-zA-Z0-9_\-]+$/.test(clean) || clean.length > 128) {
    throw new Error(`Identifiant de personne invalide pour Firestore: "${clean}"`);
  }
  return clean;
}

/**
 * Saves a cropped photo to Firestore
 */
export async function savePersonPhotoToFirestore(params: {
  personId: string;
  photoDataUrl: string;
  shape?: 'circle' | 'oval' | 'portrait' | 'square';
  filter?: 'none' | 'sepia' | 'bw' | 'warm';
  caption?: string;
  updatedAt?: string;
}): Promise<PersonPhotoRecord> {
  const validPersonId = sanitizePersonId(params.personId);

  // Bound check according to firebase-blueprint.json (max 1000k characters)
  if (!params.photoDataUrl || params.photoDataUrl.length < 10) {
    throw new Error('Image manquante ou invalide.');
  }
  if (params.photoDataUrl.length > 1000000) {
    throw new Error("L'image compressée dépasse la limite autorisée (1 Mo).");
  }

  const record: PersonPhotoRecord = {
    personId: validPersonId,
    photoDataUrl: params.photoDataUrl,
    shape: params.shape || 'circle',
    filter: params.filter || 'none',
    caption: params.caption ? params.caption.slice(0, 256) : '',
    updatedAt: params.updatedAt || new Date().toISOString(),
  };

  const currentUser = auth.currentUser;
  if (currentUser?.uid) {
    record.uploadedBy = currentUser.uid;
  }

  const docRef = doc(db, COLLECTION_NAME, validPersonId);
  assertWriteQuotaAvailable(`${COLLECTION_NAME}/${validPersonId}`);
  try {
    await setDoc(docRef, record);
    return record;
  } catch (error) {
    if (isQuotaExceededError(error)) {
      markFirestoreQuotaExceeded();
    }
    handleFirestoreError(error, OperationType.WRITE, `${COLLECTION_NAME}/${validPersonId}`);
  }
}

/**
 * Deletes a person's photo from Firestore
 */
export async function deletePersonPhotoFromFirestore(personId: string): Promise<void> {
  const validPersonId = sanitizePersonId(personId);
  const docRef = doc(db, COLLECTION_NAME, validPersonId);
  assertWriteQuotaAvailable(`${COLLECTION_NAME}/${validPersonId}`);
  try {
    await deleteDoc(docRef);
  } catch (error) {
    if (isQuotaExceededError(error)) {
      markFirestoreQuotaExceeded();
    }
    handleFirestoreError(error, OperationType.DELETE, `${COLLECTION_NAME}/${validPersonId}`);
  }
}

/**
 * Gets a single person's photo from Firestore
 */
export async function getPersonPhotoFromFirestore(personId: string): Promise<PersonPhotoRecord | null> {
  const validPersonId = sanitizePersonId(personId);
  const docRef = doc(db, COLLECTION_NAME, validPersonId);
  try {
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return snap.data() as PersonPhotoRecord;
  } catch (error) {
    if (isQuotaExceededError(error)) {
      markFirestoreQuotaExceeded();
    }
    handleFirestoreError(error, OperationType.GET, `${COLLECTION_NAME}/${validPersonId}`);
  }
}

/**
 * Gets all stored person photos from Firestore (use sparingly — prefer delta listener)
 */
export async function getAllPersonPhotosFromFirestore(): Promise<Record<string, PersonPhotoRecord>> {
  const colRef = collection(db, COLLECTION_NAME);
  try {
    const snap = await getDocs(colRef);
    const result: Record<string, PersonPhotoRecord> = {};
    snap.forEach((docSnap) => {
      const data = docSnap.data() as PersonPhotoRecord;
      if (data?.personId && data?.photoDataUrl) {
        result[data.personId] = data;
      }
    });
    return result;
  } catch (error) {
    if (isQuotaExceededError(error)) {
      markFirestoreQuotaExceeded();
    }
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAME);
  }
}

/**
 * Real-time listener for person photos in the family tree.
 * When `sinceUpdatedAt` is provided (returning device with populated IndexedDB),
 * queries ONLY photos updated after `sinceUpdatedAt` — reducing read units from
 * thousands per reload down to 0 when no new photo has been uploaded!
 */
export function subscribeToPersonPhotos(
  onUpdate: (
    photosDeltaMap: Record<string, PersonPhotoRecord>,
    meta: { fromCache: boolean; isFullSnapshot: boolean; maxUpdatedAt: string | null }
  ) => void,
  onError?: (err: Error) => void,
  sinceUpdatedAt?: string | null
): () => void {
  const colRef = collection(db, COLLECTION_NAME);
  const isFullSnapshot = !sinceUpdatedAt;
  const targetQuery = sinceUpdatedAt
    ? query(colRef, where('updatedAt', '>', sinceUpdatedAt))
    : colRef;

  return onSnapshot(
    targetQuery,
    (snapshot) => {
      const map: Record<string, PersonPhotoRecord> = {};
      let maxUpdatedAt: string | null = sinceUpdatedAt || null;
      snapshot.forEach((docSnap) => {
        const item = docSnap.data() as PersonPhotoRecord;
        if (item?.personId && item?.photoDataUrl) {
          map[item.personId] = item;
          if (item.updatedAt && (!maxUpdatedAt || item.updatedAt > maxUpdatedAt)) {
            maxUpdatedAt = item.updatedAt;
          }
        }
      });
      onUpdate(map, {
        fromCache: snapshot.metadata.fromCache,
        isFullSnapshot,
        maxUpdatedAt,
      });
    },
    (error) => {
      if (isQuotaExceededError(error)) {
        markFirestoreQuotaExceeded();
      }
      try {
        handleFirestoreError(error, OperationType.LIST, COLLECTION_NAME);
      } catch (e) {
        if (onError && e instanceof Error) onError(e);
      }
    }
  );
}

/**
 * Atomically commits a batch of SyncOperations to Firestore (familyArchive/main)
 * inside a Firestore transaction.
 *
 * Why this eliminates partial saves & clobbered edits permanently:
 * - Reads the latest live server document before applying our pending operations
 * - Merges ONLY the modified person(s) / explicit relationship deltas / settings
 * - If another family member edits a different person concurrently, Firestore
 *   automatically retries the transaction so BOTH edits are preserved!
 * - Batches multiple rapid edits into a single Firestore write.
 */
export async function commitOperationsToFirestore(
  ops: SyncOperation[],
  fallbackArchive: ArchiveState
): Promise<FamilyArchiveRecord> {
  const docPath = `${ARCHIVE_COLLECTION}/${ARCHIVE_DOC_ID}`;
  assertWriteQuotaAvailable(docPath);
  const docRef = doc(db, ARCHIVE_COLLECTION, ARCHIVE_DOC_ID);

  try {
    const committed = await runTransaction(db, async (tx) => {
      const snap = await tx.get(docRef);
      const serverState: ArchiveState = snap.exists()
        ? {
            people: Array.isArray((snap.data() as FamilyArchiveRecord).people)
              ? (snap.data() as FamilyArchiveRecord).people
              : fallbackArchive.people,
            settings: {
              ...DEFAULT_SETTINGS,
              ...((snap.data() as FamilyArchiveRecord).settings || {}),
            },
          }
        : {
            people: stripPeopleForStorage(fallbackArchive.people),
            settings: { ...DEFAULT_SETTINGS, ...fallbackArchive.settings },
          };

      const nextState = reconcileArchiveWithOutbox(serverState, ops);
      const cleanPeople = stripPeopleForStorage(nextState.people).slice(0, 500);
      if (cleanPeople.length === 0) {
        throw new Error('Archive vide refusée pour préserver la sécurité des données.');
      }

      const record: FamilyArchiveRecord = {
        people: cleanPeople,
        settings: JSON.parse(JSON.stringify(nextState.settings)),
        updatedAt: new Date().toISOString(),
      };

      tx.set(docRef, record);
      return record;
    });

    return committed;
  } catch (error) {
    if (isQuotaExceededError(error)) {
      markFirestoreQuotaExceeded();
    }
    handleFirestoreError(error, OperationType.WRITE, docPath);
  }
}

/**
 * Saves the complete family tree structure and settings to Firestore (familyArchive/main)
 * Used only for initial seeding when the server document does not exist yet.
 */
export async function saveFamilyArchiveToFirestore(
  people: Person[],
  settings?: TreeSettings
): Promise<FamilyArchiveRecord> {
  const docRef = doc(db, ARCHIVE_COLLECTION, ARCHIVE_DOC_ID);
  const record: FamilyArchiveRecord = {
    people: stripPeopleForStorage(people).slice(0, 500),
    updatedAt: new Date().toISOString(),
  };
  if (settings) {
    record.settings = JSON.parse(JSON.stringify(settings));
  }
  assertWriteQuotaAvailable(`${ARCHIVE_COLLECTION}/${ARCHIVE_DOC_ID}`);
  try {
    await setDoc(docRef, record);
    return record;
  } catch (error) {
    if (isQuotaExceededError(error)) {
      markFirestoreQuotaExceeded();
    }
    handleFirestoreError(error, OperationType.WRITE, `${ARCHIVE_COLLECTION}/${ARCHIVE_DOC_ID}`);
  }
}

/**
 * Real-time listener for the family tree archive in Firestore.
 * If the document doesn't exist yet on the server, onMissing() is called so the app can seed it automatically.
 */
export function subscribeToFamilyArchive(
  onUpdate: (record: FamilyArchiveRecord, meta: { fromCache: boolean; hasPendingWrites: boolean }) => void,
  onMissing?: () => void,
  onError?: (err: Error) => void
): () => void {
  const docRef = doc(db, ARCHIVE_COLLECTION, ARCHIVE_DOC_ID);
  return onSnapshot(
    docRef,
    { includeMetadataChanges: true },
    (snapshot) => {
      if (!snapshot.exists()) {
        if (!snapshot.metadata.fromCache && onMissing) {
          onMissing();
        }
        return;
      }
      const data = snapshot.data() as FamilyArchiveRecord;
      if (data && Array.isArray(data.people) && data.people.length > 0) {
        onUpdate(data, {
          fromCache: snapshot.metadata.fromCache,
          hasPendingWrites: snapshot.metadata.hasPendingWrites,
        });
      }
    },
    (error) => {
      if (isQuotaExceededError(error)) {
        markFirestoreQuotaExceeded();
      }
      try {
        handleFirestoreError(error, OperationType.GET, `${ARCHIVE_COLLECTION}/${ARCHIVE_DOC_ID}`);
      } catch (e) {
        if (onError && e instanceof Error) onError(e);
      }
    }
  );
}
