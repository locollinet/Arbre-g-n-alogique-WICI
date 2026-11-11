import React, { useState, useMemo, useRef } from 'react';
import {
  Printer,
  Download,
  FileCode,
  X,
  Compass,
  Check,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Sparkles,
  Info,
  LayoutGrid,
  Share2,
  AlertCircle
} from 'lucide-react';
import { Person, TreeSettings } from '../data/wiciFamily';
import {
  buildPhotoPosterSvg,
  printPhotoPoster,
  exportPhotoPosterPng,
  exportPhotoPosterSvg,
  PosterOptions
} from '../utils/photoPosterGenerator';

interface FamilyPosterModalProps {
  isOpen: boolean;
  onClose: () => void;
  people: Person[];
  settings: TreeSettings;
  accentColor: string;
  onOpenShare?: () => void;
}

export const FamilyPosterModal: React.FC<FamilyPosterModalProps> = ({
  isOpen,
  onClose,
  people,
  settings,
  accentColor,
  onOpenShare,
}) => {
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
  const [customTitle, setCustomTitle] = useState('');
  const [customSubtitle, setCustomSubtitle] = useState('');
  const [previewZoom, setPreviewZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const posterOptions = useMemo<PosterOptions>(
    () => ({
      orientation,
      title: customTitle.trim() || settings.familyName || 'L’Arbre des Wici',
      subtitle: customSubtitle.trim() || undefined,
    }),
    [orientation, customTitle, customSubtitle, settings.familyName]
  );

  const posterData = useMemo(() => {
    try {
      return buildPhotoPosterSvg(people, settings, posterOptions);
    } catch (e) {
      console.error('Erreur génération poster:', e);
      return null;
    }
  }, [people, settings, posterOptions]);

  const handlePrint = async () => {
    setBusy(true);
    setStatusMsg('Préparation de l’impression A3...');
    setErrorMsg(null);
    try {
      printPhotoPoster(people, settings, posterOptions);
      setStatusMsg('Impression lancée directement.');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Impossible de lancer l’impression.');
    } finally {
      setBusy(false);
      setTimeout(() => setStatusMsg(null), 4000);
    }
  };

  const handleDownloadPng = async () => {
    setBusy(true);
    setStatusMsg('Génération du fichier PNG 300 DPI...');
    setErrorMsg(null);
    try {
      await exportPhotoPosterPng(people, settings, posterOptions);
      setStatusMsg('Image PNG téléchargée avec succès.');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Impossible d’exporter l’image.');
    } finally {
      setBusy(false);
      setTimeout(() => setStatusMsg(null), 4000);
    }
  };

  const handleDownloadSvg = () => {
    setErrorMsg(null);
    try {
      exportPhotoPosterSvg(people, settings, posterOptions);
      setStatusMsg('Fichier vectoriel SVG téléchargé.');
      setTimeout(() => setStatusMsg(null), 4000);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Impossible d’exporter le SVG.');
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="poster-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-6xl max-h-[95vh] bg-[#FAF8F5] border border-[#D5C7B4] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-[#1C1917]">
        {/* Top Header */}
        <div className="flex items-center justify-between px-5 sm:px-7 py-4 bg-white border-b border-[#E6DFD3] shrink-0">
          <div className="flex items-center gap-3">
            <div
              className="h-10 w-10 rounded-full flex items-center justify-center text-white shrink-0 shadow-2xs"
              style={{ backgroundColor: accentColor }}
            >
              <Printer className="h-5 w-5" />
            </div>
            <div>
              <h2
                id="poster-modal-title"
                className="font-serif text-xl sm:text-2xl font-semibold tracking-tight text-[#1C1917]"
              >
                Planche Photo A3 & Galerie de Portraits
              </h2>
              <p className="text-xs text-[#7A7065]">
                {people.length} membres · Disposition noble avec photos et noms en dessous · Format 420 × 297 mm
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 rounded-full flex items-center justify-center text-[#7A7065] hover:text-[#1C1917] hover:bg-[#FAF8F5] transition-colors"
            aria-label="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body: Sidebar controls + Live Preview */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-hidden">
          {/* Controls Panel (Left on Desktop, Top on Mobile) */}
          <div className="lg:col-span-4 p-5 sm:p-6 bg-white border-r border-[#E6DFD3] overflow-y-auto space-y-6">
            {/* 1. Format & Orientation */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-[#5A5248] uppercase tracking-wider">
                1. Orientation de la planche A3
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setOrientation('landscape')}
                  className={`min-h-[44px] px-3 py-2.5 rounded-xl border text-xs font-medium flex flex-col items-center justify-center gap-1 transition-all ${
                    orientation === 'landscape'
                      ? 'border-[#8C7355] bg-[#FAF8F5] text-[#1C1917] shadow-2xs font-semibold'
                      : 'border-[#E0D7C9] bg-white text-[#6E665C] hover:border-[#8C7355]'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 h-3 border border-current rounded-xs" />
                    <span>A3 Paysage</span>
                  </span>
                  <span className="text-[10px] text-[#8C7A65]">Recommandé (5 branches)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setOrientation('portrait')}
                  className={`min-h-[44px] px-3 py-2.5 rounded-xl border text-xs font-medium flex flex-col items-center justify-center gap-1 transition-all ${
                    orientation === 'portrait'
                      ? 'border-[#8C7355] bg-[#FAF8F5] text-[#1C1917] shadow-2xs font-semibold'
                      : 'border-[#E0D7C9] bg-white text-[#6E665C] hover:border-[#8C7355]'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-4 border border-current rounded-xs" />
                    <span>A3 Portrait</span>
                  </span>
                  <span className="text-[10px] text-[#8C7A65]">Format affiche verticale</span>
                </button>
              </div>
            </div>

            {/* 2. Titre & Frontispice */}
            <div className="space-y-3">
              <label className="block text-xs font-semibold text-[#5A5248] uppercase tracking-wider">
                2. Titre personnalisé
              </label>
              <div>
                <input
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder={settings.familyName || 'L’Arbre des Wici'}
                  className="w-full h-10 px-3 bg-[#FAF8F5] border border-[#E0D7C9] rounded-lg text-sm text-[#1C1917] focus:outline-none focus:border-[#8C7355] focus:bg-white"
                />
              </div>
            </div>

            {/* 3. Action Buttons */}
            <div className="pt-2 space-y-2.5">
              <label className="block text-xs font-semibold text-[#5A5248] uppercase tracking-wider">
                3. Sortie & Impression
              </label>

              <button
                type="button"
                disabled={busy}
                onClick={handlePrint}
                className="w-full min-h-[48px] px-4 rounded-xl text-white font-medium text-sm flex items-center justify-center gap-2 transition-all shadow-sm hover:opacity-95 active:scale-[0.99]"
                style={{ backgroundColor: accentColor }}
              >
                <Printer className="h-4.5 w-4.5" />
                <span>Imprimer ou Enregistrer en PDF</span>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleDownloadPng}
                  className="min-h-[42px] px-3 py-2 rounded-xl border border-[#D5C7B4] bg-white hover:bg-[#FAF8F5] text-xs font-medium text-[#1C1917] flex items-center justify-center gap-1.5 transition-colors"
                  title="Télécharger l’affiche en image PNG haute définition (300 DPI)"
                >
                  <Download className="h-3.5 w-3.5 text-[#8C7355]" />
                  <span>Image PNG HD</span>
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={handleDownloadSvg}
                  className="min-h-[42px] px-3 py-2 rounded-xl border border-[#D5C7B4] bg-white hover:bg-[#FAF8F5] text-xs font-medium text-[#1C1917] flex items-center justify-center gap-1.5 transition-colors"
                  title="Télécharger le fichier vectoriel SVG (pour imprimeur / retouche)"
                >
                  <FileCode className="h-3.5 w-3.5 text-[#8C7355]" />
                  <span>Vecteur SVG</span>
                </button>
              </div>

              {statusMsg && (
                <div className="p-2.5 rounded-lg bg-[#F0F7F2] border border-[#CDE5D5] text-[#2E6B3F] text-xs font-medium flex items-center gap-1.5 animate-in fade-in">
                  <Check className="h-3.5 w-3.5 shrink-0" />
                  <span>{statusMsg}</span>
                </div>
              )}

              {errorMsg && (
                <div className="p-2.5 rounded-lg bg-[#FAF0EE] border border-[#F0CEC7] text-[#C8523A] text-xs font-medium flex items-center gap-1.5 animate-in fade-in">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {onOpenShare && (
                <button
                  type="button"
                  onClick={onOpenShare}
                  className="w-full min-h-[40px] px-3 py-2 rounded-xl border border-[#D5C7B4] bg-[#FAF8F5] hover:bg-[#EFECE4] text-xs font-medium text-[#1C1917] flex items-center justify-center gap-2 transition-colors"
                >
                  <Share2 className="h-3.5 w-3.5 text-[#8C7355]" />
                  <span>Partager l’arbre ou envoyer sur WhatsApp</span>
                </button>
              )}
            </div>

            {/* 4. Conseil d'impression pour Tata Laurence & néophytes */}
            <div className="p-3.5 rounded-xl bg-[#FAF6F0] border border-[#E8DFD3] text-xs text-[#6E6354] space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-[#1C1917]">
                <Info className="h-4 w-4 text-[#8C7355]" />
                <span>Conseil pour un tirage parfait</span>
              </div>
              <p className="leading-relaxed">
                Dans la boîte de dialogue d’impression qui va s’ouvrir, sélectionnez le format papier <b>A3</b> (ou A4 selon votre imprimante) et veillez à cocher <b>« Graphiques d’arrière-plan »</b> pour imprimer toutes les belles nuances de couleurs.
              </p>
            </div>
          </div>

          {/* Live Preview Panel (Right) */}
          <div className="lg:col-span-8 bg-[#4A443C] p-4 sm:p-6 flex flex-col items-center justify-center overflow-auto min-h-[360px] sm:min-h-[480px]">
            {/* Preview Zoom Dock */}
            <div className="flex items-center gap-2 mb-3 px-3 py-1 bg-black/60 backdrop-blur-md rounded-full text-white text-xs">
              <button
                type="button"
                onClick={() => setPreviewZoom((z) => Math.max(0.4, z - 0.2))}
                className="p-1 hover:text-[#C5B49E]"
                title="Dézoomer"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <span className="font-mono tabular-nums">{Math.round(previewZoom * 100)}%</span>
              <button
                type="button"
                onClick={() => setPreviewZoom((z) => Math.min(2, z + 0.2))}
                className="p-1 hover:text-[#C5B49E]"
                title="Zoomer"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setPreviewZoom(1)}
                className="px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 text-[11px]"
              >
                Ajuster
              </button>
            </div>

            {/* Actual Rendered SVG */}
            <div
              className="bg-[#FAF8F5] shadow-2xl rounded-sm transition-transform duration-150 origin-top overflow-hidden max-w-full"
              style={{
                transform: `scale(${previewZoom})`,
                maxHeight: '72vh',
              }}
            >
              {posterData ? (
                <div
                  className="max-h-[72vh] overflow-auto"
                  dangerouslySetInnerHTML={{
                    __html: posterData.svg.replace(/^<\?xml[^?]*\?>/, ''),
                  }}
                />
              ) : (
                <div className="p-12 text-center text-sm text-[#8C7A65]">
                  Calcul de la planche en cours...
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
