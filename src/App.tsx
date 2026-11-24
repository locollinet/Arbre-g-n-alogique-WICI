import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  INITIAL_WICI_PEOPLE,
  DEFAULT_SETTINGS,
  Person,
  TreeSettings,
  getFullName
} from './data/wiciFamily';
import { TreeCanvasView } from './components/TreeCanvasView';
import { MobileGenealogyView } from './components/MobileGenealogyView';
import { StudioSettingsView } from './components/StudioSettingsView';
import { ChronicleBranchesView } from './components/ChronicleBranchesView';
import { PersonDrawer } from './components/PersonDrawer';
import { PhotoCropperModal, CropResult } from './components/PhotoCropperModal';
import {
  Layers,
  Sliders,
  Smartphone,
  Network,
  CloudCheck,
  CloudOff,
  RefreshCw,
  UserPlus,
  Sparkles,
  Share2,
  AlertCircle,
  Check
} from 'lucide-react';
import { FamilyPosterModal } from './components/FamilyPosterModal';
import { ShareFamilyModal } from './components/ShareFamilyModal';
import {
  savePhotoToIndexedDb,
  getAllPhotosFromIndexedDb,
  deletePhotoFromIndexedDb,
} from './utils/localPhotoStorage';
import { runFullPhotoRecovery } from './utils/recoverPhotos';
import { testConnection } from './firebase/firebase';
import { isQuotaExceededError } from './firebase/errors';
import {
  subscribeToPersonPhotos,
  savePersonPhotoToFirestore,
  deletePersonPhotoFromFirestore,
  subscribeToFamilyArchive,
  saveFamilyArchiveToFirestore,
  commitOperationsToFirestore,
  isFirestoreWriteQuotaExceeded,
  markFirestoreQuotaExceeded,
  resetFirestoreQuotaBreaker,
  PersonPhotoRecord
} from './firebase/photoService';
import {
  ArchiveState,
  SyncOperation,
  PendingPhotoOperation,
  buildUpsertPersonOp,
  createOpId,
  enqueueOperation,
  removeCommittedOperations,
  reconcileArchiveWithOutbox,
  stripPeopleForStorage,
  loadOutboxFromStorage,
  saveOutboxToStorage,
  loadPendingPhotoOps,
  savePendingPhotoOps,
  upsertPendingPhotoOp,
  hasCompletedInitialFullPhotoSync,
  markInitialFullPhotoSyncDone,
  loadLastPhotoSyncTimestamp,
  saveLastPhotoSyncTimestamp,
  clearLastPhotoSyncTimestamp,
  computeSafeDeltaWatermark
} from './utils/syncEngine';

function withNetworkTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`NETWORK_TIMEOUT:${label}`)), ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function waitBriefly<T>(promise: Promise<T>, ms: number): Promise<{ done: true; value: T } | { done: false }> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ done: false });
      }
    }, ms);
    promise.then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ done: true, value });
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ done: true, value: false as unknown as T });
        }
      }
    );
  });
}

const STORAGE_PEOPLE_KEY = 'wici-archive-people-v2';
const STORAGE_SETTINGS_KEY = 'wici-archive-settings-v2';

export type CloudSyncStatus =
  | 'chargement'
  | 'disponible'
  | 'synchronisation'
  | 'cache'
  | 'quota'
  | 'indisponible';

function loadInitialPeopleFromLocal(): Person[] {
  try {
    const savedV2 = localStorage.getItem(STORAGE_PEOPLE_KEY);
    if (savedV2) {
      const parsed = JSON.parse(savedV2);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return stripPeopleForStorage(parsed);
      }
    }
    const legacy = localStorage.getItem('wici-tree-v1');
    if (legacy) {
      const parsedLegacy = JSON.parse(legacy);
      if (Array.isArray(parsedLegacy) && parsedLegacy.length > 0) {
        return stripPeopleForStorage(parsedLegacy);
      }
    }
  } catch {
    // Fallback to initial seed
  }
  return stripPeopleForStorage(INITIAL_WICI_PEOPLE);
}

function loadInitialSettingsFromLocal(): TreeSettings {
  try {
    const saved = localStorage.getItem(STORAGE_SETTINGS_KEY);
    if (saved) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    }
  } catch {
    // Fallback
  }
  return DEFAULT_SETTINGS;
}

const SEED_PHOTOS_BY_ID: Record<string, string> = Object.fromEntries(
  INITIAL_WICI_PEOPLE.filter((p) => !!p.photo).map((p) => [p.id, p.photo!])
);

