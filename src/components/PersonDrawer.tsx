import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  UserPlus,
  Sparkles,
  Camera,
  Trash2,
  GitBranch,
  Check,
  Search,
  ChevronRight,
  Heart,
  Users,
  Calendar,
  MapPin,
  BookOpen,
  Cloud,
  CloudCheck,
  Crop
} from 'lucide-react';
import {
  Person,
  getFullName,
  getInitials,
  getLifeDates,
  isPersonIncomplete
} from '../data/wiciFamily';
import { getAncestorsSet, getDescendantsSet } from '../utils/treeLayout';
import { validatePeople } from '../utils/validateFamily';
import { PhotoCropperModal, CropResult } from './PhotoCropperModal';
import { PersonPhotoRecord } from '../firebase/photoService';

interface PersonDrawerProps {
  isOpen: boolean;
  personId: string | null; // null if closed, 'new' if creating new person
  preselectedParentId?: string | null;
  people: Person[];
  onClose: () => void;
  onSavePerson: (person: Person, childIdsToAttach?: string[]) => void;
  onDeletePerson: (id: string) => void;
  onSelectPerson: (id: string) => void;
  onFocusBranch: (id: string) => void;
  onAddChildFor: (parentId: string) => void;
  onSavePhoto?: (personId: string, result: CropResult) => Promise<void> | void;
  onRemovePhoto?: (personId: string) => Promise<void>;
  photosMap?: Record<string, PersonPhotoRecord>;
  accentColor: string;
}

