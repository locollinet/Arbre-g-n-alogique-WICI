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
  CloudCheck,
  AlertCircle,
  Eye,
  RefreshCw,
  Move,
  Camera,
  Maximize2,
  Minimize2
} from 'lucide-react';
import { Person, getFullName, getLifeDates } from '../data/wiciFamily';

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
  initialFilter?: 'none' | 'sepia' | 'bw' | 'warm';
  initialShape?: 'circle' | 'oval' | 'portrait' | 'square';
  accentColor: string;
  onClose: () => void;
  onSave: (result: CropResult) => Promise<void> | void;
}

type ShapeType = 'circle' | 'oval' | 'portrait' | 'square';
type FilterType = 'none' | 'sepia' | 'bw' | 'warm';

const OUTPUT_DIM = 380;

export const PhotoCropperModal: React.FC<PhotoCropperModalProps> = ({
  isOpen,
  person,
  initialImageSrc,
  initialFilter = 'none',
  initialShape = 'circle',
  accentColor,
  onClose,
  onSave,
}) => {
  const [imageSrc, setImageSrc] = useState<string | null>(initialImageSrc || null);
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);

  // Transform states: zoom = 1 means the entire image fits comfortably inside the frame
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [rotation, setRotation] = useState<number>(0);

  // Style states
  const [shape, setShape] = useState<ShapeType>(initialShape);
  const [filter, setFilter] = useState<FilterType>(initialFilter);
  const [caption, setCaption] = useState<string>('');

  // Status states
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string>('');
  const [estimatedSizeKb, setEstimatedSizeKb] = useState<number>(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pinchRef = useRef<{ dist: number; startZoom: number } | null>(null);

  // Initialize or reset when opened
  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      setShape(initialShape || 'circle');
      setFilter(initialFilter || 'none');
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
  }, [isOpen, initialImageSrc, initialFilter, initialShape, person]);

  // Compute normalized baseScale so that at zoom = 1 (100%), even a 4000px photo fits entirely inside the 380px frame
  const getBaseScale = useCallback((img: HTMLImageElement) => {
    const maxDim = Math.max(img.width, img.height, 1);
    // If it's already a 380x380 cropped image, keep 1:1 at zoom=1
    if (img.width === OUTPUT_DIM && img.height === OUTPUT_DIM) {
      return 1;
    }
    return (OUTPUT_DIM * 0.92) / maxDim;
  }, []);

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
      // Start at zoom = 1.0 (entire photo visible, never over-zoomed!)
      setZoom(1);
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
    canvas.width = OUTPUT_DIM;
    canvas.height = OUTPUT_DIM;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.clearRect(0, 0, OUTPUT_DIM, OUTPUT_DIM);
    ctx.save();

    // 1. Clip path based on chosen shape
    const center = OUTPUT_DIM / 2;
    ctx.beginPath();
    if (shape === 'circle') {
      ctx.arc(center, center, OUTPUT_DIM * 0.46, 0, Math.PI * 2);
    } else if (shape === 'oval') {
      ctx.ellipse(center, center, OUTPUT_DIM * 0.38, OUTPUT_DIM * 0.46, 0, 0, Math.PI * 2);
    } else if (shape === 'portrait') {
      const w = OUTPUT_DIM * 0.74;
      const h = OUTPUT_DIM * 0.92;
      const x = (OUTPUT_DIM - w) / 2;
      const y = (OUTPUT_DIM - h) / 2;
      ctx.roundRect(x, y, w, h, 24);
    } else {
      const s = OUTPUT_DIM * 0.88;
      const x = (OUTPUT_DIM - s) / 2;
      ctx.roundRect(x, x, s, s, 20);
    }
    ctx.closePath();
    ctx.clip();

    // 2. Background base fill
    ctx.fillStyle = '#F5F2EB';
    ctx.fillRect(0, 0, OUTPUT_DIM, OUTPUT_DIM);

    // 3. Transformations: Center -> Pan -> Rotate -> Normalized Scale * User Zoom
    const baseScale = getBaseScale(loadedImage);
    const effectiveScale = baseScale * zoom;

    ctx.translate(center + pan.x, center + pan.y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(effectiveScale, effectiveScale);

    // Draw the image centered
    const imgX = -loadedImage.width / 2;
    const imgY = -loadedImage.height / 2;
    ctx.drawImage(loadedImage, imgX, imgY);

    ctx.restore();

    // 4. Apply Filters
    if (filter !== 'none') {
      const imgData = ctx.getImageData(0, 0, OUTPUT_DIM, OUTPUT_DIM);
      const d = imgData.data;

      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        const a = d[i + 3];
        if (a === 0) continue;

        if (filter === 'sepia') {
          const tr = 0.393 * r + 0.769 * g + 0.189 * b;
          const tg = 0.349 * r + 0.686 * g + 0.168 * b;
          const tb = 0.272 * r + 0.534 * g + 0.131 * b;
          d[i] = Math.min(255, tr * 1.05);
          d[i + 1] = Math.min(255, tg * 0.98);
          d[i + 2] = Math.min(255, tb * 0.88);
        } else if (filter === 'bw') {
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          const contrast = (gray - 128) * 1.15 + 128;
          const clamped = Math.max(0, Math.min(255, contrast));
          d[i] = clamped;
          d[i + 1] = clamped;
          d[i + 2] = clamped;
        } else if (filter === 'warm') {
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
    ctx.strokeStyle = '#B89F7C';
    if (shape === 'circle') {
      ctx.beginPath();
      ctx.arc(center, center, OUTPUT_DIM * 0.46, 0, Math.PI * 2);
      ctx.stroke();
    } else if (shape === 'oval') {
      ctx.beginPath();
      ctx.ellipse(center, center, OUTPUT_DIM * 0.38, OUTPUT_DIM * 0.46, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (shape === 'portrait') {
      const w = OUTPUT_DIM * 0.74;
      const h = OUTPUT_DIM * 0.92;
      const x = (OUTPUT_DIM - w) / 2;
      const y = (OUTPUT_DIM - h) / 2;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 24);
      ctx.stroke();
    } else {
      const s = OUTPUT_DIM * 0.88;
      const x = (OUTPUT_DIM - s) / 2;
      ctx.beginPath();
      ctx.roundRect(x, x, s, s, 20);
      ctx.stroke();
    }
    ctx.restore();

    const dataUrl = canvas.toDataURL('image/jpeg', 0.84);
    setPreviewDataUrl(dataUrl);
    setEstimatedSizeKb(Math.round(dataUrl.length / 1024));
    return dataUrl;
  }, [loadedImage, shape, filter, zoom, pan, rotation, getBaseScale]);

  useEffect(() => {
    if (loadedImage) {
      renderCropCanvas();
    }
  }, [loadedImage, shape, filter, zoom, pan, rotation, renderCropCanvas]);

  // Drag interaction for positioning the image
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!loadedImage || e.pointerType === 'touch') return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setIsDragging(true);
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStart || e.pointerType === 'touch') return;
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
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      setIsDragging(false);
      setDragStart(null);
    }
  };

  // Touch drag + 2-finger pinch zoom inside cropper
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!loadedImage) return;
    if (e.touches.length === 1) {
      const t = e.touches[0];
      setIsDragging(true);
      setDragStart({
        x: t.clientX,
        y: t.clientY,
        panX: pan.x,
        panY: pan.y,
      });
      pinchRef.current = null;
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY
      );
      pinchRef.current = { dist, startZoom: zoom };
      setIsDragging(false);
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!loadedImage) return;
    if (e.touches.length === 2 && pinchRef.current) {
      const dist = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY
      );
      const ratio = dist / Math.max(1, pinchRef.current.dist);
      const next = Math.min(5, Math.max(0.15, Number((pinchRef.current.startZoom * ratio).toFixed(2))));
      setZoom(next);
    } else if (e.touches.length === 1 && isDragging && dragStart) {
      const t = e.touches[0];
      setPan({
        x: dragStart.panX + (t.clientX - dragStart.x),
        y: dragStart.panY + (t.clientY - dragStart.y),
      });
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    setDragStart(null);
    pinchRef.current = null;
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!loadedImage) return;
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    setZoom((z) => Math.min(5, Math.max(0.15, Number((z * factor).toFixed(2)))));
  };

  const handleRotate90 = () => {
    setRotation((r) => (r + 90) % 360);
  };

  // Fit entire photo inside the medallion (dezoom complete)
  const handleFitWholePhoto = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
  };

  // Fill the medallion without margins
  const handleFillFrame = () => {
    if (!loadedImage) return;
    const maxDim = Math.max(loadedImage.width, loadedImage.height, 1);
    const minDim = Math.min(loadedImage.width, loadedImage.height, 1);
    const fillZoom = Number(((maxDim / minDim) * 1.04).toFixed(2));
    setZoom(Math.min(5, Math.max(0.15, fillZoom)));
    setPan({ x: 0, y: 0 });
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
      setErrorMessage(msg || "Erreur lors de l'enregistrement de la photo.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  const datesText = getLifeDates(person);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1C1917]/70 backdrop-blur-xs p-3 sm:p-6 overflow-y-auto">
      <div className="fixed inset-0" onClick={onClose} aria-label="Fermer" />

      <div className="relative z-10 w-full max-w-4xl bg-[#FAF8F5] text-[#1C1917] border border-[#E6DFD3] rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 bg-white border-b border-[#E6DFD3] shrink-0">
          <div className="flex items-center gap-3">
            <div
              className="h-9 w-9 rounded-full flex items-center justify-center text-white shrink-0"
              style={{ backgroundColor: accentColor }}
            >
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#8C7A65] font-medium">
                Atelier Photo Familial
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

        {/* Content body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-7">
          {errorMessage && (
            <div className="mb-5 p-3.5 bg-[#FDF2F0] border border-[#E6B8B0] text-xs text-[#8C2D19] flex items-center gap-2 rounded-lg">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {!imageSrc ? (
            <div
              className="border-2 border-dashed border-[#D8CFC2] bg-white rounded-xl p-10 text-center flex flex-col items-center justify-center gap-4 hover:border-[#8C7355] transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="h-16 w-16 rounded-full bg-[#FAF8F5] border border-[#E2DAD0] flex items-center justify-center text-[#8C7A65]">
                <Camera className="h-8 w-8" />
              </div>
              <div className="max-w-md">
                <h3 className="font-serif text-xl font-normal text-[#1C1917]">
                  Choisir une photo pour {person.first}
                </h3>
                <p className="text-xs text-[#7A7266] mt-1.5">
                  Sélectionnez une photo depuis votre téléphone ou votre ordinateur (JPG, PNG, WebP).
                </p>
                <p className="text-[11px] text-[#9A9184] mt-1">
                  Elle sera automatiquement adaptée et partagée sur l’arbre familial.
                </p>
              </div>

              <button
                type="button"
                className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium text-white rounded-lg transition-opacity hover:opacity-90"
                style={{ backgroundColor: accentColor }}
              >
                <Upload className="h-4 w-4" />
                <span>Sélectionner une photo</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Interactive Canvas & Framing (7 cols) */}
              <div className="lg:col-span-7 flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[#575047] flex items-center gap-1.5">
                    <Move className="h-3.5 w-3.5 text-[#8C7A65]" />
                    Glissez l’image et dézoomez librement (jusqu’à 15 %)
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleFitWholePhoto}
                      className="px-2.5 py-1 text-xs bg-white border border-[#D8CFC2] hover:border-[#8C7355] text-[#1C1917] rounded-md flex items-center gap-1 transition-colors"
                      title="Dézoomer pour voir toute la photo en entier"
                    >
                      <Minimize2 className="h-3 w-3 text-[#8C7A65]" />
                      <span>Photo entière</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleFillFrame}
                      className="px-2.5 py-1 text-xs bg-white border border-[#D8CFC2] hover:border-[#8C7355] text-[#1C1917] rounded-md flex items-center gap-1 transition-colors"
                      title="Ajuster pour remplir le médaillon"
                    >
                      <Maximize2 className="h-3 w-3 text-[#8C7A65]" />
                      <span>Remplir</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs text-[#8C7A65] hover:text-[#1C1917] underline transition-colors ml-1"
                    >
                      Changer de photo
                    </button>
                  </div>
                </div>

                {/* Canvas Container */}
                <div
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  onTouchCancel={handleTouchEnd}
                  onWheel={handleWheel}
                  className={`relative w-full aspect-square max-w-[340px] sm:max-w-[380px] mx-auto bg-[#F2EDE4] border border-[#D5C7B4] rounded-xl shadow-inner overflow-hidden select-none touch-none flex items-center justify-center ${
                    isDragging ? 'cursor-grabbing' : 'cursor-grab'
                  }`}
                  style={{
                    backgroundImage: 'radial-gradient(#D5C7B4 1.5px, transparent 1.5px)',
                    backgroundSize: '20px 20px',
                  }}
                >
                  <canvas
                    ref={canvasRef}
                    className="w-full h-full object-contain pointer-events-none drop-shadow-md"
                  />

                  <div className="absolute inset-0 pointer-events-none border border-[#B89F7C]/20" />
                  <div className="absolute top-2.5 left-3 bg-white/85 backdrop-blur-xs px-2 py-0.5 rounded text-[11px] font-mono text-[#575047] pointer-events-none">
                    Zoom : {Math.round(zoom * 100)}%
                  </div>
                </div>

                {/* Transform Sliders: Wide Zoom (15% to 500%) & Tilt */}
                <div className="space-y-3 bg-white p-4 border border-[#E6DFD3] rounded-xl">
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.max(0.15, Number((z - 0.1).toFixed(2))))}
                      className="p-1.5 border border-[#E0D7C9] rounded hover:bg-[#FAF8F5] text-[#575047]"
                      title="Dézoomer"
                    >
                      <ZoomOut className="h-4 w-4" />
                    </button>
                    <input
                      type="range"
                      min="0.15"
                      max="4"
                      step="0.02"
                      value={zoom}
                      onChange={(e) => setZoom(parseFloat(e.target.value))}
                      className="w-full accent-[#8C7355] cursor-pointer"
                    />
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.min(5, Number((z + 0.1).toFixed(2))))}
                      className="p-1.5 border border-[#E0D7C9] rounded hover:bg-[#FAF8F5] text-[#575047]"
                      title="Zoomer"
                    >
                      <ZoomIn className="h-4 w-4" />
                    </button>
                    <span className="text-xs font-mono tabular-nums text-[#6E665C] w-12 text-right">
                      {Math.round(zoom * 100)}%
                    </span>
                  </div>

                  {/* Tilt Slider + 90° Rotate */}
                  <div className="flex items-center gap-3 pt-2 border-t border-[#F0EAE1]">
                    <span className="text-[11px] text-[#6E665C] whitespace-nowrap">
                      Rotation :
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
                      className="p-1.5 border border-[#D8CFC2] hover:bg-[#F5F2EB] rounded text-[#1C1917] transition-colors"
                      title="Pivoter de 90°"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column: Filters, Shape & Live In-Situ Preview (5 cols) */}
              <div className="lg:col-span-5 flex flex-col gap-4">
                {/* Framing Shape Selector */}
                <div>
                  <label className="block text-xs font-medium text-[#575047] mb-1.5">
                    Forme du cadre
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'circle', label: 'Médaillon Rond' },
                      { id: 'oval', label: 'Camée Ovale' },
                      { id: 'portrait', label: 'Format Portrait' },
                      { id: 'square', label: 'Carré Doux' },
                    ].map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setShape(item.id as ShapeType)}
                        className={`p-2.5 border rounded-lg text-center transition-all ${
                          shape === item.id
                            ? 'bg-white border-[#8C7355] shadow-xs font-medium text-[#1C1917]'
                            : 'bg-[#FAF8F5] border-[#E0D7C9] hover:bg-white text-[#6E665C]'
                        }`}
                      >
                        <span className="block text-xs">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Vintage Photographic Tone Filters */}
                <div>
                  <label className="block text-xs font-medium text-[#575047] mb-1.5 flex items-center gap-1.5">
                    <Sliders className="h-3.5 w-3.5 text-[#8C7A65]" />
                    Couleur & Filtre
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'none', label: 'Couleur Naturelle', desc: 'Photo originale' },
                      { id: 'sepia', label: 'Sépia d’Archives', desc: 'Chaleur ancienne' },
                      { id: 'bw', label: 'Noir & Blanc', desc: 'Argentique doux' },
                      { id: 'warm', label: 'Lumière Dorée', desc: 'Patine chaude' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFilter(f.id as FilterType)}
                        className={`p-2.5 border rounded-lg text-left transition-all ${
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

                {/* Live In-Situ Tree Node Preview */}
                <div className="bg-white border border-[#E2DAD0] rounded-xl p-4">
                  <span className="text-[11px] uppercase tracking-[0.16em] text-[#8C7A65] font-medium block mb-3 flex items-center gap-1.5">
                    <Eye className="h-3.5 w-3.5" />
                    Aperçu sur sa carte dans l’arbre
                  </span>

                  <div className="bg-[#FAF8F5] border border-[#E2DAD0] rounded-lg shadow-xs p-3.5 flex items-center gap-3.5 max-w-[260px] mx-auto">
                    <div className="h-12 w-12 rounded-full border border-[#DFD6C7] bg-[#F5F1E9] flex items-center justify-center overflow-hidden shrink-0">
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

                  <div className="mt-3 pt-2.5 border-t border-[#EAE3D6] flex items-center justify-between text-[11px] text-[#7A7266]">
                    <span className="flex items-center gap-1.5">
                      <CloudCheck className="h-3.5 w-3.5 text-[#5B8266]" />
                      Synchronisation Firebase directe
                    </span>
                    <span className="font-mono tabular-nums">~{estimatedSizeKb} Ko</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 sm:px-6 py-4 bg-white border-t border-[#E6DFD3] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <span className="text-xs text-[#6E665C] flex items-center gap-1.5">
            <CloudCheck className="h-4 w-4 text-[#4D7A58]" />
            Partagé automatiquement avec toute la famille
          </span>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 text-xs font-medium border border-[#D8CFC2] rounded-lg hover:bg-[#F5F2EB] text-[#1C1917] transition-colors"
            >
              Annuler
            </button>

            {imageSrc && (
              <button
                type="button"
                onClick={handleSaveAndSync}
                disabled={isSaving || !loadedImage}
                className="inline-flex items-center gap-2 px-5 py-2 text-xs font-medium text-white rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50 shadow-xs"
                style={{ backgroundColor: accentColor }}
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Enregistrement…</span>
                  </>
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    <span>Enregistrer la photo</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

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
