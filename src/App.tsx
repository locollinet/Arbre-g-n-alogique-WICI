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
  UserPlus,
  Sparkles,
  Share2
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
  isFirestoreWriteQuotaExceeded,
  PersonPhotoRecord
} from './firebase/photoService';

const STORAGE_PEOPLE_KEY = 'wici-archive-people-v2';
const STORAGE_SETTINGS_KEY = 'wici-archive-settings-v2';

export default function App() {
  const [activeTab, setActiveTab] = useState<'tree' | 'branches' | 'settings'>('tree');
  const [focusBranch, setFocusBranch] = useState<string>('all');

  const [people, setPeople] = useState<Person[]>(() => {
    const seedPhotos = new Map(
      INITIAL_WICI_PEOPLE.filter((p) => !!p.photo).map((p) => [p.id, p.photo])
    );
    try {
      const savedV2 = localStorage.getItem(STORAGE_PEOPLE_KEY);
      if (savedV2) {
        const parsed = JSON.parse(savedV2);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((p: Person) => ({
            ...p,
            photo: p.photo || seedPhotos.get(p.id),
          }));
        }
      }
      const legacy = localStorage.getItem('wici-tree-v1');
      if (legacy) {
        const parsedLegacy = JSON.parse(legacy);
        if (Array.isArray(parsedLegacy) && parsedLegacy.length > 0) {
          return parsedLegacy.map((p: Person) => ({
            ...p,
            photo: p.photo || seedPhotos.get(p.id),
          }));
        }
      }
    } catch {
      // Fallback to initial seed
    }
    return INITIAL_WICI_PEOPLE;
  });

  const [mobileViewMode, setMobileViewMode] = useState<'touch' | 'canvas'>('canvas');

  const [settings, setSettings] = useState<TreeSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_SETTINGS_KEY);
      if (saved) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      }
    } catch {
      // Fallback
    }
    return DEFAULT_SETTINGS;
  });

  // Slide-over drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [preselectedParentId, setPreselectedParentId] = useState<string | null>(null);
  const [preselectedParentIds, setPreselectedParentIds] = useState<string[]>([]);

  // Standalone Photo Cropper Atelier state
  const [cropperPersonId, setCropperPersonId] = useState<string | null>(null);

  // Standalone A3 Art Poster & Share Modals
  const [posterModalOpen, setPosterModalOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);

  // Firebase Cloud Data state (No Auth required — direct link sharing)
  const [photosMap, setPhotosMap] = useState<Record<string, PersonPhotoRecord>>({});
  const lastCloudPhotos = useRef<Record<string, PersonPhotoRecord>>({});
  const [cloudStatus, setCloudStatus] = useState<'chargement' | 'disponible' | 'cache' | 'quota' | 'indisponible'>('chargement');
  const hasSeededArchiveRef = useRef(false);
  const hasReconciledInitialSeedRef = useRef(false);
  const settingsSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Helper to persist tree changes to Firestore and report real status
  const syncTreeToCloud = useCallback(
    async (nextPeople: Person[], nextSettings: TreeSettings): Promise<boolean> => {
      if (isFirestoreWriteQuotaExceeded()) {
        setCloudStatus('quota');
        return false;
      }
      try {
        await saveFamilyArchiveToFirestore(nextPeople, nextSettings);
        setCloudStatus('disponible');
        return true;
      } catch (err) {
        if (isQuotaExceededError(err)) {
          setCloudStatus('quota');
          console.warn('Quota journalier d’écriture Firestore atteint ; sauvegarde locale conservée.');
        } else {
          console.error('Erreur synchronisation Firestore:', err);
          setCloudStatus('indisponible');
        }
        return false;
      }
    },
    []
  );

  // 1. Initial connection test to Firestore & local IndexedDB photos load on boot
  useEffect(() => {
    testConnection().catch(() => {
      // Offline fallback
    });

    // Load any photos saved in IndexedDB (immune to 5MB localStorage quota)
    getAllPhotosFromIndexedDb()
      .then((localMap) => {
        if (Object.keys(localMap).length > 0) {
          setPeople((prev) => {
            let changed = false;
            const next = prev.map((p) => {
              const localPhoto = localMap[p.id]?.photoDataUrl;
              if (localPhoto && !p.photo) {
                changed = true;
                return { ...p, photo: localPhoto };
              }
              return p;
            });
            if (changed) {
              peopleRef.current = next;
              return next;
            }
            return prev;
          });
        }
      })
      .catch((err) => {
        console.warn('Chargement IndexedDB:', err);
      });

    // Deep local-only auto-recovery of any photos from browser cache (localStorage or IndexedDB).
    // IMPORTANT: never push cached photos back to Firestore automatically on boot —
    // doing so burns daily write units on every page load. Photos are synced to Firestore
    // only when explicitly uploaded or edited by the user.
    runFullPhotoRecovery(peopleRef.current).then(({ recoveredPhotos }) => {
      const recoveredIds = Object.keys(recoveredPhotos);
      if (recoveredIds.length === 0) return;

      setPeople((prev) => {
        let changed = false;
        const next = prev.map((p) => {
          const salvaged = recoveredPhotos[p.id];
          if (salvaged && !p.photo) {
            changed = true;
            return { ...p, photo: salvaged };
          }
          return p;
        });
        if (changed) {
          peopleRef.current = next;
          return next;
        }
        return prev;
      });
    });

    return () => {
      if (settingsSyncTimerRef.current) {
        clearTimeout(settingsSyncTimerRef.current);
      }
    };
  }, []);

  // 2. Subscribe to real-time Family Archive (people + settings) in Firestore
  useEffect(() => {
    const initialIds = new Set(INITIAL_WICI_PEOPLE.map((p) => p.id));

    const unsub = subscribeToFamilyArchive(
      (archiveRecord, fromCache) => {
        setCloudStatus(fromCache ? 'cache' : 'disponible');
        if (Array.isArray(archiveRecord.people) && archiveRecord.people.length > 0) {
          // If the cloud doc only has the untouched default seed while this browser
          // still holds locally added members (added before cloud was connected),
          // preserve and push those local members up to Firestore once.
          if (!fromCache && !hasReconciledInitialSeedRef.current) {
            hasReconciledInitialSeedRef.current = true;
            const cloudIds = new Set(archiveRecord.people.map((p) => p.id));
            const cloudIsOnlyDefaultSeed =
              archiveRecord.people.length === INITIAL_WICI_PEOPLE.length &&
              archiveRecord.people.every((p) => initialIds.has(p.id));
            const localExtraMembers = peopleRef.current.filter(
              (p) => !initialIds.has(p.id) && !cloudIds.has(p.id)
            );

            if (cloudIsOnlyDefaultSeed && localExtraMembers.length > 0 && !isFirestoreWriteQuotaExceeded()) {
              const mergedPeople = [...archiveRecord.people, ...localExtraMembers].map((cp) => ({
                ...cp,
                photo:
                  lastCloudPhotos.current[cp.id]?.photoDataUrl ||
                  peopleRef.current.find((lp) => lp.id === cp.id)?.photo ||
                  cp.photo,
              }));
              peopleRef.current = mergedPeople;
              setPeople(mergedPeople);
              void saveFamilyArchiveToFirestore(mergedPeople, settingsRef.current)
                .then(() => {
                  setCloudStatus('disponible');
                  notify(
                    `${localExtraMembers.length} membre(s) local(aux) synchronisé(s) vers le cloud.`
                  );
                })
                .catch((err) => {
                  if (isQuotaExceededError(err)) {
                    setCloudStatus('quota');
                  } else {
                    console.error('Erreur fusion initiale Firestore:', err);
                  }
                });
              return;
            }
          }

          setPeople((prev) => {
            // Merge cloud people with currently loaded photos without losing local portraits
            const prevPhotos = new Map(prev.map((p) => [p.id, p.photo]));
            const cloudPhotos = lastCloudPhotos.current;
            const next = archiveRecord.people.map((cp) => ({
              ...cp,
              photo: cloudPhotos[cp.id]?.photoDataUrl || prevPhotos.get(cp.id) || cp.photo,
            }));
            peopleRef.current = next;
            return next;
          });
        }
        if (archiveRecord.settings) {
          setSettings((prev) => ({ ...prev, ...archiveRecord.settings }));
        }
      },
      () => {
        // Document doesn't exist yet on Firestore: seed the database with our initial copy!
        if (!hasSeededArchiveRef.current && !isFirestoreWriteQuotaExceeded()) {
          hasSeededArchiveRef.current = true;
          hasReconciledInitialSeedRef.current = true;
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
          console.error('Erreur synchronisation archive Firestore:', err);
          setCloudStatus('indisponible');
        }
      }
    );
    return () => unsub();
  }, [notify]);

  // 3. Subscribe to real-time Cloud Photos in Firestore (strictly read-only listener)
  useEffect(() => {
    setCloudStatus('chargement');
    const unsub = subscribeToPersonPhotos(
      (cloudMap, fromCache) => {
        const prevCloud = lastCloudPhotos.current;
        lastCloudPhotos.current = cloudMap;
        if (!isFirestoreWriteQuotaExceeded()) {
          setCloudStatus(fromCache ? 'cache' : 'disponible');
        }
        setPhotosMap(cloudMap);
        // Seamlessly merge cloud photos without ever deleting local portraits
        setPeople((prev) => {
          let hasDiff = false;
          const next = prev.map((p) => {
            const cloudPhoto = cloudMap[p.id]?.photoDataUrl;
            if (cloudPhoto && cloudPhoto !== p.photo) {
              hasDiff = true;
              return { ...p, photo: cloudPhoto };
            }
            return p;
          });
          return hasDiff ? next : prev;
        });

        // Cache only newly arrived or updated cloud photos in IndexedDB
        Object.values(cloudMap).forEach((rec) => {
          if (
            rec.personId &&
            rec.photoDataUrl &&
            prevCloud[rec.personId]?.photoDataUrl !== rec.photoDataUrl
          ) {
            void savePhotoToIndexedDb({
              personId: rec.personId,
              photoDataUrl: rec.photoDataUrl,
              shape: rec.shape,
              filter: rec.filter,
              caption: rec.caption,
              updatedAt: rec.updatedAt,
            });
          }
        });
      },
      (err) => {
        if (isQuotaExceededError(err)) {
          setCloudStatus('quota');
        } else {
          setCloudStatus('indisponible');
          console.warn('Real-time photo sync note:', err);
        }
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 3400);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // Persist people changes locally (without heavy base64 strings if already in cloud to keep localStorage light)
  useEffect(() => {
    try {
      const compactPeople = people.map((p) =>
        photosMap[p.id] ? { ...p, photo: undefined } : p
      );
      localStorage.setItem(STORAGE_PEOPLE_KEY, JSON.stringify(compactPeople));
    } catch {
      // ignore storage quota warning since Firebase holds the main copy
    }
  }, [people, photosMap]);

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
    const next = { ...settingsRef.current, ...partial };
    settingsRef.current = next;
    setSettings(next);
    // Debounce cloud writes so typing in title/subtitle/motto sends 1 write instead of 1 per keystroke
    if (settingsSyncTimerRef.current) {
      clearTimeout(settingsSyncTimerRef.current);
    }
    settingsSyncTimerRef.current = setTimeout(() => {
      settingsSyncTimerRef.current = null;
      void syncTreeToCloud(peopleRef.current, settingsRef.current);
    }, 1200);
  };

  const handleResetSettings = () => {
    settingsRef.current = DEFAULT_SETTINGS;
    setSettings(DEFAULT_SETTINGS);
    void syncTreeToCloud(peopleRef.current, DEFAULT_SETTINGS).then((ok) => {
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

  const handleSavePerson = (updated: Person, childIdsToAttach?: string[]) => {
    const prevList = peopleRef.current;
    const prevPerson = prevList.find((p) => p.id === updated.id);
    const isNewPerson = !prevPerson;
    const prevSpouses = new Set(prevPerson?.spouses || []);
    const nextSpouses = new Set(updated.spouses || []);
    const spousesChanged =
      prevSpouses.size !== nextSpouses.size ||
      Array.from(nextSpouses).some((id) => !prevSpouses.has(id));

    let nextList = isNewPerson
      ? [...prevList, updated]
      : prevList.map((p) => (p.id === updated.id ? updated : p));

    if (childIdsToAttach) {
      const childSet = new Set(childIdsToAttach);
      nextList = nextList.map((p) => {
        if (p.id === updated.id) return p;
        const currentlyHasParent = (p.parents || []).includes(updated.id);
        if (childSet.has(p.id) && !currentlyHasParent) {
          return { ...p, parents: [...(p.parents || []), updated.id] };
        }
        if (!childSet.has(p.id) && currentlyHasParent) {
          return { ...p, parents: (p.parents || []).filter((id) => id !== updated.id) };
        }
        return p;
      });
    }

    if (spousesChanged) {
      nextList = nextList.map((p) => {
        if (p.id === updated.id) return p;
        const shouldLink = nextSpouses.has(p.id);
        const wasLinked = prevSpouses.has(p.id);
        const hasBackLink = (p.spouses || []).includes(updated.id);
        if (shouldLink && !hasBackLink) {
          return { ...p, spouses: [...(p.spouses || []), updated.id] };
        }
        if (!shouldLink && wasLinked && hasBackLink) {
          return { ...p, spouses: (p.spouses || []).filter((id) => id !== updated.id) };
        }
        return p;
      });
    }

    peopleRef.current = nextList;
    setPeople(nextList);
    setSelectedPersonId(updated.id);

    void syncTreeToCloud(nextList, settingsRef.current).then((ok) => {
      notify(
        ok
          ? `Fiche de ${getFullName(updated)} enregistrée et synchronisée pour toute la famille.`
          : isFirestoreWriteQuotaExceeded()
          ? `Fiche de ${getFullName(updated)} enregistrée localement (quota journalier Firebase atteint — reprise demain).`
          : `Fiche de ${getFullName(updated)} enregistrée localement (synchronisation cloud indisponible).`
      );
    });

    if (isNewPerson && updated.photo) {
      void savePhotoToIndexedDb({
        personId: updated.id,
        photoDataUrl: updated.photo,
        updatedAt: new Date().toISOString(),
      });
      if (!isFirestoreWriteQuotaExceeded()) {
        void savePersonPhotoToFirestore({ personId: updated.id, photoDataUrl: updated.photo })
          .then((record) => {
            setPhotosMap((prev) => ({ ...prev, [updated.id]: record }));
          })
          .catch((err) => {
            if (isQuotaExceededError(err)) {
              setCloudStatus('quota');
            } else {
              console.error('Erreur enregistrement photo Firestore:', err);
            }
          });
      }
    }
  };

  const handleDeletePerson = (id: string) => {
    const prevList = peopleRef.current;
    const target = prevList.find((p) => p.id === id);
    const nextList = prevList
      .filter((p) => p.id !== id)
      .map((p) => ({
        ...p,
        parents: (p.parents || []).filter((pid) => pid !== id),
        spouses: (p.spouses || []).filter((sid) => sid !== id),
      }));

    peopleRef.current = nextList;
    setPeople(nextList);
    if (focusBranch === id) setFocusBranch('all');

    void syncTreeToCloud(nextList, settingsRef.current).then((ok) => {
      if (target) {
        notify(
          ok
            ? `${getFullName(target)} a été retiré(e) de l’arbre pour toute la famille.`
            : `${getFullName(target)} retiré(e) localement (synchronisation cloud indisponible).`
        );
      }
    });
  };

  const handleImportData = (importedPeople: Person[], importedSettings?: Partial<TreeSettings>) => {
    const nextSettings = importedSettings
      ? { ...settingsRef.current, ...importedSettings }
      : settingsRef.current;
    peopleRef.current = importedPeople;
    setPeople(importedPeople);
    if (importedSettings) {
      settingsRef.current = nextSettings;
      setSettings(nextSettings);
    }
    setFocusBranch('all');
    void syncTreeToCloud(importedPeople, nextSettings);

    // Enregistrement immédiat de toutes les photos dans IndexedDB
    for (const p of importedPeople) {
      if (p.photo) {
        void savePhotoToIndexedDb({
          personId: p.id,
          photoDataUrl: p.photo,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  };

  const handleRestoreInitialData = () => {
    const withPhotos = INITIAL_WICI_PEOPLE.map((p) => ({
      ...p,
      photo: photosMap[p.id]?.photoDataUrl || p.photo,
    }));
    peopleRef.current = withPhotos;
    settingsRef.current = DEFAULT_SETTINGS;
    setPeople(withPhotos);
    setSettings(DEFAULT_SETTINGS);
    setFocusBranch('all');
    void syncTreeToCloud(withPhotos, DEFAULT_SETTINGS).then((ok) => {
      notify(
        ok
          ? 'Arbre initial de la famille Wici restauré et synchronisé.'
          : 'Arbre initial restauré localement (synchronisation cloud indisponible).'
      );
    });
  };

  const handleSavePersonPhoto = async (personId: string, result: CropResult) => {
    // 1. Mise à jour immédiate de l'état React
    setPeople((prev) =>
      prev.map((p) => (p.id === personId ? { ...p, photo: result.dataUrl } : p))
    );

    const personObj = people.find((p) => p.id === personId);
    const personName = personObj ? getFullName(personObj) : 'Membre';

    // 2. Sauvegarde permanente et garantie dans IndexedDB (espace illimité)
    await savePhotoToIndexedDb({
      personId,
      photoDataUrl: result.dataUrl,
      shape: result.shape,
      filter: result.filter,
      caption: result.caption,
      updatedAt: new Date().toISOString(),
    });

    // 3. Sauvegarde dans Firestore si connecté et quota disponible
    if (isFirestoreWriteQuotaExceeded()) {
      setCloudStatus('quota');
      notify(`Portrait de ${personName} enregistré sur cet appareil (quota Firebase atteint pour aujourd’hui).`);
      return;
    }

    try {
      const savedRecord = await savePersonPhotoToFirestore({
        personId,
        photoDataUrl: result.dataUrl,
        shape: result.shape,
        filter: result.filter,
        caption: result.caption,
      });

      if (savedRecord) {
        setPhotosMap((prev) => ({ ...prev, [personId]: savedRecord }));
        notify(`Portrait de ${personName} sauvegardé et synchronisé.`);
      }
    } catch (err: unknown) {
      if (isQuotaExceededError(err)) {
        setCloudStatus('quota');
        notify(`Portrait de ${personName} sauvegardé sur cet appareil (quota journalier Firebase atteint — reprise demain).`);
      } else {
        console.warn('Sauvegarde Cloud Firestore différée:', err);
        notify(`Portrait de ${personName} sauvegardé en sécurité sur votre appareil.`);
      }
    }
  };

  const handleRemovePersonPhoto = async (personId: string) => {
    await deletePhotoFromIndexedDb(personId);
    await deletePersonPhotoFromFirestore(personId).catch(() => {});
    setPeople((prev) =>
      prev.map((p) => (p.id === personId ? { ...p, photo: undefined } : p))
    );
    setPhotosMap((prev) => {
      const next = { ...prev };
      delete next[personId];
      return next;
    });
  };

  return (
    <div
      className="min-h-screen flex flex-col text-[#1C1917] transition-colors duration-200 pb-14 md:pb-0"
      style={{ backgroundColor: canvasBg }}
    >
      {/* Top Bar - Clean, Responsive Header */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 px-4 sm:px-6 lg:px-8 h-14 bg-white/95 backdrop-blur-md border-b border-[#E6DFD3]">
        {/* Zone 1: Brand title + member count */}
        <div className="flex items-baseline gap-3 shrink-0">
          <a
            href="#arbre"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('tree');
            }}
            className="font-serif text-xl sm:text-2xl font-medium tracking-tight text-[#1C1917] whitespace-nowrap"
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

        {/* Zone 3: Planche A3 d'Art, Partager, Cloud Sync & Add Person */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Bouton Doré Dédié : Arbre A3 d'Art */}
          <button
            type="button"
            onClick={() => setPosterModalOpen(true)}
            className="inline-flex min-h-[36px] px-3 sm:px-3.5 py-1.5 rounded-full text-xs font-semibold text-white transition-all whitespace-nowrap shrink-0 hover:opacity-95 items-center justify-center gap-1.5 shadow-xs active:scale-[0.98]"
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

          <div className="hidden lg:flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FAF8F5] border border-[#E6DFD3] text-xs">
            <span
              className={`h-2 w-2 rounded-full ${
                cloudStatus === 'indisponible' || cloudStatus === 'quota' ? 'bg-[#C87D55]' : 'bg-[#4D7A58]'
              }`}
            />
            <CloudCheck
              className={`h-3.5 w-3.5 ${
                cloudStatus === 'indisponible' || cloudStatus === 'quota' ? 'text-[#A05A37]' : 'text-[#4D7A58]'
              }`}
            />
            <span
              className={`font-medium ${
                cloudStatus === 'indisponible' || cloudStatus === 'quota' ? 'text-[#A05A37]' : 'text-[#4D7A58]'
              }`}
            >
              {cloudStatus === 'disponible'
                ? 'Synchronisé Firebase'
                : cloudStatus === 'cache'
                ? 'Synchronisé (cache)'
                : cloudStatus === 'quota'
                ? 'Quota atteint · local'
                : cloudStatus === 'indisponible'
                ? 'Sauvegarde locale'
                : 'Connexion…'}
            </span>
          </div>

          {activeTab === 'tree' && (
            <div className="md:hidden inline-flex items-center bg-[#FAF8F5] border border-[#E0D7C9] p-0.5 rounded-full">
              <button
                type="button"
                onClick={() => setMobileViewMode('canvas')}
                className={`min-h-[32px] px-2.5 text-xs font-medium rounded-full flex items-center gap-1 ${
                  mobileViewMode === 'canvas'
                    ? 'bg-white text-[#1C1917] shadow-2xs font-semibold'
                    : 'text-[#6E665C]'
                }`}
                title="Plan panoramique 2D"
              >
                <Network className="h-3.5 w-3.5" />
                <span>Arbre</span>
              </button>
              <button
                type="button"
                onClick={() => setMobileViewMode('touch')}
                className={`min-h-[32px] px-2.5 text-xs font-medium rounded-full flex items-center gap-1 ${
                  mobileViewMode === 'touch'
                    ? 'bg-white text-[#1C1917] shadow-2xs font-semibold'
                    : 'text-[#6E665C]'
                }`}
                title="Navigation par foyer"
              >
                <Smartphone className="h-3.5 w-3.5" />
                <span>Foyer</span>
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => handleOpenCreatePerson()}
            className="inline-flex min-h-[36px] px-3 sm:px-4 py-1.5 rounded-full text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0 hover:opacity-90 items-center justify-center gap-1.5"
            style={{ backgroundColor: accentColor }}
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Nouveau membre</span>
            <span className="sm:hidden">Ajouter</span>
          </button>
        </div>
      </header>

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
            onSavePerson={(p) => handleSavePerson(p)}
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
          className="fixed bottom-16 md:bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#1C1917] text-[#FAF8F5] px-5 py-2.5 rounded-full text-xs font-medium shadow-lg border border-[#3D3832]"
        >
          {toastMsg}
        </div>
      )}
    </div>
  );
}
