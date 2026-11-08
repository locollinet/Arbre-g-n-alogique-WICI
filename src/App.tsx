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
  UserPlus
} from 'lucide-react';
import { testConnection } from './firebase/firebase';
import {
  subscribeToPersonPhotos,
  savePersonPhotoToFirestore,
  deletePersonPhotoFromFirestore,
  subscribeToFamilyArchive,
  saveFamilyArchiveToFirestore,
  PersonPhotoRecord
} from './firebase/photoService';

const STORAGE_PEOPLE_KEY = 'wici-archive-people-v2';
const STORAGE_SETTINGS_KEY = 'wici-archive-settings-v2';

export default function App() {
  const [activeTab, setActiveTab] = useState<'tree' | 'branches' | 'settings'>('tree');
  const [focusBranch, setFocusBranch] = useState<string>('all');

  const [people, setPeople] = useState<Person[]>(() => {
    try {
      const savedV2 = localStorage.getItem(STORAGE_PEOPLE_KEY);
      if (savedV2) {
        const parsed = JSON.parse(savedV2);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      const legacy = localStorage.getItem('wici-tree-v1');
      if (legacy) {
        const parsedLegacy = JSON.parse(legacy);
        if (Array.isArray(parsedLegacy) && parsedLegacy.length > 0) return parsedLegacy;
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

  // Standalone Photo Cropper Atelier state
  const [cropperPersonId, setCropperPersonId] = useState<string | null>(null);

  // Firebase Cloud Data state (No Auth required — direct link sharing)
  const [photosMap, setPhotosMap] = useState<Record<string, PersonPhotoRecord>>({});
  const lastCloudPhotos = useRef<Record<string, PersonPhotoRecord>>({});
  const [cloudStatus, setCloudStatus] = useState<'chargement' | 'disponible' | 'cache' | 'indisponible'>('chargement');
  const hasSeededArchiveRef = useRef(false);

  // Subtle toast notification
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const notify = useCallback((msg: string) => {
    setToastMsg(msg);
  }, []);

  // Helper to persist tree changes to Firestore in the background
  const syncTreeToCloud = useCallback(
    (nextPeople: Person[], nextSettings: TreeSettings) => {
      saveFamilyArchiveToFirestore(nextPeople, nextSettings)
        .then(() => {
          setCloudStatus('disponible');
        })
        .catch((err) => {
          console.warn('Synchronisation Firestore différée:', err);
        });
    },
    []
  );

  // 1. Initial connection test to Firestore on boot
  useEffect(() => {
    testConnection().catch(() => {
      // Offline fallback
    });
  }, []);

  // 2. Subscribe to real-time Family Archive (people + settings) in Firestore
  useEffect(() => {
    const unsub = subscribeToFamilyArchive(
      (archiveRecord, fromCache) => {
        setCloudStatus(fromCache ? 'cache' : 'disponible');
        if (Array.isArray(archiveRecord.people) && archiveRecord.people.length > 0) {
          setPeople((prev) => {
            // Merge cloud people with currently loaded photos
            const prevPhotos = new Map(prev.map((p) => [p.id, p.photo]));
            const cloudPhotos = lastCloudPhotos.current;
            return archiveRecord.people.map((cp) => ({
              ...cp,
              photo: cloudPhotos[cp.id]?.photoDataUrl || prevPhotos.get(cp.id) || cp.photo,
            }));
          });
        }
        if (archiveRecord.settings) {
          setSettings((prev) => ({ ...prev, ...archiveRecord.settings }));
        }
      },
      () => {
        // Document doesn't exist yet on Firestore: seed the database with our initial copy!
        if (!hasSeededArchiveRef.current) {
          hasSeededArchiveRef.current = true;
          saveFamilyArchiveToFirestore(people, settings)
            .then(() => setCloudStatus('disponible'))
            .catch(() => {});
        }
      },
      () => {
        setCloudStatus('indisponible');
      }
    );
    return () => unsub();
  }, []);

  // 3. Subscribe to real-time Cloud Photos in Firestore only when authenticated
  useEffect(() => {
    if (!authInitialized) return;

    if (!currentUser) {
      setCloudStatus('non-connecté');
      setPhotosMap({});
      return;
    }

    setCloudStatus('chargement');
    const unsub = subscribeToPersonPhotos(
      (cloudMap, fromCache) => {
        const previous = lastCloudPhotos.current;
        lastCloudPhotos.current = cloudMap;
        setCloudStatus(fromCache ? 'cache' : 'disponible');
        setPhotosMap(cloudMap);
        // Seamlessly merge cloud photos into local people state
        setPeople((prev) => {
          let hasDiff = false;
          const next = prev.map((p) => {
            const cloudPhoto = cloudMap[p.id]?.photoDataUrl;
            if (cloudPhoto && cloudPhoto !== p.photo) {
              hasDiff = true;
              return { ...p, photo: cloudPhoto };
            }
            if (!cloudPhoto && previous[p.id] && p.photo === previous[p.id].photoDataUrl) {
              hasDiff = true;
              return { ...p, photo: undefined };
            }
            return p;
          });
          return hasDiff ? next : prev;
        });
      },
      (err) => {
        setCloudStatus('indisponible');
        console.warn('Real-time photo sync note:', err);
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
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      syncTreeToCloud(people, next);
      return next;
    });
  };

  const handleResetSettings = () => {
    setSettings(DEFAULT_SETTINGS);
    syncTreeToCloud(people, DEFAULT_SETTINGS);
    notify('Réglages esthétiques restaurés aux valeurs par défaut.');
  };

  const handleOpenPerson = (id: string) => {
    setPreselectedParentId(null);
    setSelectedPersonId(id);
    setDrawerOpen(true);
  };

  const handleOpenCreatePerson = (parentId?: string) => {
    setPreselectedParentId(parentId || null);
    setSelectedPersonId('new');
    setDrawerOpen(true);
  };

  const handleSavePerson = (updated: Person, childIdsToAttach?: string[]) => {
    const isNewPerson = !people.some((p) => p.id === updated.id);
    setPeople((prev) => {
      const exists = prev.some((p) => p.id === updated.id);
      let nextList = exists
        ? prev.map((p) => (p.id === updated.id ? updated : p))
        : [...prev, updated];

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

      syncTreeToCloud(nextList, settings);
      return nextList;
    });

    setSelectedPersonId(updated.id);
    notify(`Fiche de ${getFullName(updated)} enregistrée et synchronisée.`);

    if (isNewPerson && updated.photo) {
      void savePersonPhotoToFirestore({ personId: updated.id, photoDataUrl: updated.photo })
        .then((record) => {
          setPhotosMap((prev) => ({ ...prev, [updated.id]: record }));
        })
        .catch(() => {});
    }
  };

  const handleDeletePerson = (id: string) => {
    const target = people.find((p) => p.id === id);
    setPeople((prev) => {
      const nextList = prev
        .filter((p) => p.id !== id)
        .map((p) => ({
          ...p,
          parents: (p.parents || []).filter((pid) => pid !== id),
          spouses: (p.spouses || []).filter((sid) => sid !== id),
        }));
      syncTreeToCloud(nextList, settings);
      return nextList;
    });
    if (focusBranch === id) setFocusBranch('all');
    if (target) {
      notify(`${getFullName(target)} a été retiré(e) de l’arbre.`);
    }
  };

  const handleImportData = (importedPeople: Person[], importedSettings?: Partial<TreeSettings>) => {
    const nextSettings = importedSettings ? { ...settings, ...importedSettings } : settings;
    setPeople(importedPeople);
    if (importedSettings) {
      setSettings(nextSettings);
    }
    setFocusBranch('all');
    syncTreeToCloud(importedPeople, nextSettings);
  };

  const handleRestoreInitialData = () => {
    const withPhotos = INITIAL_WICI_PEOPLE.map((p) => ({
      ...p,
      photo: photosMap[p.id]?.photoDataUrl || p.photo,
    }));
    setPeople(withPhotos);
    setSettings(DEFAULT_SETTINGS);
    setFocusBranch('all');
    syncTreeToCloud(withPhotos, DEFAULT_SETTINGS);
    notify('Arbre initial de la famille Wici restauré et synchronisé.');
  };

  const handleSavePersonPhoto = async (personId: string, result: CropResult) => {
    setPeople((prev) =>
      prev.map((p) => (p.id === personId ? { ...p, photo: result.dataUrl } : p))
    );

    const personObj = people.find((p) => p.id === personId);
    const personName = personObj ? getFullName(personObj) : 'Membre';

    if (!currentUser) {
      notify(`Portrait de ${personName} sauvegardé localement sur cet appareil.`);
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

      setPhotosMap((prev) => ({ ...prev, [personId]: savedRecord }));
      notify(`Portrait de ${personName} enregistré dans le Cloud Firebase.`);
    } catch (err: unknown) {
      console.warn('Sauvegarde Cloud Firestore différée:', err);
      notify(`Portrait de ${personName} enregistré localement.`);
    }
  };

  const handleRemovePersonPhoto = async (personId: string) => {
    await deletePersonPhotoFromFirestore(personId);
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

        {/* Zone 3: Cloud Sync Pill, Mobile View Toggle & Add Person */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden lg:flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FAF8F5] border border-[#E6DFD3] text-xs">
            <span
              className={`h-2 w-2 rounded-full ${
                cloudStatus === 'indisponible' ? 'bg-[#C87D55]' : 'bg-[#4D7A58]'
              }`}
            />
            <CloudCheck className="h-3.5 w-3.5 text-[#4D7A58]" />
            <span className="text-[#4D7A58] font-medium">
              {cloudStatus === 'disponible'
                ? 'Synchronisé Firebase'
                : cloudStatus === 'cache'
                ? 'Synchronisé (cache)'
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
