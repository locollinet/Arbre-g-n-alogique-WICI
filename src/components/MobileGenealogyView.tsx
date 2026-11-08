import React, { useState, useMemo } from 'react';
import {
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  User,
  Heart,
  Users,
  Calendar,
  Search,
  Plus,
  ArrowRight,
  Home,
  Check,
  HelpCircle,
  Camera,
  MapPin,
  Sparkles,
  Info
} from 'lucide-react';
import {
  Person,
  BRANCH_DEFINITIONS,
  GENERATION_LABELS,
  getFullName,
  getInitials,
  getLifeDates,
  isPersonIncomplete
} from '../data/wiciFamily';
import { resolveBranchId } from '../utils/treeLayout';

interface MobileGenealogyViewProps {
  people: Person[];
  onSelectPerson: (id: string) => void;
  onAddChildFor: (parentId: string) => void;
  onSwitchToCanvas: () => void;
  accentColor: string;
}

export const MobileGenealogyView: React.FC<MobileGenealogyViewProps> = ({
  people,
  onSelectPerson,
  onAddChildFor,
  onSwitchToCanvas,
  accentColor,
}) => {
  // Navigation tabs:
  // 'lineage' = Mode Exploration Naturelle (de personne en personne)
  // 'generations' = Grand Livre de Famille (par générations)
  // 'search' = Recherche simple et rapide
  const [mobileMode, setMobileMode] = useState<'lineage' | 'generations' | 'search'>('lineage');
  const [currentFocusId, setCurrentFocusId] = useState<string>('victoria');
  const [history, setHistory] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGenerations, setExpandedGenerations] = useState<Set<number>>(new Set([0, 1, 2]));

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  // Current person
  const currentPerson = byId.get(currentFocusId) || people[0];

  const navigateToPerson = (id: string) => {
    if (id === currentFocusId) return;
    setHistory((prev) => [...prev, currentFocusId]);
    setCurrentFocusId(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const navigateBack = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setCurrentFocusId(prev);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Immediate relationships
  const parents = useMemo(() => {
    if (!currentPerson) return [];
    return (currentPerson.parents || [])
      .map((pid) => byId.get(pid))
      .filter(Boolean) as Person[];
  }, [currentPerson, byId]);

  const children = useMemo(() => {
    if (!currentPerson) return [];
    return people
      .filter((p) => (p.parents || []).includes(currentPerson.id))
      .sort((a, b) => {
        const ya = parseInt((a.birth || '').replace(/\D/g, ''), 10) || 9999;
        const yb = parseInt((b.birth || '').replace(/\D/g, ''), 10) || 9999;
        return ya - yb;
      });
  }, [currentPerson, people]);

  const spouses = useMemo(() => {
    if (!currentPerson) return [];
    const set = new Set<string>(currentPerson.spouses || []);
    for (const ch of children) {
      for (const pid of ch.parents || []) {
        if (pid !== currentPerson.id) set.add(pid);
      }
    }
    return Array.from(set)
      .map((id) => byId.get(id))
      .filter(Boolean) as Person[];
  }, [currentPerson, children, byId]);

  const siblings = useMemo(() => {
    if (!currentPerson || currentPerson.parents.length === 0) return [];
    return people
      .filter(
        (p) =>
          p.id !== currentPerson.id &&
          (p.parents || []).some((pid) => currentPerson.parents.includes(pid))
      )
      .sort((a, b) => {
        const ya = parseInt((a.birth || '').replace(/\D/g, ''), 10) || 9999;
        const yb = parseInt((b.birth || '').replace(/\D/g, ''), 10) || 9999;
        return ya - yb;
      });
  }, [currentPerson, people]);

  // Compute generation depth
  const depthMap = useMemo(() => {
    const map = new Map<string, number>();
    map.set('victoria', 0);
    map.set('fiodor', 0);
    map.set('aloisi', 0);

    let changed = true;
    let limit = 8;
    while (changed && limit > 0) {
      changed = false;
      limit--;
      for (const p of people) {
        if (!map.has(p.id)) {
          const pDepths = (p.parents || [])
            .map((pid) => map.get(pid))
            .filter((d): d is number => d !== undefined);
          if (pDepths.length > 0) {
            map.set(p.id, Math.max(...pDepths) + 1);
            changed = true;
          }
        }
      }
    }
    for (const p of people) {
      if (!map.has(p.id)) map.set(p.id, 0);
    }
    return map;
  }, [people]);

  // Filtered members for generational and search view
  const filteredPeople = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return people.filter((p) => {
      if (selectedBranch !== 'all') {
        const bId = resolveBranchId(p.id, byId);
        if (bId !== selectedBranch && p.id !== selectedBranch) return false;
      }
      if (!q) return true;
      return (
        getFullName(p).toLowerCase().includes(q) ||
        (p.birth || '').includes(q) ||
        (p.notes || '').toLowerCase().includes(q)
      );
    });
  }, [people, selectedBranch, searchQuery, byId]);

  // Grouped for generation view
  const generationsList = useMemo(() => {
    const groups: { depth: number; meta: any; members: Person[] }[] = [];
    for (let d = 0; d <= 4; d++) {
      const members = filteredPeople
        .filter((p) => (depthMap.get(p.id) ?? 0) === d)
        .sort((a, b) => {
          const ya = parseInt((a.birth || '').replace(/\D/g, ''), 10) || 9999;
          const yb = parseInt((b.birth || '').replace(/\D/g, ''), 10) || 9999;
          return ya - yb;
        });

      if (members.length > 0 || !searchQuery) {
        groups.push({
          depth: d,
          meta: GENERATION_LABELS[d] || {
            roman: `${d + 1}`,
            title: `Génération ${d + 1}`,
            era: '',
          },
          members,
        });
      }
    }
    return groups;
  }, [filteredPeople, depthMap, searchQuery]);

  return (
    <div className="flex flex-col w-full pb-36 text-[#1C1917]">
      {/* 1. Header clair et rassurant pour personne non technophile */}
      <div className="sticky top-14 z-20 bg-[#FAF8F5]/98 backdrop-blur-md border-b border-[#E6DFD3] px-4 py-3 shadow-2xs space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          {/* 3 boutons simples avec libellés en français limpide */}
          <div className="flex items-center bg-[#EFEBE4] p-1 rounded-full border border-[#DFD7CC]">
            <button
              type="button"
              onClick={() => setMobileMode('lineage')}
              className={`min-h-[40px] px-3.5 text-xs font-medium rounded-full transition-all ${
                mobileMode === 'lineage'
                  ? 'bg-white text-[#1C1917] shadow-sm font-semibold'
                  : 'text-[#6E665C]'
              }`}
            >
              Foyer & Famille
            </button>
            <button
              type="button"
              onClick={() => setMobileMode('generations')}
              className={`min-h-[40px] px-3.5 text-xs font-medium rounded-full transition-all ${
                mobileMode === 'generations'
                  ? 'bg-white text-[#1C1917] shadow-sm font-semibold'
                  : 'text-[#6E665C]'
              }`}
            >
              Toute la liste
            </button>
            <button
              type="button"
              onClick={() => setMobileMode('search')}
              className={`min-h-[40px] px-3 text-xs font-medium rounded-full transition-all flex items-center gap-1.5 ${
                mobileMode === 'search'
                  ? 'bg-white text-[#1C1917] shadow-sm font-semibold'
                  : 'text-[#6E665C]'
              }`}
            >
              <Search className="h-3.5 w-3.5" />
              <span>Chercher</span>
            </button>
          </div>

          {/* Bouton pour les curieux voulant voir le grand plan */}
          <button
            type="button"
            onClick={onSwitchToCanvas}
            className="min-h-[40px] px-3 text-xs font-medium border border-[#D8CFC2] bg-white text-[#1C1917] rounded-full active:bg-[#F0ECE3] flex items-center gap-1.5 shrink-0 shadow-2xs"
            title="Voir le grand schéma d’ensemble"
          >
            <span>Grand Plan</span>
            <ArrowRight className="h-3.5 w-3.5 text-[#8C7A65]" />
          </button>
        </div>

        {/* Barre de recherche simple */}
        {mobileMode === 'search' && (
          <div className="relative pt-1">
            <Search className="h-4 w-4 text-[#8C7A65] absolute left-3.5 top-1/2 translate-y-[-30%] pointer-events-none" />
            <input
              type="search"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tapez un prénom ou un nom…"
              className="w-full h-12 pl-10 pr-4 bg-white border border-[#D0C6B8] text-base text-[#1C1917] placeholder:text-[#8E867B] rounded-xl focus:outline-none focus:border-[#8C7355] shadow-2xs"
            />
          </div>
        )}

        {/* Boutons des 5 branches si on est en mode Liste */}
        {mobileMode === 'generations' && (
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pt-1.5 -mx-4 px-4">
            {BRANCH_DEFINITIONS.map((b) => {
              const active = selectedBranch === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setSelectedBranch(b.id)}
                  className={`min-h-[38px] px-4 text-xs font-medium transition-colors whitespace-nowrap shrink-0 rounded-full flex items-center justify-center ${
                    active
                      ? 'text-white shadow-xs'
                      : 'bg-white text-[#575047] border border-[#E0D7C9] active:bg-[#EAE4D8]'
                  }`}
                  style={active ? { backgroundColor: accentColor } : undefined}
                >
                  {b.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* MODE 1 : FOYER & FAMILLE (Ultra-intuitif pour tante non technophile) */}
      {mobileMode === 'lineage' && (
        <div className="px-4 py-4 space-y-4">
          {/* Barre de retour et aide discrète */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={navigateBack}
                  className="min-h-[42px] px-3.5 bg-white border border-[#D0C6B8] text-[#1C1917] active:bg-[#EFECE4] rounded-full flex items-center gap-1.5 font-medium text-xs shadow-2xs"
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span>Personne précédente</span>
                </button>
              )}
              {currentFocusId !== 'victoria' && (
                <button
                  type="button"
                  onClick={() => navigateToPerson('victoria')}
                  className="min-h-[42px] px-3.5 bg-white border border-[#D0C6B8] text-[#1C1917] active:bg-[#EFECE4] rounded-full flex items-center gap-1.5 font-medium text-xs shadow-2xs"
                >
                  <Home className="h-4 w-4 text-[#8C7A65]" />
                  <span>Retour à Victoria</span>
                </button>
              )}
            </div>

            <span className="text-xs font-serif italic text-[#8C7A65]">
              Génération {GENERATION_LABELS[depthMap.get(currentPerson.id) ?? 0]?.roman || 'I'}
            </span>
          </div>

          {/* SECTION 1: SES PARENTS (Toucher pour remonter) */}
          <div className="bg-white border border-[#E4DDD3] rounded-2xl p-4 shadow-2xs space-y-2.5">
            <div className="flex items-center justify-between text-xs text-[#8C7A65] font-medium">
              <span className="flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                <span>Ses Parents</span>
              </span>
              <span className="text-[11px] text-[#A3998D]">Toucher pour remonter</span>
            </div>

            {parents.length > 0 ? (
              <div className="space-y-2">
                {parents.map((par) => (
                  <button
                    key={par.id}
                    type="button"
                    onClick={() => navigateToPerson(par.id)}
                    className="w-full min-h-[52px] flex items-center justify-between p-3 bg-[#FAF8F5] border border-[#E8E2D8] active:border-[#8C7355] text-left rounded-xl transition-all shadow-2xs"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-full bg-white border border-[#D5CBBF] flex items-center justify-center shrink-0">
                        {par.photo ? (
                          <img src={par.photo} alt="" className="h-full w-full rounded-full object-cover" />
                        ) : (
                          <span className="font-serif text-sm font-medium text-[#7D6B57]">
                            {getInitials(par)}
                          </span>
                        )}
                      </div>
                      <div className="truncate">
                        <p className="font-serif text-base font-medium text-[#1C1917] truncate leading-tight">
                          {getFullName(par)}
                        </p>
                        <p className="text-xs text-[#857C70] font-mono mt-0.5">
                          {getLifeDates(par)}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-medium text-[#8C7355] shrink-0 ml-2">
                      Voir ↑
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-3 text-xs text-[#6E665C] bg-[#FAF8F5] border border-dashed border-[#DFD6C7] rounded-xl text-center">
                <span className="font-serif italic font-medium">Victoria Tripel (1914–1997)</span>
                <span className="block text-[11px] text-[#8C7A65] mt-0.5">
                  Matriarche à l'origine de toute la lignée Wici
                </span>
              </div>
            )}
          </div>

          {/* SECTION 2 : LA CARTE MAÎTRESSE CENTRALE */}
          <div className="bg-white border-2 border-[#8C7355] rounded-2xl p-5 shadow-sm relative space-y-4">
            <div className="flex items-start gap-4">
              <div className="h-20 w-20 rounded-full border-2 border-[#D5C7B4] bg-[#FAF8F5] flex items-center justify-center overflow-hidden shrink-0 shadow-xs">
                {currentPerson.photo ? (
                  <img src={currentPerson.photo} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="font-serif text-3xl font-medium text-[#7D6B57]">
                    {getInitials(currentPerson)}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-[11px] uppercase tracking-wider text-[#8C7355] font-medium">
                  {currentPerson.id === 'victoria' ? 'Matriarche de la famille' : 'Fiche active'}
                </span>
                <h3 className="font-serif text-2xl font-medium text-[#1C1917] leading-tight mt-0.5">
                  {getFullName(currentPerson)}
                </h3>
                <p className="text-xs font-mono text-[#857C70] mt-1">
                  {getLifeDates(currentPerson)}
                </p>
                {currentPerson.occupation && (
                  <p className="text-xs text-[#6E665C] mt-1">
                    {currentPerson.occupation}
                  </p>
                )}
              </div>
            </div>

            {/* Note ou souvenir familial en écriture soignée */}
            {currentPerson.notes && (
              <div className="p-3 bg-[#FAF8F5] border-l-2 border-[#8C7355] rounded-r-lg">
                <p className="text-xs font-serif italic text-[#4A453E] leading-relaxed">
                  « {currentPerson.notes} »
                </p>
              </div>
            )}

            {/* Gros boutons d'actions clairs avec cibles confortables */}
            <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={() => onSelectPerson(currentPerson.id)}
                className="w-full min-h-[48px] px-4 text-sm font-medium text-white rounded-xl flex items-center justify-center gap-2 active:opacity-90 shadow-2xs"
                style={{ backgroundColor: accentColor }}
              >
                <span>Ouvrir son portrait complet</span>
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onAddChildFor(currentPerson.id)}
                className="min-h-[46px] px-4 text-xs font-medium border border-[#D0C6B8] bg-[#FAF8F5] text-[#1C1917] active:bg-[#EAE4D8] rounded-xl flex items-center justify-center gap-1.5"
              >
                <Plus className="h-4 w-4 text-[#8C7355]" />
                <span>Ajouter un enfant à cette personne</span>
              </button>
            </div>
          </div>

          {/* SECTION 3 : CONJOINT(S) ET CO-PARENTS */}
          {spouses.length > 0 && (
            <div className="bg-white border border-[#E4DDD3] rounded-2xl p-4 shadow-2xs space-y-2.5">
              <div className="flex items-center justify-between text-xs text-[#8C7A65] font-medium">
                <span className="flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                  <Heart className="h-3.5 w-3.5 text-[#9A7B56]" />
                  <span>Mariage / Union(s) ({spouses.length})</span>
                </span>
                <span className="text-[11px] text-[#A3998D]">Toucher pour afficher</span>
              </div>

              <div className="space-y-2">
                {spouses.map((sp) => (
                  <button
                    key={sp.id}
                    type="button"
                    onClick={() => navigateToPerson(sp.id)}
                    className="w-full min-h-[50px] flex items-center justify-between p-3 bg-[#FAF8F5] border border-[#E8E2D8] active:border-[#8C7355] text-left rounded-xl transition-all shadow-2xs"
                  >
                    <div className="truncate">
                      <p className="font-serif text-base font-medium text-[#1C1917] truncate leading-tight">
                        {getFullName(sp)}
                      </p>
                      <p className="text-xs text-[#857C70] font-mono mt-0.5">
                        {getLifeDates(sp)}
                      </p>
                    </div>
                    <span className="text-xs font-medium text-[#8C7355] shrink-0 ml-2">
                      Afficher →
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* SECTION 4 : SES ENFANTS (Toucher pour descendre d'une génération) */}
          <div className="bg-white border border-[#E4DDD3] rounded-2xl p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] uppercase tracking-wider text-[#8C7A65] font-medium block">
                  Ses Enfants ({children.length})
                </span>
                <span className="text-xs text-[#8E867B]">
                  Toucher un enfant pour voir sa propre famille
                </span>
              </div>
              <button
                type="button"
                onClick={() => onAddChildFor(currentPerson.id)}
                className="text-xs text-[#8C7355] font-medium hover:underline p-1"
              >
                + Ajouter
              </button>
            </div>

            {children.length > 0 ? (
              <div className="space-y-2">
                {children.map((ch) => {
                  const chKids = people.filter((c) => (c.parents || []).includes(ch.id));
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => navigateToPerson(ch.id)}
                      className="w-full min-h-[56px] flex items-center justify-between p-3.5 bg-[#FAF8F5] border border-[#E8E2D8] active:border-[#8C7355] text-left rounded-xl transition-all shadow-2xs group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-10 w-10 rounded-full bg-white border border-[#D5CBBF] flex items-center justify-center shrink-0">
                          {ch.photo ? (
                            <img src={ch.photo} alt="" className="h-full w-full rounded-full object-cover" />
                          ) : (
                            <span className="font-serif text-sm font-medium text-[#7D6B57]">
                              {getInitials(ch)}
                            </span>
                          )}
                        </div>
                        <div className="truncate">
                          <p className="font-serif text-base font-medium text-[#1C1917] truncate leading-tight group-hover:text-[#8C7355]">
                            {getFullName(ch)}
                          </p>
                          <p className="text-xs text-[#857C70] font-mono mt-0.5">
                            {getLifeDates(ch)}
                            {chKids.length > 0 && (
                              <span className="ml-2 text-[#8C7355] font-sans font-medium">
                                · {chKids.length} enfant{chKids.length > 1 ? 's' : ''}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs font-medium text-[#8C7355] shrink-0 ml-2">
                        Descendre ↓
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="p-4 text-xs text-[#8E867B] italic bg-[#FAF8F5] border border-dashed border-[#DFD6C7] rounded-xl text-center">
                Aucun enfant renseigné pour {getFullName(currentPerson)}.
              </div>
            )}
          </div>

          {/* SECTION 5 : FRÈRES ET SŒURS */}
          {siblings.length > 0 && (
            <div className="bg-white border border-[#E4DDD3] rounded-2xl p-4 shadow-2xs space-y-2.5">
              <span className="text-[11px] uppercase tracking-wider text-[#8C7A65] font-medium flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                <span>Frères & Sœurs ({siblings.length})</span>
              </span>
              <div className="flex flex-wrap gap-2">
                {siblings.map((sib) => (
                  <button
                    key={sib.id}
                    type="button"
                    onClick={() => navigateToPerson(sib.id)}
                    className="min-h-[42px] px-3.5 bg-[#FAF8F5] border border-[#E0D7C9] text-xs text-[#1C1917] font-medium rounded-full active:bg-[#EAE4D8] flex items-center gap-1.5 shadow-2xs"
                  >
                    <span className="font-serif text-sm">{sib.first}</span>
                    {sib.birth && (
                      <span className="font-mono text-[10px] text-[#8C7A65]">
                        ({sib.birth})
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODE 2 & 3 : TOUTE LA LISTE OU RECHERCHE */}
      {(mobileMode === 'generations' || mobileMode === 'search') && (
        <div className="px-4 py-4 space-y-4">
          {generationsList.map((gen) => {
            const isExpanded = expandedGenerations.has(gen.depth);
            return (
              <div
                key={gen.depth}
                className="bg-white border border-[#E4DDD3] rounded-2xl shadow-2xs overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => {
                    setExpandedGenerations((prev) => {
                      const next = new Set(prev);
                      if (next.has(gen.depth)) next.delete(gen.depth);
                      else next.add(gen.depth);
                      return next;
                    });
                  }}
                  className="w-full min-h-[52px] px-4 py-3 flex items-center justify-between bg-[#FAF8F5] active:bg-[#EFE9DF] transition-colors text-left border-b border-[#EAE3D6]"
                >
                  <div className="flex items-baseline gap-2.5">
                    <span className="font-serif italic font-medium text-lg text-[#8C7355]">
                      Génération {gen.meta.roman}
                    </span>
                    <span className="text-xs font-medium text-[#1C1917]">
                      {gen.meta.title}
                    </span>
                    <span className="text-xs text-[#8C7A65] font-mono tabular-nums">
                      ({gen.members.length})
                    </span>
                  </div>
                  {isExpanded ? (
                    <ChevronDown className="h-5 w-5 text-[#8C7A65] shrink-0" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-[#8C7A65] shrink-0" />
                  )}
                </button>

                {isExpanded && (
                  <div className="divide-y divide-[#F2EFE9] bg-white">
                    {gen.members.map((person) => {
                      return (
                        <div
                          key={person.id}
                          className="p-3.5 flex items-center justify-between gap-3 min-h-[58px]"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setCurrentFocusId(person.id);
                              setMobileMode('lineage');
                            }}
                            className="flex items-center gap-3.5 min-w-0 flex-1 text-left"
                          >
                            <div className="h-11 w-11 rounded-full border border-[#DFD6C7] bg-[#FAF8F5] flex items-center justify-center overflow-hidden shrink-0">
                              {person.photo ? (
                                <img
                                  src={person.photo}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <span className="font-serif text-sm font-medium text-[#7D6B57]">
                                  {getInitials(person)}
                                </span>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <h4 className="font-serif text-base font-medium text-[#1C1917] truncate leading-tight">
                                {getFullName(person)}
                              </h4>
                              <p className="text-xs font-mono tabular-nums text-[#857C70] mt-0.5 truncate">
                                {getLifeDates(person)}
                              </p>
                            </div>
                          </button>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setCurrentFocusId(person.id);
                                setMobileMode('lineage');
                              }}
                              className="min-h-[40px] px-3 text-xs text-[#8C7355] font-medium border border-[#E0D7C9] bg-[#FAF8F5] active:bg-[#EAE4D8] rounded-full"
                            >
                              Arbre
                            </button>
                            <button
                              type="button"
                              onClick={() => onSelectPerson(person.id)}
                              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[#B5A898] active:text-[#1C1917]"
                              aria-label="Fiche complète"
                            >
                              <ChevronRight className="h-5 w-5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Bouton d'action flottant au pouce en bas */}
      <div className="fixed bottom-16 left-0 right-0 p-3 bg-gradient-to-t from-[#FAF8F5] via-[#FAF8F5]/90 to-transparent pointer-events-none z-20 md:hidden flex justify-center">
        <button
          type="button"
          onClick={() => onAddChildFor(currentFocusId)}
          className="pointer-events-auto shadow-lg min-h-[48px] px-6 text-sm font-medium text-white flex items-center gap-2 rounded-full active:scale-95 transition-transform"
          style={{ backgroundColor: accentColor }}
        >
          <Plus className="h-4 w-4" />
          <span>Ajouter quelqu’un dans l’arbre</span>
        </button>
      </div>
    </div>
  );
};
