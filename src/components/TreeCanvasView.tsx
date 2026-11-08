import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { ExportControls } from './ExportControls';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  RotateCcw,
  Search,
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  ArrowDownUp,
  ArrowLeftRight,
  Compass,
  SlidersHorizontal,
  UserPlus
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
  PositionedNode
} from '../utils/treeLayout';

interface TreeCanvasViewProps {
  people: Person[];
  settings: TreeSettings;
  onUpdateSettings: (partial: Partial<TreeSettings>) => void;
  onSelectPerson: (id: string) => void;
  onAddChildFor: (parentId: string) => void;
  onOpenSettingsTab: () => void;
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
  focusBranch,
  onChangeFocusBranch,
  accentColor,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<number>(0.85);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 40, y: 24 });
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

  // Highlighted lineage set when hovering a person
  const highlightedIds = useMemo(() => {
    if (!hoveredPersonId) return null;
    const anc = getAncestorsSet(people, hoveredPersonId);
    const desc = getDescendantsSet(people, hoveredPersonId);
    return new Set<string>([...anc, ...desc]);
  }, [people, hoveredPersonId]);

  // Center & Fit helper
  const fitTreeInViewport = useCallback(
    (preferReadableScale = false) => {
      const el = containerRef.current;
      if (!el) return;
      const vw = el.clientWidth;
      const vh = el.clientHeight;
      if (vw === 0 || vh === 0) return;

      const scaleX = (vw - 64) / layout.width;
      const scaleY = (vh - 64) / layout.height;
      let targetZoom = Math.min(scaleX, scaleY);

      if (preferReadableScale) {
        // Keep cards comfortably readable on initial arrival and center around Victoria / root
        targetZoom = Math.max(0.68, Math.min(1, targetZoom));
      } else {
        targetZoom = Math.max(0.01, Math.min(1.15, targetZoom));
      }

      const rootNode =
        layout.nodes.find((n) => n.id === (focusBranch === 'all' ? 'victoria' : focusBranch)) ||
        layout.nodes[0];

      if (preferReadableScale && rootNode && layout.width * targetZoom > vw) {
        if (settings.orientation === 'vertical') {
          const rootCenterX = (rootNode.x + rootNode.width / 2) * targetZoom;
          setPan({
            x: vw / 2 - rootCenterX,
            y: 28,
          });
        } else {
          const rootCenterY = (rootNode.y + rootNode.height / 2) * targetZoom;
          setPan({
            x: 36,
            y: vh / 2 - rootCenterY,
          });
        }
      } else {
        setPan({
          x: Math.max(24, (vw - layout.width * targetZoom) / 2),
          // Keep the overview visible above the mobile bottom navigation.
          y: vw < 640 ? 32 : Math.max(24, (vh - layout.height * targetZoom) / 2),
        });
      }
      setZoom(targetZoom);
    },
    [layout, focusBranch, settings.orientation]
  );

  const zoomFromCenter = (target: number) => {
    const el = containerRef.current;
    if (!el) return;
    const next = Math.max(0.01, Math.min(1.8, target));
    const x = el.clientWidth / 2, y = el.clientHeight / 2;
    setPan({ x: x - ((x - pan.x) / zoom) * next, y: y - ((y - pan.y) / zoom) * next });
    setZoom(next);
  };

  // Center on a specific person node
  const centerOnPerson = useCallback(
    (id: string) => {
      const el = containerRef.current;
      if (!el) return;
      const node = layout.nodes.find((n) => n.id === id);
      const partner = layout.partners.find((p) => p.person.id === id);
      const target = node || partner;
      if (!target) return;

      const targetZoom = Math.max(zoom, 0.88);
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

  // Recenter when focusBranch or orientation changes
  useEffect(() => {
    const timer = requestAnimationFrame(() => {
      fitTreeInViewport(false);
    });
    return () => cancelAnimationFrame(timer);
  }, [focusBranch, settings.orientation, settings.cardStyle, isFullscreen]);

  // Pointer pan handlers
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
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

  const handlePointerUp = () => {
    setIsDragging(false);
    dragStartRef.current = null;
  };

  // Touch pan & pinch-zoom handlers
  const touchStateRef = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
    initialDistance?: number;
    initialZoom?: number;
    midX?: number;
    midY?: number;
  } | null>(null);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-interactive="true"]')) return;
    const el = containerRef.current;
    if (!el) return;

    if (e.touches.length === 1) {
      const t = e.touches[0];
      touchStateRef.current = {
        startX: t.clientX,
        startY: t.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      hasMovedRef.current = false;
    } else if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const rect = el.getBoundingClientRect();
      const midX = (t1.clientX + t2.clientX) / 2 - rect.left;
      const midY = (t1.clientY + t2.clientY) / 2 - rect.top;

      touchStateRef.current = {
        startX: t1.clientX,
        startY: t1.clientY,
        panX: pan.x,
        panY: pan.y,
        initialDistance: dist,
        initialZoom: zoom,
        midX,
        midY,
      };
      hasMovedRef.current = true;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!touchStateRef.current) return;

    if (e.touches.length === 1 && !touchStateRef.current.initialDistance) {
      const t = e.touches[0];
      const dx = t.clientX - touchStateRef.current.startX;
      const dy = t.clientY - touchStateRef.current.startY;
      if (Math.abs(dx) + Math.abs(dy) > 5) {
        hasMovedRef.current = true;
      }
      setPan({
        x: touchStateRef.current.panX + dx,
        y: touchStateRef.current.panY + dy,
      });
    } else if (e.touches.length === 2 && touchStateRef.current.initialDistance) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const ratio = dist / touchStateRef.current.initialDistance;
      const nextZoom = Math.max(0.01, Math.min(1.8, (touchStateRef.current.initialZoom || 0.8) * ratio));

      const midX = touchStateRef.current.midX || 0;
      const midY = touchStateRef.current.midY || 0;
      const worldX = (midX - touchStateRef.current.panX) / (touchStateRef.current.initialZoom || 1);
      const worldY = (midY - touchStateRef.current.panY) / (touchStateRef.current.initialZoom || 1);

      setZoom(Number(nextZoom.toFixed(3)));
      setPan({
        x: midX - worldX * nextZoom,
        y: midY - worldY * nextZoom,
      });
    }
  };

  const handleTouchEnd = () => {
    touchStateRef.current = null;
  };

  // Wheel zoom / trackpad pan
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;

    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= 40) {
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const nextZoom = Math.max(0.01, Math.min(1.8, zoom * factor));

      const worldX = (cursorX - pan.x) / zoom;
      const worldY = (cursorY - pan.y) / zoom;

      setZoom(Number(nextZoom.toFixed(3)));
      setPan({
        x: cursorX - worldX * nextZoom,
        y: cursorY - worldY * nextZoom,
      });
    } else {
      setPan((prev) => ({
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY,
      }));
    }
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
    // Collapse generation III so only Gen I, II, III are visible for a clean overview
    const toCollapse = new Set<string>();
    for (const n of layout.nodes) {
      if (n.depth >= 2 && n.childCount > 0) {
        toCollapse.add(n.id);
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
    const { person, width, height, childCount, descendantCount, isCollapsed } = node;
    const isDimmed = highlightedIds ? !highlightedIds.has(person.id) : false;
    const isFounder = person.id === 'victoria';
    const incomplete = isPersonIncomplete(person);
    const datesText =
      [person.birth, person.death].filter(Boolean).join(' – ') ||
      (incomplete ? 'Dates à compléter' : '');

    return (
      <div
        key={person.id}
        data-interactive="true"
        role="button"
        tabIndex={0}
        aria-label={`Voir la fiche de ${getFullName(person)}`}
        onPointerDown={() => { hasMovedRef.current = false; }}
        onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelectPerson(person.id); } }}
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
        className={`absolute group cursor-pointer select-none transition-opacity duration-150 ${
          isDimmed ? 'opacity-35' : 'opacity-100'
        }`}
      >
        <div
          className={`relative h-full w-full bg-white border transition-all duration-150 flex ${
            settings.cardStyle === 'medallion'
              ? 'flex-col items-center justify-center text-center px-3 py-2.5'
              : 'items-center gap-3.5 px-4 py-3'
          } ${
            isFounder
              ? 'border-[#9A7B56] shadow-[0_8px_28px_rgba(138,112,80,0.14)]'
              : 'border-[#E2DAD0] hover:border-[#9A7B56] shadow-[0_3px_14px_rgba(28,25,23,0.04)] hover:shadow-[0_8px_24px_rgba(28,25,23,0.09)]'
          }`}
        >
          {/* Subtle top ornamental line on Founder or Editorial style */}
          {settings.cardStyle === 'editorial' && (
            <div
              className="absolute top-0 left-4 right-4 h-[1.5px] opacity-60 transition-opacity group-hover:opacity-100"
              style={{
                backgroundColor: isFounder ? accentColor : 'transparent',
              }}
            />
          )}

          {/* Avatar / Monogram */}
          {settings.showInitialsAvatar && settings.cardStyle !== 'minimal' && (
            <div
              className={`${
                settings.cardStyle === 'medallion' ? 'h-11 w-11 mb-1.5' : 'h-12 w-12'
              } shrink-0 rounded-full border border-[#DFD6C7] bg-[#F5F1E9] flex items-center justify-center overflow-hidden`}
            >
              {person.photo ? (
                <img
                  src={person.photo}
                  alt={getFullName(person)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="font-serif text-base font-medium text-[#7D6B57]">
                  {getInitials(person)}
                </span>
              )}
            </div>
          )}

          {/* Name & Dates */}
          <div className="min-w-0 flex-1">
            <p
              className={`font-serif text-[#1C1917] leading-[1.15] ${
                settings.cardStyle === 'minimal' ? 'text-base' : 'text-[17px]'
              } font-medium line-clamp-2`}
            >
              {person.first}
              {person.last && (
                <span className="block text-[14px] font-normal text-[#4A443C]">
                  {person.last}
                </span>
              )}
            </p>
            {settings.showDates && datesText && (
              <p
                className={`mt-1 text-[11px] font-mono tabular-nums truncate ${
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
              className={`absolute flex items-center justify-center gap-0.5 rounded-full border text-[10px] font-mono tabular-nums transition-colors shadow-xs ${
                settings.orientation === 'vertical'
                  ? '-bottom-3 left-1/2 -translate-x-1/2 px-2 h-5'
                  : '-right-3 top-1/2 -translate-y-1/2 px-1.5 h-5'
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
          ? 'fixed inset-0 z-40 flex flex-col bg-[#FAF8F5]'
          : 'relative flex flex-col w-full'
      }
    >
      {/* Editorial Header Banner (Hidden in fullscreen mode for maximum canvas space) */}
      {!isFullscreen && (
        <section className="max-w-[1600px] w-full mx-auto px-6 lg:px-10 pt-7 pb-5">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 border-b border-[#E6DFD3] pb-6">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-[#8C7A65] font-medium">
                {settings.subtitle}
              </p>
              <h1
                className="font-serif text-3xl sm:text-4xl lg:text-[44px] font-normal tracking-tight text-[#1C1917] mt-1"
                style={{ textWrap: 'balance' }}
              >
                {settings.familyName}
              </h1>
              <p className="text-sm text-[#6E665C] mt-1.5 max-w-2xl">
                {settings.motto}
              </p>
            </div>

            {/* Key Archival Metrics — Unboxed Editorial Typography */}
            <div className="flex flex-wrap items-center gap-6 text-xs text-[#6E665C] shrink-0">
              <div>
                <span className="block font-serif text-2xl text-[#1C1917] font-mono tabular-nums">
                  {people.length}
                </span>
                <span className="uppercase tracking-[0.15em] text-[10px] text-[#8C7A65]">
                  Membres Inscrits
                </span>
              </div>
              <span className="text-[#D8CFC2] text-xl font-light" aria-hidden="true">
                /
              </span>
              <div>
                <span className="block font-serif text-2xl text-[#1C1917] font-mono tabular-nums">
                  5
                </span>
                <span className="uppercase tracking-[0.15em] text-[10px] text-[#8C7A65]">
                  Générations
                </span>
              </div>
              <span className="text-[#D8CFC2] text-xl font-light" aria-hidden="true">
                /
              </span>
              <div>
                <span className="block font-serif text-2xl text-[#1C1917] font-mono tabular-nums">
                  5
                </span>
                <span className="uppercase tracking-[0.15em] text-[10px] text-[#8C7A65]">
                  Branches Majeures
                </span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Workspace Control Bar: Branch Filter + Orientation + Search */}
      <div className="max-w-[1600px] w-full mx-auto px-6 lg:px-10 pb-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 bg-white border border-[#E6DFD3] p-2.5">
          {/* Segmented Branch Selector */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            {BRANCH_DEFINITIONS.map((b) => {
              const active = focusBranch === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onChangeFocusBranch(b.id)}
                  className={`px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'text-white shadow-xs'
                      : 'text-[#575047] hover:text-[#1C1917] hover:bg-[#F5F2EB]'
                  }`}
                  style={active ? { backgroundColor: accentColor } : undefined}
                >
                  {b.label}
                </button>
              );
            })}
          </div>

          {/* Right Controls: Orientation Switch, Fold/Unfold, Search */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <ExportControls people={people} settings={settings} />
            {/* Orientation Segmented Switch */}
            <div className="inline-flex items-center bg-[#FAF8F5] border border-[#E6DFD3] p-0.5">
              <button
                type="button"
                onClick={() => onUpdateSettings({ orientation: 'vertical' })}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  settings.orientation === 'vertical'
                    ? 'bg-white text-[#1C1917] shadow-2xs border border-[#E2DAD0]'
                    : 'text-[#6E665C] hover:text-[#1C1917]'
                }`}
                title="Affichage vertical de haut en bas"
              >
                <ArrowDownUp className="h-3.5 w-3.5" />
                <span>Vertical</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateSettings({ orientation: 'horizontal' })}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  settings.orientation === 'horizontal'
                    ? 'bg-white text-[#1C1917] shadow-2xs border border-[#E2DAD0]'
                    : 'text-[#6E665C] hover:text-[#1C1917]'
                }`}
                title="Affichage horizontal de gauche à droite"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />
                <span>Horizontal</span>
              </button>
            </div>

            {/* Fold / Unfold Quick Button */}
            {collapsedIds.size > 0 ? (
              <button
                type="button"
                onClick={expandAll}
                className="px-3 py-1.5 text-xs font-medium border border-[#E6DFD3] bg-[#FAF8F5] hover:bg-[#EFECE4] text-[#1C1917] transition-colors whitespace-nowrap"
              >
                Tout déplier ({collapsedIds.size})
              </button>
            ) : (
              <button
                type="button"
                onClick={collapseToBranches}
                className="px-3 py-1.5 text-xs font-medium border border-[#E6DFD3] bg-[#FAF8F5] hover:bg-[#EFECE4] text-[#575047] transition-colors whitespace-nowrap"
                title="Replier les générations IV et V pour une vue synthétique"
              >
                Vue 3 générations
              </button>
            )}

            {/* Quick Search Input */}
            <div className="relative w-full sm:w-56">
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
                placeholder="Rechercher un membre…"
                className="w-full h-8.5 pl-8 pr-3 bg-[#FAF8F5] border border-[#E6DFD3] text-xs text-[#1C1917] placeholder:text-[#8E867B] focus:outline-none focus:border-[#8C7355]"
              />
              {isSearchOpen && searchQuery.trim().length > 0 && (
                <div className="absolute right-0 left-0 top-10 z-30 bg-white border border-[#D8CFC2] shadow-lg divide-y divide-[#F2EFE9] max-h-64 overflow-y-auto">
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
          </div>
        </div>
      </div>

      {/* Main Genealogical Interactive Canvas */}
      <div className="max-w-[1600px] w-full mx-auto px-6 lg:px-10 flex-1 flex flex-col pb-8">
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
          className={`relative w-full overflow-hidden border border-[#E2DAD0] bg-[#FAF8F5] select-none touch-none ${
            isFullscreen ? 'flex-1 h-full' : 'h-[520px] sm:h-[660px] lg:h-[720px]'
          } ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{
            backgroundImage:
              'radial-gradient(#D8CFC2 1px, transparent 1px)',
            backgroundSize: '28px 28px',
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
            {/* Generation Stratum Guides */}
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
                      top: `${band.coord - 28}px`,
                      left: '20px',
                      right: '20px',
                    }}
                    className="absolute pointer-events-none border-t border-dashed border-[#E2DAD0]/80 pt-1.5 flex items-baseline gap-2"
                  >
                    <span className="font-serif italic text-xs text-[#8C7A65]">
                      Génération {genMeta.roman}
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.16em] text-[#9E9488]">
                      · {genMeta.title}
                    </span>
                  </div>
                ) : (
                  <div
                    key={`gen-${band.depth}`}
                    style={{
                      left: `${band.coord}px`,
                      top: '18px',
                      width: `${band.size}px`,
                    }}
                    className="absolute pointer-events-none border-b border-dashed border-[#E2DAD0] pb-1.5"
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
              className="absolute inset-0 pointer-events-none overflow-visible"
            >
              {layout.edges.map((edge) => {
                const isHighlighted =
                  highlightedIds &&
                  highlightedIds.has(edge.fromId) &&
                  highlightedIds.has(edge.toId);
                const isDimmed = highlightedIds && !isHighlighted;

                return (
                  <path
                    key={edge.id}
                    d={buildEdgeSvgPath(edge, settings.orientation, settings.edgeStyle)}
                    fill="none"
                    stroke={isHighlighted ? accentColor : '#C5B49E'}
                    strokeWidth={isHighlighted ? 2.4 : 1.5}
                    strokeDasharray={edge.isPartnerLink ? '3 3' : undefined}
                    strokeLinecap="round"
                    className={`transition-opacity duration-150 ${
                      isDimmed ? 'opacity-25' : 'opacity-90'
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
                  onPointerDown={() => { hasMovedRef.current = false; }}
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
                      className="h-5 w-5 rounded-full object-cover shrink-0"
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

          {/* Floating Bottom-Left Legend & Instructions */}
          <div className="absolute bottom-4 left-4 z-20 hidden sm:flex items-center gap-3 bg-white/95 backdrop-blur-xs border border-[#E2DAD0] px-3.5 py-2 text-xs text-[#6E665C] shadow-xs pointer-events-auto">
            <span>Glisser pour naviguer · Molette pour zoomer · Cliquer sur une carte pour ouvrir son portrait</span>
            <span className="text-[#D8CFC2]">|</span>
            <button
              type="button"
              onClick={onOpenSettingsTab}
              className="inline-flex items-center gap-1 text-[#8C7355] hover:text-[#1C1917] font-medium whitespace-nowrap"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Paramétrer le style
            </button>
          </div>

          {/* Floating Bottom-Right Zoom & Fullscreen Controls */}
          <div
            data-interactive="true"
            className="absolute bottom-3 right-3 sm:bottom-4 sm:right-4 z-20 flex items-center bg-white/95 backdrop-blur-xs border border-[#E2DAD0] shadow-xs divide-x divide-[#EAE4DA]"
          >
            <button
              type="button"
              onClick={() => zoomFromCenter(zoom / 1.25)}
              className="h-10 w-10 sm:h-9 sm:w-9 flex items-center justify-center text-[#4A453E] hover:bg-[#FAF8F5] active:bg-[#EFECE4] transition-colors"
              title="Dézoomer"
              aria-label="Dézoomer"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => zoomFromCenter(1)}
              className="px-2.5 sm:px-3 h-10 sm:h-9 text-xs font-mono tabular-nums text-[#4A453E] hover:bg-[#FAF8F5] active:bg-[#EFECE4] transition-colors whitespace-nowrap"
              title="Revenir à 100 %"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => zoomFromCenter(zoom * 1.25)}
              className="h-10 w-10 sm:h-9 sm:w-9 flex items-center justify-center text-[#4A453E] hover:bg-[#FAF8F5] active:bg-[#EFECE4] transition-colors"
              title="Zoomer"
              aria-label="Zoomer"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => fitTreeInViewport(false)}
              className="block px-3 h-10 sm:h-9 text-xs font-medium text-[#4A453E] hover:bg-[#FAF8F5] transition-colors whitespace-nowrap"
              title="Afficher l'arbre entier dans le cadre"
            >
              Tout voir
            </button>
            <button
              type="button"
              onClick={() => setIsFullscreen((f) => !f)}
              className="h-10 w-10 sm:h-9 sm:w-9 flex items-center justify-center text-[#4A453E] hover:bg-[#FAF8F5] active:bg-[#EFECE4] transition-colors"
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
              className="hidden md:block absolute top-4 right-4 z-20 w-44 h-28 bg-white/95 backdrop-blur-xs border border-[#E2DAD0] p-1.5 shadow-xs"
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
                className="w-full h-20 cursor-crosshair bg-[#FAF8F5]"
              >
                <g fill="none" stroke="#C5B49E" strokeWidth="10">
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
                      rx="6"
                    />
                  ))}
                </g>
              </svg>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
