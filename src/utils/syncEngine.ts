import { Person, TreeSettings, DEFAULT_SETTINGS } from '../data/wiciFamily';

export const OUTBOX_STORAGE_KEY = 'wici-sync-outbox-v1';
export const PENDING_PHOTOS_STORAGE_KEY = 'wici-pending-photos-v1';
export const LAST_PHOTO_SYNC_KEY = 'wici-last-photo-sync-v1';

export interface ArchiveState {
  people: Person[];
  settings: TreeSettings;
}

export type SyncOperation =
  | {
      opId: string;
      createdAt: string;
      type: 'UPSERT_PERSON';
      person: Person;
      attachChildIds?: string[];
      detachChildIds?: string[];
      attachSpouseIds?: string[];
      detachSpouseIds?: string[];
    }
  | {
      opId: string;
      createdAt: string;
      type: 'DELETE_PERSON';
      personId: string;
    }
  | {
      opId: string;
      createdAt: string;
      type: 'UPDATE_SETTINGS';
      partial: Partial<TreeSettings>;
    }
  | {
      opId: string;
      createdAt: string;
      type: 'RESET_SETTINGS';
      settings: TreeSettings;
    }
  | {
      opId: string;
      createdAt: string;
      type: 'REPLACE_ARCHIVE';
      people: Person[];
      settings?: TreeSettings;
    };

export interface PendingPhotoOperation {
  personId: string;
  action: 'upsert' | 'delete';
  updatedAt: string;
}

export function createOpId(): string {
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Strips heavy base64 photo strings and undefined fields from a Person
 * so both Firestore (familyArchive/main) and localStorage stay tiny (~10KB).
 */
export function stripPersonForStorage(p: Person): Person {
  const clean: Person = {
    id: String(p.id || '').trim(),
    first: typeof p.first === 'string' ? p.first : '',
    last: typeof p.last === 'string' ? p.last : '',
    parents: Array.isArray(p.parents)
      ? Array.from(new Set(p.parents.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)))
      : [],
  };
  if (typeof p.maidenName === 'string' && p.maidenName.trim()) clean.maidenName = p.maidenName.trim();
  if (typeof p.birth === 'string' && p.birth.trim()) clean.birth = p.birth.trim();
  if (typeof p.death === 'string' && p.death.trim()) clean.death = p.death.trim();
  if (typeof p.location === 'string' && p.location.trim()) clean.location = p.location.trim();
  if (typeof p.occupation === 'string' && p.occupation.trim()) clean.occupation = p.occupation.trim();
  if (Array.isArray(p.spouses)) {
    const cleanSpouses = Array.from(
      new Set(p.spouses.filter((id): id is string => typeof id === 'string' && id.trim().length > 0 && id !== clean.id))
    );
    if (cleanSpouses.length > 0) clean.spouses = cleanSpouses;
  }
  if (typeof p.notes === 'string' && p.notes.trim()) clean.notes = p.notes.trim();
  return clean;
}

export function stripPeopleForStorage(people: Person[]): Person[] {
  return people.map(stripPersonForStorage);
}

/**
 * Sanitizes referential integrity across an archive (removes dangling parent/spouse IDs
 * and deduplicates arrays) so concurrent deletions on another device never block a transaction.
 */
export function sanitizeArchivePeople(people: Person[]): Person[] {
  const validIds = new Set(people.map((p) => p.id));
  return people.map((raw) => {
    const p = stripPersonForStorage(raw);
    const parents = p.parents.filter((id) => id !== p.id && validIds.has(id));
    const spouses = (p.spouses || []).filter((id) => id !== p.id && validIds.has(id));
    const next: Person = {
      ...p,
      parents,
    };
    if (spouses.length > 0) {
      next.spouses = spouses;
    } else {
      delete next.spouses;
    }
    return next;
  });
}

/**
 * Computes an atomic UPSERT_PERSON operation with explicit child & spouse deltas
 * relative to the current list of people, so concurrent additions on another device
 * are NEVER accidentally detached when merging in a Firestore transaction.
 */
