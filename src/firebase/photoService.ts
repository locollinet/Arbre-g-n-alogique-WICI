import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  getDoc,
  onSnapshot
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { OperationType, handleFirestoreError } from './errors';

export interface PersonPhotoRecord {
  personId: string;
  photoDataUrl: string;
  shape?: 'circle' | 'oval' | 'portrait' | 'square';
  filter?: 'none' | 'sepia' | 'bw' | 'warm';
  caption?: string;
  updatedAt: string;
  uploadedBy?: string;
}

const COLLECTION_NAME = 'personPhotos';

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
}): Promise<PersonPhotoRecord> {
  const validPersonId = sanitizePersonId(params.personId);

  // Bound check according to firebase-blueprint.json (max 500k characters)
  if (!params.photoDataUrl || params.photoDataUrl.length < 10) {
    throw new Error('Image manquante ou invalide.');
  }
  if (params.photoDataUrl.length > 500000) {
    throw new Error("L'image compressée dépasse la limite autorisée (500 Ko).");
  }

  const record: PersonPhotoRecord = {
    personId: validPersonId,
    photoDataUrl: params.photoDataUrl,
    shape: params.shape || 'circle',
    filter: params.filter || 'none',
    caption: params.caption ? params.caption.slice(0, 256) : '',
    updatedAt: new Date().toISOString(),
  };

  const currentUser = auth.currentUser;
  if (currentUser?.uid) {
    record.uploadedBy = currentUser.uid;
  }

  const docRef = doc(db, COLLECTION_NAME, validPersonId);
  try {
    await setDoc(docRef, record);
    return record;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${COLLECTION_NAME}/${validPersonId}`);
  }
}

/**
 * Deletes a person's photo from Firestore
 */
export async function deletePersonPhotoFromFirestore(personId: string): Promise<void> {
  const validPersonId = sanitizePersonId(personId);
  const docRef = doc(db, COLLECTION_NAME, validPersonId);
  try {
    await deleteDoc(docRef);
  } catch (error) {
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
    handleFirestoreError(error, OperationType.GET, `${COLLECTION_NAME}/${validPersonId}`);
  }
}

/**
 * Gets all stored person photos from Firestore
 */
export async function getAllPersonPhotosFromFirestore(): Promise<Record<string, PersonPhotoRecord>> {
  const colRef = collection(db, COLLECTION_NAME);
  try {
    const snap = await getDocs(colRef);
    const result: Record<string, PersonPhotoRecord> = {};
    snap.forEach((docSnap) => {
      const data = docSnap.data() as PersonPhotoRecord;
      result[data.personId] = data;
    });
    return result;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAME);
  }
}

/**
 * Real-time listener for all person photos in the family tree
 */
export function subscribeToPersonPhotos(
  onUpdate: (photosMap: Record<string, PersonPhotoRecord>, fromCache: boolean) => void,
  onError?: (err: Error) => void
): () => void {
  const colRef = collection(db, COLLECTION_NAME);
  return onSnapshot(
    colRef,
    { includeMetadataChanges: true },
    (snapshot) => {
      const map: Record<string, PersonPhotoRecord> = {};
      snapshot.forEach((docSnap) => {
        const item = docSnap.data() as PersonPhotoRecord;
        if (item.personId && item.photoDataUrl) {
          map[item.personId] = item;
        }
      });
      onUpdate(map, snapshot.metadata.fromCache);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, COLLECTION_NAME);
      } catch (e) {
        if (onError && e instanceof Error) onError(e);
      }
    }
  );
}
