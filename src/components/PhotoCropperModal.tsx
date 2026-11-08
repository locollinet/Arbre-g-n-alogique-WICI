import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X,
  Upload,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Sliders,
  Check,
  Sparkles,
  Cloud,
  CloudCheck,
  AlertCircle,
  Eye,
  RefreshCw,
  Move,
  Camera,
  LogIn
} from 'lucide-react';
import { Person, getFullName, getLifeDates } from '../data/wiciFamily';
import { auth } from '../firebase/firebase';
import { signInWithGoogle } from '../firebase/authService';

export interface CropResult {
  dataUrl: string;
  shape: 'circle' | 'oval' | 'portrait' | 'square';
  filter: 'none' | 'sepia' | 'bw' | 'warm';
  caption?: string;
  fileSizeBytes: number;
}

interface PhotoCropperModalProps {
  isOpen: boolean;
  person: Person;
  initialImageSrc?: string;
  accentColor: string;
  onClose: () => void;
  onSave: (result: CropResult) => Promise<void> | void;
}

type ShapeType = 'circle' | 'oval' | 'portrait' | 'square';
type FilterType = 'none' | 'sepia' | 'bw' | 'warm';

export const PhotoCropperModal: React.FC<PhotoCropperModalProps> = ({
  isOpen,
  person,
  initialImageSrc,
  accentColor,
  onClose,
  onSave,
}) => {
  const [imageSrc, setImageSrc] = useState<string | null>(initialImageSrc || null);
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);

  // Transform states
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [rotation, setRotation] = useState<number>(0); // in degrees (-45 to 45 fine tilt or 90 steps)

  // Style states
  const [shape, setShape] = useState<ShapeType>('circle');
  const [filter, setFilter] = useState<FilterType>('sepia');
  const [caption, setCaption] = useState<string>('');

  // Status states
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string>('');
  const [estimatedSizeKb, setEstimatedSizeKb] = useState<number>(0);
  const [isAuthPromptOpen, setIsAuthPromptOpen] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize or reset when opened
  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      setShape('circle');
      setFilter('sepia');
      setCaption('');
      setPan({ x: 0, y: 0 });
      setZoom(1);
      setRotation(0);

      if (initialImageSrc) {
        setImageSrc(initialImageSrc);
      } else if (person.photo) {
        setImageSrc(person.photo);
      } else {
        setImageSrc(null);
      }
    }
  }, [isOpen, initialImageSrc, person]);

  // Load Image element when imageSrc changes
  useEffect(() => {
    if (!imageSrc) {
      setLoadedImage(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setLoadedImage(img);
      // Auto-fit initial zoom so face fills the crop zone nicely
      const minDim = Math.min(img.width, img.height);
      const targetSize = 280;
      const initialScale = Math.max(1, targetSize / minDim);
      setZoom(Number(initialScale.toFixed(2)));
      setPan({ x: 0, y: 0 });
      setRotation(0);
    };
    img.onerror = () => {
      setErrorMessage("Impossible de charger l'image source.");
    };
    img.src = imageSrc;
  }, [imageSrc]);

  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMessage(null);

    if (!file.type.startsWith('image/')) {
      setErrorMessage('Veuillez sélectionner un fichier image valide (JPG, PNG, WebP).');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result as string);
    };
    reader.onerror = () => {
      setErrorMessage('Erreur lors de la lecture du fichier.');
    };
    reader.readAsDataURL(file);
  };

  // Generate canvas rendering
  const renderCropCanvas = useCallback(() => {
    if (!loadedImage || !canvasRef.current) return '';

    const canvas = canvasRef.current;
    const outputDim = 380; // High resolution for crisp Retina display
    canvas.width = outputDim;
    canvas.height = outputDim;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.clearRect(0, 0, outputDim, outputDim);
    ctx.save();

    // 1. Clip path based on chosen shape
    const center = outputDim / 2;
    ctx.beginPath();
    if (shape === 'circle') {
      ctx.arc(center, center, outputDim * 0.46, 0, Math.PI * 2);
    } else if (shape === 'oval') {
      ctx.ellipse(center, center, outputDim * 0.38, outputDim * 0.46, 0, 0, Math.PI * 2);
    } else if (shape === 'portrait') {
      const w = outputDim * 0.74;
      const h = outputDim * 0.92;
      const x = (outputDim - w) / 2;
      const y = (outputDim - h) / 2;
      const r = 24;
      ctx.roundRect(x, y, w, h, r);
    } else {
      // square with elegant rounded corners
      const s = outputDim * 0.88;
      const x = (outputDim - s) / 2;
      const r = 20;
      ctx.roundRect(x, x, s, s, r);
    }
    ctx.closePath();
    ctx.clip();

    // 2. Background base fill
    ctx.fillStyle = '#F5F2EB';
    ctx.fillRect(0, 0, outputDim, outputDim);

    // 3. Transformations: Center -> Pan -> Rotate -> Scale
    ctx.translate(center + pan.x, center + pan.y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(zoom, zoom);

    // Draw the image centered
    const imgX = -loadedImage.width / 2;
    const imgY = -loadedImage.height / 2;
    ctx.drawImage(loadedImage, imgX, imgY);

    ctx.restore();

    // 4. Apply Filters
    if (filter !== 'none') {
      // Re-apply filter via Canvas composition
      const imgData = ctx.getImageData(0, 0, outputDim, outputDim);
      const d = imgData.data;

      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        const a = d[i + 3];
        if (a === 0) continue;

        if (filter === 'sepia') {
          // Warm archival sepia formula
          const tr = 0.393 * r + 0.769 * g + 0.189 * b;
          const tg = 0.349 * r + 0.686 * g + 0.168 * b;
          const tb = 0.272 * r + 0.534 * g + 0.131 * b;
          d[i] = Math.min(255, tr * 1.05);
          d[i + 1] = Math.min(255, tg * 0.98);
          d[i + 2] = Math.min(255, tb * 0.88);
        } else if (filter === 'bw') {
          // Classic film grain silver gelatin B&W
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          // slight contrast curve
          const contrast = (gray - 128) * 1.15 + 128;
          const clamped = Math.max(0, Math.min(255, contrast));
          d[i] = clamped;
          d[i + 1] = clamped;
          d[i + 2] = clamped;
        } else if (filter === 'warm') {
          // Golden hour archival amber
          d[i] = Math.min(255, r * 1.08 + 8);
          d[i + 1] = Math.min(255, g * 1.02 + 4);
          d[i + 2] = Math.max(0, b * 0.92 - 4);
        }
      }
      ctx.putImageData(imgData, 0, 0);
    }

    // 5. Draw decorative archival cameo border
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#B89F7C'; // Warm bronze/gold heirloom trim
    if (shape === 'circle') {
      ctx.beginPath();
      ctx.arc(center, center, outputDim * 0.46, 0, Math.PI * 2);
      ctx.stroke();
    } else if (shape === 'oval') {
      ctx.beginPath();
      ctx.ellipse(center, center, outputDim * 0.38, outputDim * 0.46, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (shape === 'portrait') {
      const w = outputDim * 0.74;
      const h = outputDim * 0.92;
      const x = (outputDim - w) / 2;
      const y = (outputDim - h) / 2;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 24);
      ctx.stroke();
    } else {
      const s = outputDim * 0.88;
      const x = (outputDim - s) / 2;
      ctx.beginPath();
      ctx.roundRect(x, x, s, s, 20);
      ctx.stroke();
    }
    ctx.restore();

    const dataUrl = canvas.toDataURL('image/jpeg', 0.84);
    setPreviewDataUrl(dataUrl);
    setEstimatedSizeKb(Math.round(dataUrl.length / 1024));
    return dataUrl;
  }, [loadedImage, shape, filter, zoom, pan, rotation]);

  // Update canvas on parameter change
  useEffect(() => {
    if (loadedImage) {
      renderCropCanvas();
    }
  }, [loadedImage, shape, filter, zoom, pan, rotation, renderCropCanvas]);

  // Drag interaction for positioning the image
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!loadedImage) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsDragging(true);
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStart) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    setPan({
      x: dragStart.panX + dx,
      y: dragStart.panY + dy,
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      setIsDragging(false);
      setDragStart(null);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!loadedImage) return;
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    setZoom((z) => Math.min(3.5, Math.max(0.4, Number((z + delta).toFixed(2)))));
  };

  // Quick 90 degree rotation
  const handleRotate90 = () => {
    setRotation((r) => (r + 90) % 360);
  };

  // Reset framing
  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
  };

  // Save handler with Firebase Cloud storage
  const handleSaveAndSync = async () => {
    if (!loadedImage) return;
    setIsSaving(true);
    setErrorMessage(null);

    try {
      const finalDataUrl = renderCropCanvas();
      if (!finalDataUrl) throw new Error('Échec de la génération du portrait.');

      const result: CropResult = {
        dataUrl: finalDataUrl,
        shape,
        filter,
        caption: caption.trim() || undefined,
        fileSizeBytes: finalDataUrl.length,
      };

      await onSave(result);
      onClose();
    } catch (err: unknown) {
      console.error('Erreur enregistrement photo:', err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('permission-denied') || msg.includes('PERMISSION_DENIED')) {
        setErrorMessage(
          'Permissions insuffisantes. Connectez-vous avec Google pour enregistrer le portrait dans Firebase.'
        );
        setIsAuthPromptOpen(true);
      } else {
        setErrorMessage(msg || "Erreur lors de l'enregistrement de la photo.");
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      setErrorMessage(null);
      await signInWithGoogle();
      setIsAuthPromptOpen(false);
      // Retry save automatically
      await handleSaveAndSync();
    } catch (e) {
      setErrorMessage("Échec de l'authentification Google.");
    }
  };

  if (!isOpen) return null;

  const datesText = getLifeDates(person);
  const currentUser = auth.currentUser;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1C1917]/70 backdrop-blur-xs p-3 sm:p-6 overflow-y-auto">
      {/* Backdrop click */}
      <div className="fixed inset-0" onClick={onClose} aria-label="Fermer" />

      {/* Modal Card */}
      <div className="relative z-10 w-full max-w-4xl bg-[#FAF8F5] text-[#1C1917] border border-[#E6DFD3] shadow-2xl overflow-hidden flex flex-col my-auto max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-[#E6DFD3] shrink-0">
          <div className="flex items-center gap-3">
            <div
              className="h-9 w-9 rounded-full flex items-center justify-center text-white"
              style={{ backgroundColor: accentColor }}
            >
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#8C7A65] font-medium">
                Atelier Photographique & Archives Cloud
              </p>
              <h2 className="font-serif text-xl sm:text-2xl font-normal text-[#1C1917]">
                Portrait de {getFullName(person)}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-[#8E867B] hover:text-[#1C1917] hover:bg-[#F5F2EB] rounded-full transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Auth prompt banner if not logged in */}
        {!currentUser && (
          <div className="bg-[#F8F5EE] border-b border-[#E8DEC9] px-6 py-2.5 flex items-center justify-between gap-3 text-xs text-[#6B5E4F] shrink-0">
            <div className="flex items-center gap-2">
              <Cloud className="h-4 w-4 text-[#8C7A65]" />
              <span>
                <strong>Stockage Cloud Firebase actif :</strong> Connectez-vous avec Google pour sauvegarder vos photos de façon pérenne sur le cloud sans alourdir le code.
              </span>
            </div>
            <button
              type="button"
              onClick={handleGoogleLogin}
              className="inline-flex items-center gap-1.5 px-3 py-1 bg-white border border-[#D5C7B4] hover:border-[#8C7355] text-xs font-medium text-[#1C1917] rounded-xs shadow-2xs whitespace-nowrap transition-colors"
            >
              <LogIn className="h-3.5 w-3.5 text-[#8C7A65]" />
              <span>Connexion Google</span>
            </button>
          </div>
        )}

        {/* Content body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-7">
          {errorMessage && (
            <div className="mb-5 p-3.5 bg-[#FDF2F0] border border-[#E6B8B0] text-xs text-[#8C2D19] flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {!imageSrc ? (
            /* Upload Zone if no image is loaded */
            <div className="border-2 border-dashed border-[#D8CFC2] bg-white p-10 text-center flex flex-col items-center justify-center gap-4 hover:border-[#8C7355] transition-colors cursor-pointer"
                 onClick={() => fileInputRef.current?.click()}>
              <div className="h-16 w-16 rounded-full bg-[#FAF8F5] border border-[#E2DAD0] flex items-center justify-center text-[#8C7A65]">
                <Camera className="h-8 w-8" />
              </div>
              <div className="max-w-md">
                <h3 className="font-serif text-xl font-normal text-[#1C1917]">
                  Ajouter un portrait photographique
                </h3>
                <p className="text-xs text-[#7A7266] mt-1.5">
                  Glissez-déposez une photo d'époque ou cliquez pour parcourir vos fichiers (JPG, PNG, WebP).
                </p>
                <p className="text-[11px] text-[#9A9184] mt-1">
                  La photo sera automatiquement recadrée et optimisée pour l'arbre généalogique.
                </p>
              </div>

              <button
                type="button"
                className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: accentColor }}
              >
                <Upload className="h-4 w-4" />
                <span>Sélectionner une photo</span>
              </button>
            </div>
          ) : (
            /* Active Cropper Workspace */
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-7">
              {/* Left Column: Interactive Canvas & Framing (7 cols) */}
              <div className="lg:col-span-7 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[#575047] uppercase tracking-wider flex items-center gap-1.5">
                    <Move className="h-3.5 w-3.5 text-[#8C7A65]" />
                    Cadre & Positionnement (Glisser pour ajuster)
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleReset}
                      className="text-xs text-[#8C7A65] hover:text-[#1C1917] flex items-center gap-1 transition-colors"
                      title="Réinitialiser le zoom et la position"
                    >
                      <RefreshCw className="h-3 w-3" />
                      <span>Réinitialiser</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs text-[#8C7A65] hover:text-[#1C1917] underline transition-colors ml-2"
                    >
                      Autre fichier
                    </button>
                  </div>
                </div>

                {/* Canvas Container */}
                <div
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  onWheel={handleWheel}
                  className={`relative w-full aspect-square max-w-[380px] mx-auto bg-[#F2EDE4] border border-[#D5C7B4] shadow-inner overflow-hidden select-none touch-none flex items-center justify-center ${
                    isDragging ? 'cursor-grabbing' : 'cursor-grab'
                  }`}
                  style={{
                    backgroundImage:
                      'radial-gradient(#D5C7B4 1.5px, transparent 1.5px)',
                    backgroundSize: '20px 20px',
                  }}
                >
                  <canvas
                    ref={canvasRef}
                    className="w-full h-full object-contain pointer-events-none drop-shadow-md"
                  />

                  {/* Visual Guide Overlay (Corner crosshairs) */}
                  <div className="absolute inset-0 pointer-events-none border border-[#B89F7C]/20" />
                  <div className="absolute top-2 left-2 text-[10px] font-mono text-[#8C7A65]/70 pointer-events-none">
                    Zoom: {(zoom * 100).toFixed(0)}%
                  </div>
                </div>

                {/* Framing Shape Selector */}
                <div>
                  <label className="block text-xs font-medium text-[#575047] mb-1.5">
                    Forme du médaillon dans l'arbre
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { id: 'circle', label: 'Médaillon Rond', desc: 'Classique d’orfèvre' },
                      { id: 'oval', label: 'Camée Ovale', desc: 'Portrait XIXe-XXe' },
                      { id: 'portrait', label: 'Format 3:4', desc: 'Studio d’époque' },
                      { id: 'square', label: 'Carré Doux', desc: 'Épuré & moderne' },
                    ].map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setShape(item.id as ShapeType)}
                        className={`p-2.5 border text-center transition-all ${
                          shape === item.id
                            ? 'bg-white border-[#8C7355] shadow-xs'
                            : 'bg-[#FAF8F5] border-[#E0D7C9] hover:bg-white text-[#6E665C]'
                        }`}
                      >
                        <span className="block text-xs font-medium text-[#1C1917]">
                          {item.label}
                        </span>
                        <span className="block text-[10px] text-[#8C7A65] mt-0.5">
                          {item.desc}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Transform Sliders: Zoom & Tilt */}
                <div className="space-y-3 bg-white p-3.5 border border-[#E6DFD3]">
                  {/* Zoom Slider */}
                  <div className="flex items-center gap-3">
                    <ZoomOut className="h-4 w-4 text-[#8C7A65] shrink-0" />
                    <input
                      type="range"
                      min="0.5"
                      max="3"
                      step="0.05"
                      value={zoom}
                      onChange={(e) => setZoom(parseFloat(e.target.value))}
                      className="w-full accent-[#8C7355] cursor-pointer"
                    />
                    <ZoomIn className="h-4 w-4 text-[#8C7A65] shrink-0" />
                    <span className="text-xs font-mono tabular-nums text-[#6E665C] w-12 text-right">
                      {Math.round(zoom * 100)}%
                    </span>
                  </div>

                  {/* Tilt Slider + 90° Rotate */}
                  <div className="flex items-center gap-3 pt-1 border-t border-[#F0EAE1]">
                    <span className="text-[11px] text-[#6E665C] whitespace-nowrap">
                      Inclinaison :
                    </span>
                    <input
                      type="range"
                      min="-45"
                      max="45"
                      step="1"
                      value={rotation}
                      onChange={(e) => setRotation(parseInt(e.target.value, 10))}
                      className="w-full accent-[#8C7355] cursor-pointer"
                    />
                    <span className="text-xs font-mono tabular-nums text-[#6E665C] w-10 text-right">
                      {rotation}°
                    </span>
                    <button
                      type="button"
                      onClick={handleRotate90}
                      className="p-1.5 border border-[#D8CFC2] hover:bg-[#F5F2EB] rounded-xs text-[#1C1917] transition-colors"
                      title="Pivoter de 90°"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column: Filters, Live In-Situ Preview & Sync (5 cols) */}
              <div className="lg:col-span-5 flex flex-col gap-5">
                {/* Vintage Photographic Tone Filters */}
                <div>
                  <label className="block text-xs font-medium text-[#575047] mb-2 flex items-center gap-1.5">
                    <Sliders className="h-3.5 w-3.5 text-[#8C7A65]" />
                    Tonalité & Filtre d'Époque
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'sepia', label: 'Sépia d’Archives', desc: 'Chaleur vintage' },
                      { id: 'bw', label: 'Argentique N&B', desc: 'Contraste d’antan' },
                      { id: 'warm', label: 'Lumière Dorée', desc: 'Patine douce' },
                      { id: 'none', label: 'Couleur Naturelle', desc: 'Sans retouche' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFilter(f.id as FilterType)}
                        className={`p-2 border text-left transition-all ${
                          filter === f.id
                            ? 'bg-white border-[#8C7355] shadow-xs ring-1 ring-[#8C7355]/40'
                            : 'bg-[#FAF8F5] border-[#E0D7C9] hover:bg-white text-[#6E665C]'
                        }`}
                      >
                        <span className="block text-xs font-medium text-[#1C1917]">
                          {f.label}
                        </span>
                        <span className="block text-[10px] text-[#8C7A65]">
                          {f.desc}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Optional Caption / Date */}
                <div>
                  <label className="block text-xs font-medium text-[#575047] mb-1">
                    Légende ou date de la prise de vue (facultatif)
                  </label>
                  <input
                    type="text"
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="Ex: Photo de mariage, 1938"
                    className="w-full h-9 px-3 bg-white border border-[#D8CFC2] text-xs text-[#1C1917] focus:outline-none focus:border-[#8C7355]"
                    maxLength={100}
                  />
                </div>

                {/* Live In-Situ Tree Node Preview */}
                <div className="bg-[#FAF8F5] border border-[#E2DAD0] p-4">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-[#8C7A65] font-medium block mb-3 flex items-center gap-1.5">
                    <Eye className="h-3.5 w-3.5" />
                    Aperçu en situation dans l'arbre
                  </span>

                  {/* Render exact tree card style */}
                  <div className="bg-white border border-[#E2DAD0] shadow-sm p-3.5 flex items-center gap-3.5 max-w-[280px] mx-auto transition-transform">
                    {/* The cropped avatar */}
                    <div className="h-12 w-12 rounded-full border border-[#DFD6C7] bg-[#F5F1E9] flex items-center justify-center overflow-hidden shrink-0 shadow-2xs">
                      {previewDataUrl ? (
                        <img
                          src={previewDataUrl}
                          alt="Preview"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="font-serif text-base text-[#7D6B57]">
                          {(person.first.charAt(0) + person.last.charAt(0)).toUpperCase()}
                        </span>
                      )}
                    </div>
                    {/* The typography */}
                    <div className="min-w-0 flex-1">
                      <p className="font-serif text-[17px] font-medium text-[#1C1917] leading-tight truncate">
                        {person.first}
                        {person.last && (
                          <span className="block text-[13px] font-normal text-[#4A443C]">
                            {person.last}
                          </span>
                        )}
                      </p>
                      {datesText && (
                        <p className="text-[11px] font-mono tabular-nums text-[#857C70] mt-0.5 truncate">
                          {datesText}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Footnote on size and performance */}
                  <div className="mt-3.5 pt-3 border-t border-[#EAE3D6] flex items-center justify-between text-[11px] text-[#7A7266]">
                    <span className="flex items-center gap-1.5">
                      <CloudCheck className="h-3.5 w-3.5 text-[#5B8266]" />
                      Optimisé pour Firestore
                    </span>
                    <span className="font-mono tabular-nums">
                      ~{estimatedSizeKb} Ko
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-white border-t border-[#E6DFD3] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs text-[#6E665C]">
            <Cloud className="h-4 w-4 text-[#8C7A65]" />
            <span>
              {currentUser
                ? `Connecté en tant que ${currentUser.displayName || currentUser.email}`
                : 'Mode local / Connexion Google recommandée pour le cloud'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 text-xs font-medium border border-[#D8CFC2] hover:bg-[#F5F2EB] text-[#1C1917] transition-colors"
            >
              Annuler
            </button>

            {imageSrc && (
              <button
                type="button"
                onClick={handleSaveAndSync}
                disabled={isSaving || !loadedImage}
                className="inline-flex items-center gap-2 px-5 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 shadow-xs"
                style={{ backgroundColor: accentColor }}
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Sauvegarde Firestore…</span>
                  </>
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    <span>Enregistrer le portrait</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Hidden native file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
    </div>
  );
};
