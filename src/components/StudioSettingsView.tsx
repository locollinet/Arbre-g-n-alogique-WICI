import React, { useState, useMemo, useRef } from 'react';
import {
  Search,
  UserPlus,
  SlidersHorizontal,
  Users,
  Download,
  Upload,
  RotateCcw,
  Edit3,
  Check,
  AlertCircle,
  Sparkles,
  FileCode,
  ArrowDownUp,
  ArrowLeftRight,
  Eye,
  Trash2,
  Plus,
  Camera,
  Cloud,
  CloudCheck,
  Crop,
  LogIn,
  LogOut
} from 'lucide-react';
import { User } from 'firebase/auth';
import {
  Person,
  TreeSettings,
  BRANCH_DEFINITIONS,
  getFullName,
  getInitials,
  getLifeDates,
  isPersonIncomplete
} from '../data/wiciFamily';
import { computeTreeLayout, buildEdgeSvgPath, resolveBranchId } from '../utils/treeLayout';
import { PersonPhotoRecord } from '../firebase/photoService';

interface StudioSettingsViewProps {
  people: Person[];
  settings: TreeSettings;
  onUpdateSettings: (partial: Partial<TreeSettings>) => void;
  onResetSettings: () => void;
  onSavePerson: (person: Person) => void;
  onDeletePerson: (id: string) => void;
  onOpenPersonDrawer: (id: string) => void;
  onAddChildFor: (parentId: string) => void;
  onAddNewPerson: () => void;
  onImportData: (people: Person[], settings?: Partial<TreeSettings>) => void;
  onRestoreInitialData: () => void;
  onNotify: (msg: string) => void;
  onOpenPhotoCropper?: (personId: string) => void;
  photosMap?: Record<string, PersonPhotoRecord>;
  currentUser?: User | null;
  onGoogleLogin?: () => void;
  onGoogleLogout?: () => void;
  accentColor: string;
}

export const StudioSettingsView: React.FC<StudioSettingsViewProps> = ({
  people,
  settings,
  onUpdateSettings,
  onResetSettings,
  onSavePerson,
  onDeletePerson,
  onOpenPersonDrawer,
  onAddChildFor,
  onAddNewPerson,
  onImportData,
  onRestoreInitialData,
  onNotify,
  onOpenPhotoCropper,
  photosMap,
  currentUser,
  onGoogleLogin,
  onGoogleLogout,
  accentColor,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'members' | 'photos' | 'design' | 'backup'>('members');
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);

  // Quick inline edit state for fast table completion
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineFirst, setInlineFirst] = useState('');
  const [inlineLast, setInlineLast] = useState('');
  const [inlineBirth, setInlineBirth] = useState('');
  const [inlineDeath, setInlineDeath] = useState('');
  const [confirmRestore, setConfirmRestore] = useState(false);

  const photosCount = useMemo(() => people.filter((p) => !!p.photo).length, [people]);
  const cloudPhotosCount = useMemo(() => (photosMap ? Object.keys(photosMap).length : 0), [photosMap]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const incompletePeople = useMemo(
    () => people.filter((p) => isPersonIncomplete(p)),
    [people]
  );

  const filteredPeople = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people
      .filter((p) => {
        if (onlyIncomplete && !isPersonIncomplete(p)) return false;
        if (branchFilter !== 'all') {
          const bId = resolveBranchId(p.id, byId);
          if (bId !== branchFilter && p.id !== branchFilter) return false;
        }
        if (!q) return true;
        return (
          getFullName(p).toLowerCase().includes(q) ||
          (p.birth || '').toLowerCase().includes(q) ||
          (p.notes || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const ya = parseInt((a.birth || '').replace(/\D/g, ''), 10) || 9999;
        const yb = parseInt((b.birth || '').replace(/\D/g, ''), 10) || 9999;
        if (ya !== yb) return ya - yb;
        return getFullName(a).localeCompare(getFullName(b), 'fr');
      });
  }, [people, search, branchFilter, onlyIncomplete, byId]);

  const startInlineEdit = (p: Person) => {
    setInlineEditId(p.id);
    setInlineFirst(p.first);
    setInlineLast(p.last);
    setInlineBirth(p.birth || '');
    setInlineDeath(p.death || '');
  };

  const saveInlineEdit = (p: Person) => {
    if (!inlineFirst.trim()) return;
    onSavePerson({
      ...p,
      first: inlineFirst.trim(),
      last: inlineLast.trim(),
      birth: inlineBirth.trim(),
      death: inlineDeath.trim(),
    });
    setInlineEditId(null);
    onNotify(`Fiche de ${inlineFirst.trim()} ${inlineLast.trim()} mise à jour.`);
  };

  // JSON Export
  const handleExportJson = () => {
    const payload = {
      format: 'arbre-des-wici',
      version: 2,
      exportedAt: new Date().toISOString(),
      settings,
      people,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `archives-famille-wici-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    onNotify('Sauvegarde JSON exportée avec succès.');
  };

  // High-Definition Printable SVG Poster Export
  const handleExportSvgPoster = () => {
    const fullLayout = computeTreeLayout(people, 'all', new Set(), settings);
    const pad = 80;
    const totalW = fullLayout.width + pad * 2;
    const totalH = fullLayout.height + pad * 2 + 90;

    const escXml = (s: string) =>
      String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const edgesSvg = fullLayout.edges
      .map(
        (e) =>
          `<path d="${buildEdgeSvgPath(
            e,
            settings.orientation,
            settings.edgeStyle
          )}" fill="none" stroke="#C5B49E" stroke-width="1.6" stroke-linecap="round"/>`
      )
      .join('\n');

    const nodesSvg = fullLayout.nodes
      .map((n) => {
        const p = n.person;
        const dates = [p.birth, p.death].filter(Boolean).join(' – ');
        return `<g transform="translate(${n.x}, ${n.y})">
          <rect width="${n.width}" height="${n.height}" fill="#FFFFFF" stroke="#DFD6C7" stroke-width="1.2"/>
          <circle cx="34" cy="${n.height / 2}" r="20" fill="#F5F1E9" stroke="#DFD6C7"/>
          <text x="34" y="${n.height / 2 + 5}" text-anchor="middle" font-family="Georgia, serif" font-size="13" fill="#7D6B57">${escXml(
            getInitials(p)
          )}</text>
          <text x="66" y="${n.height / 2 - 6}" font-family="Georgia, serif" font-size="15" font-weight="500" fill="#1C1917">${escXml(
            p.first
          )}</text>
          <text x="66" y="${n.height / 2 + 12}" font-family="Georgia, serif" font-size="13" fill="#4A443C">${escXml(
            p.last
          )}</text>
          <text x="66" y="${n.height / 2 + 28}" font-family="monospace" font-size="10" fill="#857C70">${escXml(
            dates
          )}</text>
        </g>`;
      })
      .join('\n');

    const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" height="${totalH}">
  <rect width="100%" height="100%" fill="#FAF8F5"/>
  <g transform="translate(${pad}, 55)">
    <text x="0" y="0" font-family="Georgia, serif" font-size="11" letter-spacing="3" fill="#8C7A65">${escXml(
      settings.subtitle.toUpperCase()
    )}</text>
    <text x="0" y="34" font-family="Georgia, serif" font-size="34" fill="#1C1917">${escXml(
      settings.familyName
    )}</text>
  </g>
  <g transform="translate(${pad}, ${pad + 60})">
    ${edgesSvg}
    ${nodesSvg}
  </g>
