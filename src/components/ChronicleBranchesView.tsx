import React from 'react';
import { GitBranch, ChevronRight, ArrowUpRight, Users, Calendar } from 'lucide-react';
import {
  Person,
  BRANCH_DEFINITIONS,
  GENERATION_LABELS,
  getFullName,
  getInitials,
  getLifeDates
} from '../data/wiciFamily';
import { getDescendantsSet, computeTreeLayout } from '../utils/treeLayout';
import { DEFAULT_SETTINGS } from '../data/wiciFamily';

interface ChronicleBranchesViewProps {
  people: Person[];
  onSelectPerson: (id: string) => void;
  onFocusBranchInTree: (branchId: string) => void;
  accentColor: string;
}

export const ChronicleBranchesView: React.FC<ChronicleBranchesViewProps> = ({
  people,
  onSelectPerson,
  onFocusBranchInTree,
  accentColor,
}) => {
  const byId = new Map(people.map((p) => [p.id, p]));
  const fullLayout = computeTreeLayout(people, 'all', new Set(), DEFAULT_SETTINGS);

  const depthMap = new Map<string, number>();
  fullLayout.nodes.forEach((n) => depthMap.set(n.id, n.depth));
  fullLayout.partners.forEach((p) => depthMap.set(p.person.id, p.depth));

  const mainBranches = BRANCH_DEFINITIONS.filter((b) => b.id !== 'all');

  // Group people by generation depth (0 to 4)
  const generations = Array.from({ length: Math.max(4, ...depthMap.values()) + 1 }, (_, depth) => {
    const members = people
      .filter((p) => (depthMap.get(p.id) ?? 0) === depth)
      .sort((a, b) => {
        const ya = parseInt((a.birth || '').replace(/\D/g, ''), 10) || 9999;
        const yb = parseInt((b.birth || '').replace(/\D/g, ''), 10) || 9999;
        return ya - yb;
      });
    return {
      depth,
      meta: GENERATION_LABELS[depth] || {
        roman: `${depth + 1}`,
        title: `Génération ${depth + 1}`,
        era: '',
      },
      members,
    };
  });

  return (
    <div className="max-w-[1600px] w-full mx-auto px-6 lg:px-10 py-8 space-y-12">
      {/* Section 1: Les Cinq Grandes Branches issues de Victoria Tripel */}
      <section className="space-y-6">
        <div className="border-b border-[#E6DFD3] pb-5 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#8C7A65] font-medium">
              Monographie Familiale
            </p>
            <h1 className="font-serif text-3xl sm:text-4xl font-normal text-[#1C1917] mt-1">
              Les Cinq Branches & Générations
            </h1>
            <p className="text-sm text-[#6E665C] mt-1.5 max-w-2xl">
              De Victoria Tripel (1914–1997), unie à Fiodor Belawski puis à Aloïsi Wicikowski (1915–1972), sont nées cinq branches qui forment aujourd’hui la grande famille Wici.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-5">
          {mainBranches.map((branch, idx) => {
            const founder = byId.get(branch.founderId);
            if (!founder) return null;
            const descIds = getDescendantsSet(people, founder.id);
            const descendants = people.filter(
              (p) => descIds.has(p.id) && p.id !== founder.id
            );
            const coParent =
              branch.id === 'lydia' || branch.id === 'flore'
                ? 'Fiodor Belawski'
                : 'Aloïsi Wicikowski';

            return (
              <div
                key={branch.id}
                className="bg-white border border-[#E6DFD3] p-6 flex flex-col justify-between hover:border-[#B5A288] transition-colors"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs text-[#8C7A65]">
                    <span className="font-mono">0{idx + 1}. BRANCHE</span>
                    <span className="font-mono tabular-nums">
                      {descIds.size} personne{descIds.size > 1 ? 's' : ''}
                    </span>
                  </div>

                  <div>
                    <button
                      type="button"
                      onClick={() => onSelectPerson(founder.id)}
                      className="font-serif text-2xl text-[#1C1917] hover:text-[#8C7355] text-left leading-tight"
                    >
                      {getFullName(founder)}
                    </button>
                    <p className="text-xs font-mono text-[#8C7A65] mt-1">
                      {getLifeDates(founder)}
                    </p>
                    <p className="text-[11px] text-[#6E665C] mt-2">
                      Fille/Fils de Victoria Tripel · {coParent}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-[#F0ECE3] space-y-1.5">
                    <span className="block text-[10px] uppercase tracking-[0.16em] text-[#8C7A65]">
                      Descendance directe
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {descendants.slice(0, 8).map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => onSelectPerson(d.id)}
                          className="text-xs text-[#3D3832] hover:text-[#8C7355] underline decoration-[#D8CFC2] underline-offset-2"
                        >
                          {d.first}
                        </button>
                      ))}
                      {descendants.length > 8 && (
                        <span className="text-xs text-[#8C7A65]">
                          +{descendants.length - 8}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onFocusBranchInTree(branch.id)}
                  className="mt-6 w-full inline-flex items-center justify-between px-3.5 py-2 text-xs font-medium border border-[#E6DFD3] bg-[#FAF8F5] hover:bg-[#1C1917] hover:text-white hover:border-[#1C1917] transition-colors"
                >
                  <span>Explorer dans l’arbre</span>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Section 2: Chronologie par Générations (I à V) */}
      <section className="space-y-6">
        <div className="border-b border-[#E6DFD3] pb-4">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#8C7A65] font-medium">
            Index Chronologique
          </p>
          <h2 className="font-serif text-2xl sm:text-3xl font-normal text-[#1C1917] mt-1">
            Répertoire par Génération
          </h2>
        </div>

        <div className="space-y-6">
          {generations.map((gen) => (
            <div
              key={gen.depth}
              className="bg-white border border-[#E6DFD3] p-6 grid grid-cols-1 lg:grid-cols-12 gap-6"
            >
              <div className="lg:col-span-3 lg:border-r lg:border-[#F0ECE3] lg:pr-6 flex flex-col justify-between">
                <div>
                  <span className="font-serif italic text-3xl text-[#8C7355]">
                    Génération {gen.meta.roman}
                  </span>
                  <h3 className="font-serif text-xl text-[#1C1917] mt-1">
                    {gen.meta.title}
                  </h3>
                  <p className="text-xs font-mono text-[#8C7A65] mt-1">
                    {gen.meta.era}
                  </p>
                </div>
                <p className="text-xs text-[#6E665C] mt-4 font-mono tabular-nums">
                  {gen.members.length} membre{gen.members.length > 1 ? 's' : ''}
                </p>
              </div>

              <div className="lg:col-span-9 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {gen.members.map((m) => {
                  const parentsText = (m.parents || [])
                    .map((pid) => byId.get(pid)?.first)
                    .filter(Boolean)
                    .join(' & ');

                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onSelectPerson(m.id)}
                      className="flex items-center gap-3 p-3 bg-[#FAF8F5] border border-[#E6DFD3] hover:border-[#8C7355] hover:bg-white text-left transition-colors group"
                    >
                      <div className="h-10 w-10 rounded-full border border-[#DFD6C7] bg-white flex items-center justify-center overflow-hidden shrink-0">
                        {m.photo ? (
                          <img
                            src={m.photo}
                            alt={getFullName(m)}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="font-serif text-xs text-[#7D6B57]">
                            {getInitials(m)}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-serif text-base font-medium text-[#1C1917] truncate group-hover:text-[#8C7355]">
                          {getFullName(m)}
                        </p>
                        <div className="flex items-center gap-1.5 text-[11px] text-[#8C7A65] truncate">
                          <span className="font-mono tabular-nums">
                            {[m.birth, m.death].filter(Boolean).join('–') || '—'}
                          </span>
                          {parentsText && (
                            <>
                              <span>·</span>
                              <span className="truncate">Enf. de {parentsText}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-[#C5B49E] group-hover:translate-x-0.5 transition-transform shrink-0" />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
