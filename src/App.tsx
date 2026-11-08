import React, { useState, useEffect, useCallback, useRef } from 'react';
import { User } from 'firebase/auth';
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
  GitFork,
  Layers,
  Sliders,
  Smartphone,
  Network,
  Cloud,
  CloudCheck,
  LogIn,
  LogOut,
  Camera
} from 'lucide-react';
import { testConnection } from './firebase/firebase';
import {
  subscribeToPersonPhotos,
  savePersonPhotoToFirestore,
  deletePersonPhotoFromFirestore,
  PersonPhotoRecord
} from './firebase/photoService';
import {
  signInWithGoogle,
  signOutCurrentUser,
  subscribeToAuth
} from './firebase/authService';

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
      // Also check legacy key from previous HTML file if any
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

  // Standalone Photo Cropper Atelier state (when launched from Studio or Tree)
  const [cropperPersonId, setCropperPersonId] = useState<string | null>(null);

  // Firebase Cloud Auth & Data state
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [photosMap, setPhotosMap] = useState<Record<string, PersonPhotoRecord>>({});
  const lastCloudPhotos = useRef<Record<string, PersonPhotoRecord>>({});
  const [cloudStatus, setCloudStatus] = useState<'chargement' | 'disponible' | 'cache' | 'indisponible'>('chargement');

  // Subtle toast notification
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const notify = useCallback((msg: string) => {
    setToastMsg(msg);
  }, []);

  // 1. Initial connection test to Firestore on boot
  useEffect(() => {
    testConnection().catch(() => {
      // Offline fallback
    });
  }, []);

  // 2. Subscribe to Firebase Auth state
  useEffect(() => {
    const unsub = subscribeToAuth((user) => {
      setCurrentUser(user);
    });
    return () => unsub();
  }, []);

  // 3. Subscribe to real-time Cloud Photos in Firestore
  useEffect(() => {
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
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 3400);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // Persist people changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_PEOPLE_KEY, JSON.stringify(people));
    } catch {
      notify('Espace local saturé : pensez à exporter votre sauvegarde JSON dans l’onglet Paramètres.');
    }
  }, [people, notify]);

  // Persist settings changes
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
    setSettings((prev) => ({ ...prev, ...partial }));
  };

  const handleResetSettings = () => {
    setSettings(DEFAULT_SETTINGS);
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
    setPeople((prev) => {
      const exists = prev.some((p) => p.id === updated.id);
      let nextList = exists
        ? prev.map((p) => (p.id === updated.id ? updated : p))
        : [...prev, updated];

      // If childIdsToAttach was provided from the PersonDrawer, synchronize parent links on children
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

      return nextList;
    });

    setSelectedPersonId(updated.id);
    notify(`Fiche de ${getFullName(updated)} enregistrée dans ce navigateur.`);
    if (!people.some(p => p.id === updated.id) && updated.photo) {
      void savePersonPhotoToFirestore({ personId: updated.id, photoDataUrl: updated.photo }).then(record => {
        setPhotosMap(prev => ({ ...prev, [updated.id]: record }));
        notify(`Portrait de ${getFullName(updated)} envoyé dans le cloud ; sa fiche reste locale.`);
      }).catch(() => notify(`Fiche et portrait de ${getFullName(updated)} enregistrés uniquement sur cet appareil.`));
    }
  };

  const handleDeletePerson = (id: string) => {
    const target = people.find((p) => p.id === id);
    setPeople((prev) =>
      prev
        .filter((p) => p.id !== id)
        .map((p) => ({
          ...p,
          parents: (p.parents || []).filter((pid) => pid !== id),
          spouses: (p.spouses || []).filter((sid) => sid !== id),
        }))
    );
    if (focusBranch === id) setFocusBranch('all');
    if (target) {
      notify(`${getFullName(target)} a été retiré(e) de l’arbre.`);
    }
  };

  const handleImportData = (importedPeople: Person[], importedSettings?: Partial<TreeSettings>) => {
    setPeople(importedPeople);
    if (importedSettings) {
      setSettings((prev) => ({ ...prev, ...importedSettings }));
    }
    setFocusBranch('all');
  };

  const handleRestoreInitialData = () => {
    setPeople(INITIAL_WICI_PEOPLE);
    setSettings(DEFAULT_SETTINGS);
    setFocusBranch('all');
    notify('Arbre initial de la famille Wici restauré.');
  };

  const handleSavePersonPhoto = async (personId: string, result: CropResult) => {
    // 1. Optimistic update in memory
    setPeople((prev) =>
      prev.map((p) => (p.id === personId ? { ...p, photo: result.dataUrl } : p))
    );

    const personObj = people.find((p) => p.id === personId);
    const personName = personObj ? getFullName(personObj) : 'Membre';

    try {
      const savedRecord = await savePersonPhotoToFirestore({
        personId,
        photoDataUrl: result.dataUrl,
        shape: result.shape,
        filter: result.filter,
        caption: result.caption,
      });

      setPhotosMap((prev) => ({ ...prev, [personId]: savedRecord }));
      notify(`Portrait de ${personName} synchronisé dans le Cloud Firebase.`);
    } catch (err: unknown) {
      console.warn('Sauvegarde Cloud Firestore différée ou restreinte:', err);
      notify(`Portrait de ${personName} sauvegardé localement dans l’arbre.`);
    }
  };

  const handleRemovePersonPhoto = async (personId: string) => {
    if (!currentUser) throw new Error('Connexion nécessaire pour supprimer le portrait partagé.');
    await deletePersonPhotoFromFirestore(personId);
    setPhotosMap(prev => { const next = { ...prev }; delete next[personId]; return next; });
  };

  const handleGoogleLogin = async () => {
    try {
      const user = await signInWithGoogle();
      notify(`Connecté avec ${user.displayName || user.email}. Les fiches restent locales ; seules les photos peuvent être partagées.`);
    } catch (e) {
      notify('Connexion Google annulée ou indisponible.');
    }
  };

  const handleGoogleLogout = async () => {
    try {
      await signOutCurrentUser();
      notify('Session fermée. Vos données locales restent disponibles.');
    } catch {
      // ignore
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col text-[#1C1917] transition-colors duration-200 pb-16 md:pb-0"
      style={{ backgroundColor: canvasBg }}
    >
      {/* Top Bar - Responsive Header with Brand & Mode Switch */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-4 px-4 sm:px-6 lg:px-10 h-14 sm:h-16 bg-white/95 backdrop-blur-md border-b border-[#E6DFD3]">
        {/* Zone 1: Brand title */}
        <a
          href="#arbre"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('tree');
          }}
          className="font-serif text-lg sm:text-2xl font-medium tracking-tight text-[#1C1917] whitespace-nowrap shrink-0"
        >
          {settings.familyName}
        </a>

        {/* Zone 2: Desktop Navigation Links (hidden on mobile, handled by bottom bar) */}
        <nav className="hidden md:flex items-center gap-6 lg:gap-8 text-sm font-medium text-[#6E665C]">
          <button
            type="button"
            onClick={() => setActiveTab('tree')}
            className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
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
            className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
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
            className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'settings'
                ? 'border-[#1C1917] text-[#1C1917]'
                : 'border-transparent hover:text-[#1C1917]'
            }`}
          >
            Atelier & Paramètres
          </button>
        </nav>

        {/* Zone 3: Cloud Sync, Mobile View Toggle & Action */}
        <div className="flex items-center gap-2.5 shrink-0">
          {/* Subtle Firebase Cloud Sync Status */}
          <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 bg-[#FAF8F5] border border-[#E6DFD3] text-xs">
            <span className="flex items-center gap-1.5 text-[#4D7A58] font-medium">
              <span className="h-2 w-2 rounded-full bg-[#4D7A58]" />
              <CloudCheck className="h-3.5 w-3.5" />
              <span>{cloudStatus === 'disponible' ? 'Photos connectées' : cloudStatus === 'cache' ? 'Photos en cache' : cloudStatus === 'indisponible' ? 'Photos indisponibles' : 'Connexion photos…'}</span>
            </span>
            <span className="text-[#D8CFC2]">·</span>
            {currentUser ? (
              <div className="flex items-center gap-1.5 text-[#1C1917]">
                <span className="max-w-[130px] truncate text-[11px] font-sans">
                  {currentUser.displayName || currentUser.email}
                </span>
                <button
                  type="button"
                  onClick={handleGoogleLogout}
                  title="Déconnexion Google"
                  className="text-[#8C7A65] hover:text-[#992B15] transition-colors p-0.5"
                >
                  <LogOut className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleGoogleLogin}
                className="text-[11px] font-medium text-[#8C7355] hover:text-[#1C1917] flex items-center gap-1 transition-colors"
                title="Se connecter avec Google pour persister les photos"
              >
                <LogIn className="h-3 w-3" />
                <span>Connexion</span>
              </button>
            )}
          </div>

          {activeTab === 'tree' && (
            <div className="md:hidden inline-flex items-center bg-[#FAF8F5] border border-[#E0D7C9] p-0.5 rounded-xs">
              <button
                type="button"
                onClick={() => setMobileViewMode('touch')}
                className={`min-h-[34px] px-2.5 text-xs font-medium rounded-2xs flex items-center gap-1 ${
                  mobileViewMode === 'touch'
                    ? 'bg-white text-[#1C1917] shadow-2xs font-semibold'
                    : 'text-[#6E665C]'
                }`}
                title="Affichage optimisé tactile"
              >
                <Smartphone className="h-3.5 w-3.5" />
                <span>Explorer</span>
              </button>
              <button
                type="button"
                onClick={() => setMobileViewMode('canvas')}
                className={`min-h-[34px] px-2.5 text-xs font-medium rounded-2xs flex items-center gap-1 ${
                  mobileViewMode === 'canvas'
                    ? 'bg-white text-[#1C1917] shadow-2xs font-semibold'
                    : 'text-[#6E665C]'
                }`}
                title="Plan panoramique 2D"
              >
                <Network className="h-3.5 w-3.5" />
                <span>Arbre</span>
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => handleOpenCreatePerson()}
            className="hidden sm:inline-flex min-h-[40px] px-4 py-2 text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0 hover:opacity-90 items-center justify-center"
            style={{ backgroundColor: accentColor }}
          >
            + Nouveau membre
          </button>
        </div>
      </header>

      {/* Main Content View */}
      <main className="flex-1 flex flex-col">
        {activeTab === 'tree' && (
          <>
            {/* On mobile: show touch-first list by default, allow toggle to canvas */}
            <div className="md:hidden">
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

            {/* On desktop: show full interactive canvas */}
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
            currentUser={currentUser}
            onGoogleLogin={handleGoogleLogin}
            onGoogleLogout={handleGoogleLogout}
            accentColor={accentColor}
          />
        )}
      </main>

      {/* Ergonomic Fixed Bottom Tab Bar for Mobile Touch (Pattern 1) */}
      <nav
        aria-label="Navigation principale mobile"
        className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-white/95 backdrop-blur-md border-t border-[#E6DFD3] grid grid-cols-3 h-16 px-2 safe-area-pb"
      >
        <button
          type="button"
          onClick={() => setActiveTab('tree')}
          className={`flex flex-col items-center justify-center min-h-[44px] transition-colors ${
            activeTab === 'tree' ? 'text-[#1C1917]' : 'text-[#8C7A65]'
          }`}
        >
          <Network className="h-5 w-5" style={activeTab === 'tree' ? { color: accentColor } : undefined} />
          <span className={`text-[10px] mt-1 font-medium tracking-tight ${activeTab === 'tree' ? 'font-semibold' : ''}`}>
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
          <Layers className="h-5 w-5" style={activeTab === 'branches' ? { color: accentColor } : undefined} />
          <span className={`text-[10px] mt-1 font-medium tracking-tight ${activeTab === 'branches' ? 'font-semibold' : ''}`}>
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
          <Sliders className="h-5 w-5" style={activeTab === 'settings' ? { color: accentColor } : undefined} />
          <span className={`text-[10px] mt-1 font-medium tracking-tight ${activeTab === 'settings' ? 'font-semibold' : ''}`}>
            Paramètres
          </span>
        </button>
      </nav>

      {/* Quiet Archival Footer (visible on desktop or scrolled end) */}
      <footer className="border-t border-[#E6DFD3] bg-white px-6 lg:px-10 py-5 hidden md:block">
        <div className="max-w-[1600px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#787167]">
          <p className="font-serif italic text-sm text-[#4A453E]">
            {settings.familyName} — Cinq générations d’histoire familiale préservées.
          </p>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setActiveTab('tree')}
              className="hover:text-[#1C1917] transition-colors"
            >
              Vue de l’arbre
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() => setActiveTab('branches')}
              className="hover:text-[#1C1917] transition-colors"
            >
              Les 5 branches
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className="hover:text-[#1C1917] transition-colors"
            >
              Paramétrage & Sauvegarde
            </button>
          </div>
        </div>
      </footer>

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

      {/* Standalone Photo Cropper Atelier (e.g. from Studio Gallery or direct link) */}
      {cropperPersonId && (
        <PhotoCropperModal
          isOpen={!!cropperPersonId}
          person={people.find((p) => p.id === cropperPersonId) || (people[0] as Person)}
          initialImageSrc={people.find((p) => p.id === cropperPersonId)?.photo}
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
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#1C1917] text-[#FAF8F5] px-5 py-2.5 text-xs font-medium shadow-lg border border-[#3D3832]"
        >
          {toastMsg}
        </div>
      )}
    </div>
  );
}