export default function App() {
  const [activeTab, setActiveTab] = useState<'tree' | 'branches' | 'settings'>('tree');
  const [focusBranch, setFocusBranch] = useState<string>('all');

  // Initialize server baseline + persistent outbox so unsynced offline edits survive reloads
  const initialOutbox = useRef<SyncOperation[]>(loadOutboxFromStorage());
  const initialPendingPhotos = useRef<PendingPhotoOperation[]>(loadPendingPhotoOps());
  const serverArchiveRef = useRef<ArchiveState>({
    people: loadInitialPeopleFromLocal(),
    settings: loadInitialSettingsFromLocal(),
  });

  const photoCacheRef = useRef<Record<string, string>>({ ...SEED_PHOTOS_BY_ID });
  const pendingPhotosRef = useRef<PendingPhotoOperation[]>(initialPendingPhotos.current);
  const outboxRef = useRef<SyncOperation[]>(initialOutbox.current);

  const hydratePhotosOnPeople = useCallback((list: Person[]): Person[] => {
    const pendingDeletes = new Set(
      pendingPhotosRef.current.filter((o) => o.action === 'delete').map((o) => o.personId)
    );
    return list.map((p) => {
      if (pendingDeletes.has(p.id)) {
        return { ...p, photo: undefined };
      }
      const cached = photoCacheRef.current[p.id];
      return cached ? { ...p, photo: cached } : { ...p, photo: undefined };
    });
  }, []);

  const initialReconciled = useRef<ArchiveState>(
    reconcileArchiveWithOutbox(serverArchiveRef.current, outboxRef.current)
  );

  const [people, setPeople] = useState<Person[]>(() =>
    hydratePhotosOnPeople(initialReconciled.current.people)
  );
  const [settings, setSettings] = useState<TreeSettings>(() => initialReconciled.current.settings);

  const [mobileViewMode, setMobileViewMode] = useState<'touch' | 'canvas'>('canvas');

  // Slide-over drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [preselectedParentId, setPreselectedParentId] = useState<string | null>(null);
  const [preselectedParentIds, setPreselectedParentIds] = useState<string[]>([]);

  // Standalone Photo Cropper Atelier state
  const [cropperPersonId, setCropperPersonId] = useState<string | null>(null);

  // Standalone A3 Art Poster, Share & Sync Status Popover
  const [posterModalOpen, setPosterModalOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [syncPopoverOpen, setSyncPopoverOpen] = useState(false);

  // Cloud Sync State
  const [photosMap, setPhotosMap] = useState<Record<string, PersonPhotoRecord>>({});
  const lastCloudPhotos = useRef<Record<string, PersonPhotoRecord>>({});
  const [cloudStatus, setCloudStatus] = useState<CloudSyncStatus>('chargement');
  const [pendingOutboxCount, setPendingOutboxCount] = useState<number>(outboxRef.current.length);
  const [pendingPhotosCount, setPendingPhotosCount] = useState<number>(
    pendingPhotosRef.current.length
  );
  const [photoSubVersion, setPhotoSubVersion] = useState<number>(0);

  const hasSeededArchiveRef = useRef(false);
  const isFlushingRef = useRef(false);
  const activeFlushPromiseRef = useRef<Promise<boolean> | null>(null);
  const needsAnotherFlushRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptsRef = useRef(0);
  const settingsSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSettingsPartialRef = useRef<Partial<TreeSettings>>({});
  const flushQueueRef = useRef<(opts?: { manual?: boolean }) => Promise<boolean>>(async () => false);

  const peopleRef = useRef<Person[]>(people);
  useEffect(() => {
    peopleRef.current = people;
  }, [people]);

  const settingsRef = useRef<TreeSettings>(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Subtle toast notification
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const notify = useCallback((msg: string) => {
    setToastMsg(msg);
  }, []);

  /**
   * Recomputes the UI state strictly as:
   *   reconcileArchiveWithOutbox(serverArchiveRef, outboxRef) + local/cloud photos.
   * Guarantees that incoming Firestore snapshots NEVER wipe out unsynced local edits!
   */
  const recomputeDisplayedState = useCallback(() => {
    const merged = reconcileArchiveWithOutbox(serverArchiveRef.current, outboxRef.current);
    const withPhotos = hydratePhotosOnPeople(merged.people);
    peopleRef.current = withPhotos;
    settingsRef.current = merged.settings;
    setPeople(withPhotos);
    setSettings(merged.settings);
  }, [hydratePhotosOnPeople]);

  const persistOutboxState = useCallback((nextOutbox: SyncOperation[]) => {
    outboxRef.current = nextOutbox;
    saveOutboxToStorage(nextOutbox);
    setPendingOutboxCount(nextOutbox.length);
  }, []);

  const persistPendingPhotosState = useCallback((nextPending: PendingPhotoOperation[]) => {
    pendingPhotosRef.current = nextPending;
    savePendingPhotoOps(nextPending);
    setPendingPhotosCount(nextPending.length);
  }, []);

  /**
   * Single-flight transactional sync worker with promise coalescing.
   * - Never falsely returns `false` when called while another flush is already in flight:
   *   instead, it awaits the active pass and runs a follow-up pass for newly arrived ops.
   * - Guards every network call with a 15s timeout so a stalled 4G socket never deadlocks the worker.
   */
  const flushSyncQueue = useCallback(
    async (options?: { manual?: boolean }): Promise<boolean> => {
      const manual = !!options?.manual;
      if (manual) {
        resetFirestoreQuotaBreaker();
        retryAttemptsRef.current = 0;
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
      }

      while (activeFlushPromiseRef.current) {
        needsAnotherFlushRef.current = true;
        await activeFlushPromiseRef.current;
        if (outboxRef.current.length === 0 && pendingPhotosRef.current.length === 0) {
          return true;
        }
        if (isFirestoreWriteQuotaExceeded() && !manual) {
          return false;
        }
      }

      const runPass = async (): Promise<boolean> => {
        const hasWork = outboxRef.current.length > 0 || pendingPhotosRef.current.length > 0;
        if (!hasWork) {
          if (!isFirestoreWriteQuotaExceeded()) {
            setCloudStatus((prev) =>
              prev === 'indisponible' || prev === 'quota' ? 'disponible' : prev
            );
          }
          return true;
        }

        if (isFirestoreWriteQuotaExceeded()) {
          setCloudStatus('quota');
          return false;
        }

        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          setCloudStatus('indisponible');
          return false;
        }

        isFlushingRef.current = true;
        setCloudStatus('synchronisation');

        let allSucceeded = true;

        try {
          // 1. Drain archive operations in batched Firestore transactions
          while (outboxRef.current.length > 0) {
            const batch = [...outboxRef.current];
            const batchIds = new Set(batch.map((o) => o.opId));
            const committed = await withNetworkTimeout(
              commitOperationsToFirestore(batch, serverArchiveRef.current),
              15000,
              'archive-tx'
            );

            serverArchiveRef.current = {
              people: stripPeopleForStorage(committed.people),
              settings: { ...DEFAULT_SETTINGS, ...(committed.settings || {}) },
            };

            const remaining = removeCommittedOperations(outboxRef.current, batchIds);
            persistOutboxState(remaining);
            recomputeDisplayedState();
          }

          // 2. Drain pending photo uploads/deletions (photos are safely stored in IndexedDB)
          while (pendingPhotosRef.current.length > 0) {
            const localIdbPhotos = await getAllPhotosFromIndexedDb();
            const snapshotOps = [...pendingPhotosRef.current];

            for (const pOp of snapshotOps) {
              if (pOp.action === 'upsert') {
                const stored = localIdbPhotos[pOp.personId];
                const dataUrl = stored?.photoDataUrl || photoCacheRef.current[pOp.personId];
                if (!dataUrl) {
                  persistPendingPhotosState(
                    pendingPhotosRef.current.filter(
                      (o) => !(o.personId === pOp.personId && o.updatedAt === pOp.updatedAt)
                    )
                  );
                  continue;
                }
                const savedRec = await withNetworkTimeout(
                  savePersonPhotoToFirestore({
                    personId: pOp.personId,
                    photoDataUrl: dataUrl,
                    shape: (stored?.shape as PersonPhotoRecord['shape']) || 'circle',
                    filter: (stored?.filter as PersonPhotoRecord['filter']) || 'none',
                    caption: stored?.caption,
                    updatedAt: stored?.updatedAt || pOp.updatedAt,
                  }),
                  20000,
                  `photo-upsert-${pOp.personId}`
                );
                lastCloudPhotos.current = { ...lastCloudPhotos.current, [pOp.personId]: savedRec };
                setPhotosMap((prev) => ({ ...prev, [pOp.personId]: savedRec }));
                // Only advance watermark if initial full photo sync has already completed!
                if (savedRec.updatedAt && hasCompletedInitialFullPhotoSync()) {
                  const prevTs = loadLastPhotoSyncTimestamp();
                  if (!prevTs || savedRec.updatedAt > prevTs) {
                    saveLastPhotoSyncTimestamp(savedRec.updatedAt);
                  }
                }
                persistPendingPhotosState(
                  pendingPhotosRef.current.filter(
                    (o) => !(o.personId === pOp.personId && o.updatedAt === pOp.updatedAt)
                  )
                );
              } else if (pOp.action === 'delete') {
                await withNetworkTimeout(
                  deletePersonPhotoFromFirestore(pOp.personId),
                  15000,
                  `photo-delete-${pOp.personId}`
                );
                const nextCloud = { ...lastCloudPhotos.current };
                delete nextCloud[pOp.personId];
                lastCloudPhotos.current = nextCloud;
                setPhotosMap((prev) => {
                  const next = { ...prev };
                  delete next[pOp.personId];
                  return next;
                });
                persistPendingPhotosState(
                  pendingPhotosRef.current.filter(
                    (o) => !(o.personId === pOp.personId && o.updatedAt === pOp.updatedAt)
                  )
                );
              }
            }
          }

          retryAttemptsRef.current = 0;
          setCloudStatus('disponible');
        } catch (err) {
          allSucceeded = false;
          if (isQuotaExceededError(err)) {
            setCloudStatus('quota');
            console.warn(
              'Quota journalier Firebase atteint : vos modifications restent en sécurité dans la file locale.'
            );
          } else {
            setCloudStatus('indisponible');
            console.warn('Synchronisation Firebase différée (reprise automatique):', err);
            const delays = [3000, 8000, 20000, 45000];
            const delay = delays[Math.min(retryAttemptsRef.current, delays.length - 1)];
            retryAttemptsRef.current += 1;
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
            retryTimerRef.current = setTimeout(() => {
              retryTimerRef.current = null;
              void flushQueueRef.current();
            }, delay);
          }
        } finally {
          isFlushingRef.current = false;
        }

        return allSucceeded;
      };

      const passPromise = runPass();
      activeFlushPromiseRef.current = passPromise;
      let result = false;
      try {
        result = await passPromise;
      } finally {
        if (activeFlushPromiseRef.current === passPromise) {
          activeFlushPromiseRef.current = null;
        }
      }

      if (
        (needsAnotherFlushRef.current ||
          outboxRef.current.length > 0 ||
          pendingPhotosRef.current.length > 0) &&
        result &&
        !isFirestoreWriteQuotaExceeded()
      ) {
        needsAnotherFlushRef.current = false;
        return flushSyncQueue();
      }
      needsAnotherFlushRef.current = false;
      return result;
    },
    [persistOutboxState, persistPendingPhotosState, recomputeDisplayedState]
  );

  useEffect(() => {
    flushQueueRef.current = flushSyncQueue;
  }, [flushSyncQueue]);

  /**
   * Enqueues a single archive SyncOperation, updates UI optimistically,
   * persists to outbox immediately, and triggers the transactional sync worker.
   */
  const dispatchArchiveOp = useCallback(
    async (op: SyncOperation): Promise<boolean> => {
      const nextOutbox = enqueueOperation(outboxRef.current, op);
      persistOutboxState(nextOutbox);
      recomputeDisplayedState();
      return flushSyncQueue();
    },
    [persistOutboxState, recomputeDisplayedState, flushSyncQueue]
  );

  // 1. Boot: connectivity check, online/visibility auto-retry, & IndexedDB portrait hydration
  useEffect(() => {
    void testConnection().then((state) => {
      if (state === 'quota') {
        markFirestoreQuotaExceeded();
        setCloudStatus('quota');
      } else if (state === 'offline') {
        setCloudStatus('indisponible');
      }
    });

    const handleOnline = () => {
      void flushQueueRef.current();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (outboxRef.current.length > 0 || pendingPhotosRef.current.length > 0) {
          void flushQueueRef.current();
        }
      }
    };
    const flushPendingSettingsToOutboxSync = () => {
      if (settingsSyncTimerRef.current) {
        clearTimeout(settingsSyncTimerRef.current);
        settingsSyncTimerRef.current = null;
      }
      const pendingPartial = pendingSettingsPartialRef.current;
      if (Object.keys(pendingPartial).length > 0) {
        pendingSettingsPartialRef.current = {};
        const nextOutbox = enqueueOperation(outboxRef.current, {
          opId: createOpId(),
          createdAt: new Date().toISOString(),
          type: 'UPDATE_SETTINGS',
          partial: pendingPartial,
        });
        outboxRef.current = nextOutbox;
        saveOutboxToStorage(nextOutbox);
      }
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      flushPendingSettingsToOutboxSync();
      if (isFlushingRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', flushPendingSettingsToOutboxSync);

    // Flush any leftover pending operations saved from an earlier offline/quota session
    if (outboxRef.current.length > 0 || pendingPhotosRef.current.length > 0) {
      void flushQueueRef.current();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', flushPendingSettingsToOutboxSync);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (settingsSyncTimerRef.current) clearTimeout(settingsSyncTimerRef.current);
    };
  }, []);

  // 2. Subscribe to real-time Family Archive (people + settings) in Firestore
  useEffect(() => {
    const unsub = subscribeToFamilyArchive(
      (archiveRecord, meta) => {
        if (!isFirestoreWriteQuotaExceeded() && !isFlushingRef.current) {
          if (outboxRef.current.length === 0 && pendingPhotosRef.current.length === 0) {
            setCloudStatus(meta.fromCache ? 'cache' : 'disponible');
          }
        }

        if (Array.isArray(archiveRecord.people) && archiveRecord.people.length > 0) {
          serverArchiveRef.current = {
            people: stripPeopleForStorage(archiveRecord.people),
            settings: {
              ...DEFAULT_SETTINGS,
              ...(archiveRecord.settings || serverArchiveRef.current.settings),
            },
          };
          // Always re-apply any pending local outbox edits on top of the server baseline!
          recomputeDisplayedState();
        }
      },
      () => {
        // Document doesn't exist yet on Firestore: seed once
        if (!hasSeededArchiveRef.current && !isFirestoreWriteQuotaExceeded()) {
          hasSeededArchiveRef.current = true;
          saveFamilyArchiveToFirestore(peopleRef.current, settingsRef.current)
            .then(() => setCloudStatus('disponible'))
            .catch((err) => {
              if (isQuotaExceededError(err)) {
                setCloudStatus('quota');
              } else {
                console.error('Erreur initialisation archive Firestore:', err);
                setCloudStatus('indisponible');
              }
            });
        }
      },
      (err) => {
        if (isQuotaExceededError(err)) {
          setCloudStatus('quota');
        } else {
          console.warn('Synchronisation archive Firestore:', err);
          setCloudStatus('indisponible');
        }
      }
    );
    return () => unsub();
  }, [recomputeDisplayedState]);

  // 3. Hydrate local IndexedDB portraits FIRST, then attach a DELTA Firestore photo listener
  //    (reads 0 documents on repeat visits when IndexedDB is already up-to-date!)
  useEffect(() => {
    let cancelled = false;
    let unsubPhotos: (() => void) | null = null;

    const initPhotosAndDeltaSync = async () => {
      // Load all locally cached portraits from IndexedDB
      const localMap = await getAllPhotosFromIndexedDb();
      if (cancelled) return;

      const localKeys = Object.keys(localMap);
      if (localKeys.length > 0) {
        const seededRecords: Record<string, PersonPhotoRecord> = {};
        for (const rec of Object.values(localMap)) {
          if (rec.personId && rec.photoDataUrl) {
            photoCacheRef.current[rec.personId] = rec.photoDataUrl;
            seededRecords[rec.personId] = {
              personId: rec.personId,
              photoDataUrl: rec.photoDataUrl,
              shape: (rec.shape as PersonPhotoRecord['shape']) || 'circle',
              filter: (rec.filter as PersonPhotoRecord['filter']) || 'none',
              caption: rec.caption,
              updatedAt: rec.updatedAt,
            };
          }
        }
        lastCloudPhotos.current = { ...seededRecords, ...lastCloudPhotos.current };
        setPhotosMap((prev) => ({ ...seededRecords, ...prev }));
        recomputeDisplayedState();
      } else {
        // If IndexedDB was empty, run a purely local cache scan (0 Firestore ops)
        const { recoveredPhotos } = await runFullPhotoRecovery(peopleRef.current);
        if (!cancelled && Object.keys(recoveredPhotos).length > 0) {
          for (const [pid, dataUrl] of Object.entries(recoveredPhotos)) {
            photoCacheRef.current[pid] = dataUrl;
          }
          recomputeDisplayedState();
        }
      }

      if (cancelled) return;

      // Determine clock-skew-safe delta watermark: ONLY use delta query if an initial
      // full server sync has completed AND IndexedDB actually holds cached portraits!
      const savedWatermark = loadLastPhotoSyncTimestamp();
      const effectiveSince = computeSafeDeltaWatermark(
        savedWatermark,
        hasCompletedInitialFullPhotoSync(),
        localKeys.length
      );

      unsubPhotos = subscribeToPersonPhotos(
        (deltaMap, meta) => {
          if (cancelled) return;

          const pendingPhotoIds = new Set(pendingPhotosRef.current.map((o) => o.personId));
          const prevCloud = lastCloudPhotos.current;
          const nextCloud = { ...prevCloud };
          let cacheChanged = false;

          // Apply new or updated portraits from Firestore (never clobbering a pending local upload!)
          for (const rec of Object.values(deltaMap)) {
            if (!rec.personId || !rec.photoDataUrl) continue;
            if (pendingPhotoIds.has(rec.personId)) continue;

            nextCloud[rec.personId] = rec;
            if (photoCacheRef.current[rec.personId] !== rec.photoDataUrl) {
              photoCacheRef.current[rec.personId] = rec.photoDataUrl;
              cacheChanged = true;
            }

            if (prevCloud[rec.personId]?.photoDataUrl !== rec.photoDataUrl) {
              void savePhotoToIndexedDb({
                personId: rec.personId,
                photoDataUrl: rec.photoDataUrl,
                shape: rec.shape,
                filter: rec.filter,
                caption: rec.caption,
                updatedAt: rec.updatedAt,
              });
            }
          }

          // If this is a live full snapshot from the server, mark initial sync done & propagate deletions
          if (meta.isFullSnapshot && !meta.fromCache) {
            markInitialFullPhotoSyncDone();
            for (const existingId of Object.keys(prevCloud)) {
              if (!deltaMap[existingId] && !pendingPhotoIds.has(existingId)) {
                delete nextCloud[existingId];
                if (!SEED_PHOTOS_BY_ID[existingId]) {
                  delete photoCacheRef.current[existingId];
                  void deletePhotoFromIndexedDb(existingId);
                  cacheChanged = true;
                }
              }
            }
          }

          lastCloudPhotos.current = nextCloud;
          setPhotosMap(nextCloud);

          if (!meta.fromCache && meta.maxUpdatedAt && (meta.isFullSnapshot || hasCompletedInitialFullPhotoSync())) {
            const prevTs = loadLastPhotoSyncTimestamp();
            if (!prevTs || meta.maxUpdatedAt > prevTs) {
              saveLastPhotoSyncTimestamp(meta.maxUpdatedAt);
            }
          }

          if (cacheChanged) {
            recomputeDisplayedState();
          }

          if (
            !isFirestoreWriteQuotaExceeded() &&
            !isFlushingRef.current &&
            outboxRef.current.length === 0 &&
            pendingPhotosRef.current.length === 0
          ) {
            setCloudStatus(meta.fromCache ? 'cache' : 'disponible');
          }
        },
        (err) => {
          if (isQuotaExceededError(err)) {
            setCloudStatus('quota');
          } else {
            console.warn('Synchronisation portraits Firestore:', err);
          }
        },
        effectiveSince
      );
    };

    void initPhotosAndDeltaSync();

    return () => {
      cancelled = true;
      if (unsubPhotos) unsubPhotos();
    };
  }, [recomputeDisplayedState, photoSubVersion]);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 4000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // Persist people changes locally — ALWAYS stripped of base64 photos (~10KB max, NEVER hits 5MB quota!)
  useEffect(() => {
    try {
      const lightweight = stripPeopleForStorage(people);
      localStorage.setItem(STORAGE_PEOPLE_KEY, JSON.stringify(lightweight));
    } catch {
      // ignore if private browsing blocks localStorage
    }
  }, [people]);

  // Persist settings changes locally
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // ignore
    }
  }, [settings]);

  // Accent color based on selected luxury palette
  const accentColor =
    settings.palette === 'porcelain-cypress'
      ? '#344E41'
      : settings.palette === 'alabaster-slate'
      ? '#1E3A5F'
      : '#8C7355';

  const canvasBg =
    settings.palette === 'porcelain-cypress'
      ? '#F7F9F7'
      : settings.palette === 'alabaster-slate'
      ? '#F8FAFC'
      : '#FAF8F5';

  const handleUpdateSettings = (partial: Partial<TreeSettings>) => {
    // Immediate optimistic local update
    const nextSettings = { ...settingsRef.current, ...partial };
    settingsRef.current = nextSettings;
    setSettings(nextSettings);

    // Coalesce rapid keystrokes, then enqueue isolated UPDATE_SETTINGS op (NEVER touches people!)
    pendingSettingsPartialRef.current = {
      ...pendingSettingsPartialRef.current,
      ...partial,
    };
    if (settingsSyncTimerRef.current) {
      clearTimeout(settingsSyncTimerRef.current);
    }
    settingsSyncTimerRef.current = setTimeout(() => {
      settingsSyncTimerRef.current = null;
      const mergedPartial = pendingSettingsPartialRef.current;
      pendingSettingsPartialRef.current = {};
      if (Object.keys(mergedPartial).length > 0) {
        void dispatchArchiveOp({
          opId: createOpId(),
          createdAt: new Date().toISOString(),
          type: 'UPDATE_SETTINGS',
          partial: mergedPartial,
        });
      }
    }, 900);
  };

  const handleResetSettings = () => {
    if (settingsSyncTimerRef.current) {
      clearTimeout(settingsSyncTimerRef.current);
      settingsSyncTimerRef.current = null;
      pendingSettingsPartialRef.current = {};
    }
    void dispatchArchiveOp({
      opId: createOpId(),
      createdAt: new Date().toISOString(),
      type: 'RESET_SETTINGS',
      settings: DEFAULT_SETTINGS,
    }).then((ok) => {
      notify(
        ok
          ? 'Réglages esthétiques restaurés et synchronisés.'
          : 'Réglages restaurés localement (synchronisation cloud en attente).'
      );
    });
  };

  const handleOpenPerson = (id: string) => {
    setPreselectedParentId(null);
    setPreselectedParentIds([]);
    setSelectedPersonId(id);
    setDrawerOpen(true);
  };

  const handleOpenCreatePerson = (parentId?: string) => {
    setPreselectedParentId(parentId || null);
    setPreselectedParentIds([]);
    setSelectedPersonId('new');
    setDrawerOpen(true);
  };

  const handleOpenCreateSibling = (parentIds: string[]) => {
    setPreselectedParentId(null);
    setPreselectedParentIds(parentIds);
    setSelectedPersonId('new');
    setDrawerOpen(true);
  };

  const handleSavePerson = async (
    updated: Person,
    childIdsToAttach?: string[]
  ): Promise<boolean> => {
    const prevList = peopleRef.current;
    const isNewPerson = !prevList.some((p) => p.id === updated.id);

    // If a new person was created with a photo, cache & queue the photo too
    if (isNewPerson && updated.photo) {
      const photoUpdatedAt = new Date().toISOString();
      photoCacheRef.current[updated.id] = updated.photo;
      await savePhotoToIndexedDb({
        personId: updated.id,
        photoDataUrl: updated.photo,
        updatedAt: photoUpdatedAt,
      });
      persistPendingPhotosState(
        upsertPendingPhotoOp(pendingPhotosRef.current, {
          personId: updated.id,
          action: 'upsert',
          updatedAt: photoUpdatedAt,
        })
      );
    }

    const op = buildUpsertPersonOp(prevList, updated, childIdsToAttach);
    setSelectedPersonId(updated.id);

    // Enqueue immediately & wait up to 3.5s so normal saves confirm live while shaky 4G never freezes UI
    const syncPromise = dispatchArchiveOp(op);
    const race = await waitBriefly(syncPromise, 3500);
    if (!race.done) {
      notify(`Fiche de ${getFullName(updated)} enregistrée · synchronisation cloud en cours…`);
      void syncPromise.then((finalOk) => {
        if (finalOk) {
          notify(`Fiche de ${getFullName(updated)} synchronisée pour toute la famille.`);
        }
      });
      return true;
    }

    const ok = race.value;
    notify(
      ok
        ? `Fiche de ${getFullName(updated)} enregistrée et synchronisée pour toute la famille.`
        : isFirestoreWriteQuotaExceeded()
        ? `Fiche de ${getFullName(updated)} enregistrée sur cet appareil (quota Firebase atteint — synchro auto dès reprise).`
        : `Fiche de ${getFullName(updated)} enregistrée sur cet appareil (envoi vers le cloud en attente).`
    );
    return ok;
  };

  const handleDeletePerson = (id: string) => {
    const target = peopleRef.current.find((p) => p.id === id);
    if (focusBranch === id) setFocusBranch('all');

    // Clean up local photo cache & pending photo uploads for the deleted member
    const hadCloudPhoto = !!lastCloudPhotos.current[id];
    delete photoCacheRef.current[id];
    void deletePhotoFromIndexedDb(id);
    if (hadCloudPhoto) {
      persistPendingPhotosState(
        upsertPendingPhotoOp(pendingPhotosRef.current, {
          personId: id,
          action: 'delete',
          updatedAt: new Date().toISOString(),
        })
      );
    } else if (pendingPhotosRef.current.some((o) => o.personId === id)) {
      persistPendingPhotosState(pendingPhotosRef.current.filter((o) => o.personId !== id));
    }

    void dispatchArchiveOp({
      opId: createOpId(),
      createdAt: new Date().toISOString(),
      type: 'DELETE_PERSON',
      personId: id,
    }).then((ok) => {
      if (target) {
        notify(
          ok
            ? `${getFullName(target)} a été retiré(e) de l’arbre pour toute la famille.`
            : `${getFullName(target)} retiré(e) localement (envoi vers le cloud en attente).`
        );
      }
    });
  };

  const handleImportData = (importedPeople: Person[], importedSettings?: Partial<TreeSettings>) => {
    const nextSettings = importedSettings
      ? { ...settingsRef.current, ...importedSettings }
      : settingsRef.current;

    // Save imported portraits to IndexedDB & queue changed portraits for cloud sync
    const nowIso = new Date().toISOString();
    let nextPendingPhotos = pendingPhotosRef.current;
    for (const p of importedPeople) {
      if (p.photo) {
        const isDifferentFromCloud = lastCloudPhotos.current[p.id]?.photoDataUrl !== p.photo;
        photoCacheRef.current[p.id] = p.photo;
        void savePhotoToIndexedDb({
          personId: p.id,
          photoDataUrl: p.photo,
          updatedAt: nowIso,
        });
        if (isDifferentFromCloud) {
          nextPendingPhotos = upsertPendingPhotoOp(nextPendingPhotos, {
            personId: p.id,
            action: 'upsert',
            updatedAt: nowIso,
          });
        }
      }
    }
    if (nextPendingPhotos !== pendingPhotosRef.current) {
      persistPendingPhotosState(nextPendingPhotos);
    }

    setFocusBranch('all');
    void dispatchArchiveOp({
      opId: createOpId(),
      createdAt: nowIso,
      type: 'REPLACE_ARCHIVE',
      people: stripPeopleForStorage(importedPeople),
      settings: nextSettings,
    }).then((ok) => {
      notify(
        ok
          ? `Sauvegarde importée et synchronisée (${importedPeople.length} membres).`
          : `Sauvegarde importée localement (${importedPeople.length} membres — synchro en attente).`
      );
    });
  };

  const handleRestoreInitialData = () => {
    setFocusBranch('all');
    void dispatchArchiveOp({
      opId: createOpId(),
      createdAt: new Date().toISOString(),
      type: 'REPLACE_ARCHIVE',
      people: stripPeopleForStorage(INITIAL_WICI_PEOPLE),
      settings: DEFAULT_SETTINGS,
    }).then((ok) => {
      notify(
        ok
          ? 'Arbre initial de la famille Wici restauré et synchronisé.'
          : 'Arbre initial restauré localement (synchronisation en attente).'
      );
    });
  };

  const handleSavePersonPhoto = async (personId: string, result: CropResult) => {
    const nowIso = new Date().toISOString();
    const personObj = peopleRef.current.find((p) => p.id === personId);
    const personName = personObj ? getFullName(personObj) : 'Membre';

    // 1. Update local photo cache & UI immediately
    photoCacheRef.current[personId] = result.dataUrl;
    recomputeDisplayedState();

    // 2. Permanent save in IndexedDB (immune to 5MB localStorage limit)
    await savePhotoToIndexedDb({
      personId,
      photoDataUrl: result.dataUrl,
      shape: result.shape,
      filter: result.filter,
      caption: result.caption,
      updatedAt: nowIso,
    });

    // 3. Queue into persistent pending-photos outbox so it NEVER gets lost on 4G drop or quota exhaustion
    persistPendingPhotosState(
      upsertPendingPhotoOp(pendingPhotosRef.current, {
        personId,
        action: 'upsert',
        updatedAt: nowIso,
      })
    );

    // 4. Flush immediately to Firestore (bounded 3.5s UI wait so shaky 4G never freezes the cropper modal)
    const syncPromise = flushSyncQueue();
    const race = await waitBriefly(syncPromise, 3500);
    if (!race.done) {
      notify(`Portrait de ${personName} enregistré · envoi vers le cloud en cours…`);
      void syncPromise.then((finalOk) => {
        if (finalOk) {
          notify(`Portrait de ${personName} synchronisé pour toute la famille.`);
        }
      });
      return;
    }
    const ok = race.value;
    if (ok) {
      notify(`Portrait de ${personName} sauvegardé et synchronisé pour la famille.`);
    } else if (isFirestoreWriteQuotaExceeded()) {
      notify(
        `Portrait de ${personName} enregistré sur cet appareil (quota Firebase atteint — synchro auto dès reprise).`
      );
    } else {
      notify(
        `Portrait de ${personName} enregistré en sécurité sur cet appareil (envoi vers le cloud en attente).`
      );
    }
  };

  const handleRemovePersonPhoto = async (personId: string) => {
    const nowIso = new Date().toISOString();
    const personObj = peopleRef.current.find((p) => p.id === personId);
    const personName = personObj ? getFullName(personObj) : 'Membre';
    delete photoCacheRef.current[personId];
    await deletePhotoFromIndexedDb(personId);

    persistPendingPhotosState(
      upsertPendingPhotoOp(pendingPhotosRef.current, {
        personId,
        action: 'delete',
        updatedAt: nowIso,
      })
    );
    recomputeDisplayedState();
    void flushSyncQueue().then((ok) => {
      notify(
        ok
          ? `Portrait de ${personName} retiré pour toute la famille.`
          : `Portrait de ${personName} retiré localement (synchro cloud en attente).`
      );
    });
  };

  const handleForceSyncNow = async (): Promise<boolean> => {
    const ok = await flushSyncQueue({ manual: true });
    if (ok) {
      notify('Toutes les modifications sont synchronisées avec Firebase.');
    } else if (isFirestoreWriteQuotaExceeded()) {
      notify(
        'Le quota journalier gratuit Firebase est encore atteint. Vos modifications restent protégées sur cet appareil.'
      );
    } else {
      notify('Connexion instable — nouvelle tentative automatique dès le retour du réseau.');
    }
    return ok;
  };

  const handleForceFullPhotoRefresh = () => {
    resetFirestoreQuotaBreaker();
    clearLastPhotoSyncTimestamp();
    setPhotoSubVersion((v) => v + 1);
    setSyncPopoverOpen(false);
    notify('Actualisation des portraits depuis le cloud lancée…');
  };

  const totalPendingCount = pendingOutboxCount + pendingPhotosCount;
  const isWarningStatus =
    cloudStatus === 'indisponible' || cloudStatus === 'quota' || totalPendingCount > 0;

  return (
    <div
      className="min-h-screen flex flex-col text-[#1C1917] transition-colors duration-200 pb-14 md:pb-0"
      style={{ backgroundColor: canvasBg }}
    >
      {/* Top Bar - Clean, Responsive Header */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 sm:gap-3 px-3 sm:px-6 lg:px-8 h-14 bg-white/95 backdrop-blur-md border-b border-[#E6DFD3]">
        {/* Zone 1: Brand title + member count */}
        <div className="flex items-baseline gap-3 shrink-0 min-w-0">
          <a
            href="#arbre"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('tree');
            }}
            className="font-serif text-lg sm:text-2xl font-medium tracking-tight text-[#1C1917] whitespace-nowrap truncate"
          >
            {settings.familyName}
          </a>
          <span className="hidden xl:inline-block text-xs text-[#8C7A65] font-mono">
            {people.length} membres · 5 générations
          </span>
        </div>

        {/* Zone 2: Desktop Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#6E665C]">
          <button
            type="button"
            onClick={() => setActiveTab('tree')}
            className={`py-4 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'tree'
                ? 'border-[#1C1917] text-[#1C1917]'
                : 'border-transparent hover:text-[#1C1917]'
            }`}
          >
            L’Arbre Généalogique
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('branches')}
            className={`py-4 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'branches'
                ? 'border-[#1C1917] text-[#1C1917]'
                : 'border-transparent hover:text-[#1C1917]'
            }`}
          >
            Branches & Générations
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`py-4 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'settings'
                ? 'border-[#1C1917] text-[#1C1917]'
                : 'border-transparent hover:text-[#1C1917]'
            }`}
          >
            Fiches & Options
          </button>
        </nav>

        {/* Zone 3: Planche A3 d'Art, Partager, Always-Visible Cloud Sync & Add Person */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Bouton Doré Dédié : Arbre A3 d'Art */}
          <button
            type="button"
            onClick={() => setPosterModalOpen(true)}
            className="inline-flex min-h-[36px] px-2.5 sm:px-3.5 py-1.5 rounded-full text-xs font-semibold text-white transition-all whitespace-nowrap shrink-0 hover:opacity-95 items-center justify-center gap-1.5 shadow-xs active:scale-[0.98]"
            style={{ backgroundColor: '#8C7355' }}
            title="Ouvrir le véritable arbre généalogique illustré A3 d’art avec tronc, branches et portraits"
          >
            <Sparkles className="h-3.5 w-3.5 text-[#F5EBE1]" />
            <span>Arbre A3</span>
            <span className="hidden xl:inline text-[10px] uppercase font-mono tracking-wider opacity-90">d’Art</span>
          </button>

          {/* Bouton Dédié : Partager */}
          <button
            type="button"
            onClick={() => setShareModalOpen(true)}
            className="inline-flex min-h-[36px] px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-medium border border-[#D5C7B4] bg-[#FAF8F5] hover:bg-[#EFECE4] text-[#1C1917] transition-colors whitespace-nowrap shrink-0 items-center justify-center gap-1.5"
            title="Partager le lien de l’arbre avec la famille ou sur WhatsApp"
          >
            <Share2 className="h-3.5 w-3.5 text-[#8C7A65]" />
            <span className="hidden sm:inline">Partager</span>
          </button>

          {/* Always-visible Cloud Sync Status Button + Popover (Mobile & Desktop!) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setSyncPopoverOpen((v) => !v)}
              aria-expanded={syncPopoverOpen}
              className={`inline-flex min-h-[36px] items-center gap-1.5 px-2.5 lg:px-3 py-1 rounded-full border text-xs transition-colors ${
                cloudStatus === 'synchronisation'
                  ? 'bg-[#EEF4FA] border-[#C5D8EC] text-[#274C77]'
                  : isWarningStatus
                  ? 'bg-[#FDF6EE] border-[#E5C9A8] text-[#8F4D16]'
                  : 'bg-[#FAF8F5] border-[#E6DFD3] text-[#4D7A58]'
              }`}
              title="Voir l’état de synchronisation cloud Firebase"
            >
              {cloudStatus === 'synchronisation' ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin shrink-0" />
              ) : isWarningStatus ? (
                <CloudOff className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <CloudCheck className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="font-medium whitespace-nowrap hidden lg:inline">
                {cloudStatus === 'synchronisation'
                  ? 'Synchronisation…'
                  : cloudStatus === 'quota'
                  ? totalPendingCount > 0
                    ? `Quota · ${totalPendingCount} en attente`
                    : 'Quota atteint · local'
                  : totalPendingCount > 0
                  ? `${totalPendingCount} en attente`
                  : cloudStatus === 'indisponible'
                  ? 'Hors ligne'
                  : cloudStatus === 'disponible'
                  ? 'Synchronisé'
                  : cloudStatus === 'cache'
                  ? 'Synchronisé (cache)'
                  : 'Connexion…'}
              </span>
              {totalPendingCount > 0 && (
                <span className="lg:hidden inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[#B46B27] text-white text-[10px] font-bold font-mono">
                  {totalPendingCount}
                </span>
              )}
            </button>

            {syncPopoverOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setSyncPopoverOpen(false)}
                />
                <div className="absolute right-0 top-full mt-2 w-80 max-w-[92vw] bg-white border border-[#D8CFC2] rounded-2xl shadow-xl p-4 z-50 text-xs text-[#1C1917] space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.16em] text-[#8C7A65] font-semibold">
                        État de la synchronisation
                      </p>
                      <p className="font-serif text-base font-medium text-[#1C1917] mt-0.5">
                        {cloudStatus === 'synchronisation'
                          ? 'Envoi vers le cloud en cours…'
                          : cloudStatus === 'quota'
                          ? 'Quota journalier Firebase atteint'
                          : totalPendingCount > 0
                          ? `${totalPendingCount} modification${totalPendingCount > 1 ? 's' : ''} en attente`
                          : cloudStatus === 'indisponible'
                          ? 'Mode hors ligne (local)'
                          : 'Arbre synchronisé pour la famille'}
                      </p>
                    </div>
                    <span
                      className={`h-2.5 w-2.5 rounded-full mt-1 shrink-0 ${
                        cloudStatus === 'synchronisation'
                          ? 'bg-[#274C77] animate-pulse'
                          : isWarningStatus
                          ? 'bg-[#C87D55]'
                          : 'bg-[#4D7A58]'
                      }`}
                    />
                  </div>

                  {totalPendingCount > 0 ? (
                    <div className="p-2.5 rounded-xl bg-[#FDF6EE] border border-[#E5C9A8] text-[#7D4B1D] space-y-1">
                      <p className="font-medium flex items-center gap-1.5">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        <span>Aucune donnée n’est perdue !</span>
                      </p>
                      <p className="leading-relaxed text-[11px]">
                        {pendingOutboxCount > 0 && (
                          <span>
                            • {pendingOutboxCount} modification{pendingOutboxCount > 1 ? 's' : ''} de fiche(s) en attente
                            <br />
                          </span>
                        )}
                        {pendingPhotosCount > 0 && (
                          <span>
                            • {pendingPhotosCount} portrait{pendingPhotosCount > 1 ? 's' : ''} en attente d’envoi
                            <br />
                          </span>
                        )}
                        Elles sont sauvegardées en sécurité sur cet appareil et seront envoyées automatiquement dès que Firebase sera disponible.
                      </p>
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-[#F0F7F2] border border-[#CDE5D5] text-[#2E6B3F] flex items-center gap-2">
                      <Check className="h-4 w-4 shrink-0" />
                      <span className="leading-snug">
                        Toutes vos fiches et photos sont bien enregistrées et partagées.
                      </span>
                    </div>
                  )}

                  {cloudStatus === 'quota' && (
                    <p className="text-[11px] text-[#6E665C] leading-relaxed">
                      La limite gratuite journalière de Firebase a été atteinte aujourd’hui. Elle se réinitialise automatiquement demain : gardez cet appareil, vos modifications partiront toutes seules.
                    </p>
                  )}

                  <div className="flex flex-col gap-1.5 pt-1 border-t border-[#F0ECE3]">
                    <button
                      type="button"
                      disabled={cloudStatus === 'synchronisation'}
                      onClick={() => void handleForceSyncNow()}
                      className="w-full py-2 px-3 rounded-xl text-white font-medium flex items-center justify-center gap-1.5 transition-opacity hover:opacity-95 disabled:opacity-60"
                      style={{ backgroundColor: accentColor }}
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${
                          cloudStatus === 'synchronisation' ? 'animate-spin' : ''
                        }`}
                      />
                      <span>Synchroniser maintenant</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleForceFullPhotoRefresh}
                      className="w-full py-1.5 px-3 rounded-xl border border-[#E0D7C9] bg-[#FAF8F5] hover:bg-[#EFECE4] text-[#575047] font-medium transition-colors"
                    >
                      Actualiser tous les portraits du cloud
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {activeTab === 'tree' && (
            <div className="md:hidden inline-flex items-center bg-[#FAF8F5] border border-[#E0D7C9] p-0.5 rounded-full">
              <button
                type="button"
                onClick={() => setMobileViewMode('canvas')}
                className={`min-h-[32px] px-2 text-xs font-medium rounded-full flex items-center gap-1 ${
                  mobileViewMode === 'canvas'
                    ? 'bg-white text-[#1C1917] shadow-2xs font-semibold'
                    : 'text-[#6E665C]'
                }`}
                title="Plan panoramique 2D"
              >
                <Network className="h-3.5 w-3.5" />
                <span className="hidden xs:inline">Arbre</span>
              </button>
              <button
                type="button"
                onClick={() => setMobileViewMode('touch')}
                className={`min-h-[32px] px-2 text-xs font-medium rounded-full flex items-center gap-1 ${
                  mobileViewMode === 'touch'
                    ? 'bg-white text-[#1C1917] shadow-2xs font-semibold'
                    : 'text-[#6E665C]'
                }`}
                title="Navigation par foyer"
              >
                <Smartphone className="h-3.5 w-3.5" />
                <span className="hidden xs:inline">Foyer</span>
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => handleOpenCreatePerson()}
            className="inline-flex min-h-[36px] px-2.5 sm:px-4 py-1.5 rounded-full text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0 hover:opacity-90 items-center justify-center gap-1.5"
            style={{ backgroundColor: accentColor }}
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Nouveau membre</span>
            <span className="sm:hidden">Ajouter</span>
          </button>
        </div>
      </header>

      {/* Non-intrusive Pending Sync / Quota Banner (visible on mobile & desktop whenever edits are waiting) */}
      {(totalPendingCount > 0 || cloudStatus === 'quota') && (
        <div className="bg-[#FDF6EE] border-b border-[#E5C9A8] px-4 py-2 text-xs text-[#7D4B1D] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-[#B46B27]" />
            <span>
              {cloudStatus === 'quota' ? (
                <>
                  <b>Quota Firebase du jour atteint.</b>{' '}
                  {totalPendingCount > 0
                    ? `${totalPendingCount} modification${totalPendingCount > 1 ? 's' : ''} sauvegardée${totalPendingCount > 1 ? 's' : ''} sur cet appareil — envoi automatique dès réinitialisation.`
                    : 'Vos consultations et exports PDF continuent de fonctionner normalement.'}
                </>
              ) : (
                <>
                  <b>
                    {totalPendingCount} modification{totalPendingCount > 1 ? 's' : ''} en attente d’envoi
                  </b>{' '}
                  (sauvegardée{totalPendingCount > 1 ? 's' : ''} en sécurité sur cet appareil).
                </>
              )}
            </span>
          </div>
          <button
            type="button"
            disabled={cloudStatus === 'synchronisation'}
            onClick={() => void handleForceSyncNow()}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white border border-[#D8B994] hover:bg-[#FAF1E6] text-[#7D4B1D] font-semibold whitespace-nowrap disabled:opacity-60"
          >
            <RefreshCw
              className={`h-3 w-3 ${cloudStatus === 'synchronisation' ? 'animate-spin' : ''}`}
            />
            <span>Réessayer</span>
          </button>
        </div>
      )}

      {/* Main Content View */}
      <main className="flex-1 flex flex-col">
        {activeTab === 'tree' && (
          <>
            <div className="md:hidden flex-1 flex flex-col">
              {mobileViewMode === 'touch' ? (
                <MobileGenealogyView
                  people={people}
                  settings={settings}
                  onSelectPerson={handleOpenPerson}
                  onAddChildFor={(parentId) => handleOpenCreatePerson(parentId)}
                  onSwitchToCanvas={() => setMobileViewMode('canvas')}
                  onOpenPhotoCropper={(personId) => setCropperPersonId(personId)}
                  onOpenPoster={() => setPosterModalOpen(true)}
                  onOpenShare={() => setShareModalOpen(true)}
                  accentColor={accentColor}
                />
              ) : (
                <TreeCanvasView
                  people={people}
                  settings={settings}
                  onUpdateSettings={handleUpdateSettings}
                  onSelectPerson={handleOpenPerson}
                  onAddChildFor={(parentId) => handleOpenCreatePerson(parentId)}
                  onOpenSettingsTab={() => setActiveTab('settings')}
                  onOpenPhotoCropper={(personId) => setCropperPersonId(personId)}
                  onOpenPoster={() => setPosterModalOpen(true)}
                  onOpenShare={() => setShareModalOpen(true)}
                  focusBranch={focusBranch}
                  onChangeFocusBranch={setFocusBranch}
                  accentColor={accentColor}
                />
              )}
            </div>

            <div className="hidden md:flex flex-col flex-1">
              <TreeCanvasView
                people={people}
                settings={settings}
                onUpdateSettings={handleUpdateSettings}
                onSelectPerson={handleOpenPerson}
                onAddChildFor={(parentId) => handleOpenCreatePerson(parentId)}
                onOpenSettingsTab={() => setActiveTab('settings')}
                onOpenPhotoCropper={(personId) => setCropperPersonId(personId)}
                onOpenPoster={() => setPosterModalOpen(true)}
                onOpenShare={() => setShareModalOpen(true)}
                focusBranch={focusBranch}
                onChangeFocusBranch={setFocusBranch}
                accentColor={accentColor}
              />
            </div>
          </>
        )}

        {activeTab === 'branches' && (
          <ChronicleBranchesView
            people={people}
            onSelectPerson={handleOpenPerson}
            onFocusBranchInTree={(branchId) => {
              setFocusBranch(branchId);
              setActiveTab('tree');
              setMobileViewMode('canvas');
            }}
            accentColor={accentColor}
          />
        )}

        {activeTab === 'settings' && (
          <StudioSettingsView
            people={people}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onResetSettings={handleResetSettings}
            onSavePerson={(p) => {
              void handleSavePerson(p);
            }}
            onDeletePerson={handleDeletePerson}
            onOpenPersonDrawer={handleOpenPerson}
            onAddChildFor={(parentId) => handleOpenCreatePerson(parentId)}
            onAddNewPerson={() => handleOpenCreatePerson()}
            onImportData={handleImportData}
            onRestoreInitialData={handleRestoreInitialData}
            onNotify={notify}
            onOpenPhotoCropper={(personId) => setCropperPersonId(personId)}
            photosMap={photosMap}
            accentColor={accentColor}
          />
        )}
      </main>

      {/* Ergonomic Fixed Bottom Tab Bar for Mobile Touch */}
      <nav
        aria-label="Navigation principale mobile"
        className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-white/95 backdrop-blur-md border-t border-[#E6DFD3] grid grid-cols-3 h-14 px-2 safe-area-pb"
      >
        <button
          type="button"
          onClick={() => setActiveTab('tree')}
          className={`flex flex-col items-center justify-center min-h-[44px] transition-colors ${
            activeTab === 'tree' ? 'text-[#1C1917]' : 'text-[#8C7A65]'
          }`}
        >
          <Network className="h-4.5 w-4.5" style={activeTab === 'tree' ? { color: accentColor } : undefined} />
          <span className={`text-[10px] mt-0.5 font-medium tracking-tight ${activeTab === 'tree' ? 'font-semibold' : ''}`}>
            L’Arbre
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('branches')}
          className={`flex flex-col items-center justify-center min-h-[44px] transition-colors ${
            activeTab === 'branches' ? 'text-[#1C1917]' : 'text-[#8C7A65]'
          }`}
        >
          <Layers className="h-4.5 w-4.5" style={activeTab === 'branches' ? { color: accentColor } : undefined} />
          <span className={`text-[10px] mt-0.5 font-medium tracking-tight ${activeTab === 'branches' ? 'font-semibold' : ''}`}>
            Branches
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('settings')}
          className={`flex flex-col items-center justify-center min-h-[44px] transition-colors ${
            activeTab === 'settings' ? 'text-[#1C1917]' : 'text-[#8C7A65]'
          }`}
        >
          <Sliders className="h-4.5 w-4.5" style={activeTab === 'settings' ? { color: accentColor } : undefined} />
          <span className={`text-[10px] mt-0.5 font-medium tracking-tight ${activeTab === 'settings' ? 'font-semibold' : ''}`}>
            Fiches & Photos
          </span>
        </button>
      </nav>

      {/* Slide-Over Person Portrait & Edit Drawer */}
      <PersonDrawer
        isOpen={drawerOpen}
        personId={selectedPersonId}
        preselectedParentId={preselectedParentId}
        preselectedParentIds={preselectedParentIds}
        people={people}
        onClose={() => setDrawerOpen(false)}
        onSavePerson={handleSavePerson}
        onDeletePerson={handleDeletePerson}
        onSelectPerson={(id) => setSelectedPersonId(id)}
        onFocusBranch={(id) => {
          setFocusBranch(id);
          setMobileViewMode('canvas');
          setActiveTab('tree');
        }}
        onAddChildFor={(parentId) => handleOpenCreatePerson(parentId)}
        onAddSiblingFor={(parentIds) => handleOpenCreateSibling(parentIds)}
        onSavePhoto={handleSavePersonPhoto}
        onRemovePhoto={handleRemovePersonPhoto}
        photosMap={photosMap}
        accentColor={accentColor}
      />

      {/* Standalone Photo Cropper Atelier */}
      {cropperPersonId && (
        <PhotoCropperModal
          isOpen={!!cropperPersonId}
          person={people.find((p) => p.id === cropperPersonId) || (people[0] as Person)}
          initialImageSrc={people.find((p) => p.id === cropperPersonId)?.photo}
          initialFilter={photosMap[cropperPersonId]?.filter || 'none'}
          initialShape={photosMap[cropperPersonId]?.shape || 'circle'}
          accentColor={accentColor}
          onClose={() => setCropperPersonId(null)}
          onSave={async (result) => {
            await handleSavePersonPhoto(cropperPersonId, result);
            setCropperPersonId(null);
          }}
        />
      )}

      {/* Standalone Live A3 Photo Poster Modal */}
      {posterModalOpen && (
        <FamilyPosterModal
          isOpen={posterModalOpen}
          onClose={() => setPosterModalOpen(false)}
          people={people}
          settings={settings}
          accentColor={accentColor}
          pendingSyncCount={totalPendingCount}
          cloudStatus={cloudStatus}
          onForceSync={handleForceSyncNow}
          onOpenShare={() => {
            setPosterModalOpen(false);
            setShareModalOpen(true);
          }}
        />
      )}

      {/* Standalone Share Family Modal */}
      {shareModalOpen && (
        <ShareFamilyModal
          isOpen={shareModalOpen}
          onClose={() => setShareModalOpen(false)}
          accentColor={accentColor}
          familyName={settings.familyName}
          peopleCount={people.length}
        />
      )}

      {/* Subtle Notification Toast */}
      {toastMsg && (
        <div
          role="status"
          className="fixed bottom-16 md:bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#1C1917] text-[#FAF8F5] px-5 py-2.5 rounded-full text-xs font-medium shadow-lg border border-[#3D3832] max-w-[92vw] text-center"
        >
          {toastMsg}
        </div>
      )}
    </div>
  );
}
