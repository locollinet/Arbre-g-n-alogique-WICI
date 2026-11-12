import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { ExportControls } from './ExportControls';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Search,
  Plus,
  Minus,
  ArrowDownUp,
  ArrowLeftRight,
  SlidersHorizontal,
  Scan,
  Layers,
  Camera,
  Sparkles,
  Share2
} from 'lucide-react';
import {
  Person,
  TreeSettings,
  BRANCH_DEFINITIONS,
  GENERATION_LABELS,
  getFullName,
  getInitials,
  isPersonIncomplete
} from '../data/wiciFamily';
import {
  computeTreeLayout,
  buildEdgeSvgPath,
  getAncestorsSet,
  getDescendantsSet,
  getBranchPalette,
  PositionedNode
} from '../utils/treeLayout';

interface TreeCanvasViewProps {
  people: Person[];
  settings: TreeSettings;
  onUpdateSettings: (partial: Partial<TreeSettings>) => void;
  onSelectPerson: (id: string) => void;
  onAddChildFor: (parentId: string) => void;
  onOpenSettingsTab: () => void;
  onOpenPhotoCropper?: (personId: string) => void;
  onOpenPoster?: () => void;
  onOpenShare?: () => void;
  focusBranch: string;
  onChangeFocusBranch: (branchId: string) => void;
  accentColor: string;
}

