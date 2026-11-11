import React, { useState, useEffect } from 'react';
import { X, Check, Copy, Share2, Smartphone, MessageCircle, Link as LinkIcon, Heart } from 'lucide-react';

interface ShareFamilyModalProps {
  isOpen: boolean;
  onClose: () => void;
  accentColor?: string;
  familyName?: string;
  peopleCount?: number;
}

export const ShareFamilyModal: React.FC<ShareFamilyModalProps> = ({
  isOpen,
  onClose,
  accentColor = '#8C7355',
  familyName = "L’Arbre des Wici",
  peopleCount = 42,
}) => {
  const [copied, setCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [canNativeShare, setCanNativeShare] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setShareUrl(window.location.href);
      setCanNativeShare(typeof navigator !== 'undefined' && !!navigator.share);
    }
  }, [isOpen]);

  const handleCopyLink = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const input = document.createElement('input');
        input.value = shareUrl;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch (err) {
      console.warn('Erreur copie presse-papiers:', err);
    }
  };

  const handleNativeShare = async () => {
    if (!navigator.share) return;
    try {
      await navigator.share({
        title: `${familyName} — Arbre Généalogique`,
        text: `Découvre notre arbre généalogique familial (${peopleCount} membres) et la planche de portraits :`,
        url: shareUrl,
      });
    } catch {
      // User cancelled share
    }
  };

  const whatsappMessage = encodeURIComponent(
    `Coucou ! Voici le lien de notre arbre généalogique familial "${familyName}" (${peopleCount} membres) avec tous les portraits et la planche A3 :\n${shareUrl}`
  );
  const whatsappUrl = `https://api.whatsapp.com/send?text=${whatsappMessage}`;

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div className="relative w-full max-w-lg bg-[#FAF8F5] border border-[#D5C7B4] rounded-2xl shadow-2xl overflow-hidden text-[#1C1917] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-[#E6DFD3]">
          <div className="flex items-center gap-3">
            <div
              className="h-10 w-10 rounded-full flex items-center justify-center text-white shrink-0 shadow-2xs"
              style={{ backgroundColor: accentColor }}
            >
              <Share2 className="h-5 w-5" />
            </div>
            <div>
              <h2
                id="share-modal-title"
                className="font-serif text-xl font-semibold tracking-tight text-[#1C1917]"
              >
                Partager l’Arbre Familial
              </h2>
              <p className="text-xs text-[#7A7065]">
                Lien direct d'accès pour toute la famille
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

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Explanatory note */}
          <div className="p-4 bg-white border border-[#E8DFD3] rounded-xl space-y-1.5">
            <p className="text-xs font-semibold text-[#1C1917] flex items-center gap-1.5">
              <Heart className="h-4 w-4 text-[#C8523A]" />
              <span>Accès partagé et sécurisé en temps réel</span>
            </p>
            <p className="text-xs text-[#6E6354] leading-relaxed">
              Toute personne ouvrant ce lien sur son smartphone, sa tablette ou son ordinateur pourra consulter l’arbre complet, voir les photos et afficher la planche A3.
            </p>
          </div>

          {/* Direct WhatsApp Share Button */}
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full min-h-[46px] px-4 py-2.5 rounded-xl bg-[#25D366] hover:bg-[#20BD5A] text-white font-medium text-sm flex items-center justify-center gap-2.5 transition-colors shadow-2xs"
          >
            <MessageCircle className="h-5 w-5" />
            <span>Envoyer sur WhatsApp à la famille</span>
          </a>

          {/* Native Mobile Share Sheet if supported */}
          {canNativeShare && (
            <button
              type="button"
              onClick={handleNativeShare}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl border border-[#D5C7B4] bg-white hover:bg-[#FAF8F5] text-xs font-medium text-[#1C1917] flex items-center justify-center gap-2 transition-colors"
            >
              <Smartphone className="h-4 w-4 text-[#8C7355]" />
              <span>Partager via mes applications (SMS, Mail…)</span>
            </button>
          )}

          {/* Copy URL Input Box */}
          <div className="space-y-1.5 pt-1">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#7A7065]">
              Lien direct de l’arbre
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <LinkIcon className="h-3.5 w-3.5 text-[#8C7A65] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  readOnly
                  value={shareUrl}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                  className="w-full h-11 pl-9 pr-3 bg-white border border-[#D8CFC2] rounded-xl text-xs font-mono text-[#1C1917] focus:outline-none focus:border-[#8C7355]"
                />
              </div>

              <button
                type="button"
                onClick={handleCopyLink}
                className="h-11 px-4 rounded-xl text-white font-medium text-xs flex items-center gap-1.5 transition-opacity hover:opacity-90 shrink-0 shadow-2xs"
                style={{ backgroundColor: accentColor }}
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" />
                    <span>Copié !</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    <span>Copier</span>
                  </>
                )}
              </button>
            </div>
            {copied && (
              <p className="text-[11px] text-[#2E6B3F] font-medium pt-0.5">
                ✓ Le lien a été copié avec succès dans votre presse-papiers.
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-white border-t border-[#E6DFD3] flex items-center justify-between text-xs text-[#8C7A65]">
          <span>{peopleCount} personnes réunies</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-[#1C1917] hover:bg-[#FAF8F5] font-medium"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
