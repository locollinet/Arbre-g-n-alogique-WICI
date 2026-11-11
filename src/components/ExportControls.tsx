import React, { useState } from 'react';
import { Person, TreeSettings } from '../data/wiciFamily';
import { exportPosterPng, exportPosterSvg, printPoster } from '../utils/posterExport';
import { FamilyPosterModal } from './FamilyPosterModal';
import { Printer, Share2, Sparkles, Network, Image as ImageIcon } from 'lucide-react';

export function ExportControls({
  people,
  settings,
  accentColor = '#8C7355',
  buttonClassName,
  label = 'Partager / Imprimer',
}: {
  people: Person[];
  settings: TreeSettings;
  accentColor?: string;
  buttonClassName?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [posterModalOpen, setPosterModalOpen] = useState(false);

  const run = async (action: () => void | Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="relative shrink-0 z-20">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={
            buttonClassName ||
            'min-h-[36px] px-3.5 sm:px-4 py-1.5 rounded-full bg-[#1C1917] hover:bg-[#38332E] text-white text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shadow-2xs'
          }
        >
          <Printer className="h-3.5 w-3.5 text-[#C5B49E]" />
          <span>{label}</span>
        </button>

        {open && (
          <div
            className="absolute right-0 top-full mt-2 w-80 bg-white border border-[#D5C7B4] rounded-2xl shadow-xl p-4 space-y-3 animate-in fade-in zoom-in-95 duration-150 z-50 text-[#1C1917]"
            role="group"
            aria-label="Options d’exportation et d’impression"
          >
            {/* Section 1 : Nouvelle Planche Photo A3 d'Art */}
            <div className="p-3 bg-[#FAF6F0] border border-[#E8DFD3] rounded-xl space-y-2">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-[#8C7355]" />
                <span className="font-serif text-sm font-semibold text-[#1C1917]">
                  Planche Photo A3 d’Art
                </span>
                <span className="ml-auto text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-[#8C7355] text-white">
                  Nouveau
                </span>
              </div>
              <p className="text-[11px] text-[#6E6354] leading-relaxed">
                Trombinoscope complet avec médaillons photos, noms sous les portraits et organisation par branche. Idéal pour tirage et encadrement A3.
              </p>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setPosterModalOpen(true);
                }}
                className="w-full min-h-[40px] px-3 py-2 rounded-lg text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-opacity hover:opacity-95 shadow-2xs"
                style={{ backgroundColor: accentColor }}
              >
                <Printer className="h-3.5 w-3.5" />
                <span>Ouvrir la Planche A3 (Prévisualiser)</span>
              </button>
            </div>

            {/* Section 2 : Arbre Généalogique Schématique */}
            <div className="space-y-1.5 pt-1 border-t border-[#F0ECE3]">
              <div className="flex items-center gap-1.5 px-1">
                <Network className="h-3.5 w-3.5 text-[#8C7A65]" />
                <span className="font-serif text-sm font-medium text-[#1C1917]">
                  Schéma de l’Arbre Ramifié
                </span>
              </div>
              <p className="text-[11px] text-[#7A7065] px-1">
                Le grand graphique interconnecté avec toutes les lignes de descendance.
              </p>

              <div className="grid grid-cols-1 gap-1 pt-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => printPoster(people, settings))}
                  className="w-full text-left min-h-[38px] px-3 py-1.5 rounded-lg border border-[#E6DFD3] hover:bg-[#FAF8F5] text-xs flex items-center justify-between transition-colors"
                >
                  <span>Imprimer le schéma en PDF</span>
                  <Printer className="h-3 w-3 text-[#8C7A65]" />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => exportPosterPng(people, settings))}
                  className="w-full text-left min-h-[38px] px-3 py-1.5 rounded-lg border border-[#E6DFD3] hover:bg-[#FAF8F5] text-xs flex items-center justify-between transition-colors"
                >
                  <span>Télécharger en image PNG</span>
                  <ImageIcon className="h-3 w-3 text-[#8C7A65]" />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => exportPosterSvg(people, settings))}
                  className="w-full text-left min-h-[38px] px-3 py-1.5 rounded-lg border border-[#E6DFD3] hover:bg-[#FAF8F5] text-xs flex items-center justify-between transition-colors"
                >
                  <span>Télécharger en fichier vectoriel SVG</span>
                  <Share2 className="h-3 w-3 text-[#8C7A65]" />
                </button>
              </div>
            </div>

            {error && <p role="alert" className="text-xs text-red-800 px-1">{error}</p>}
          </div>
        )}
      </div>

      {/* Standalone Live A3 Poster Modal */}
      {posterModalOpen && (
        <FamilyPosterModal
          isOpen={posterModalOpen}
          onClose={() => setPosterModalOpen(false)}
          people={people}
          settings={settings}
          accentColor={accentColor}
        />
      )}
    </>
  );
}