export const TreeCanvasView: React.FC<TreeCanvasViewProps> = ({
  people,
  settings,
  onUpdateSettings,
  onSelectPerson,
  onAddChildFor,
  onOpenSettingsTab,
  onOpenPhotoCropper,
  onOpenPoster,
  onOpenShare,
  focusBranch,
  onChangeFocusBranch,
  accentColor,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<number>(0.72);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 32, y: 20 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const hasMovedRef = useRef(false);

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [hoveredPersonId, setHoveredPersonId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const layout = useMemo(
    () => computeTreeLayout(people, focusBranch, collapsedIds, settings),
    [people, focusBranch, collapsedIds, settings]
  );

  // Highlighted lineage set when hovering a person (ancestors + descendants path)
  const highlightedIds = useMemo(() => {
    if (!hoveredPersonId) return null;
    const anc = getAncestorsSet(people, hoveredPersonId);
    const desc = getDescendantsSet(people, hoveredPersonId);
    return new Set<string>([...anc, ...desc]);
  }, [people, hoveredPersonId]);

  /**
   * Fits the tree in the viewport.
   * - mode = 'all': fits 100% of the tree inside the visible canvas so you see the whole family at once.
   * - mode = 'smart': intelligent opening compromise — fits the whole tree if the scale stays >= 0.48
   *   (desktop), or centers on Victoria & the 5 branches at a comfortable readable scale (~0.56) on smaller screens.
   */
  const fitTreeInViewport = useCallback(
    (mode: 'all' | 'smart' = 'all') => {
      const el = containerRef.current;
      if (!el) return;
      const vw = el.clientWidth;
      const vh = el.clientHeight;
      if (vw === 0 || vh === 0) return;

      const pad = vw < 640 ? 24 : 48;
      const scaleX = (vw - pad) / Math.max(1, layout.width);
      const scaleY = (vh - pad - 44) / Math.max(1, layout.height);
      const fullFitZoom = Math.max(0.12, Math.min(1.15, Math.min(scaleX, scaleY)));

      const minComfortZoom = vw < 640 ? 0.52 : 0.46;
      const targetZoom =
        mode === 'smart' && focusBranch === 'all'
          ? Math.max(minComfortZoom, fullFitZoom)
          : fullFitZoom;

      const rootNode =
        layout.nodes.find((n) => n.id === (focusBranch === 'all' ? 'victoria' : focusBranch)) ||
        layout.nodes[0];

      if (mode === 'smart' && rootNode && layout.width * targetZoom > vw) {
        if (settings.orientation === 'vertical') {
          const rootCenterX = (rootNode.x + rootNode.width / 2) * targetZoom;
          setPan({
            x: vw / 2 - rootCenterX,
            y: 22,
          });
        } else {
          const rootCenterY = (rootNode.y + rootNode.height / 2) * targetZoom;
          setPan({
            x: 24,
            y: vh / 2 - rootCenterY,
          });
        }
      } else {
        setPan({
          x: Math.max(16, (vw - layout.width * targetZoom) / 2),
          y: Math.max(18, (vh - 36 - layout.height * targetZoom) / 2),
        });
      }
      setZoom(Number(targetZoom.toFixed(3)));
    },
    [layout, focusBranch, settings.orientation]
  );

  const zoomAtPoint = useCallback(
    (targetZoom: number, focalX?: number, focalY?: number) => {
      const el = containerRef.current;
      if (!el) return;
      const next = Math.max(0.12, Math.min(1.8, targetZoom));
      const cx = focalX ?? el.clientWidth / 2;
      const cy = focalY ?? el.clientHeight / 2;
      const worldX = (cx - pan.x) / zoom;
      const worldY = (cy - pan.y) / zoom;
      setPan({
        x: cx - worldX * next,
        y: cy - worldY * next,
      });
      setZoom(Number(next.toFixed(3)));
    },
    [pan, zoom]
  );

  // Center on a specific person node
  const centerOnPerson = useCallback(
    (id: string) => {
      const el = containerRef.current;
      if (!el) return;
      const node = layout.nodes.find((n) => n.id === id);
      const partner = layout.partners.find((p) => p.person.id === id);
      const target = node || partner;
      if (!target) return;

      const targetZoom = Math.max(zoom, 0.85);
      const cx = (target.x + target.width / 2) * targetZoom;
      const cy = (target.y + target.height / 2) * targetZoom;

      setZoom(targetZoom);
      setPan({
        x: el.clientWidth / 2 - cx,
        y: el.clientHeight / 2 - cy,
      });
    },
    [layout, zoom]
  );

  // Recenter with smart compromise on initial load or when branch/orientation changes
  useEffect(() => {
    const timer = requestAnimationFrame(() => {
      fitTreeInViewport(focusBranch === 'all' ? 'smart' : 'all');
    });
    return () => cancelAnimationFrame(timer);
  }, [focusBranch, settings.orientation, settings.cardStyle, isFullscreen, collapsedIds.size]);

  // Mouse Pointer pan handlers (strictly ignore touch so TouchEvents handle mobile without conflict)
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    if ((e.target as HTMLElement).closest('[data-interactive="true"]')) return;
    setIsDragging(true);
    hasMovedRef.current = false;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    if (!isDragging || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) {
      hasMovedRef.current = true;
    }
    setPan({
      x: dragStartRef.current.panX + dx,
      y: dragStartRef.current.panY + dy,
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    setIsDragging(false);
    dragStartRef.current = null;
  };

  // Dedicated Mobile Touch pan & pinch-zoom handlers (conflict-free)
  const touchStateRef = useRef<{
    mode: 'pan' | 'pinch';
    startX: number;
    startY: number;
    panX: number;
    panY: number;
    initialDistance: number;
    initialZoom: number;
    midX: number;
    midY: number;
  } | null>(null);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;

    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.max(10, Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY));
      const rect = el.getBoundingClientRect();
      const midX = (t1.clientX + t2.clientX) / 2 - rect.left;
      const midY = (t1.clientY + t2.clientY) / 2 - rect.top;

      touchStateRef.current = {
        mode: 'pinch',
        startX: midX,
        startY: midY,
        panX: pan.x,
        panY: pan.y,
        initialDistance: dist,
        initialZoom: zoom,
        midX,
        midY,
      };
      hasMovedRef.current = true;
      return;
    }

    if (e.touches.length === 1) {
      if ((e.target as HTMLElement).closest('[data-interactive="true"]')) {
        hasMovedRef.current = false;
      }
      const t = e.touches[0];
      touchStateRef.current = {
        mode: 'pan',
        startX: t.clientX,
        startY: t.clientY,
        panX: pan.x,
        panY: pan.y,
        initialDistance: 0,
        initialZoom: zoom,
        midX: 0,
        midY: 0,
      };
      hasMovedRef.current = false;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el || !touchStateRef.current) return;

    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.max(10, Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY));
      const rect = el.getBoundingClientRect();
      const currentMidX = (t1.clientX + t2.clientX) / 2 - rect.left;
      const currentMidY = (t1.clientY + t2.clientY) / 2 - rect.top;

      // If transitioning from 1 finger to 2 fingers mid-gesture, initialize pinch state
      if (touchStateRef.current.mode !== 'pinch') {
        touchStateRef.current = {
          mode: 'pinch',
          startX: currentMidX,
          startY: currentMidY,
          panX: pan.x,
          panY: pan.y,
          initialDistance: dist,
          initialZoom: zoom,
          midX: currentMidX,
          midY: currentMidY,
        };
        return;
      }

      const ratio = dist / touchStateRef.current.initialDistance;
      const nextZoom = Math.max(0.12, Math.min(1.8, touchStateRef.current.initialZoom * ratio));

      const worldX =
        (touchStateRef.current.midX - touchStateRef.current.panX) /
        touchStateRef.current.initialZoom;
      const worldY =
        (touchStateRef.current.midY - touchStateRef.current.panY) /
        touchStateRef.current.initialZoom;

      setZoom(Number(nextZoom.toFixed(3)));
      setPan({
        x: currentMidX - worldX * nextZoom,
        y: currentMidY - worldY * nextZoom,
      });
      hasMovedRef.current = true;
    } else if (e.touches.length === 1 && touchStateRef.current.mode === 'pan') {
      const t = e.touches[0];
      const dx = t.clientX - touchStateRef.current.startX;
      const dy = t.clientY - touchStateRef.current.startY;
      if (Math.abs(dx) + Math.abs(dy) > 6) {
        hasMovedRef.current = true;
      }
      setPan({
        x: touchStateRef.current.panX + dx,
        y: touchStateRef.current.panY + dy,
      });
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 1) {
      // Smooth transition from 2-finger pinch back to 1-finger pan without jumping
      const t = e.touches[0];
      touchStateRef.current = {
        mode: 'pan',
        startX: t.clientX,
        startY: t.clientY,
        panX: pan.x,
        panY: pan.y,
        initialDistance: 0,
        initialZoom: zoom,
        midX: 0,
        midY: 0,
      };
    } else if (e.touches.length === 0) {
      touchStateRef.current = null;
    }
  };

  // Smooth, immediate wheel zoom centered on cursor (works with mouse wheel & Mac trackpad)
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;

    // If clear horizontal two-finger swipe without ctrlKey, allow horizontal panning
    if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.3) {
      setPan((prev) => ({
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY,
      }));
      return;
    }

    const rect = el.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;

    // Smooth proportional zoom factor
    const sensitivity = e.ctrlKey || e.metaKey ? 0.008 : 0.0022;
    const factor = Math.exp(-e.deltaY * sensitivity);
    const nextZoom = Math.max(0.12, Math.min(1.8, zoom * factor));

    const worldX = (cursorX - pan.x) / zoom;
    const worldY = (cursorY - pan.y) / zoom;

    setZoom(Number(nextZoom.toFixed(3)));
    setPan({
      x: cursorX - worldX * nextZoom,
      y: cursorY - worldY * nextZoom,
    });
  };

  // Double-click on canvas to zoom in smoothly on that spot
  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-interactive="true"]')) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    zoomAtPoint(zoom < 0.85 ? 0.95 : zoom * 1.35, cx, cy);
  };

  const toggleCollapseNode = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setCollapsedIds(new Set());

  const collapseToBranches = () => {
    const toCollapse = new Set<string>();
    for (const p of people) {
      // Collapse grandchildren so only Gen I, II, III are shown
      const hasKids = people.some((c) => (c.parents || []).includes(p.id));
      if (hasKids && p.id !== 'victoria' && !['lydia', 'flore', 'peter', 'therese', 'regine'].includes(p.id)) {
        toCollapse.add(p.id);
      }
    }
    setCollapsedIds(toCollapse);
  };

  // Search filtering
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return people
      .filter((p) => getFullName(p).toLowerCase().includes(q) || (p.birth || '').includes(q))
      .slice(0, 8);
  }, [people, searchQuery]);

  const handleSelectSearchResult = (person: Person) => {
    setSearchQuery('');
    setIsSearchOpen(false);
    if (focusBranch !== 'all') {
      onChangeFocusBranch('all');
    }
    setCollapsedIds(new Set());
    setTimeout(() => {
      centerOnPerson(person.id);
      onSelectPerson(person.id);
    }, 60);
  };

  // Minimap click navigation
  const handleMinimapClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = Math.min(rect.width / layout.width, rect.height / layout.height);
    const offsetX = (rect.width - layout.width * scale) / 2;
    const offsetY = (rect.height - layout.height * scale) / 2;

    const worldX = (e.clientX - rect.left - offsetX) / scale;
    const worldY = (e.clientY - rect.top - offsetY) / scale;

    setPan({
      x: el.clientWidth / 2 - worldX * zoom,
      y: el.clientHeight / 2 - worldY * zoom,
    });
  };

  const renderPersonCard = (node: PositionedNode) => {
    const { person, width, height, childCount, descendantCount, isCollapsed, branchId } = node;
    const isDimmed = highlightedIds ? !highlightedIds.has(person.id) : false;
    const isHighlighted = highlightedIds ? highlightedIds.has(person.id) : false;
    const isFounder = person.id === 'victoria';
    const incomplete = isPersonIncomplete(person);
    const branchPalette = getBranchPalette(branchId);
    const datesText =
      [person.birth, person.death].filter(Boolean).join(' – ') ||
      (incomplete ? 'À compléter' : '');

    return (
      <div
        key={person.id}
        data-interactive="true"
        role="button"
        tabIndex={0}
        aria-label={`Voir la fiche de ${getFullName(person)}`}
        onPointerDown={() => {
          hasMovedRef.current = false;
        }}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onSelectPerson(person.id);
          }
        }}
        onMouseEnter={() => setHoveredPersonId(person.id)}
        onMouseLeave={() => setHoveredPersonId(null)}
        onClick={() => {
          if (!hasMovedRef.current) onSelectPerson(person.id);
        }}
        style={{
          left: `${node.x}px`,
          top: `${node.y}px`,
          width: `${width}px`,
          height: `${height}px`,
        }}
        className={`absolute z-10 group cursor-pointer select-none transition-opacity duration-150 ${
          isDimmed ? 'opacity-30' : 'opacity-100'
        }`}
      >
        <div
          style={{
            borderColor: isHighlighted || isFounder ? branchPalette.border : undefined,
          }}
          className={`relative h-full w-full bg-white rounded-lg border transition-all duration-150 flex ${
            settings.cardStyle === 'medallion'
              ? 'flex-col items-center justify-center text-center px-2.5 py-2'
              : 'items-center gap-3 px-3.5 py-2.5'
          } ${
            isFounder
              ? 'border-2 shadow-[0_8px_28px_rgba(138,112,80,0.16)]'
              : isHighlighted
              ? 'border-2 shadow-[0_6px_20px_rgba(28,25,23,0.10)]'
              : 'border-[#E2DAD0] hover:border-[#9A7B56] shadow-[0_2px_10px_rgba(28,25,23,0.04)] hover:shadow-[0_6px_20px_rgba(28,25,23,0.09)]'
          }`}
        >
          {/* Subtle top branch color line */}
          <div
            className="absolute top-0 left-3 right-3 h-[2.5px] rounded-b-full opacity-75 group-hover:opacity-100 transition-opacity"
            style={{
              backgroundColor: branchPalette.border,
            }}
          />

          {/* Avatar / Monogram with quick photo access */}
          {settings.showInitialsAvatar && settings.cardStyle !== 'minimal' && (
            <div
              className={`${
                settings.cardStyle === 'medallion' ? 'h-10 w-10 mb-1' : 'h-11 w-11'
              } shrink-0 aspect-square rounded-full border border-[#DFD6C7] flex items-center justify-center overflow-hidden relative group/avatar cursor-pointer hover:border-[#8C7355] transition-all`}
              style={{ backgroundColor: branchPalette.light }}
              onClick={(e) => {
                if (onOpenPhotoCropper) {
                  e.stopPropagation();
                  onOpenPhotoCropper(person.id);
                }
              }}
              title={person.photo ? 'Modifier ou recadrer la photo' : 'Ajouter une photo'}
            >
              {person.photo ? (
                <img
                  src={person.photo}
                  alt={getFullName(person)}
                  className="h-full w-full aspect-square rounded-full object-cover transition-transform duration-150 group-hover/avatar:scale-105"
                />
              ) : (
                <span
                  className="font-serif text-sm font-semibold"
                  style={{ color: branchPalette.badge }}
                >
                  {getInitials(person)}
                </span>
              )}
              {/* Subtle hover camera overlay indicator */}
              <div className="absolute inset-0 bg-[#1C1917]/50 text-white flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity">
                <Camera className="h-3.5 w-3.5" />
              </div>
            </div>
          )}

          {/* Name & Dates */}
          <div className="min-w-0 flex-1">
            <p
              className={`font-serif text-[#1C1917] leading-[1.15] ${
                settings.cardStyle === 'minimal' ? 'text-[15px]' : 'text-[16px]'
              } font-medium line-clamp-2`}
            >
              {person.first}
              {person.last && (
                <span className="block text-[13px] font-normal text-[#4A443C] truncate">
                  {person.last}
                </span>
              )}
            </p>
            {settings.showDates && datesText && (
              <p
                className={`mt-0.5 text-[10px] font-mono tabular-nums truncate ${
                  incomplete ? 'text-[#A67644]' : 'text-[#857C70]'
                }`}
              >
                {datesText}
              </p>
            )}
          </div>

          {/* Quick + Add Child button on hover */}
          <button
            type="button"
            title={`Ajouter un enfant à ${getFullName(person)}`}
            onClick={(e) => {
              e.stopPropagation();
              onAddChildFor(person.id);
            }}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 absolute -top-2.5 right-2 h-6 w-6 rounded-full bg-white border border-[#C8B9A6] text-[#6E604F] hover:bg-[#1C1917] hover:text-white hover:border-[#1C1917] flex items-center justify-center transition-all shadow-xs"
          >
            <Plus className="h-3 w-3" />
          </button>

          {/* Collapse / Expand Children Toggle */}
          {childCount > 0 && (
            <button
              type="button"
              onClick={(e) => toggleCollapseNode(person.id, e)}
              title={
                isCollapsed
                  ? `Déplier la descendance (${descendantCount})`
                  : 'Replier cette branche'
              }
              className={`absolute z-20 flex items-center justify-center gap-0.5 rounded-full border text-[10px] font-mono tabular-nums transition-colors shadow-xs ${
                settings.orientation === 'vertical'
                  ? '-bottom-2.5 left-1/2 -translate-x-1/2 px-2 h-5'
                  : '-right-2.5 top-1/2 -translate-y-1/2 px-1.5 h-5'
              } ${
                isCollapsed
                  ? 'bg-[#1C1917] text-white border-[#1C1917]'
                  : 'bg-[#FAF8F5] text-[#6E665C] border-[#D5CBBF] hover:border-[#8C7355]'
              }`}
            >
              {isCollapsed ? (
                <>
                  <Plus className="h-2.5 w-2.5" />
                  <span>{descendantCount}</span>
                </>
              ) : (
                <Minus className="h-2.5 w-2.5" />
              )}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className={
        isFullscreen
          ? 'fixed inset-0 z-50 flex flex-col bg-[#FAF8F5]'
          : 'relative flex flex-col flex-1 w-full'
      }
    >
      {/* Compact Top Control Bar: Branch Pills + View Mode + Search */}
      <div className="w-full bg-white/95 backdrop-blur-md border-b border-[#E6DFD3] px-3 sm:px-6 lg:px-8 py-2">
        <div className="max-w-[1800px] mx-auto flex flex-wrap items-center justify-between gap-2">
          {/* Segmented Branch Selector with Color Dots */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
            {BRANCH_DEFINITIONS.map((b) => {
              const active = focusBranch === b.id;
              const pal = getBranchPalette(b.id === 'all' ? 'root' : b.id);
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onChangeFocusBranch(b.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
                    active
                      ? 'text-white shadow-xs'
                      : 'text-[#575047] hover:text-[#1C1917] bg-[#FAF8F5] hover:bg-[#EFECE4] border border-[#E6DFD3]'
                  }`}
                  style={active ? { backgroundColor: pal.badge } : undefined}
                >
                  {b.id !== 'all' && !active && (
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: pal.badge }}
                    />
                  )}
                  <span>{b.label}</span>
                </button>
              );
            })}
          </div>

          {/* Right Controls: 3-Gen Fold, Orientation, Search, Export */}
          <div className="flex items-center gap-2 shrink-0 ml-auto">
            {/* Fold / Unfold Quick Button */}
            {collapsedIds.size > 0 ? (
              <button
                type="button"
                onClick={expandAll}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-[#1C1917] text-white transition-colors whitespace-nowrap"
              >
                <Layers className="h-3.5 w-3.5" />
                <span>Tout déplier (5 gén.)</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={collapseToBranches}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-[#E6DFD3] bg-[#FAF8F5] hover:bg-[#EFECE4] text-[#575047] transition-colors whitespace-nowrap"
                title="Replier les générations IV et V pour voir le cœur de famille en grand"
              >
                <Layers className="h-3.5 w-3.5 text-[#8C7A65]" />
                <span className="hidden sm:inline">Vue 3 générations</span>
                <span className="sm:hidden">3 gén.</span>
              </button>
            )}

            {/* Orientation Switch */}
            <button
              type="button"
              onClick={() =>
                onUpdateSettings({
                  orientation: settings.orientation === 'vertical' ? 'horizontal' : 'vertical',
                })
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-[#E6DFD3] bg-[#FAF8F5] hover:bg-[#EFECE4] text-[#575047] transition-colors whitespace-nowrap"
              title="Basculer entre l'arbre Vertical (Haut → Bas) et Horizontal (Gauche → Droite)"
            >
              {settings.orientation === 'vertical' ? (
                <>
                  <ArrowDownUp className="h-3.5 w-3.5 text-[#8C7355]" />
                  <span className="hidden md:inline">Haut → Bas</span>
                </>
              ) : (
                <>
                  <ArrowLeftRight className="h-3.5 w-3.5 text-[#8C7355]" />
                  <span className="hidden md:inline">Gauche → Droite</span>
                </>
              )}
            </button>

            {/* Quick Search Input */}
            <div className="relative w-36 sm:w-52">
              <Search className="h-3.5 w-3.5 text-[#8C7A65] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onFocus={() => setIsSearchOpen(true)}
                onBlur={() => setTimeout(() => setIsSearchOpen(false), 180)}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setIsSearchOpen(true);
                }}
                placeholder="Chercher un prénom…"
                className="w-full h-8 pl-8 pr-2.5 rounded-full bg-[#FAF8F5] border border-[#E6DFD3] text-xs text-[#1C1917] placeholder:text-[#8E867B] focus:outline-none focus:border-[#8C7355] focus:bg-white"
              />
              {isSearchOpen && searchQuery.trim().length > 0 && (
                <div className="absolute right-0 left-0 sm:left-auto sm:w-64 top-9 z-40 bg-white border border-[#D8CFC2] rounded-xl shadow-lg divide-y divide-[#F2EFE9] max-h-64 overflow-y-auto">
                  {searchResults.length > 0 ? (
                    searchResults.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleSelectSearchResult(p)}
                        className="w-full flex items-center justify-between px-3.5 py-2.5 text-left hover:bg-[#FAF8F5] transition-colors"
                      >
                        <span className="font-serif text-sm text-[#1C1917]">
                          {getFullName(p)}
                        </span>
                        <span className="text-[11px] font-mono text-[#8C7A65]">
                          {p.birth || ''}
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="px-3.5 py-3 text-xs text-[#8E867B]">
                      Aucun membre trouvé pour « {searchQuery} »
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {onOpenPoster ? (
                <button
                  type="button"
                  onClick={onOpenPoster}
                  className="inline-flex min-h-[36px] px-3.5 py-1.5 rounded-full bg-[#8C7355] hover:bg-[#735D43] text-white text-xs font-semibold items-center gap-1.5 transition-colors whitespace-nowrap shadow-2xs"
                  title="Ouvrir le véritable arbre généalogique illustré A3 d’art"
                >
                  <Sparkles className="h-3.5 w-3.5 text-[#F5EBE1]" />
                  <span>Arbre A3</span>
                </button>
              ) : null}

              {onOpenShare ? (
                <button
                  type="button"
                  onClick={onOpenShare}
                  className="inline-flex min-h-[36px] px-3 py-1.5 rounded-full bg-[#1C1917] hover:bg-[#38332E] text-white text-xs font-medium items-center gap-1.5 transition-colors whitespace-nowrap shadow-2xs"
                  title="Partager l’arbre avec la famille ou sur WhatsApp"
                >
                  <Share2 className="h-3.5 w-3.5 text-[#C5B49E]" />
                  <span className="hidden sm:inline">Partager</span>
                </button>
              ) : null}

              {!onOpenPoster && !onOpenShare && (
                <ExportControls people={people} settings={settings} accentColor={accentColor} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Full-Viewport Interactive Genealogical Canvas */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        className={`relative w-full overflow-hidden bg-[#FAF8F5] select-none touch-none ${
          isFullscreen
            ? 'flex-1 h-full'
            : 'h-[calc(100dvh-168px)] md:h-[calc(100dvh-112px)] min-h-[480px]'
        } ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{
          backgroundImage: 'radial-gradient(#D8CFC2 1px, transparent 1px)',
          backgroundSize: '26px 26px',
        }}
      >
        {/* Transformed World Layer */}
        <div
          style={{
            width: `${layout.width}px`,
            height: `${layout.height}px`,
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
          className="relative will-change-transform"
        >
          {/* Generation Stratum Guides (Behind cards at z-0) */}
          {settings.showGenerations &&
            layout.generationBands.map((band) => {
              const genMeta = GENERATION_LABELS[band.depth] || {
                roman: `${band.depth + 1}`,
                title: `Génération ${band.depth + 1}`,
                era: '',
              };

              return settings.orientation === 'vertical' ? (
                <div
                  key={`gen-${band.depth}`}
                  style={{
                    top: `${band.coord - 26}px`,
                    left: '16px',
                    right: '16px',
                  }}
                  className="absolute z-0 pointer-events-none border-t border-dashed border-[#E2DAD0]/75 pt-1 flex items-baseline gap-2"
                >
                  <span className="font-serif italic text-xs text-[#8C7A65] bg-[#FAF8F5]/90 px-1.5 rounded">
                    Génération {genMeta.roman} · {genMeta.title}
                  </span>
                </div>
              ) : (
                <div
                  key={`gen-${band.depth}`}
                  style={{
                    left: `${band.coord}px`,
                    top: '14px',
                    width: `${band.size}px`,
                  }}
                  className="absolute z-0 pointer-events-none border-b border-dashed border-[#E2DAD0] pb-1"
                >
                  <span className="font-serif italic text-xs text-[#8C7A65] block">
                    Génération {genMeta.roman}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.14em] text-[#9E9488] block">
                    {genMeta.title}
                  </span>
                </div>
              );
            })}

          {/* SVG Connecting Lines Layer */}
          <svg
            width={layout.width}
            height={layout.height}
            className="absolute inset-0 z-1 pointer-events-none overflow-visible"
          >
            {layout.edges.map((edge) => {
              const isHighlighted =
                highlightedIds &&
                highlightedIds.has(edge.fromId) &&
                highlightedIds.has(edge.toId);
              const isDimmed = highlightedIds && !isHighlighted;
              const pal = getBranchPalette(edge.branchId);

              return (
                <path
                  key={edge.id}
                  d={buildEdgeSvgPath(edge, settings.orientation, settings.edgeStyle)}
                  fill="none"
                  stroke={isHighlighted ? pal.border : pal.line}
                  strokeWidth={isHighlighted ? 2.8 : 1.65}
                  strokeDasharray={edge.isPartnerLink ? '3 3' : undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`transition-opacity duration-150 ${
                    isDimmed ? 'opacity-20' : 'opacity-95'
                  }`}
                />
              );
            })}
          </svg>

          {/* Partner / Union Medallions */}
          {layout.partners.map((partner) => {
            const p = partner.person;
            const dates = [p.birth, p.death].filter(Boolean).join(' – ');
            return (
              <button
                key={partner.id}
                type="button"
                data-interactive="true"
                onPointerDown={() => {
                  hasMovedRef.current = false;
                }}
                onClick={() => {
                  if (!hasMovedRef.current) onSelectPerson(p.id);
                }}
                style={{
                  left: `${partner.x}px`,
                  top: `${partner.y}px`,
                  width: `${partner.width}px`,
                  height: `${partner.height}px`,
                }}
                className="absolute z-10 flex items-center justify-center gap-2 rounded-full bg-[#F4F0E8] border border-[#D5C7B4] hover:border-[#8C7355] hover:bg-white px-3 text-left shadow-2xs transition-colors cursor-pointer"
                title={`Voir la fiche de ${getFullName(p)}`}
              >
                {p.photo ? (
                  <img
                    src={p.photo}
                    alt={getFullName(p)}
                    className="h-5 w-5 aspect-square rounded-full object-cover shrink-0 scale-[1.09]"
                  />
                ) : (
                  <span className="h-5 w-5 rounded-full bg-[#E5DEC9] text-[#6E604F] font-serif text-[10px] flex items-center justify-center shrink-0">
                    {getInitials(p)}
                  </span>
                )}
                <div className="min-w-0 leading-tight">
                  <span className="block text-[11px] text-[#3D3832] truncate">
                    <span className="italic font-serif text-[#8C7A65]">avec </span>
                    <span className="font-medium">{getFullName(p)}</span>
                  </span>
                  {dates && (
                    <span className="block text-[9px] font-mono text-[#8C7A65] truncate">
                      {dates}
                    </span>
                  )}
                </div>
              </button>
            );
          })}

          {/* Person Cards Layer */}
          {layout.nodes.map(renderPersonCard)}
        </div>

        {/* Floating Bottom-Left Tip (Desktop) */}
        <div className="absolute bottom-4 left-4 z-20 hidden lg:flex items-center gap-2.5 bg-white/95 backdrop-blur-xs border border-[#E2DAD0] rounded-full px-4 py-2 text-xs text-[#6E665C] shadow-sm pointer-events-auto">
          <span>Molette ou Pincer : zoomer · Glisser : déplacer · Survol : surbrillance de la lignée</span>
          <span className="text-[#D8CFC2]">|</span>
          <button
            type="button"
            onClick={onOpenSettingsTab}
            className="inline-flex items-center gap-1 text-[#8C7355] hover:text-[#1C1917] font-medium whitespace-nowrap"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Options
          </button>
        </div>

        {/* Floating Bottom-Center / Right Ergonomic Zoom & Fit Dock */}
        <div
          data-interactive="true"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 lg:left-auto lg:translate-x-0 lg:right-4 z-20 flex items-center gap-1 bg-white/95 backdrop-blur-md border border-[#D8CFC2] rounded-full px-2 py-1 shadow-md"
        >
          <button
            type="button"
            onClick={() => zoomAtPoint(zoom / 1.22)}
            className="h-8 w-8 rounded-full flex items-center justify-center text-[#4A453E] hover:bg-[#FAF8F5] active:bg-[#EFECE4] transition-colors"
            title="Dézoomer"
            aria-label="Dézoomer"
          >
            <ZoomOut className="h-4 w-4" />
          </button>

          {/* Direct Zoom Slider for effortless zooming */}
          <input
            type="range"
            min="0.15"
            max="1.5"
            step="0.02"
            value={Math.min(1.5, Math.max(0.15, zoom))}
            onChange={(e) => zoomAtPoint(parseFloat(e.target.value))}
            aria-label="Niveau de zoom"
            className="w-20 sm:w-28 accent-[#8C7355] cursor-pointer"
          />

          <span className="w-10 text-center text-[11px] font-mono tabular-nums text-[#4A453E]">
            {Math.round(zoom * 100)}%
          </span>

          <button
            type="button"
            onClick={() => zoomAtPoint(zoom * 1.22)}
            className="h-8 w-8 rounded-full flex items-center justify-center text-[#4A453E] hover:bg-[#FAF8F5] active:bg-[#EFECE4] transition-colors"
            title="Zoomer"
            aria-label="Zoomer"
          >
            <ZoomIn className="h-4 w-4" />
          </button>

          <div className="h-4 w-[1px] bg-[#E6DFD3] mx-0.5" />

          <button
            type="button"
            onClick={() => fitTreeInViewport('all')}
            className="inline-flex items-center gap-1 px-3 h-8 rounded-full text-xs font-medium bg-[#FAF8F5] hover:bg-[#1C1917] hover:text-white text-[#1C1917] border border-[#E2DAD0] transition-colors whitespace-nowrap"
            title="Adapter le zoom pour voir l'arbre entier dans l'écran"
          >
            <Scan className="h-3.5 w-3.5" />
            <span>Voir en entier</span>
          </button>

          <button
            type="button"
            onClick={() => setIsFullscreen((f) => !f)}
            className="h-8 w-8 rounded-full flex items-center justify-center text-[#4A453E] hover:bg-[#FAF8F5] active:bg-[#EFECE4] transition-colors"
            title={isFullscreen ? 'Quitter le plein écran' : 'Plein écran'}
            aria-label="Plein écran"
          >
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Floating Top-Right Minimap Radar (Optional in settings) */}
        {settings.showMinimap && (
          <div
            data-interactive="true"
            className="hidden xl:block absolute top-3 right-3 z-20 w-44 h-26 bg-white/95 backdrop-blur-xs border border-[#E2DAD0] rounded-lg p-1.5 shadow-xs"
          >
            <div className="flex items-center justify-between px-1 pb-1">
              <span className="text-[9px] uppercase tracking-[0.16em] text-[#8C7A65]">
                Aperçu Radar
              </span>
              <button
                type="button"
                onClick={() => onUpdateSettings({ showMinimap: false })}
                className="text-[10px] text-[#9E9488] hover:text-[#1C1917]"
                title="Masquer le radar"
              >
                ×
              </button>
            </div>
            <svg
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              preserveAspectRatio="xMidYMid meet"
              onClick={handleMinimapClick}
              className="w-full h-18 cursor-crosshair bg-[#FAF8F5] rounded"
            >
              <g fill="none" stroke="#C5B49E" strokeWidth="12">
                {layout.edges.map((e) => (
                  <path
                    key={`mini-${e.id}`}
                    d={buildEdgeSvgPath(e, settings.orientation, settings.edgeStyle)}
                  />
                ))}
              </g>
              <g fill="#9A7B56">
                {layout.nodes.map((n) => (
                  <rect
                    key={`mini-n-${n.id}`}
                    x={n.x}
                    y={n.y}
                    width={n.width}
                    height={n.height}
                    rx="8"
                  />
                ))}
              </g>
            </svg>
          </div>
        )}
      </div>
    </div>
  );
};