export function buildUpsertPersonOp(
  prevPeople: Person[],
  updated: Person,
  childIdsToAttach?: string[]
): Extract<SyncOperation, { type: 'UPSERT_PERSON' }> {
  const cleanPerson = stripPersonForStorage(updated);
  const prevPerson = prevPeople.find((p) => p.id === cleanPerson.id);

  let attachChildIds: string[] | undefined;
  let detachChildIds: string[] | undefined;

  if (childIdsToAttach) {
    const prevChildIds = new Set(
      prevPeople
        .filter((p) => p.id !== cleanPerson.id && (p.parents || []).includes(cleanPerson.id))
        .map((p) => p.id)
    );
    const nextChildIds = new Set(childIdsToAttach.filter((id) => id !== cleanPerson.id));

    const added = Array.from(nextChildIds).filter((id) => !prevChildIds.has(id));
    const removed = Array.from(prevChildIds).filter((id) => !nextChildIds.has(id));
    if (added.length > 0) attachChildIds = added;
    if (removed.length > 0) detachChildIds = removed;
  }

  const prevSpouses = new Set(prevPerson?.spouses || []);
  const nextSpouses = new Set(cleanPerson.spouses || []);
  const attachSpouseIds = Array.from(nextSpouses).filter((id) => !prevSpouses.has(id));
  const detachSpouseIds = Array.from(prevSpouses).filter((id) => !nextSpouses.has(id));

  const op: Extract<SyncOperation, { type: 'UPSERT_PERSON' }> = {
    opId: createOpId(),
    createdAt: new Date().toISOString(),
    type: 'UPSERT_PERSON',
    person: cleanPerson,
  };
  if (attachChildIds && attachChildIds.length > 0) op.attachChildIds = attachChildIds;
  if (detachChildIds && detachChildIds.length > 0) op.detachChildIds = detachChildIds;
  if (attachSpouseIds.length > 0) op.attachSpouseIds = attachSpouseIds;
  if (detachSpouseIds.length > 0) op.detachSpouseIds = detachSpouseIds;
  return op;
}

/**
 * Pure deterministic reducer that applies a single SyncOperation on top of an ArchiveState.
 * Used identically for optimistic UI, outbox reconciliation over incoming snapshots,
 * AND inside Firestore runTransaction() on the live server document!
 */
