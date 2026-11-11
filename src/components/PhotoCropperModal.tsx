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
  Minimize2,
  Undo2
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

  // Transform states
  // zoom = 1.0 means the image fills the circular medallion (Cover)
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
  const [isDragOverDropZone, setIsDragOverDropZone] = useState<boolean>(false);

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

  // Compute Cover Scale: scale factor so at zoom=1.0, the photo completely fills the frame
  const getCoverScale = useCallback((img: HTMLImageElement, rot: number) => {
    const isSideways = rot % 180 !== 0;
    const effW = isSideways ? img.height : img.width;
    const effH = isSideways ? img.width : img.height;
    const minSide = Math.max(1, Math.min(effW, effH));
    return OUTPUT_DIM / minSide;
  }, []);

  // Compute Contain Scale: scale factor so the entire photo fits without cropping
  const getContainScale = useCallback((img: HTMLImageElement, rot: number) => {
    const isSideways = rot % 180 !== 0;
    const effW = isSideways ? img.height : img.width;
    const effH = isSideways ? img.width : img.height;
    const maxSide = Math.max(1, Math.max(effW, effH));
    return OUTPUT_DIM / maxSide;
  }, []);

  // Load Image element safely without setting crossOrigin on data URLs
  useEffect(() => {
    if (!imageSrc) {
      setLoadedImage(null);
      return;
    }
    const img = new Image();
    // Only set crossOrigin for remote http(s) URLs, never for data: or blob:
    if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      setLoadedImage(img);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setRotation(0);
      setErrorMessage(null);
    };
    img.onerror = () => {
      setErrorMessage("Impossible d'ouvrir cette image. Veuillez sélectionner un fichier JPG, PNG ou WebP valide.");
    };
    img.src = imageSrc;
  }, [imageSrc]);

  // Handle file selection from disk or phone
  const processSelectedFile = (file: File) => {
    setErrorMessage(null);

    // Accept standard images and HEIC from phones
    const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(file.name);
    if (!isImage) {
      setErrorMessage('Veuillez sélectionner un fichier image valide (JPG, PNG, WebP).');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImageSrc(reader.result);
      }
    };
    reader.onerror = () => {
      setErrorMessage('Erreur lors de la lecture du fichier photo.');
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processSelectedFile(file);
    e.target.value = '';
  };

  // Drag and drop onto modal drop zone
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverDropZone(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processSelectedFile(file);
    }
  };

  // Generate canvas rendering with exact scaling, rotation and framing
  const renderCropCanvas = useCallback(() => {
    if (!loadedImage || !canvasRef.current) return '';

    const canvas = canvasRef.current;
    canvas.width = OUTPUT_DIM;
    canvas.height = OUTPUT_DIM;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.clearRect(0, 0, OUTPUT_DIM, OUTPUT_DIM);

    // 1. Warm archival paper base (prevents black background in JPEG)
    ctx.fillStyle = '#FAF8F5';
    ctx.fillRect(0, 0, OUTPUT_DIM, OUTPUT_DIM);

    // 2. Exact scale calculation: cover scale * user zoom
    const center = OUTPUT_DIM / 2;
    const baseScale = getCoverScale(loadedImage, rotation);
    const effectiveScale = baseScale * zoom;

    ctx.save();
    ctx.translate(center + pan.x, center + pan.y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(effectiveScale, effectiveScale);

    // Draw the image centered around the origin
    ctx.drawImage(loadedImage, -loadedImage.width / 2, -loadedImage.height / 2);
    ctx.restore();

    // 3. Apply color filters if selected
    if (filter !== 'none') {
      try {
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
      } catch (err) {
        console.warn('Canvas filter error:', err);
      }
    }

    try {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
      setPreviewDataUrl(dataUrl);
      setEstimatedSizeKb(Math.round(dataUrl.length / 1024));
      return dataUrl;
    } catch {
      return '';
    }
  }, [loadedImage, filter, zoom, pan, rotation, getCoverScale]);

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
      x: Math.round(dragStart.panX + dx),
      y: Math.round(dragStart.panY + dy),
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

  // Touch drag + 2-finger pinch zoom
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
      const next = Math.min(3.5, Math.max(0.2, Number((pinchRef.current.startZoom * ratio).toFixed(2))));
      setZoom(next);
    } else if (e.touches.length === 1 && isDragging && dragStart) {
      const t = e.touches[0];
      setPan({
        x: Math.round(dragStart.panX + (t.clientX - dragStart.x)),
        y: Math.round(dragStart.panY + (t.clientY - dragStart.y)),
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
    const delta = e.deltaY > 0 ? -0.06 : 0.06;
    setZoom((z) => Math.min(3.5, Math.max(0.2, Number((z + delta).toFixed(2)))));
  };

  // 90° clockwise rotation
  const handleRotate90 = () => {
    setRotation((r) => (r + 90) % 360);
    setPan({ x: 0, y: 0 });
  };

  // Reset positioning & centering
  const handleRecenter = () => {
    setPan({ x: 0, y: 0 });
  };

  // Fit entire photo inside medallion (contain)
  const handleFitWholePhoto = () => {
    if (!loadedImage) return;
    const coverScale = getCoverScale(loadedImage, rotation);
    const containScale = getContainScale(loadedImage, rotation);
    const fitZoom = Number((containScale / coverScale).toFixed(2));
    setZoom(Math.max(0.2, fitZoom));
    setPan({ x: 0, y: 0 });
  };

  // Fill medallion completely (cover)
  const handleFillFrame = () => {
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
  };

  // Save handler with Cloud Firestore storage
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1C1917]/75 backdrop-blur-[3px] p-3 sm:p-6 overflow-y-auto">
      <div className="fixed inset-0" onClick={onClose} aria-label="Fermer" />

      <div className="relative z-10 w-full max-w-4xl bg-[#FAF8F5] text-[#1C1917] border border-[#E6DFD3] rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[94vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-7 py-4 bg-white border-b border-[#E6DFD3] shrink-0">
          <div className="flex items-center gap-3.5">
            <div
              className="h-10 w-10 rounded-full flex items-center justify-center text-white shrink-0 shadow-xs"
              style={{ backgroundColor: accentColor }}
            >
              <Camera className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#8C7A65] font-semibold">
                Photo & Portrait Familial
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
            title="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 sm:px-7">
          {errorMessage && (
            <div className="mb-5 p-3.5 bg-[#FDF2F0] border border-[#E6B8B0] text-xs text-[#8C2D19] flex items-center gap-2.5 rounded-lg shadow-2xs">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {!imageSrc ? (
            /* Upload / Drop Screen */
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOverDropZone(true);
              }}
              onDragLeave={() => setIsDragOverDropZone(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-10 sm:p-14 text-center flex flex-col items-center justify-center gap-4 transition-all cursor-pointer ${
                isDragOverDropZone
                  ? 'border-[#8C7355] bg-[#F2EDE4] scale-[0.99]'
                  : 'border-[#D8CFC2] bg-white hover:border-[#8C7355] hover:bg-[#FAF8F5]'
              }`}
            >
              <div className="h-20 w-20 rounded-full bg-[#FAF8F5] border border-[#E2DAD0] flex items-center justify-center text-[#8C7A65] shadow-xs">
                <Upload className="h-9 w-9 text-[#8C7355]" />
              </div>
              <div className="max-w-md space-y-1.5">
                <h3 className="font-serif text-2xl font-normal text-[#1C1917]">
                  Ajouter une photo de {person.first}
                </h3>
                <p className="text-sm text-[#6E665C]">
                  Cliquez ici pour choisir une photo sur votre téléphone ou votre ordinateur, ou glissez-déposez le fichier.
                </p>
                <p className="text-xs text-[#8C7A65]">
                  Formats acceptés : JPG, PNG, WebP (photos de famille, portraits d’époque, scans…)
                </p>
              </div>

              <button
                type="button"
                className="mt-3 inline-flex items-center gap-2 px-6 py-3 text-sm font-medium text-white rounded-xl shadow-xs transition-opacity hover:opacity-90"
                style={{ backgroundColor: accentColor }}
              >
                <Camera className="h-4 w-4" />
                <span>Sélectionner une photo</span>
              </button>
            </div>
          ) : (
            /* Interactive Cropping & Preview Workspace */
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: Interactive Canvas & Framing (7 cols) */}
              <div className="lg:col-span-7 flex flex-col gap-3.5">
                {/* Visual helper badge */}
                <div className="flex flex-wrap items-center justify-between gap-2 bg-[#F2EDE4]/70 px-3.5 py-2 rounded-lg border border-[#E2DAD0]">
                  <span className="text-xs font-medium text-[#4A453E] flex items-center gap-1.5">
                    <Move className="h-3.5 w-3.5 text-[#8C7355]" />
                    Glissez la photo pour centrer le visage dans le cercle
                  </span>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs font-medium text-[#8C7355] hover:text-[#1C1917] underline transition-colors"
                  >
                    Changer de photo
                  </button>
                </div>

                {/* Canvas Container with circular / oval framing overlay */}
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
                  className={`relative w-full aspect-square max-w-[340px] sm:max-w-[380px] mx-auto bg-[#F4F0E8] border-2 border-[#D5C7B4] rounded-2xl shadow-inner overflow-hidden select-none touch-none flex items-center justify-center ${
                    isDragging ? 'cursor-grabbing' : 'cursor-grab'
                  }`}
                  style={{
                    backgroundImage: 'radial-gradient(#D5C7B4 1.5px, transparent 1.5px)',
                    backgroundSize: '18px 18px',
                  }}
                >
                  {/* The actual rendering canvas */}
                  <canvas
                    ref={canvasRef}
                    className="w-full h-full object-contain pointer-events-none drop-shadow-sm"
                  />

                  {/* Framing Mask Overlay (Shades outer areas so user clearly sees the medallion crop) */}
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden">
                    {shape === 'circle' && (
                      <div className="w-[90%] h-[90%] rounded-full border-2 border-[#8C7355] shadow-[0_0_0_9999px_rgba(28,25,23,0.48)] transition-all" />
                    )}
                    {shape === 'oval' && (
                      <div className="w-[78%] h-[92%] rounded-[50%] border-2 border-[#8C7355] shadow-[0_0_0_9999px_rgba(28,25,23,0.48)] transition-all" />
                    )}
                    {shape === 'portrait' && (
                      <div className="w-[78%] h-[92%] rounded-2xl border-2 border-[#8C7355] shadow-[0_0_0_9999px_rgba(28,25,23,0.48)] transition-all" />
                    )}
                    {shape === 'square' && (
                      <div className="w-[88%] h-[88%] rounded-xl border-2 border-[#8C7355] shadow-[0_0_0_9999px_rgba(28,25,23,0.48)] transition-all" />
                    )}
                  </div>

                  {/* Live zoom badge indicator */}
                  <div className="absolute top-2.5 left-3 bg-[#1C1917]/75 backdrop-blur-xs text-white px-2.5 py-1 rounded-md text-[11px] font-mono tabular-nums pointer-events-none shadow-xs z-10">
                    Zoom : {Math.round(zoom * 100)}%
                  </div>
                </div>

                {/* Quick Presets & Zoom Toolset */}
                <div className="bg-white p-4 border border-[#E6DFD3] rounded-xl space-y-3.5 shadow-2xs">
                  {/* Quick Action Buttons */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <button
                      type="button"
                      onClick={handleFillFrame}
                      className="px-3 py-2 text-xs bg-[#FAF8F5] border border-[#D8CFC2] hover:border-[#8C7355] hover:bg-white text-[#1C1917] rounded-lg flex items-center justify-center gap-1.5 transition-all font-medium"
                      title="Ajuste pour remplir tout le médaillon"
                    >
                      <Maximize2 className="h-3.5 w-3.5 text-[#8C7355]" />
                      <span>Remplir</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleFitWholePhoto}
                      className="px-3 py-2 text-xs bg-[#FAF8F5] border border-[#D8CFC2] hover:border-[#8C7355] hover:bg-white text-[#1C1917] rounded-lg flex items-center justify-center gap-1.5 transition-all font-medium"
                      title="Affiche la photo entière sans rien couper"
                    >
                      <Minimize2 className="h-3.5 w-3.5 text-[#8C7355]" />
                      <span>Photo entière</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleRotate90}
                      className="px-3 py-2 text-xs bg-[#FAF8F5] border border-[#D8CFC2] hover:border-[#8C7355] hover:bg-white text-[#1C1917] rounded-lg flex items-center justify-center gap-1.5 transition-all font-medium"
                      title="Pivote de 90 degrés si la photo est penchée"
                    >
                      <RotateCw className="h-3.5 w-3.5 text-[#8C7355]" />
                      <span>Pivoter 90°</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleRecenter}
                      className="px-3 py-2 text-xs bg-[#FAF8F5] border border-[#D8CFC2] hover:border-[#8C7355] hover:bg-white text-[#1C1917] rounded-lg flex items-center justify-center gap-1.5 transition-all font-medium"
                      title="Replace la photo au milieu"
                    >
                      <Undo2 className="h-3.5 w-3.5 text-[#8C7355]" />
                      <span>Recentrer</span>
                    </button>
                  </div>

                  {/* Smooth Zoom Slider with (-) and (+) buttons */}
                  <div className="flex items-center gap-3 pt-1 border-t border-[#F2ECE1]">
                    <span className="text-xs text-[#6E665C] font-medium whitespace-nowrap">
                      Zoom :
                    </span>
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.max(0.2, Number((z - 0.1).toFixed(2))))}
                      className="h-8 w-8 flex items-center justify-center border border-[#D8CFC2] rounded-md bg-[#FAF8F5] hover:bg-white text-[#575047] shrink-0"
                      title="Dézoomer"
                    >
                      <ZoomOut className="h-4 w-4" />
                    </button>
                    <input
                      type="range"
                      min="0.2"
                      max="3.0"
                      step="0.02"
                      value={zoom}
                      onChange={(e) => setZoom(parseFloat(e.target.value))}
                      className="w-full accent-[#8C7355] cursor-pointer h-2"
                    />
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.min(3.5, Number((z + 0.1).toFixed(2))))}
                      className="h-8 w-8 flex items-center justify-center border border-[#D8CFC2] rounded-md bg-[#FAF8F5] hover:bg-white text-[#575047] shrink-0"
                      title="Zoomer"
                    >
                      <ZoomIn className="h-4 w-4" />
                    </button>
                    <span className="text-xs font-mono tabular-nums text-[#6E665C] w-12 text-right">
                      {Math.round(zoom * 100)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Right Column: Live In-Situ Tree Node Preview & Tone Filters (5 cols) */}
              <div className="lg:col-span-5 flex flex-col gap-4">
                {/* Live In-Situ Tree Card Preview */}
                <div className="bg-white border border-[#E2DAD0] rounded-xl p-4 sm:p-5 shadow-2xs">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-[#8C7A65] font-semibold block mb-3 flex items-center gap-1.5">
                    <Eye className="h-3.5 w-3.5" />
                    Aperçu en direct sur la carte de l’arbre
                  </span>

                  <div className="bg-[#FAF8F5] border border-[#E2DAD0] rounded-xl p-4 flex items-center gap-3.5 max-w-[280px] mx-auto shadow-xs">
                    <div className="h-14 w-14 aspect-square rounded-full border-2 border-[#DFD6C7] bg-[#F5F1E9] flex items-center justify-center overflow-hidden shrink-0 shadow-2xs">
                      {previewDataUrl ? (
                        <img
                          src={previewDataUrl}
                          alt="Aperçu"
                          className="h-full w-full aspect-square rounded-full object-cover"
                        />
                      ) : (
                        <span className="font-serif text-lg text-[#7D6B57]">
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

                  <div className="mt-3.5 pt-2.5 border-t border-[#EAE3D6] flex items-center justify-between text-[11px] text-[#7A7266]">
                    <span className="flex items-center gap-1.5 text-[#4D7A58] font-medium">
                      <CloudCheck className="h-3.5 w-3.5" />
                      Partagé avec toute la famille
                    </span>
                    <span className="font-mono tabular-nums">~{estimatedSizeKb} Ko</span>
                  </div>
                </div>

                {/* Tone / Vintage Filters */}
                <div>
                  <label className="block text-xs font-semibold text-[#575047] mb-2 flex items-center gap-1.5">
                    <Sliders className="h-3.5 w-3.5 text-[#8C7A65]" />
                    Teinte & Style du portrait
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'none', label: 'Couleur Naturelle', desc: 'Photo originale' },
                      { id: 'sepia', label: 'Sépia d’Époque', desc: 'Chaleur vintage' },
                      { id: 'bw', label: 'Noir & Blanc', desc: 'Argentique doux' },
                      { id: 'warm', label: 'Lumière Dorée', desc: 'Patine chaleureuse' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFilter(f.id as FilterType)}
                        className={`p-2.5 border rounded-xl text-left transition-all ${
                          filter === f.id
                            ? 'bg-white border-[#8C7355] shadow-xs ring-1.5 ring-[#8C7355]/40 font-medium'
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

                {/* Forme du cadre (optional aesthetic fine-tuning) */}
                <div>
                  <label className="block text-xs font-semibold text-[#575047] mb-2">
                    Forme du cadre de coupe
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
                        className={`p-2 border rounded-lg text-center text-xs transition-all ${
                          shape === item.id
                            ? 'bg-white border-[#8C7355] shadow-2xs font-medium text-[#1C1917]'
                            : 'bg-[#FAF8F5] border-[#E0D7C9] hover:bg-white text-[#6E665C]'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 sm:px-7 py-4 bg-white border-t border-[#E6DFD3] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <span className="text-xs text-[#6E665C] flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-[#8C7355]" />
            Le portrait sera automatiquement visible sur l’arbre généalogique.
          </span>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2.5 text-xs font-medium border border-[#D8CFC2] rounded-xl hover:bg-[#F5F2EB] text-[#1C1917] transition-colors"
            >
              Annuler
            </button>

            {imageSrc && (
              <button
                type="button"
                onClick={handleSaveAndSync}
                disabled={isSaving || !loadedImage}
                className="inline-flex items-center gap-2 px-6 py-2.5 text-xs font-medium text-white rounded-xl transition-all shadow-md hover:shadow-lg disabled:opacity-50"
                style={{ backgroundColor: accentColor }}
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Enregistrement en cours…</span>
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    <span>Valider et enregistrer le portrait</span>
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
          accept="image/*,.heic,.heif"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
    </div>
  );
};