export const PersonDrawer: React.FC<PersonDrawerProps> = ({
  isOpen,
  personId,
  preselectedParentId,
  people,
  onClose,
  onSavePerson,
  onDeletePerson,
  onSelectPerson,
  onFocusBranch,
  onAddChildFor,
  onSavePhoto,
  onRemovePhoto,
  photosMap,
  accentColor,
}) => {
  const isNew = personId === 'new';
  const existingPerson = !isNew && personId ? people.find((p) => p.id === personId) : null;

  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [birth, setBirth] = useState('');
  const [death, setDeath] = useState('');
  const [location, setLocation] = useState('');
  const [occupation, setOccupation] = useState('');
  const [notes, setNotes] = useState('');
  const [parents, setParents] = useState<string[]>([]);
  const [spouses, setSpouses] = useState<string[]>([]);
  const [childrenIds, setChildrenIds] = useState<string[]>([]);
  const [photo, setPhoto] = useState<string>('');
  const [parentQuery, setParentQuery] = useState('');
  const [childQuery, setChildQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Photo Cropper Atelier state
  const [isCropperOpen, setIsCropperOpen] = useState(false);
  const [cropperSource, setCropperSource] = useState<string | undefined>(undefined);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setErrorMsg(null);
    setConfirmDelete(false);
    setParentQuery('');
    setChildQuery('');

    if (isNew) {
      setMode('edit');
      const parentObj = preselectedParentId ? people.find((p) => p.id === preselectedParentId) : null;
      setFirst('');
      setLast(parentObj?.last || '');
      setBirth('');
      setDeath('');
      setLocation('');
      setOccupation('');
      setNotes('');
      setParents(preselectedParentId ? [preselectedParentId] : []);
      setSpouses([]);
      setChildrenIds([]);
      setPhoto('');
    } else if (existingPerson) {
      setMode('view');
      setFirst(existingPerson.first || '');
      setLast(existingPerson.last || '');
      setBirth(existingPerson.birth || '');
      setDeath(existingPerson.death || '');
      setLocation(existingPerson.location || '');
      setOccupation(existingPerson.occupation || '');
      setNotes(existingPerson.notes || '');
      setParents(existingPerson.parents || []);
      setSpouses(existingPerson.spouses || []);
      const currentKids = people
        .filter((p) => (p.parents || []).includes(existingPerson.id))
        .map((p) => p.id);
      setChildrenIds(currentKids);
      setPhoto(existingPerson.photo || '');
    }
  }, [isOpen, personId, preselectedParentId]);

  if (!isOpen || (!existingPerson && !isNew)) return null;

  const byId = new Map(people.map((p) => [p.id, p]));

  // Family relationships for view mode
  const parentObjects = (existingPerson?.parents || [])
    .map((id) => byId.get(id))
    .filter(Boolean) as Person[];

  const childObjects = existingPerson
    ? people.filter((p) => (p.parents || []).includes(existingPerson.id))
    : [];

  // Co-parents (other parent of my children or explicit spouses)
  const coParentSet = new Set<string>(existingPerson?.spouses || []);
  for (const ch of childObjects) {
    for (const pid of ch.parents || []) {
      if (pid !== existingPerson?.id) coParentSet.add(pid);
    }
  }
  const spouseObjects = Array.from(coParentSet)
    .map((id) => byId.get(id))
    .filter(Boolean) as Person[];

  // Siblings
  const siblingObjects =
    existingPerson && existingPerson.parents.length > 0
      ? people.filter(
          (p) =>
            p.id !== existingPerson.id &&
            (p.parents || []).some((pid) => existingPerson.parents.includes(pid))
        )
      : [];

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCropperSource(reader.result as string);
      setIsCropperOpen(true);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleOpenCropper = (existingSrc?: string) => {
    setCropperSource(existingSrc || photo || existingPerson?.photo || undefined);
    setIsCropperOpen(true);
  };

  const handleCropperSave = async (result: CropResult) => {
    setPhoto(result.dataUrl);
    if (existingPerson && onSavePhoto) {
      await onSavePhoto(existingPerson.id, result);
    }
    setIsCropperOpen(false);
  };

  const handleRemoveCurrentPhoto = async () => {
    setPhoto('');
    if (existingPerson) {
      if (onRemovePhoto) {
        try {
          await onRemovePhoto(existingPerson.id);
        } catch {
          // ignore offline remove error
        }
      }
      onSavePerson({ ...existingPerson, photo: undefined });
    }
  };

  const toggleParent = (id: string) => {
    if (existingPerson) {
      const desc = getDescendantsSet(people, existingPerson.id);
      if (desc.has(id)) {
        setErrorMsg("Impossible de sélectionner un descendant comme parent (boucle généalogique).");
        return;
      }
    }
    setErrorMsg(null);
    setParents((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleChild = (id: string) => {
    if (parents.includes(id) || (existingPerson && getAncestorsSet(people, existingPerson.id).has(id))) {
      setErrorMsg("Impossible de sélectionner un ancêtre comme enfant (boucle généalogique).");
      return;
    }
    setErrorMsg(null);
    setChildrenIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!first.trim()) {
      setErrorMsg("Le prénom est requis.");
      return;
    }
    const targetId = isNew
      ? `wici-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`
      : existingPerson!.id;

    const updated: Person = {
      id: targetId,
      first: first.trim(),
      last: last.trim(),
      birth: birth.trim(),
      death: death.trim(),
      location: location.trim(),
      occupation: occupation.trim(),
      notes: notes.trim(),
      parents,
      spouses,
      photo: photo || undefined,
    };

    const prospective = (isNew ? [...people, updated] : people.map(p => p.id === updated.id ? updated : p)).map(p => {
      if (p.id === updated.id) return p;
      const linked = p.parents.includes(updated.id);
      return childrenIds.includes(p.id) && !linked ? {...p, parents: [...p.parents, updated.id]} : !childrenIds.includes(p.id) && linked ? {...p, parents: p.parents.filter(id => id !== updated.id)} : p;
    });
    const validationError = validatePeople(prospective);
    if (validationError) { setErrorMsg(validationError); return; }
    if (existingPerson && !photo && photosMap?.[existingPerson.id] && onRemovePhoto) {
      try {
        await onRemovePhoto(existingPerson.id);
      } catch {
        // Ignore offline delete error; local photo is already cleared
      }
    }
    onSavePerson(updated, childrenIds);
    if (isNew) {
      onClose();
    } else {
      setMode('view');
    }
  };

  const filteredParentCandidates = people
    .filter((p) => p.id !== existingPerson?.id)
    .filter((p) =>
      getFullName(p).toLowerCase().includes(parentQuery.toLowerCase().trim())
    )
    .sort((a, b) => getFullName(a).localeCompare(getFullName(b), 'fr'));

  const filteredChildCandidates = people
    .filter((p) => p.id !== existingPerson?.id && !parents.includes(p.id))
    .filter((p) =>
      getFullName(p).toLowerCase().includes(childQuery.toLowerCase().trim())
    )
    .sort((a, b) => getFullName(a).localeCompare(getFullName(b), 'fr'));

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end bg-[#1C1917]/40 backdrop-blur-[2px] transition-opacity">
      <div
        className="fixed inset-0"
        onClick={onClose}
        aria-label="Fermer le panneau"
      />
      <aside className="relative z-10 flex h-[88vh] sm:h-full w-full max-w-xl flex-col bg-[#FAF8F5] text-[#1C1917] shadow-2xl rounded-t-3xl sm:rounded-none border-t sm:border-t-0 sm:border-l border-[#E6DFD3] overflow-hidden">
        {/* Mobile Grab Handle */}
        <div className="sm:hidden w-12 h-1.5 bg-[#D5CBBF] rounded-full mx-auto my-2.5 shrink-0" />

        {/* Top Drawer Header */}
        <div className="flex items-center justify-between border-b border-[#E6DFD3] px-5 sm:px-7 py-4 sm:py-5 bg-white">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-[#8C7A65] font-medium">
              {isNew ? 'Nouvelle Inscription aux Archives' : 'Portrait & Fiche Généalogique'}
            </p>
            <h2 className="font-serif text-2xl md:text-3xl font-normal text-[#1C1917] mt-0.5">
              {isNew ? 'Ajouter un membre' : getFullName(existingPerson)}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {!isNew && mode === 'view' && (
              <button
                type="button"
                onClick={() => setMode('edit')}
                className="px-3.5 py-2 text-xs font-medium border border-[#D8CFC2] bg-[#FAF8F5] hover:bg-[#F0ECE3] text-[#1C1917] transition-colors whitespace-nowrap"
              >
                Modifier la fiche
              </button>
            )}
            {!isNew && mode === 'edit' && (
              <button
                type="button"
                onClick={() => setMode('view')}
                className="px-3.5 py-2 text-xs font-medium border border-[#D8CFC2] bg-white hover:bg-[#F5F2EB] text-[#6E665C] transition-colors whitespace-nowrap"
              >
                Aperçu
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center border border-transparent hover:border-[#E6DFD3] hover:bg-[#F5F2EB] text-[#6E665C] transition-colors"
              aria-label="Fermer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-7 py-5 sm:py-6 space-y-6 sm:space-y-7">
          {mode === 'view' && existingPerson ? (
            <>
              {/* Hero Portrait Card */}
              <div className="flex items-start gap-4 sm:gap-6 bg-white p-4 sm:p-6 border border-[#E6DFD3] rounded-xl shadow-2xs">
                <button
                  type="button"
                  onClick={() => handleOpenCropper(existingPerson.photo)}
                  className="relative group/avatar h-20 w-20 sm:h-24 sm:w-24 shrink-0 rounded-full aspect-square border-2 border-[#D8CFC2] hover:border-[#8C7355] bg-[#F4F0E8] flex items-center justify-center overflow-hidden shadow-xs cursor-pointer transition-all"
                  title={existingPerson.photo ? 'Modifier ou recadrer la photo' : 'Ajouter une photo pour cette personne'}
                >
                  {existingPerson.photo ? (
                    <img
                      src={existingPerson.photo}
                      alt={getFullName(existingPerson)}
                      className="h-full w-full aspect-square rounded-full object-cover transition-transform duration-200 group-hover/avatar:scale-105"
                    />
                  ) : (
                    <span className="font-serif text-3xl text-[#8C7A65]">
                      {getInitials(existingPerson)}
                    </span>
                  )}
                  {/* Camera Icon Overlay */}
                  <div className="absolute inset-0 bg-[#1C1917]/45 text-white flex flex-col items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity text-[11px] font-medium p-1 text-center">
                    <Camera className="h-4 w-4 mb-0.5" />
                    <span>{existingPerson.photo ? 'Modifier' : 'Ajouter'}</span>
                  </div>
                  {/* Small badge in corner */}
                  <div className="absolute bottom-0 right-0 bg-white border border-[#D8CFC2] rounded-full p-1 shadow-xs text-[#8C7355] group-hover/avatar:text-[#1C1917]">
                    <Camera className="h-3 w-3" />
                  </div>
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-[#8C7A65] font-mono tabular-nums flex-wrap">
                    <span className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 shrink-0" />
                      <span>{getLifeDates(existingPerson)}</span>
                    </span>
                    {photosMap && photosMap[existingPerson.id] && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#4D7A58] bg-[#EEF5F0] border border-[#CDE3D2] px-2 py-0.5 rounded-2xs">
                        <CloudCheck className="h-3 w-3" />
                        <span>Cloud Firebase</span>
                      </span>
                    )}
                    {isPersonIncomplete(existingPerson) && (
                      <>
                        <span>·</span>
                        <span className="text-[#9A6B3B] font-sans">À compléter</span>
                      </>
                    )}
                  </div>
                  <h3 className="font-serif text-2xl text-[#1C1917] mt-1">
                    {getFullName(existingPerson)}
                  </h3>
                  {(existingPerson.occupation || existingPerson.location) && (
                    <p className="text-xs text-[#6E665C] mt-1 flex items-center gap-2">
                      {existingPerson.occupation && <span>{existingPerson.occupation}</span>}
                      {existingPerson.occupation && existingPerson.location && <span>·</span>}
                      {existingPerson.location && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {existingPerson.location}
                        </span>
                      )}
                    </p>
                  )}

                  {/* Photo Actions Row */}
                  <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-[#F0ECE3]">
                    {existingPerson.photo ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleOpenCropper(existingPerson.photo)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#8C7355] bg-white hover:bg-[#FAF8F5] text-[#1C1917] rounded-lg transition-colors shadow-2xs"
                        >
                          <Crop className="h-3.5 w-3.5 text-[#8C7A65]" />
                          <span>Recadrer la photo</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#D5C7B4] bg-[#FAF8F5] hover:bg-[#EFECE4] text-[#1C1917] rounded-lg transition-colors"
                        >
                          <Camera className="h-3.5 w-3.5 text-[#8C7A65]" />
                          <span>Changer</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleRemoveCurrentPhoto}
                          className="px-2.5 py-1.5 text-xs text-[#8C2D19] hover:bg-[#FDF2F0] rounded-lg transition-colors"
                        >
                          Retirer
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleOpenCropper(undefined)}
                        className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-white rounded-lg transition-all shadow-xs hover:opacity-90"
                        style={{ backgroundColor: accentColor }}
                      >
                        <Camera className="h-3.5 w-3.5" />
                        <span>Ajouter une photo</span>
                      </button>
                    )}
                  </div>

                  {/* Family Tree Actions Row */}
                  <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-[#F0ECE3]">
                    <button
                      type="button"
                      onClick={() => onAddChildFor(existingPerson.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#D5C7B4] bg-[#FAF8F5] hover:bg-[#EFECE4] text-[#1C1917] rounded-lg transition-colors whitespace-nowrap"
                    >
                      <UserPlus className="h-3.5 w-3.5 text-[#8C7355]" />
                      Ajouter un enfant
                    </button>
                    {childObjects.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          onFocusBranch(existingPerson.id);
                          onClose();
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#D8CFC2] bg-[#FAF8F5] hover:bg-[#EFECE4] text-[#1C1917] rounded-lg transition-colors whitespace-nowrap"
                      >
                        <GitBranch className="h-3.5 w-3.5 text-[#8C7A65]" />
                        Isoler sa lignée ({childObjects.length})
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Notes & Souvenirs */}
              <div className="bg-white p-6 border border-[#E6DFD3]">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-[#8C7A65] font-medium flex items-center gap-1.5">
                    <BookOpen className="h-3.5 w-3.5" />
                    Notes & Mémoire Familiale
                  </span>
                  <button
                    type="button"
                    onClick={() => setMode('edit')}
                    className="text-xs text-[#8C7A65] hover:text-[#1C1917] underline underline-offset-4"
                  >
                    Éditer
                  </button>
                </div>
                {existingPerson.notes ? (
                  <p className="text-sm leading-relaxed text-[#3D3832] font-serif italic text-base">
                    « {existingPerson.notes} »
                  </p>
                ) : (
                  <p className="text-xs text-[#8E867B]">
                    Aucune anecdote ou note biographique enregistrée pour le moment. Cliquez sur « Modifier la fiche » pour enrichir ce portrait.
                  </p>
                )}
              </div>

              {/* Family Links Architecture */}
              <div className="space-y-5">
                <h4 className="text-[11px] uppercase tracking-[0.2em] text-[#8C7A65] font-medium border-b border-[#E6DFD3] pb-2">
                  Liens de Parenté Directs
                </h4>

                {/* Parents */}
                <div>
                  <span className="text-xs font-medium text-[#6E665C] block mb-2">
                    Parents ({parentObjects.length})
                  </span>
                  {parentObjects.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {parentObjects.map((par) => (
                        <button
                          key={par.id}
                          type="button"
                          onClick={() => onSelectPerson(par.id)}
                          className="flex items-center justify-between p-3 bg-white border border-[#E6DFD3] hover:border-[#B5A288] text-left transition-colors group"
                        >
                          <div className="min-w-0">
                            <p className="font-serif text-base text-[#1C1917] truncate group-hover:text-[#8C7355]">
                              {getFullName(par)}
                            </p>
                            <p className="text-[11px] text-[#8C7A65] font-mono tabular-nums">
                              {getLifeDates(par)}
                            </p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-[#B5A898] group-hover:translate-x-0.5 transition-transform shrink-0" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[#8E867B] bg-white/60 border border-dashed border-[#DED6C8] p-3">
                      Fondateur / Parents non renseignés dans l’arbre.
                    </p>
                  )}
                </div>

                {/* Conjoints / Co-parents */}
                {spouseObjects.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-[#6E665C] flex items-center gap-1.5 mb-2">
                      <Heart className="h-3.5 w-3.5 text-[#9A7B56]" />
                      Union / Co-parent(s) ({spouseObjects.length})
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {spouseObjects.map((sp) => (
                        <button
                          key={sp.id}
                          type="button"
                          onClick={() => onSelectPerson(sp.id)}
                          className="flex items-center justify-between p-3 bg-white border border-[#E6DFD3] hover:border-[#B5A288] text-left transition-colors group"
                        >
                          <div className="min-w-0">
                            <p className="font-serif text-base text-[#1C1917] truncate">
                              {getFullName(sp)}
                            </p>
                            <p className="text-[11px] text-[#8C7A65] font-mono tabular-nums">
                              {getLifeDates(sp)}
                            </p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-[#B5A898] shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Enfants */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-[#6E665C]">
                      Enfants ({childObjects.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => onAddChildFor(existingPerson.id)}
                      className="text-xs text-[#8C7355] hover:text-[#1C1917] font-medium"
                    >
                      + Ajouter un enfant
                    </button>
                  </div>
                  {childObjects.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {childObjects.map((ch) => (
                        <button
                          key={ch.id}
                          type="button"
                          onClick={() => onSelectPerson(ch.id)}
                          className="flex items-center justify-between p-3 bg-white border border-[#E6DFD3] hover:border-[#B5A288] text-left transition-colors group"
                        >
                          <div className="min-w-0">
                            <p className="font-serif text-base text-[#1C1917] truncate">
                              {getFullName(ch)}
                            </p>
                            <p className="text-[11px] text-[#8C7A65] font-mono tabular-nums">
                              {getLifeDates(ch)}
                            </p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-[#B5A898] group-hover:translate-x-0.5 transition-transform shrink-0" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[#8E867B] bg-white/60 border border-dashed border-[#DED6C8] p-3">
                      Aucun enfant enregistré pour cette personne.
                    </p>
                  )}
                </div>

                {/* Fratrie */}
                {siblingObjects.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-[#6E665C] flex items-center gap-1.5 mb-2">
                      <Users className="h-3.5 w-3.5 text-[#8C7A65]" />
                      Frères & Sœurs ({siblingObjects.length})
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {siblingObjects.map((sib) => (
                        <button
                          key={sib.id}
                          type="button"
                          onClick={() => onSelectPerson(sib.id)}
                          className="flex items-center justify-between px-3 py-2 bg-[#F5F2EB] border border-[#E6DFD3] hover:bg-white text-left transition-colors"
                        >
                          <span className="font-serif text-sm text-[#1C1917] truncate">
                            {getFullName(sib)}
                          </span>
                          <span className="text-[11px] font-mono tabular-nums text-[#8C7A65] ml-2 shrink-0">
                            {sib.birth || ''}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            /* EDIT OR CREATE FORM */
            <form id="person-edit-form" onSubmit={handleSubmit} className="space-y-6">
              {errorMsg && (
                <div className="p-3.5 bg-[#FDF2F0] border border-[#E6B8B0] text-xs text-[#8C2D19]">
                  {errorMsg}
                </div>
              )}

              {/* Portrait Upload Section */}
              <div className="flex items-center gap-5 bg-white p-4 border border-[#E6DFD3] rounded-xl shadow-2xs">
                <button
                  type="button"
                  onClick={() => (photo ? handleOpenCropper(photo) : fileInputRef.current?.click())}
                  className="relative group/avatar h-20 w-20 rounded-full aspect-square border-2 border-[#D8CFC2] hover:border-[#8C7355] bg-[#F4F0E8] flex items-center justify-center overflow-hidden shrink-0 shadow-2xs cursor-pointer"
                  title="Choisir ou recadrer la photo"
                >
                  {photo ? (
                    <img src={photo} alt="Portrait" className="h-full w-full aspect-square rounded-full object-cover transition-transform duration-200 group-hover/avatar:scale-105" />
                  ) : (
                    <span className="font-serif text-2xl text-[#8C7A65]">
                      {(first.charAt(0) + last.charAt(0)).toUpperCase() || '?'}
                    </span>
                  )}
                  <div className="absolute inset-0 bg-[#1C1917]/45 text-white flex flex-col items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity text-[10px] font-medium p-1 text-center">
                    <Camera className="h-4 w-4 mb-0.5" />
                    <span>{photo ? 'Modifier' : 'Ajouter'}</span>
                  </div>
                </button>
                <div className="space-y-2 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#D5C7B4] bg-[#FAF8F5] hover:bg-[#EFECE4] text-[#1C1917] rounded-lg transition-colors"
                    >
                      <Camera className="h-3.5 w-3.5 text-[#8C7355]" />
                      <span>{photo ? 'Changer de photo' : 'Choisir une photo…'}</span>
                    </button>
                    {photo && (
                      <button
                        type="button"
                        onClick={() => handleOpenCropper(photo)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#8C7355] bg-white hover:bg-[#FAF8F5] text-[#1C1917] rounded-lg transition-colors shadow-2xs"
                      >
                        <Crop className="h-3.5 w-3.5 text-[#8C7A65]" />
                        <span>Recadrer & Filtres</span>
                      </button>
                    )}
                    {photo && (
                      <button
                        type="button"
                        onClick={() => setPhoto('')}
                        className="px-2.5 py-1.5 text-xs text-[#8C2D19] hover:bg-[#FDF2F0] rounded-lg transition-colors"
                      >
                        Retirer
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-[#8E867B] flex items-center gap-1">
                    <CloudCheck className="h-3 w-3 text-[#5B8266]" />
                    <span>Synchronisé automatiquement pour toute la famille.</span>
                  </p>
                </div>
              </div>

              {/* Identity Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-white p-5 border border-[#E6DFD3]">
                <div>
                  <label className="block text-xs font-medium text-[#575047] mb-1.5">
                    Prénom *
                  </label>
                  <input
                    type="text"
                    required
                    value={first}
                    onChange={(e) => setFirst(e.target.value)}
                    placeholder="Ex: Victoria"
                    className="w-full h-10 px-3 bg-[#FAF8F5] border border-[#D8CFC2] text-sm text-[#1C1917] focus:outline-none focus:border-[#8C7355]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#575047] mb-1.5">
                    Nom de famille
                  </label>
                  <input
                    type="text"
                    value={last}
                    onChange={(e) => setLast(e.target.value)}
                    placeholder="Ex: Wicikowski"
                    className="w-full h-10 px-3 bg-[#FAF8F5] border border-[#D8CFC2] text-sm text-[#1C1917] focus:outline-none focus:border-[#8C7355]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#575047] mb-1.5">
                    Année ou date de naissance
                  </label>
                  <input
                    type="text"
                    value={birth}
                    onChange={(e) => setBirth(e.target.value)}
                    placeholder="Ex: 1964"
                    className="w-full h-10 px-3 bg-[#FAF8F5] border border-[#D8CFC2] text-sm font-mono text-[#1C1917] focus:outline-none focus:border-[#8C7355]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#575047] mb-1.5">
                    Année ou date de décès (si applicable)
                  </label>
                  <input
                    type="text"
                    value={death}
                    onChange={(e) => setDeath(e.target.value)}
                    placeholder="Laisser vide si en vie"
                    className="w-full h-10 px-3 bg-[#FAF8F5] border border-[#D8CFC2] text-sm font-mono text-[#1C1917] focus:outline-none focus:border-[#8C7355]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#575047] mb-1.5">
                    Lieu / Ville
                  </label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Ex: Paris, Pologne…"
                    className="w-full h-10 px-3 bg-[#FAF8F5] border border-[#D8CFC2] text-sm text-[#1C1917] focus:outline-none focus:border-[#8C7355]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#575047] mb-1.5">
                    Profession ou Rôle
                  </label>
                  <input
                    type="text"
                    value={occupation}
                    onChange={(e) => setOccupation(e.target.value)}
                    placeholder="Ex: Architecte, Médecin…"
                    className="w-full h-10 px-3 bg-[#FAF8F5] border border-[#D8CFC2] text-sm text-[#1C1917] focus:outline-none focus:border-[#8C7355]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-[#575047] mb-1.5">
                    Souvenirs, Biographie & Notes d’archive
                  </label>
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Une histoire, un souvenir précieux, une précision sur la lignée…"
                    className="w-full p-3 bg-[#FAF8F5] border border-[#D8CFC2] text-sm text-[#1C1917] focus:outline-none focus:border-[#8C7355]"
                  />
                </div>
              </div>

              {/* Parents Selector */}
              <div className="bg-white p-5 border border-[#E6DFD3] space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-[#575047]">
                    Parents ({parents.length} sélectionné{parents.length > 1 ? 's' : ''})
                  </label>
                  {parents.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setParents([])}
                      className="text-[11px] text-[#8C7A65] hover:text-[#1C1917]"
                    >
                      Tout décocher
                    </button>
                  )}
                </div>

                {/* Selected parents quick tags */}
                {parents.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pb-1">
                    {parents.map((pid) => {
                      const pObj = byId.get(pid);
                      if (!pObj) return null;
                      return (
                        <button
                          key={pid}
                          type="button"
                          onClick={() => toggleParent(pid)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[#F0ECE3] text-[#1C1917] border border-[#D8CFC2]"
                        >
                          <span>{getFullName(pObj)}</span>
                          <X className="h-3 w-3 text-[#8C7A65]" />
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="relative">
                  <Search className="h-3.5 w-3.5 text-[#8C7A65] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    value={parentQuery}
                    onChange={(e) => setParentQuery(e.target.value)}
                    placeholder="Rechercher un parent dans l'arbre…"
                    className="w-full h-9 pl-8 pr-3 bg-[#FAF8F5] border border-[#D8CFC2] text-xs text-[#1C1917] focus:outline-none focus:border-[#8C7355]"
                  />
                </div>

                <div className="max-h-40 overflow-y-auto border border-[#E6DFD3] divide-y divide-[#F2EFE9] bg-[#FAF8F5]">
                  {filteredParentCandidates.map((cand) => {
                    const checked = parents.includes(cand.id);
                    return (
                      <button
                        key={cand.id}
                        type="button"
                        onClick={() => toggleParent(cand.id)}
                        className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left transition-colors ${
                          checked ? 'bg-[#EFECE4] font-medium text-[#1C1917]' : 'hover:bg-white text-[#4A453E]'
                        }`}
                      >
                        <span>
                          {getFullName(cand)}{' '}
                          {cand.birth && (
                            <span className="text-[#8C7A65] font-mono ml-1">({cand.birth})</span>
                          )}
                        </span>
                        {checked && <Check className="h-3.5 w-3.5 text-[#8C7355]" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Children Selector (allows linking children directly from parent!) */}
              <div className="bg-white p-5 border border-[#E6DFD3] space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-[#575047]">
                    Enfants rattachés ({childrenIds.length})
                  </label>
                </div>

                {childrenIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pb-1">
                    {childrenIds.map((cid) => {
                      const cObj = byId.get(cid);
                      if (!cObj) return null;
                      return (
                        <button
                          key={cid}
                          type="button"
                          onClick={() => toggleChild(cid)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[#F0ECE3] text-[#1C1917] border border-[#D8CFC2]"
                        >
                          <span>{getFullName(cObj)}</span>
                          <X className="h-3 w-3 text-[#8C7A65]" />
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="relative">
                  <Search className="h-3.5 w-3.5 text-[#8C7A65] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    value={childQuery}
                    onChange={(e) => setChildQuery(e.target.value)}
                    placeholder="Rattacher ou détacher un enfant existant…"
                    className="w-full h-9 pl-8 pr-3 bg-[#FAF8F5] border border-[#D8CFC2] text-xs text-[#1C1917] focus:outline-none focus:border-[#8C7355]"
                  />
                </div>

                <div className="max-h-36 overflow-y-auto border border-[#E6DFD3] divide-y divide-[#F2EFE9] bg-[#FAF8F5]">
                  {filteredChildCandidates.map((cand) => {
                    const checked = childrenIds.includes(cand.id);
                    return (
                      <button
                        key={cand.id}
                        type="button"
                        onClick={() => toggleChild(cand.id)}
                        className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left transition-colors ${
                          checked ? 'bg-[#EFECE4] font-medium text-[#1C1917]' : 'hover:bg-white text-[#4A453E]'
                        }`}
                      >
                        <span>
                          {getFullName(cand)}{' '}
                          {cand.birth && (
                            <span className="text-[#8C7A65] font-mono ml-1">({cand.birth})</span>
                          )}
                        </span>
                        {checked && <Check className="h-3.5 w-3.5 text-[#8C7355]" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </form>
          )}
        </div>

        {/* Drawer Footer */}
        <div className="border-t border-[#E6DFD3] bg-white px-5 sm:px-7 py-3.5 sm:py-4 flex items-center justify-between gap-2.5 sm:gap-3 shrink-0">
          {mode === 'edit' ? (
            <>
              {!isNew && existingPerson ? (
                confirmDelete ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onDeletePerson(existingPerson.id);
                        onClose();
                      }}
                      className="px-3 py-2 text-xs font-medium bg-[#992B15] text-white hover:bg-[#7D2210] transition-colors whitespace-nowrap"
                    >
                      Confirmer la suppression
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="px-2.5 py-2 text-xs text-[#6E665C] hover:text-[#1C1917]"
                    >
                      Annuler
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#992B15] hover:bg-[#FDF2F0] transition-colors whitespace-nowrap"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Supprimer
                  </button>
                )
              ) : (
                <div />
              )}

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => (isNew ? onClose() : setMode('view'))}
                  className="px-4 py-2 text-xs font-medium border border-[#D8CFC2] bg-white hover:bg-[#F5F2EB] text-[#575047] transition-colors whitespace-nowrap"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  form="person-edit-form"
                  className="px-5 py-2 text-xs font-medium text-white transition-colors whitespace-nowrap"
                  style={{ backgroundColor: accentColor }}
                >
                  Enregistrer dans l’arbre
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between w-full">
              <span className="text-xs text-[#8C7A65]">
                Fiche d’archive Wici · Cliquez sur un proche pour naviguer
              </span>
              <button
                type="button"
                onClick={() => setMode('edit')}
                className="px-4 py-2 text-xs font-medium text-white transition-colors whitespace-nowrap"
                style={{ backgroundColor: accentColor }}
              >
                Compléter / Modifier
              </button>
            </div>
          )}
        </div>

        {/* Hidden File Input for Direct Photo Selection */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.heic,.heif"
          onChange={handlePhotoUpload}
          className="hidden"
        />
      </aside>

      {/* Photo Cropper Modal */}
      {isCropperOpen && (
        <PhotoCropperModal
          isOpen={isCropperOpen}
          person={
            existingPerson || {
              id: 'temp-person',
              first: first || 'Nouveau',
              last: last || 'Membre',
              parents: [],
              photo,
            }
          }
          initialImageSrc={cropperSource}
          initialFilter={existingPerson ? photosMap?.[existingPerson.id]?.filter : 'none'}
          initialShape={existingPerson ? photosMap?.[existingPerson.id]?.shape : 'circle'}
          accentColor={accentColor}
          onClose={() => setIsCropperOpen(false)}
          onSave={handleCropperSave}
        />
      )}
    </div>
  );
};