export function applyOperationToArchive(state: ArchiveState, op: SyncOperation): ArchiveState {
  switch (op.type) {
    case 'UPSERT_PERSON': {
      const target = stripPersonForStorage(op.person);
      const exists = state.people.some((p) => p.id === target.id);
      const existingOnServer = state.people.find((p) => p.id === target.id);

      // Merge target's own spouse list via deltas when updating an existing person
      // so a spouse link added concurrently on another device is preserved.
      let mergedSpouses: string[] | undefined = target.spouses;
      if (existingOnServer) {
        const spouseSet = new Set(existingOnServer.spouses || []);
        for (const sid of op.attachSpouseIds || []) {
          if (sid !== target.id) spouseSet.add(sid);
        }
        for (const sid of op.detachSpouseIds || []) {
          spouseSet.delete(sid);
        }
        // If neither delta is present and target explicitly listed spouses (e.g. legacy op), keep union of existing minus explicit detach
        if (!op.attachSpouseIds && !op.detachSpouseIds && target.spouses) {
          for (const sid of target.spouses) {
            if (sid !== target.id) spouseSet.add(sid);
          }
        }
        mergedSpouses = spouseSet.size > 0 ? Array.from(spouseSet) : undefined;
      }

      const mergedTarget: Person = {
        ...target,
        ...(mergedSpouses ? { spouses: mergedSpouses } : {}),
      };
      if (!mergedSpouses) {
        delete mergedTarget.spouses;
      }

      let nextPeople = exists
        ? state.people.map((p) => (p.id === target.id ? mergedTarget : p))
        : [...state.people, mergedTarget];

      // Apply explicit child attach/detach deltas
      const attachChildren = new Set(op.attachChildIds || []);
      const detachChildren = new Set(op.detachChildIds || []);
      if (attachChildren.size > 0 || detachChildren.size > 0) {
        nextPeople = nextPeople.map((p) => {
          if (p.id === target.id) return p;
          const hasParent = (p.parents || []).includes(target.id);
          if (attachChildren.has(p.id) && !hasParent) {
            return { ...p, parents: [...(p.parents || []), target.id] };
          }
          if (detachChildren.has(p.id) && hasParent) {
            return { ...p, parents: (p.parents || []).filter((id) => id !== target.id) };
          }
          return p;
        });
      }

      // Apply bidirectional spouse back-links via explicit deltas
      const attachSpouses = new Set(op.attachSpouseIds || []);
      const detachSpouses = new Set(op.detachSpouseIds || []);
      if (attachSpouses.size > 0 || detachSpouses.size > 0) {
        nextPeople = nextPeople.map((p) => {
          if (p.id === target.id) return p;
          const hasBackLink = (p.spouses || []).includes(target.id);
          if (attachSpouses.has(p.id) && !hasBackLink) {
            return { ...p, spouses: [...(p.spouses || []), target.id] };
          }
          if (detachSpouses.has(p.id) && hasBackLink) {
            const remaining = (p.spouses || []).filter((id) => id !== target.id);
            const updatedOther: Person = { ...p, spouses: remaining };
            if (remaining.length === 0) delete updatedOther.spouses;
            return updatedOther;
          }
          return p;
        });
      }

      return {
        people: sanitizeArchivePeople(nextPeople),
        settings: state.settings,
      };
    }

    case 'DELETE_PERSON': {
      const nextPeople = state.people
        .filter((p) => p.id !== op.personId)
        .map((p) => {
          const nextParents = (p.parents || []).filter((pid) => pid !== op.personId);
          const nextSpouses = (p.spouses || []).filter((sid) => sid !== op.personId);
          const cleaned: Person = { ...p, parents: nextParents };
          if (nextSpouses.length > 0) {
            cleaned.spouses = nextSpouses;
          } else {
            delete cleaned.spouses;
          }
          return cleaned;
        });

      // Firestore rule requires people.size() >= 1; guard against emptying the entire tree
      if (nextPeople.length === 0) {
        return state;
      }

      return {
        people: sanitizeArchivePeople(nextPeople),
        settings: state.settings,
      };
    }

    case 'UPDATE_SETTINGS': {
      // STRICT ISOLATION: never touches state.people!
      return {
        people: state.people,
        settings: { ...DEFAULT_SETTINGS, ...state.settings, ...op.partial },
      };
    }

    case 'RESET_SETTINGS': {
      // STRICT ISOLATION: never touches state.people!
      return {
        people: state.people,
        settings: { ...DEFAULT_SETTINGS, ...op.settings },
      };
    }

    case 'REPLACE_ARCHIVE': {
      const sanitized = sanitizeArchivePeople(op.people);
      if (sanitized.length === 0) return state;
      return {
        people: sanitized,
        settings: op.settings ? { ...DEFAULT_SETTINGS, ...op.settings } : state.settings,
      };
    }

    default:
      return state;
  }
}

/**
 * Reconciles a server baseline with all pending local outbox operations.
 * Guarantees that incoming snapshots can NEVER wipe out unsynced local edits.
 */
export function reconcileArchiveWithOutbox(
  serverBaseline: ArchiveState,
  pendingOps: SyncOperation[]
): ArchiveState {
  if (!pendingOps || pendingOps.length === 0) {
    return {
      people: sanitizeArchivePeople(serverBaseline.people),
      settings: { ...DEFAULT_SETTINGS, ...serverBaseline.settings },
    };
  }
  return pendingOps.reduce(
    (acc, op) => applyOperationToArchive(acc, op),
    {
      people: sanitizeArchivePeople(serverBaseline.people),
      settings: { ...DEFAULT_SETTINGS, ...serverBaseline.settings },
    }
  );
}

/**
 * Appends a new operation to the outbox, coalescing consecutive UPDATE_SETTINGS ops
 * to minimize Firestore write units while strictly preserving operation order.
 */