</svg>`;

    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `affiche-arbre-wici.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    onNotify('Affiche vectorielle SVG haute définition téléchargée.');
  };

  // JSON Import
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (
        !parsed ||
        !Array.isArray(parsed.people) ||
        !parsed.people.every((p: any) => typeof p.id === 'string' && typeof p.first === 'string')
      ) {
        throw new Error('Invalid format');
      }
      onImportData(parsed.people, parsed.settings);
      onNotify(`Sauvegarde importée (${parsed.people.length} personnes).`);
    } catch {
      onNotify('Fichier de sauvegarde JSON invalide ou corrompu.');
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="max-w-[1600px] w-full mx-auto px-6 lg:px-10 py-8 space-y-8">
      {/* Studio Header & Sub-Navigation */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 border-b border-[#E6DFD3] pb-6">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#8C7A65] font-medium">
            Atelier de Configuration & Archives
          </p>
          <h1 className="font-serif text-3xl sm:text-4xl font-normal text-[#1C1917] mt-1">
            Paramétrer l’Arbre & les Membres
          </h1>
          <p className="text-sm text-[#6E665C] mt-1.5 max-w-2xl">
            Gérez les fiches de la famille, personnalisez l’esthétique de l’arbre ou exportez vos archives en toute simplicité, sans encombrer la vue de lecture.
          </p>
        </div>

        {/* Sub-tab Segmented Selector */}
        <div className="flex items-center bg-white border border-[#E6DFD3] p-1 shrink-0 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveSubTab('members')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
              activeSubTab === 'members'
                ? 'text-white shadow-2xs'
                : 'text-[#575047] hover:text-[#1C1917]'
            }`}
            style={activeSubTab === 'members' ? { backgroundColor: accentColor } : undefined}
          >
            <Users className="h-3.5 w-3.5" />
            <span>Membres ({people.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('photos')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
              activeSubTab === 'photos'
                ? 'text-white shadow-2xs'
                : 'text-[#575047] hover:text-[#1C1917]'
            }`}
            style={activeSubTab === 'photos' ? { backgroundColor: accentColor } : undefined}
          >
            <Camera className="h-3.5 w-3.5" />
            <span>Portraits & Cloud ({photosCount})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('design')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
              activeSubTab === 'design'
                ? 'text-white shadow-2xs'
                : 'text-[#575047] hover:text-[#1C1917]'
            }`}
            style={activeSubTab === 'design' ? { backgroundColor: accentColor } : undefined}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>Esthétique & Affichage</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('backup')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
              activeSubTab === 'backup'
                ? 'text-white shadow-2xs'
                : 'text-[#575047] hover:text-[#1C1917]'
            }`}
            style={activeSubTab === 'backup' ? { backgroundColor: accentColor } : undefined}
          >
            <Download className="h-3.5 w-3.5" />
            <span>Sauvegarde & Export</span>
          </button>
        </div>
      </div>

      {/* SUB-TAB 1: MEMBERS & QUICK EDITING */}
      {activeSubTab === 'members' && (
        <div className="space-y-6">
          {/* Assistant Fiches à compléter (from PDF) */}
          {incompletePeople.length > 0 && (
            <div className="bg-white border border-[#E6DFD3] p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#F0ECE3]">
                <div>
                  <span className="text-[11px] uppercase tracking-[0.18em] text-[#9A6B3B] font-medium flex items-center gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Informations à préciser d’après le document source ({incompletePeople.length})
                  </span>
                  <p className="text-xs text-[#6E665C] mt-1">
                    Ces fiches comportaient un « ? » ou une date manquante dans votre PDF initial. Cliquez sur une fiche pour la compléter.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onAddChildFor('nicolas')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-[#D8CFC2] bg-[#FAF8F5] hover:bg-[#EFECE4] text-[#1C1917] transition-colors whitespace-nowrap self-start md:self-auto"
                >
                  <Plus className="h-3.5 w-3.5 text-[#8C7355]" />
                  Ajouter un enfant à Nicolas Wicikowski
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-4">
                {incompletePeople.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => startInlineEdit(p)}
                    className="flex flex-col justify-between p-3.5 bg-[#FAF8F5] border border-[#E6DFD3] hover:border-[#8C7355] text-left transition-colors group"
                  >
                    <div>
                      <p className="font-serif text-base text-[#1C1917] font-medium group-hover:text-[#8C7355]">
                        {getFullName(p)}
                      </p>
                      <p className="text-[11px] font-mono text-[#9A6B3B] mt-0.5">
                        {getLifeDates(p)}
                      </p>
                    </div>
                    <span className="mt-3 text-[11px] text-[#6E665C] underline underline-offset-4">
                      Compléter en 1 clic →
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Filter & Search Toolbar */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white border border-[#E6DFD3] p-4">
            <div className="flex flex-wrap items-center gap-2">
              {BRANCH_DEFINITIONS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBranchFilter(b.id)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    branchFilter === b.id
                      ? 'bg-[#1C1917] text-white'
                      : 'bg-[#FAF8F5] text-[#575047] hover:bg-[#EFECE4]'
                  }`}
                >
                  {b.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setOnlyIncomplete((v) => !v)}
                className={`px-3 py-1.5 text-xs font-medium border transition-colors whitespace-nowrap ${
                  onlyIncomplete
                    ? 'bg-[#9A6B3B] text-white border-[#9A6B3B]'
                    : 'bg-white text-[#6E665C] border-[#D8CFC2] hover:bg-[#FAF8F5]'
                }`}
              >
                À compléter uniquement ({incompletePeople.length})
              </button>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative flex-1 sm:w-64">
                <Search className="h-3.5 w-3.5 text-[#8C7A65] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filtrer par nom ou année…"
                  className="w-full h-9 pl-8 pr-3 bg-[#FAF8F5] border border-[#D8CFC2] text-xs text-[#1C1917] focus:outline-none focus:border-[#8C7355]"
                />
              </div>
              <button
                type="button"
                onClick={onAddNewPerson}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0"
                style={{ backgroundColor: accentColor }}
              >
                <UserPlus className="h-3.5 w-3.5" />
                Nouveau membre
              </button>
            </div>
          </div>

          {/* Structured Archival Table */}
          <div className="bg-white border border-[#E6DFD3] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E6DFD3] bg-[#FAF8F5] text-[11px] uppercase tracking-[0.16em] text-[#8C7A65]">
                    <th className="py-3.5 px-5 font-medium">Membre de la famille</th>
                    <th className="py-3.5 px-4 font-medium">Dates</th>
                    <th className="py-3.5 px-4 font-medium">Parents rattachés</th>
                    <th className="py-3.5 px-4 font-medium">Enfants</th>
                    <th className="py-3.5 px-5 font-medium text-right">Actions rapides</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0ECE3] text-sm">
                  {filteredPeople.map((person) => {
                    const isEditing = inlineEditId === person.id;
                    const parentNames = (person.parents || [])
                      .map((pid) => byId.get(pid))
                      .filter(Boolean)
                      .map((p) => getFullName(p))
                      .join(' & ');
                    const kids = people.filter((c) => (c.parents || []).includes(person.id));

                    return (
                      <tr
                        key={person.id}
                        className="hover:bg-[#FAF8F5]/80 transition-colors"
                      >
                        <td className="py-3.5 px-5">
                          {isEditing ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={inlineFirst}
                                onChange={(e) => setInlineFirst(e.target.value)}
                                placeholder="Prénom"
                                className="w-32 h-8 px-2 bg-white border border-[#8C7355] text-xs"
                              />
                              <input
                                type="text"
                                value={inlineLast}
                                onChange={(e) => setInlineLast(e.target.value)}
                                placeholder="Nom"
                                className="w-36 h-8 px-2 bg-white border border-[#8C7355] text-xs"
                              />
                            </div>
                          ) : (
                            <div className="flex items-center gap-3">
                              <div className="h-9 w-9 rounded-full border border-[#DFD6C7] bg-[#F5F1E9] flex items-center justify-center overflow-hidden shrink-0">
                                {person.photo ? (
                                  <img
                                    src={person.photo}
                                    alt={getFullName(person)}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <span className="font-serif text-xs text-[#7D6B57]">
                                    {getInitials(person)}
                                  </span>
                                )}
                              </div>
                              <div>
                                <button
                                  type="button"
                                  onClick={() => onOpenPersonDrawer(person.id)}
                                  className="font-serif text-base font-medium text-[#1C1917] hover:text-[#8C7355] text-left"
                                >
                                  {getFullName(person)}
                                </button>
                                {person.notes && (
                                  <p className="text-[11px] text-[#8E867B] line-clamp-1 max-w-xs">
                                    {person.notes}
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-4 font-mono text-xs tabular-nums text-[#575047]">
                          {isEditing ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={inlineBirth}
                                onChange={(e) => setInlineBirth(e.target.value)}
                                placeholder="Naissance"
                                className="w-20 h-8 px-2 bg-white border border-[#8C7355] text-xs font-mono"
                              />
                              <span>–</span>
                              <input
                                type="text"
                                value={inlineDeath}
                                onChange={(e) => setInlineDeath(e.target.value)}
                                placeholder="Décès"
                                className="w-20 h-8 px-2 bg-white border border-[#8C7355] text-xs font-mono"
                              />
                            </div>
                          ) : (
                            <span
                              className={
                                isPersonIncomplete(person) ? 'text-[#9A6B3B]' : 'text-[#575047]'
                              }
                            >
                              {[person.birth, person.death].filter(Boolean).join(' – ') || '—'}
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-xs text-[#575047]">
                          {parentNames || (
                            <span className="text-[#9E9488] italic">Racine / Non renseigné</span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-xs text-[#575047] font-mono tabular-nums">
                          {kids.length > 0 ? (
                            <span>
                              {kids.length} ({kids.map((k) => k.first).join(', ')})
                            </span>
                          ) : (
                            <span className="text-[#9E9488]">—</span>
                          )}
                        </td>

                        <td className="py-3.5 px-5 text-right whitespace-nowrap">
                          {isEditing ? (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => saveInlineEdit(person)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white"
                                style={{ backgroundColor: accentColor }}
                              >
                                <Check className="h-3.5 w-3.5" />
                                Valider
                              </button>
                              <button
                                type="button"
                                onClick={() => setInlineEditId(null)}
                                className="px-2 py-1.5 text-xs text-[#6E665C] hover:text-[#1C1917]"
                              >
                                Annuler
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => startInlineEdit(person)}
                                className="px-2.5 py-1 text-xs border border-[#E6DFD3] bg-[#FAF8F5] hover:bg-[#EFECE4] text-[#4A453E] transition-colors"
                                title="Modification rapide en ligne"
                              >
                                Édition rapide
                              </button>
                              <button
                                type="button"
                                onClick={() => onAddChildFor(person.id)}
                                className="px-2.5 py-1 text-xs border border-[#E6DFD3] bg-white hover:bg-[#FAF8F5] text-[#4A453E] transition-colors"
                                title="Ajouter un enfant à cette personne"
                              >
                                + Enfant
                              </button>
                              <button
                                type="button"
                                onClick={() => onOpenPersonDrawer(person.id)}
                                className="px-2.5 py-1 text-xs font-medium text-[#8C7355] hover:text-[#1C1917] transition-colors"
                              >
                                Fiche complète →
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB: PHOTOS & CLOUD FIREBASE GALLERY */}
      {activeSubTab === 'photos' && (
        <div className="space-y-6">
          {/* Header & KPI Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white border border-[#E6DFD3] p-5">
              <span className="text-[11px] uppercase tracking-[0.18em] text-[#8C7A65] font-medium flex items-center gap-1.5">
                <Camera className="h-3.5 w-3.5" />
                Portraits Familiaux
              </span>
              <p className="font-serif text-3xl text-[#1C1917] mt-1 font-mono tabular-nums">
                {photosCount} <span className="text-sm font-sans text-[#8C7A65] font-normal">/ {people.length} membres</span>
              </p>
              <p className="text-xs text-[#6E665C] mt-1">
                Portraits recadrés et intégrés avec élégance dans les branches de l’arbre.
              </p>
            </div>

            <div className="bg-white border border-[#E6DFD3] p-5">
              <span className="text-[11px] uppercase tracking-[0.18em] text-[#4D7A58] font-medium flex items-center gap-1.5">
                <CloudCheck className="h-3.5 w-3.5" />
                Stockage Cloud Firebase
              </span>
              <p className="font-serif text-3xl text-[#1C1917] mt-1 font-mono tabular-nums">
                {cloudPhotosCount} <span className="text-sm font-sans text-[#4D7A58] font-normal">synchronisées</span>
              </p>
              <p className="text-xs text-[#6E665C] mt-1">
                Base Firestore active : les portraits sont chargés en temps réel sans alourdir le code.
              </p>
            </div>

            <div className="bg-white border border-[#E6DFD3] p-5">
              <span className="text-[11px] uppercase tracking-[0.18em] text-[#8C7A65] font-medium flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                Haute Définition & Légèreté
              </span>
              <p className="font-serif text-3xl text-[#1C1917] mt-1 font-mono tabular-nums">
                ~28 <span className="text-sm font-sans text-[#8C7A65] font-normal">Ko / photo</span>
              </p>
              <p className="text-xs text-[#6E665C] mt-1">
                Compression Retina automatique avec filtres sépia d'époque et médaillons d'orfèvre.
              </p>
            </div>
          </div>

          {/* Cloud Auth Status Card */}
          <div className="bg-white border border-[#E6DFD3] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-[#FAF8F5] border border-[#E2DAD0] flex items-center justify-center text-[#8C7A65] shrink-0">
                <Cloud className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-[#1C1917]">
                  {currentUser ? (
                    <span className="text-[#3D6946] flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-[#4D7A58]" />
                      Connecté avec Google ({currentUser.displayName || currentUser.email})
                    </span>
                  ) : (
                    <span>Mode Visiteur / Connexion Google Recommandée</span>
                  )}
                </p>
                <p className="text-xs text-[#7A7266] mt-0.5">
                  {currentUser
                    ? 'Vos recadrages et portraits sont sauvegardés de manière permanente sur votre base de données Firestore.'
                    : 'Pour enregistrer vos portraits directement dans le Cloud Firebase sans limite de stockage local, connectez-vous.'}
                </p>
              </div>
            </div>

            <div className="shrink-0">
              {currentUser ? (
                <button
                  type="button"
                  onClick={onGoogleLogout}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#D8CFC2] hover:bg-[#F5F2EB] text-[#6E665C] transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Se déconnecter</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onGoogleLogin}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 shadow-xs"
                  style={{ backgroundColor: accentColor }}
                >
                  <LogIn className="h-3.5 w-3.5" />
                  <span>Connexion Google</span>
                </button>
              )}
            </div>
          </div>

          {/* Gallery Filter & Search */}
          <div className="bg-white border border-[#E6DFD3] p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#8C7A65]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un membre par nom ou prénom…"
                className="w-full h-9 pl-9 pr-3 text-xs bg-[#FAF8F5] border border-[#D8CFC2] text-[#1C1917] focus:outline-none focus:border-[#8C7355]"
              />
            </div>

            <div className="flex items-center gap-1 overflow-x-auto">
              {BRANCH_DEFINITIONS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBranchFilter(b.id)}
                  className={`px-3 py-1.5 text-xs transition-colors whitespace-nowrap ${
                    branchFilter === b.id
                      ? 'bg-[#1C1917] text-white font-medium'
                      : 'bg-[#FAF8F5] text-[#6E665C] hover:bg-[#F0ECE3]'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          {/* Portrait Gallery Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredPeople.map((p) => {
              const isCloud = photosMap && !!photosMap[p.id];
              return (
                <div
                  key={p.id}
                  className="bg-white border border-[#E6DFD3] hover:border-[#8C7355] p-4 flex flex-col justify-between transition-all group shadow-2xs"
                >
                  <div>
                    {/* Portrait Avatar */}
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div className="relative h-16 w-16 rounded-full border border-[#DFD6C7] bg-[#F5F1E9] flex items-center justify-center overflow-hidden shrink-0 shadow-xs">
                        {p.photo ? (
                          <img
                            src={p.photo}
                            alt={getFullName(p)}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="font-serif text-xl font-medium text-[#7D6B57]">
                            {getInitials(p)}
                          </span>
                        )}
                      </div>

                      {/* Cloud Sync Status Badge */}
                      {isCloud ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#4D7A58] bg-[#EEF5F0] border border-[#CDE3D2] px-2 py-0.5 rounded-2xs">
                          <CloudCheck className="h-3 w-3" />
                          <span>Cloud</span>
                        </span>
                      ) : p.photo ? (
                        <span className="text-[10px] font-mono text-[#8C7A65] bg-[#FAF8F5] px-2 py-0.5 border border-[#E2DAD0]">
                          Local
                        </span>
                      ) : (
                        <span className="text-[10px] text-[#A6998A] italic">
                          Sans photo
                        </span>
                      )}
                    </div>

                    {/* Member Details */}
                    <h4 className="font-serif text-lg font-medium text-[#1C1917] leading-tight group-hover:text-[#8C7355] transition-colors truncate">
                      {getFullName(p)}
                    </h4>
                    <p className="text-[11px] font-mono text-[#8C7A65] mt-0.5">
                      {getLifeDates(p)}
                    </p>
                    {p.occupation && (
                      <p className="text-xs text-[#6E665C] mt-1 line-clamp-1">
                        {p.occupation}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="pt-4 mt-3 border-t border-[#F0EAE1] flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenPhotoCropper && onOpenPhotoCropper(p.id)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium border border-[#D5C7B4] bg-[#FAF8F5] hover:bg-[#EFECE4] text-[#1C1917] transition-colors"
                    >
                      <Crop className="h-3.5 w-3.5 text-[#8C7A65]" />
                      <span>{p.photo ? 'Recadrer' : 'Ajouter'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenPersonDrawer(p.id)}
                      className="px-2.5 py-1.5 text-xs text-[#8C7A65] hover:text-[#1C1917] hover:bg-[#FAF8F5] transition-colors"
                      title="Ouvrir la fiche complète"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SUB-TAB 2: DESIGN & VISUAL CUSTOMIZATION */}
      {activeSubTab === 'design' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column: Identity & Typography */}
          <div className="lg:col-span-6 space-y-6">
            <div className="bg-white border border-[#E6DFD3] p-6 space-y-5">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-[#8C7A65] font-medium">
                  01. Identité Éditoriale
                </p>
                <h3 className="font-serif text-2xl text-[#1C1917] mt-1">
                  Titres & Frontispice de l’Arbre
                </h3>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[#575047] mb-1.5">
                    Nom de l’arbre / de la maison familiale
                  </label>
                  <input
                    type="text"
                    value={settings.familyName}
                    onChange={(e) => onUpdateSettings({ familyName: e.target.value })}
                    className="w-full h-10 px-3.5 bg-[#FAF8F5] border border-[#D8CFC2] text-sm text-[#1C1917] focus:outline-none focus:border-[#8C7355]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#575047] mb-1.5">
                    Sur-titre d’archive
                  </label>
                  <input
                    type="text"
                    value={settings.subtitle}
                    onChange={(e) => onUpdateSettings({ subtitle: e.target.value })}
                    className="w-full h-10 px-3.5 bg-[#FAF8F5] border border-[#D8CFC2] text-sm text-[#1C1917] focus:outline-none focus:border-[#8C7355]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#575047] mb-1.5">
                    Devise ou introduction
                  </label>
                  <input
                    type="text"
                    value={settings.motto}
                    onChange={(e) => onUpdateSettings({ motto: e.target.value })}
                    className="w-full h-10 px-3.5 bg-[#FAF8F5] border border-[#D8CFC2] text-sm text-[#1C1917] focus:outline-none focus:border-[#8C7355]"
                  />
                </div>
              </div>
            </div>

            {/* Palette Selection */}
            <div className="bg-white border border-[#E6DFD3] p-6 space-y-5">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-[#8C7A65] font-medium">
                  02. Chromie & Harmonie
                </p>
                <h3 className="font-serif text-2xl text-[#1C1917] mt-1">
                  Nuancier Haute Horlogerie
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  {
                    id: 'ivory-bronze' as const,
                    name: 'Ivoire & Bronze',
                    desc: 'Papier coton chaud & or vieilli',
                    swatch: '#8C7355',
                  },
                  {
                    id: 'porcelain-cypress' as const,
                    name: 'Porcelaine & Cyprès',
                    desc: 'Albâtre & vert forêt profond',
                    swatch: '#344E41',
                  },
                  {
                    id: 'alabaster-slate' as const,
                    name: 'Craie & Bleu Nuit',
                    desc: 'Blanc galerie & encre marine',
                    swatch: '#1E3A5F',
                  },
                ].map((pal) => {
                  const selected = settings.palette === pal.id;
                  return (
                    <button
                      key={pal.id}
                      type="button"
                      onClick={() => onUpdateSettings({ palette: pal.id })}
                      className={`p-4 border text-left transition-all ${
                        selected
                          ? 'border-[#1C1917] bg-[#FAF8F5] shadow-xs'
                          : 'border-[#E6DFD3] bg-white hover:border-[#C5B49E]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2.5">
                        <span
                          className="h-5 w-5 rounded-full border border-black/10"
                          style={{ backgroundColor: pal.swatch }}
                        />
                        {selected && <Check className="h-4 w-4 text-[#1C1917]" />}
                      </div>
                      <p className="font-serif text-base font-medium text-[#1C1917]">
                        {pal.name}
                      </p>
                      <p className="text-[11px] text-[#6E665C] mt-0.5">{pal.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Column: Layout, Card Style & Visibility Toggles */}
          <div className="lg:col-span-6 space-y-6">
            <div className="bg-white border border-[#E6DFD3] p-6 space-y-5">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-[#8C7A65] font-medium">
                  03. Architecture Spatiale
                </p>
                <h3 className="font-serif text-2xl text-[#1C1917] mt-1">
                  Disposition des Cartes & Liaisons
                </h3>
              </div>

              {/* Orientation */}
              <div>
                <label className="block text-xs font-medium text-[#575047] mb-2">
                  Sens de déploiement de l’arbre
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ orientation: 'vertical' })}
                    className={`flex items-center gap-3 p-3.5 border text-left transition-colors ${
                      settings.orientation === 'vertical'
                        ? 'border-[#1C1917] bg-[#FAF8F5] font-medium'
                        : 'border-[#E6DFD3] hover:bg-[#FAF8F5]'
                    }`}
                  >
                    <ArrowDownUp className="h-4 w-4 text-[#8C7355] shrink-0" />
                    <div>
                      <p className="text-xs text-[#1C1917]">Vertical (Haut → Bas)</p>
                      <p className="text-[11px] text-[#8E867B]">Arbre généalogique classique</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ orientation: 'horizontal' })}
                    className={`flex items-center gap-3 p-3.5 border text-left transition-colors ${
                      settings.orientation === 'horizontal'
                        ? 'border-[#1C1917] bg-[#FAF8F5] font-medium'
                        : 'border-[#E6DFD3] hover:bg-[#FAF8F5]'
                    }`}
                  >
                    <ArrowLeftRight className="h-4 w-4 text-[#8C7355] shrink-0" />
                    <div>
                      <p className="text-xs text-[#1C1917]">Horizontal (Gauche → Droite)</p>
                      <p className="text-[11px] text-[#8E867B]">Lecture latérale panoramique</p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Card Style */}
              <div>
                <label className="block text-xs font-medium text-[#575047] mb-2">
                  Design des cartes individuelles
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: 'editorial' as const, label: 'Éditorial Luxe', sub: 'Portrait & filet' },
                    { id: 'medallion' as const, label: 'Médaillon Centré', sub: 'Portrait vertical' },
                    { id: 'minimal' as const, label: 'Épuré Galerie', sub: 'Typographie pure' },
                  ].map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => onUpdateSettings({ cardStyle: st.id })}
                      className={`p-3 border text-left transition-colors ${
                        settings.cardStyle === st.id
                          ? 'border-[#1C1917] bg-[#FAF8F5] font-medium'
                          : 'border-[#E6DFD3] hover:bg-[#FAF8F5]'
                      }`}
                    >
                      <p className="text-xs text-[#1C1917]">{st.label}</p>
                      <p className="text-[10px] text-[#8E867B] mt-0.5">{st.sub}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Edge Style */}
              <div>
                <label className="block text-xs font-medium text-[#575047] mb-2">
                  Style des traits de filiation
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ edgeStyle: 'bezier' })}
                    className={`p-3 border text-left transition-colors ${
                      settings.edgeStyle === 'bezier'
                        ? 'border-[#1C1917] bg-[#FAF8F5] font-medium'
                        : 'border-[#E6DFD3] hover:bg-[#FAF8F5]'
                    }`}
                  >
                    <p className="text-xs text-[#1C1917]">Courbes Bézier Soyeuses</p>
                    <p className="text-[11px] text-[#8E867B]">Liaisons fluides et organiques</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ edgeStyle: 'orthogonal' })}
                    className={`p-3 border text-left transition-colors ${
                      settings.edgeStyle === 'orthogonal'
                        ? 'border-[#1C1917] bg-[#FAF8F5] font-medium'
                        : 'border-[#E6DFD3] hover:bg-[#FAF8F5]'
                    }`}
                  >
                    <p className="text-xs text-[#1C1917]">Tracé Orthogonal</p>
                    <p className="text-[11px] text-[#8E867B]">Angles droits architecturaux</p>
                  </button>
                </div>
              </div>
            </div>

            {/* Visibility Toggles */}
            <div className="bg-white border border-[#E6DFD3] p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[#8C7A65] font-medium">
                    04. Options de Lecture
                  </p>
                  <h3 className="font-serif text-2xl text-[#1C1917] mt-1">
                    Éléments affichés sur le canevas
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={onResetSettings}
                  className="text-xs text-[#8C7A65] hover:text-[#1C1917] underline underline-offset-4"
                >
                  Valeurs par défaut
                </button>
              </div>

              <div className="divide-y divide-[#F0ECE3]">
                {[
                  {
                    key: 'showGenerations' as const,
                    label: 'Repères des Générations (I à V)',
                    desc: 'Affiche les lignes d’époque et numéros romains en arrière-plan',
                  },
                  {
                    key: 'showSpouses' as const,
                    label: 'Médaillons des Co-parents & Unions',
                    desc: 'Affiche Fiodor Belawski, Aloïsi Wicikowski et les conjoints sur les branches',
                  },
                  {
                    key: 'showDates' as const,
                    label: 'Années de naissance et de décès',
                    desc: 'Affiche les dates sous chaque nom dans l’arbre',
                  },
                  {
                    key: 'showInitialsAvatar' as const,
                    label: 'Portraits & Monogrammes',
                    desc: 'Affiche le médaillon photo ou les initiales gravées',
                  },
                  {
                    key: 'compactSpacing' as const,
                    label: 'Espacement rapproché (Mode Compact)',
                    desc: 'Rapproche les fratries pour réduire la largeur totale de l’arbre',
                  },
                  {
                    key: 'showMinimap' as const,
                    label: 'Radar miniature d’orientation',
                    desc: 'Affiche la mini-carte interactive en haut à droite de l’arbre',
                  },
                ].map((item) => (
                  <label
                    key={item.key}
                    className="flex items-center justify-between py-3 cursor-pointer"
                  >
                    <div className="pr-4">
                      <p className="text-xs font-medium text-[#1C1917]">{item.label}</p>
                      <p className="text-[11px] text-[#8E867B]">{item.desc}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings[item.key]}
                      onChange={(e) => onUpdateSettings({ [item.key]: e.target.checked })}
                      className="h-4 w-4 accent-[#8C7355] cursor-pointer"
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: BACKUP, IMPORT & POSTER EXPORT */}
      {activeSubTab === 'backup' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1: JSON Backup & Restore */}
          <div className="bg-white border border-[#E6DFD3] p-6 flex flex-col justify-between space-y-5">
            <div className="space-y-2">
              <span className="text-[11px] uppercase tracking-[0.18em] text-[#8C7A65] font-medium">
                Sauvegarde Intégrale
              </span>
              <h3 className="font-serif text-2xl text-[#1C1917]">
                Exporter ou Importer (.JSON)
              </h3>
              <p className="text-xs text-[#6E665C] leading-relaxed">
                Toutes vos modifications sont enregistrées automatiquement dans ce navigateur. Exportez un fichier JSON pour conserver une copie de sécurité ou partager l’arbre avec votre famille.
              </p>
            </div>

            <div className="space-y-2.5 pt-2">
              <button
                type="button"
                onClick={handleExportJson}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-white transition-colors"
                style={{ backgroundColor: accentColor }}
              >
                <Download className="h-4 w-4" />
                Télécharger la sauvegarde (.json)
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium border border-[#D8CFC2] bg-[#FAF8F5] hover:bg-[#EFECE4] text-[#1C1917] transition-colors"
              >
                <Upload className="h-4 w-4 text-[#8C7A65]" />
                Importer un fichier de sauvegarde
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleImportFile}
                className="hidden"
              />
            </div>
          </div>

          {/* Card 2: Vector SVG Poster Export */}
          <div className="bg-white border border-[#E6DFD3] p-6 flex flex-col justify-between space-y-5">
            <div className="space-y-2">
              <span className="text-[11px] uppercase tracking-[0.18em] text-[#8C7A65] font-medium">
                Édition d’Art & Impression
              </span>
              <h3 className="font-serif text-2xl text-[#1C1917]">
                Affiche Vectorielle (.SVG)
              </h3>
              <p className="text-xs text-[#6E665C] leading-relaxed">
                Générez une planche vectorielle haute définition de l’arbre complet des Wici, prête à être ouverte dans n’importe quel navigateur ou imprimée en grand format sans aucune perte de qualité.
              </p>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={handleExportSvgPoster}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium border border-[#1C1917] bg-[#1C1917] text-white hover:bg-[#332E2A] transition-colors"
              >
                <FileCode className="h-4 w-4" />
                Exporter l’affiche vectorielle (.svg)
              </button>
            </div>
          </div>

          {/* Card 3: Reset to Initial Wici Seed */}
          <div className="bg-white border border-[#E6DFD3] p-6 flex flex-col justify-between space-y-5">
            <div className="space-y-2">
              <span className="text-[11px] uppercase tracking-[0.18em] text-[#8C7A65] font-medium">
                Archives d’Origine
              </span>
              <h3 className="font-serif text-2xl text-[#1C1917]">
                Restaurer l’Arbre Initial
              </h3>
              <p className="text-xs text-[#6E665C] leading-relaxed">
                Revenez à tout instant aux données initiales extraites du document original de la famille Wici (42 membres répartis sur 5 générations).
              </p>
            </div>

            <div className="pt-2">
              {confirmRestore ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onRestoreInitialData();
                      setConfirmRestore(false);
                    }}
                    className="flex-1 py-2.5 px-3 text-xs font-medium bg-[#992B15] text-white hover:bg-[#7D2210] transition-colors"
                  >
                    Confirmer la restauration
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmRestore(false)}
                    className="py-2.5 px-3 text-xs text-[#6E665C] hover:text-[#1C1917]"
                  >
                    Annuler
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmRestore(true)}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium border border-[#E2C5BD] text-[#992B15] hover:bg-[#FDF2F0] transition-colors"
                >
                  <RotateCcw className="h-4 w-4" />
                  Réinitialiser aux données d’origine
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