export function enqueueOperation(outbox: SyncOperation[], op: SyncOperation): SyncOperation[] {
  if (op.type === 'REPLACE_ARCHIVE') {
    // A full archive replacement supersedes all earlier unsynced operations
    return [op];
  }
  if (op.type === 'UPDATE_SETTINGS' && outbox.length > 0) {
    const last = outbox[outbox.length - 1];
    if (last.type === 'UPDATE_SETTINGS') {
      return [
        ...outbox.slice(0, -1),
        {
          ...op,
          partial: { ...last.partial, ...op.partial },
        },
      ];
    }
  }
  return [...outbox, op];
}

/**
 * Removes committed operations by opId without touching any newer operations
 * added while the transaction was in flight.
 */
export function removeCommittedOperations(
  outbox: SyncOperation[],
  committedOpIds: Set<string>
): SyncOperation[] {
  return outbox.filter((op) => !committedOpIds.has(op.opId));
}

// ============================================================
// Persistent Storage Helpers (safe in SSR / private browsing)
// ============================================================

export function loadOutboxFromStorage(): SyncOperation[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(OUTBOX_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SyncOperation =>
        item && typeof item === 'object' && typeof item.opId === 'string' && typeof item.type === 'string'
    );
  } catch {
    return [];
  }
}

export function saveOutboxToStorage(outbox: SyncOperation[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (outbox.length === 0) {
      window.localStorage.removeItem(OUTBOX_STORAGE_KEY);
    } else {
      window.localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(outbox));
    }
  } catch (err) {
    console.warn('Impossible de persister la file de synchro locale:', err);
  }
}

export function loadPendingPhotoOps(): PendingPhotoOperation[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(PENDING_PHOTOS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PendingPhotoOperation =>
        item &&
        typeof item === 'object' &&
        typeof item.personId === 'string' &&
        (item.action === 'upsert' || item.action === 'delete')
    );
  } catch {
    return [];
  }
}

export function savePendingPhotoOps(ops: PendingPhotoOperation[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (ops.length === 0) {
      window.localStorage.removeItem(PENDING_PHOTOS_STORAGE_KEY);
    } else {
      window.localStorage.setItem(PENDING_PHOTOS_STORAGE_KEY, JSON.stringify(ops));
    }
  } catch {
    // ignore
  }
}

export function upsertPendingPhotoOp(
  ops: PendingPhotoOperation[],
  next: PendingPhotoOperation
): PendingPhotoOperation[] {
  const filtered = ops.filter((o) => o.personId !== next.personId);
  return [...filtered, next];
}

export const PHOTO_INITIAL_SYNC_DONE_KEY = 'wici-photo-initial-sync-done-v1';

export function hasCompletedInitialFullPhotoSync(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    return window.localStorage.getItem(PHOTO_INITIAL_SYNC_DONE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markInitialFullPhotoSyncDone(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(PHOTO_INITIAL_SYNC_DONE_KEY, '1');
  } catch {
    // ignore
  }
}

export function loadLastPhotoSyncTimestamp(): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const val = window.localStorage.getItem(LAST_PHOTO_SYNC_KEY);
    return val && val.trim() ? val.trim() : null;
  } catch {
    return null;
  }
}

export function saveLastPhotoSyncTimestamp(isoTimestamp: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (isoTimestamp) {
      window.localStorage.setItem(LAST_PHOTO_SYNC_KEY, isoTimestamp);
    }
  } catch {
    // ignore
  }
}

export function clearLastPhotoSyncTimestamp(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(LAST_PHOTO_SYNC_KEY);
    window.localStorage.removeItem(PHOTO_INITIAL_SYNC_DONE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Computes a clock-skew-safe delta watermark (5 minutes before the last confirmed timestamp)
 * so two phones whose clocks differ by a few minutes never miss each other's uploads.
 */
export function computeSafeDeltaWatermark(
  lastSyncIso: string | null,
  initialFullSyncDone: boolean,
  localCachedPhotoCount: number
): string | null {
  if (!initialFullSyncDone || localCachedPhotoCount === 0 || !lastSyncIso) {
    return null;
  }
  const parsedMs = Date.parse(lastSyncIso);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }
  const SAFETY_OVERLAP_MS = 5 * 60 * 1000;
  return new Date(Math.max(0, parsedMs - SAFETY_OVERLAP_MS)).toISOString();
}

