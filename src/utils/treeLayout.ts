import { Person, TreeSettings } from '../data/wiciFamily';

export interface PositionedNode {
  id: string;
  person: Person;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  branchId: string;
  childCount: number;
  descendantCount: number;
  isCollapsed: boolean;
  coParents: Person[];
  isInLaw?: boolean;
}

export interface PositionedPartner {
  id: string;
  person: Person;
  primaryParentId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
}

export interface LayoutEdge {
  id: string;
  fromId: string;
  toId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  branchId: string;
  isPartnerLink?: boolean;
  isStackedSpine?: boolean;
  spineX?: number;
  elbowY?: number;
}

export interface GenerationBand {
  depth: number;
  coord: number; // y in vertical, x in horizontal
  size: number;
}

export interface TreeLayoutResult {
  nodes: PositionedNode[];
  partners: PositionedPartner[];
  edges: LayoutEdge[];
  generationBands: GenerationBand[];
  width: number;
  height: number;
  cardWidth: number;
  cardHeight: number;
}

export const BRANCH_COLORS: Record<string, { border: string; badge: string; line: string; light: string }> = {
  root: { border: '#9A7B56', badge: '#8C7355', line: '#B59E82', light: '#F7F3EB' },
  lydia: { border: '#8C6239', badge: '#8C6239', line: '#C4A482', light: '#FAF4EE' },
  flore: { border: '#3B624C', badge: '#3B624C', line: '#8EB09B', light: '#F1F7F3' },
  peter: { border: '#2E5275', badge: '#2E5275', line: '#8BA6C1', light: '#F1F5F9' },
  therese: { border: '#8E4A42', badge: '#8E4A42', line: '#C8958E', light: '#FAF2F0' },
  regine: { border: '#6B4E71', badge: '#6B4E71', line: '#B39CB8', light: '#F7F3F8' },
};

export function getBranchPalette(branchId: string) {
  return BRANCH_COLORS[branchId] || BRANCH_COLORS.root;
}

export function getDescendantsSet(people: Person[], rootId: string): Set<string> {
  const set = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of people) {
      if (!set.has(p.id) && (p.parents || []).some((pid) => set.has(pid))) {
        set.add(p.id);
        changed = true;
      }
    }
  }
  return set;
}

export function getAncestorsSet(people: Person[], targetId: string): Set<string> {
  const byId = new Map(people.map((p) => [p.id, p]));
  const set = new Set<string>([targetId]);
  const queue = [targetId];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    const p = byId.get(curr);
    if (!p) continue;
    for (const pid of p.parents || []) {
      if (!set.has(pid) && byId.has(pid)) {
        set.add(pid);
        queue.push(pid);
      }
    }
  }
  return set;
}

export function getCoreLineageIds(people: Person[], focusRootId = 'victoria'): Set<string> {
  if (people.length === 0) return new Set();
  const byId = new Map(people.map((p) => [p.id, p]));
  if (byId.has(focusRootId)) {
    return getDescendantsSet(people, focusRootId);
  }
  const parentless = people.filter(
    (p) => !(p.parents || []).some((pid) => byId.has(pid) && pid !== p.id)
  );
  const candidates = parentless.length > 0 ? parentless : people;
  let bestId = candidates[0].id;
  let bestSize = -1;
  for (const cand of candidates) {
    const size = getDescendantsSet(people, cand.id).size;
    if (size > bestSize) {
      bestSize = size;
      bestId = cand.id;
    }
  }
  return getDescendantsSet(people, bestId);
}

export function isCoreLineagePerson(personId: string, people: Person[]): boolean {
  return getCoreLineageIds(people).has(personId);
}

function resolveBranchIdFromParents(personId: string, byId: Map<string, Person>): string {
  const mainBranches = new Set(['lydia', 'flore', 'peter', 'therese', 'regine']);
  let currentId: string | undefined = personId;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    if (mainBranches.has(currentId)) return currentId;
    visited.add(currentId);
    const p = byId.get(currentId);
    if (!p || !p.parents || p.parents.length === 0) break;
    const nextParent = p.parents.find((pid) => mainBranches.has(pid)) || p.parents[0];
    currentId = nextParent;
  }
  return 'root';
}

export function resolveBranchId(
  personId: string,
  byId: Map<string, Person>,
  people?: Person[]
): string {
  const direct = resolveBranchIdFromParents(personId, byId);
  if (direct !== 'root' || personId === 'victoria') return direct;

  // If this person is a spouse/in-law connected into a single main branch,
  // associate them with that branch (while Fiodor/Aloïsi spanning multiple stay 'root').
  const person = byId.get(personId);
  if (!person) return 'root';
  const list = people || Array.from(byId.values());
  const linkedBranches = new Set<string>();

  for (const sid of person.spouses || []) {
    const b = resolveBranchIdFromParents(sid, byId);
    if (b !== 'root') linkedBranches.add(b);
  }
  for (const q of list) {
    if ((q.spouses || []).includes(personId)) {
      const b = resolveBranchIdFromParents(q.id, byId);
      if (b !== 'root') linkedBranches.add(b);
    }
    if ((q.parents || []).includes(personId)) {
      const b = resolveBranchIdFromParents(q.id, byId);
      if (b !== 'root') linkedBranches.add(b);
    }
  }

  return linkedBranches.size === 1 ? Array.from(linkedBranches)[0] : 'root';
}

function getBirthSortKey(p: Person): number {
  return parseInt((p.birth || '').replace(/\D/g, ''), 10) || 9999;
}

/**
 * Returns deduplicated partner/co-parent IDs for a given person, combining
 * explicit `spouses` links (either direction) and co-parents from shared children.
 */
export function getKnownPartnerIds(personId: string, people: Person[]): string[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const person = byId.get(personId);
  if (!person) return [];

  const result: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (id !== personId && byId.has(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  };

  for (const sid of person.spouses || []) add(sid);
  for (const q of people) {
    if ((q.spouses || []).includes(personId)) add(q.id);
  }
  for (const c of people) {
    if ((c.parents || []).includes(personId)) {
      for (const pid of c.parents || []) add(pid);
    }
  }

  return result;
}

export interface HalfSiblingEntry {
  person: Person;
  sharedParents: Person[];
}

export interface SiblingGroups {
  fullSiblings: Person[];
  halfSiblings: HalfSiblingEntry[];
}

/**
 * Separates full siblings (identical parent set) from half-siblings (share at
 * least one parent but differ on the other), both sorted chronologically.
 */
export function getSiblingGroups(
  parentIds: string[],
  excludePersonId: string | null,
  people: Person[]
): SiblingGroups {
  const byId = new Map(people.map((p) => [p.id, p]));
  const myParents = Array.from(new Set(parentIds)).filter((id) => byId.has(id));
  if (myParents.length === 0) {
    return { fullSiblings: [], halfSiblings: [] };
  }
  const myParentSet = new Set(myParents);

  const fullSiblings: Person[] = [];
  const halfSiblings: HalfSiblingEntry[] = [];

  for (const other of people) {
    if (other.id === excludePersonId) continue;
    const otherParents = Array.from(new Set(other.parents || [])).filter((id) => byId.has(id));
    const sharedIds = otherParents.filter((pid) => myParentSet.has(pid));
    if (sharedIds.length === 0) continue;

    const exactSameParents =
      myParentSet.size === otherParents.length &&
      otherParents.every((pid) => myParentSet.has(pid));

    if (exactSameParents) {
      fullSiblings.push(other);
    } else {
      halfSiblings.push({
        person: other,
        sharedParents: sharedIds.map((id) => byId.get(id)!).filter(Boolean),
      });
    }
  }

  const byChronology = (a: Person, b: Person) =>
    getBirthSortKey(a) - getBirthSortKey(b);

  fullSiblings.sort(byChronology);
  halfSiblings.sort((a, b) => byChronology(a.person, b.person));

  return { fullSiblings, halfSiblings };
}

export function computeTreeLayout(
  people: Person[],
  focusBranch: string,
  collapsedIds: Set<string>,
  settings: TreeSettings
): TreeLayoutResult {
  const byId = new Map(people.map((p) => [p.id, p]));
  const isHorizontal = settings.orientation === 'horizontal';

  // Refined card dimensions for optimal balance of readability and compactness
  const cardWidth =
    settings.cardStyle === 'minimal' ? 176 : settings.cardStyle === 'medallion' ? 168 : 200;
  const cardHeight =
    settings.cardStyle === 'minimal' ? 72 : settings.cardStyle === 'medallion' ? 108 : 88;

  const siblingGap = settings.compactSpacing ? 18 : 26;
  const branchGap = settings.compactSpacing ? 32 : 44;
  const stackVerticalGap = 14;
  const stackSpineIndent = 18; // extra horizontal space reserved for the left vertical spine on stacked leaf siblings

  const levelStep = isHorizontal
    ? cardWidth + (settings.compactSpacing ? 88 : 118)
    : cardHeight + (settings.compactSpacing ? 92 : 122);
  const padX = 56;
  const padY = 56;

  // Determine which people belong to the focused view
  const allowedIds =
    focusBranch === 'all'
      ? new Set(people.map((p) => p.id))
      : getDescendantsSet(people, focusBranch);

  const activeList = people.filter((p) => allowedIds.has(p.id));
  const activeSet = new Set(activeList.map((p) => p.id));

  const coreSet = getCoreLineageIds(
    activeList,
    focusBranch !== 'all' && activeSet.has(focusBranch) ? focusBranch : 'victoria'
  );

  const childrenMap = new Map<string, Person[]>();
  activeList.forEach((p) => childrenMap.set(p.id, []));

  const primaryParentOf = new Map<string, string>();
  const coParentIds = new Set<string>();
  const childlessSpousesOf = new Map<string, Person[]>();

  // Identify who is a lineage node vs a spouse/co-parent medallion (belle-famille)
  for (const p of activeList) {
    if (p.id === focusBranch || p.id === 'victoria' || coreSet.has(p.id)) continue;
    const hasParentsInTree = (p.parents || []).some((pid) => activeSet.has(pid));
    if (hasParentsInTree) continue;

    const myKids = activeList.filter((c) => (c.parents || []).includes(p.id));
    if (myKids.length > 0) {
      const allKidsHaveOtherPrimary = myKids.every((k) =>
        (k.parents || []).some((otherId) => {
          if (otherId === p.id || !activeSet.has(otherId)) return false;
          if (coreSet.has(otherId) || otherId === 'victoria' || otherId === focusBranch) return true;
          const otherPerson = byId.get(otherId);
          return (otherPerson?.parents || []).some((gp) => activeSet.has(gp));
        })
      );
      if (allKidsHaveOtherPrimary) {
        coParentIds.add(p.id);
      }
    } else {
      // Childless explicit spouse attached to a core-lineage member
      const explicitCoreSpouse = activeList.find(
        (candidate) =>
          coreSet.has(candidate.id) &&
          ((p.spouses || []).includes(candidate.id) || (candidate.spouses || []).includes(p.id))
      );
      if (explicitCoreSpouse) {
        coParentIds.add(p.id);
        if (!childlessSpousesOf.has(explicitCoreSpouse.id)) {
          childlessSpousesOf.set(explicitCoreSpouse.id, []);
        }
        childlessSpousesOf.get(explicitCoreSpouse.id)!.push(p);
      }
    }
  }

  // Assign each child to its primary tree parent (always preferring Victoria's bloodline)
  for (const p of activeList) {
    if (coParentIds.has(p.id)) continue;
    const validParents = (p.parents || []).filter(
      (pid) => activeSet.has(pid) && pid !== p.id && !coParentIds.has(pid)
    );
    const chosenParent =
      validParents.find((pid) => pid === 'victoria') ||
      validParents.find((pid) => coreSet.has(pid)) ||
      validParents[0];
    if (chosenParent && childrenMap.has(chosenParent)) {
      childrenMap.get(chosenParent)!.push(p);
      primaryParentOf.set(p.id, chosenParent);
    }
  }

  // Sort children chronologically and keep each co-parent union contiguous
  // so undated or later children never split an existing union medallion.
  for (const [parentId, kids] of childrenMap.entries()) {
    kids.sort((a, b) => getBirthSortKey(a) - getBirthSortKey(b));
    const grouped = new Map<string, Person[]>();
    for (const k of kids) {
      const coParentKey =
        (k.parents || []).find((pid) => pid !== parentId && byId.has(pid)) || '';
      if (!grouped.has(coParentKey)) grouped.set(coParentKey, []);
      grouped.get(coParentKey)!.push(k);
    }
    childrenMap.set(parentId, Array.from(grouped.values()).flat());
  }

  // Precompute total descendants count for each person
  const descendantCountMap = new Map<string, number>();
  function countDesc(id: string, visited = new Set<string>()): number {
    if (visited.has(id)) return 0;
    visited.add(id);
    const kids = childrenMap.get(id) || [];
    let total = kids.length;
    for (const k of kids) {
      total += countDesc(k.id, visited);
    }
    descendantCountMap.set(id, total);
    return total;
  }
  activeList.forEach((p) => countDesc(p.id));

  // Helper: check if a child has any visible children of its own
  function hasVisibleChildren(personId: string): boolean {
    if (collapsedIds.has(personId)) return false;
    return (childrenMap.get(personId) || []).length > 0;
  }

  // Determine if a parent's visible children should be stacked vertically (in vertical orientation)
  // We stack when in vertical mode, depth >= 1 (so Victoria's 5 main branches always stay horizontal),
  // and the parent has >= 2 visible children that are all leaf nodes sharing the same union.
  function shouldStackChildrenVertically(parentId: string, depth: number, visibleKids: Person[]): boolean {
    if (isHorizontal) return false;
    if (depth < 1) return false;
    if (parentId === 'victoria') return false;
    if (visibleKids.length < 2) return false;
    const allLeaves = visibleKids.every((k) => !hasVisibleChildren(k.id));
    if (!allLeaves) return false;
    const firstParentsKey = (visibleKids[0].parents || []).slice().sort().join('|');
    const sameUnion = visibleKids.every(
      (k) => (k.parents || []).slice().sort().join('|') === firstParentsKey
    );
    return sameUnion;
  }

  // Find root nodes (core bloodline roots first, then any separate belle-famille roots)
  const roots = activeList
    .filter((p) => !coParentIds.has(p.id) && !primaryParentOf.has(p.id))
    .sort((a, b) => Number(coreSet.has(b.id)) - Number(coreSet.has(a.id)));

  // Measure span of each subtree along the breadth axis (X in vertical, Y in horizontal)
  const nodeUnitSpan = isHorizontal ? cardHeight : cardWidth;
  const subtreeSpan = new Map<string, number>();

  function measureSubtree(id: string, depth = 0, visited = new Set<string>()): number {
    if (visited.has(id)) return nodeUnitSpan;
    visited.add(id);
    const isCollapsed = collapsedIds.has(id);
    const kids = isCollapsed ? [] : childrenMap.get(id) || [];
    if (kids.length === 0) {
      subtreeSpan.set(id, nodeUnitSpan);
      return nodeUnitSpan;
    }

    if (shouldStackChildrenVertically(id, depth, kids)) {
      const hasSpouseOnStacked =
        settings.showSpouses &&
        kids.some((k) => (childlessSpousesOf.get(k.id)?.length || 0) > 0);
      const stackedSpan = cardWidth + stackSpineIndent + (hasSpouseOnStacked ? 184 : 0);
      subtreeSpan.set(id, stackedSpan);
      kids.forEach((k) => subtreeSpan.set(k.id, nodeUnitSpan));
      return stackedSpan;
    }

    let total = 0;
    kids.forEach((k, idx) => {
      total += measureSubtree(k.id, depth + 1, new Set(visited));
      if (idx < kids.length - 1) {
        const nextKid = kids[idx + 1];
        const sameParents =
          (k.parents || []).slice().sort().join('|') ===
          (nextKid.parents || []).slice().sort().join('|');
        total += sameParents ? siblingGap : branchGap;
      }
    });
    const span = Math.max(nodeUnitSpan, total);
    subtreeSpan.set(id, span);
    return span;
  }

  roots.forEach((r) => measureSubtree(r.id, 0));

  const nodes: PositionedNode[] = [];
  const partners: PositionedPartner[] = [];
  const edges: LayoutEdge[] = [];
  const visitedLayout = new Set<string>();
  const maxDepthSeen = { val: 0 };

  function pushPersonNode(
    person: Person,
    x: number,
    y: number,
    depth: number,
    allKids: Person[],
    isCollapsed: boolean
  ) {
    const coParentSet = new Set<string>();
    for (const k of allKids) {
      for (const pid of k.parents || []) {
        if (pid !== person.id && byId.has(pid)) {
          coParentSet.add(pid);
        }
      }
    }
    for (const sid of person.spouses || []) {
      if (sid !== person.id && byId.has(sid)) {
        coParentSet.add(sid);
      }
    }
    const coParentsList = Array.from(coParentSet)
      .map((id) => byId.get(id)!)
      .filter(Boolean);

    const branchId = resolveBranchId(person.id, byId, activeList);

    nodes.push({
      id: person.id,
      person,
      x,
      y,
      width: cardWidth,
      height: cardHeight,
      depth,
      branchId,
      childCount: allKids.length,
      descendantCount: descendantCountMap.get(person.id) || 0,
      isCollapsed,
      coParents: coParentsList,
      isInLaw: !coreSet.has(person.id),
    });
  }

  function layoutSubtree(person: Person, startBreadth: number, depth: number): number {
    if (visitedLayout.has(person.id)) return startBreadth + nodeUnitSpan / 2;
    visitedLayout.add(person.id);
    maxDepthSeen.val = Math.max(maxDepthSeen.val, depth);

    const span = subtreeSpan.get(person.id) || nodeUnitSpan;
    const isCollapsed = collapsedIds.has(person.id);
    const allKids = childrenMap.get(person.id) || [];
    const visibleKids = isCollapsed ? [] : allKids;
    const isStacked = shouldStackChildrenVertically(person.id, depth, visibleKids);

    let centerBreadth = startBreadth + span / 2;
    const levelCoord = (isHorizontal ? padX : padY) + depth * levelStep;

    if (isStacked) {
      // Parent centered at top of column; children stacked vertically below with a left spine
      const hasSpouseOnStacked =
        settings.showSpouses &&
        visibleKids.some((k) => (childlessSpousesOf.get(k.id)?.length || 0) > 0);
      const columnCenter = hasSpouseOnStacked
        ? startBreadth + (cardWidth + stackSpineIndent) / 2
        : centerBreadth;
      const parentX = columnCenter - cardWidth / 2;
      const parentY = levelCoord;
      const branchId = resolveBranchId(person.id, byId, activeList);

      pushPersonNode(person, parentX, parentY, depth, allKids, isCollapsed);

      maxDepthSeen.val = Math.max(maxDepthSeen.val, depth + 1);
      const childStartLevelY = padY + (depth + 1) * levelStep;

      let anchorX = parentX + cardWidth / 2;
      let anchorY = parentY + cardHeight;

      // Check if there is a co-parent medallion to place on the union stem
      const otherParentId = (visibleKids[0].parents || []).find(
        (pid) => pid !== person.id && byId.has(pid)
      );
      const coParent = otherParentId ? byId.get(otherParentId) : undefined;

      if (settings.showSpouses && coParent && coParentIds.has(coParent.id)) {
        const pw = 168;
        const ph = 36;
        const midY = parentY + cardHeight + (childStartLevelY - (parentY + cardHeight)) * 0.42;
        const px = anchorX - pw / 2;
        const py = midY - ph / 2;

        partners.push({
          id: `${person.id}-union-${coParent.id}`,
          person: coParent,
          primaryParentId: person.id,
          x: px,
          y: py,
          width: pw,
          height: ph,
          depth,
        });

        edges.push({
          id: `e-${person.id}-partner-${coParent.id}`,
          fromId: person.id,
          toId: coParent.id,
          x1: anchorX,
          y1: anchorY,
          x2: px + pw / 2,
          y2: py,
          branchId,
          isPartnerLink: true,
        });

        anchorX = px + pw / 2;
        anchorY = py + ph;
      }

      const childCardX = startBreadth + stackSpineIndent;
      const spineX = childCardX - 12;
      const elbowY = childStartLevelY - 16;

      visibleKids.forEach((k, idx) => {
        visitedLayout.add(k.id);
        const ky = childStartLevelY + idx * (cardHeight + stackVerticalGap);
        const kAllKids = childrenMap.get(k.id) || [];
        const kCollapsed = collapsedIds.has(k.id);
        const childBranch = resolveBranchId(k.id, byId, activeList);

        pushPersonNode(k, childCardX, ky, depth + 1, kAllKids, kCollapsed);

        edges.push({
          id: `e-${person.id}-${k.id}`,
          fromId: person.id,
          toId: k.id,
          x1: anchorX,
          y1: anchorY,
          x2: childCardX,
          y2: ky + cardHeight / 2,
          branchId: childBranch,
          isStackedSpine: true,
          spineX,
          elbowY,
        });

        if (settings.showSpouses) {
          const childSpouses = childlessSpousesOf.get(k.id) || [];
          childSpouses.forEach((sp, spIdx) => {
            const pw = 168;
            const ph = 36;
            const px = childCardX + cardWidth + 16;
            const py = ky + (cardHeight - ph) / 2 + spIdx * (ph + 6);
            partners.push({
              id: `${k.id}-spouse-${sp.id}`,
              person: sp,
              primaryParentId: k.id,
              x: px,
              y: py,
              width: pw,
              height: ph,
              depth: depth + 1,
            });
            edges.push({
              id: `e-${k.id}-spouse-${sp.id}`,
              fromId: k.id,
              toId: sp.id,
              x1: childCardX + cardWidth,
              y1: ky + cardHeight / 2,
              x2: px,
              y2: py + ph / 2,
              branchId: childBranch,
              isPartnerLink: true,
            });
          });
        }
      });

      return centerBreadth;
    }

    // Standard horizontal/vertical tree branching for non-stacked children
    const childCenters: { child: Person; center: number }[] = [];
    if (visibleKids.length > 0) {
      let cursor = startBreadth;
      const totalKidsSpan = visibleKids.reduce((acc, k, idx) => {
        const kSpan = subtreeSpan.get(k.id) || nodeUnitSpan;
        let gap = 0;
        if (idx < visibleKids.length - 1) {
          const nextK = visibleKids[idx + 1];
          const sameParents =
            (k.parents || []).slice().sort().join('|') ===
            (nextK.parents || []).slice().sort().join('|');
          gap = sameParents ? siblingGap : branchGap;
        }
        return acc + kSpan + gap;
      }, 0);

      if (totalKidsSpan < span) {
        cursor += (span - totalKidsSpan) / 2;
      }

      visibleKids.forEach((k, idx) => {
        const kSpan = subtreeSpan.get(k.id) || nodeUnitSpan;
        const cCenter = layoutSubtree(k, cursor, depth + 1);
        childCenters.push({ child: k, center: cCenter });
        cursor += kSpan;
        if (idx < visibleKids.length - 1) {
          const nextK = visibleKids[idx + 1];
          const sameParents =
            (k.parents || []).slice().sort().join('|') ===
            (nextK.parents || []).slice().sort().join('|');
          cursor += sameParents ? siblingGap : branchGap;
        }
      });

      centerBreadth =
        (childCenters[0].center + childCenters[childCenters.length - 1].center) / 2;
    }

    const x = isHorizontal ? levelCoord : centerBreadth - cardWidth / 2;
    const y = isHorizontal ? centerBreadth - cardHeight / 2 : levelCoord;
    const branchId = resolveBranchId(person.id, byId, activeList);

    pushPersonNode(person, x, y, depth, allKids, isCollapsed);

    if (visibleKids.length === 0 && settings.showSpouses) {
      const leafSpouses = childlessSpousesOf.get(person.id) || [];
      leafSpouses.forEach((sp, spIdx) => {
        const pw = 168;
        const ph = 36;
        const px = isHorizontal
          ? x + cardWidth + 16
          : x + cardWidth / 2 - pw / 2;
        const py = isHorizontal
          ? y + (cardHeight - ph) / 2 + spIdx * (ph + 6)
          : y + cardHeight + 14 + spIdx * (ph + 6);
        partners.push({
          id: `${person.id}-spouse-${sp.id}`,
          person: sp,
          primaryParentId: person.id,
          x: px,
          y: py,
          width: pw,
          height: ph,
          depth,
        });
        edges.push({
          id: `e-${person.id}-spouse-${sp.id}`,
          fromId: person.id,
          toId: sp.id,
          x1: isHorizontal ? x + cardWidth : x + cardWidth / 2,
          y1: isHorizontal ? y + cardHeight / 2 : y + cardHeight,
          x2: isHorizontal ? px : px + pw / 2,
          y2: isHorizontal ? py + ph / 2 : py,
          branchId,
          isPartnerLink: true,
        });
      });
    }

    // Group visible children by their secondary parent (if any) so we can show union medallions cleanly
    if (visibleKids.length > 0) {
      const unionGroups: { coParent?: Person; children: { child: Person; center: number }[] }[] = [];
      for (const item of childCenters) {
        const otherParentId = (item.child.parents || []).find(
          (pid) => pid !== person.id && byId.has(pid)
        );
        const coParent = otherParentId ? byId.get(otherParentId) : undefined;
        const lastGroup = unionGroups[unionGroups.length - 1];
        if (lastGroup && lastGroup.coParent?.id === coParent?.id) {
          lastGroup.children.push(item);
        } else {
          unionGroups.push({ coParent, children: [item] });
        }
      }

      for (const group of unionGroups) {
        const groupCenter =
          (group.children[0].center + group.children[group.children.length - 1].center) / 2;

        let anchorX = isHorizontal ? x + cardWidth : x + cardWidth / 2;
        let anchorY = isHorizontal ? y + cardHeight / 2 : y + cardHeight;

        if (settings.showSpouses && group.coParent && coParentIds.has(group.coParent.id)) {
          const pw = 168;
          const ph = 36;
          const midLevel =
            levelCoord +
            (isHorizontal ? cardWidth : cardHeight) +
            (levelStep - (isHorizontal ? cardWidth : cardHeight)) * 0.42;
          const px = isHorizontal ? midLevel - pw / 2 : groupCenter - pw / 2;
          const py = isHorizontal ? groupCenter - ph / 2 : midLevel - ph / 2;

          partners.push({
            id: `${person.id}-union-${group.coParent.id}`,
            person: group.coParent,
            primaryParentId: person.id,
            x: px,
            y: py,
            width: pw,
            height: ph,
            depth,
          });

          edges.push({
            id: `e-${person.id}-partner-${group.coParent.id}`,
            fromId: person.id,
            toId: group.coParent.id,
            x1: anchorX,
            y1: anchorY,
            x2: isHorizontal ? px : px + pw / 2,
            y2: isHorizontal ? py + ph / 2 : py,
            branchId,
            isPartnerLink: true,
          });

          anchorX = isHorizontal ? px + pw : px + pw / 2;
          anchorY = isHorizontal ? py + ph / 2 : py + ph;
        }

        for (const { child, center } of group.children) {
          const childLevelCoord = (isHorizontal ? padX : padY) + (depth + 1) * levelStep;
          const cx = isHorizontal ? childLevelCoord : center;
          const cy = isHorizontal ? center : childLevelCoord;
          const childBranch = resolveBranchId(child.id, byId, activeList);

          edges.push({
            id: `e-${person.id}-${child.id}`,
            fromId: person.id,
            toId: child.id,
            x1: anchorX,
            y1: anchorY,
            x2: cx,
            y2: cy,
            branchId: childBranch,
          });
        }
      }
    }

    return centerBreadth;
  }

  let rootCursor = isHorizontal ? padY : padX;
  roots.forEach((root) => {
    const rSpan = subtreeSpan.get(root.id) || nodeUnitSpan;
    layoutSubtree(root, rootCursor, 0);
    rootCursor += rSpan + branchGap * 1.4;
  });

  // Compute canvas dimensions
  let maxX = 680;
  let maxY = 480;
  for (const n of nodes) {
    maxX = Math.max(maxX, n.x + n.width + padX);
    maxY = Math.max(maxY, n.y + n.height + padY);
  }
  for (const p of partners) {
    maxX = Math.max(maxX, p.x + p.width + padX);
    maxY = Math.max(maxY, p.y + p.height + padY);
  }

  const generationBands: GenerationBand[] = [];
  for (let d = 0; d <= maxDepthSeen.val; d++) {
    generationBands.push({
      depth: d,
      coord: (isHorizontal ? padX : padY) + d * levelStep,
      size: isHorizontal ? cardWidth : cardHeight,
    });
  }

  return {
    nodes,
    partners,
    edges,
    generationBands,
    width: maxX,
    height: maxY,
    cardWidth,
    cardHeight,
  };
}

export function buildEdgeSvgPath(
  edge: LayoutEdge,
  orientation: 'vertical' | 'horizontal',
  edgeStyle: 'bezier' | 'orthogonal'
): string {
  const { x1, y1, x2, y2 } = edge;

  // Clean architectural spine path for vertically stacked leaf siblings
  if (edge.isStackedSpine && edge.spineX !== undefined && edge.elbowY !== undefined) {
    const sx = edge.spineX;
    const ey = edge.elbowY;
    const r = 8;
    const dirX = sx < x1 ? -1 : 1;
    if (Math.abs(x1 - sx) < 4) {
      return `M ${x1} ${y1} L ${sx} ${y2 - r} Q ${sx} ${y2} ${sx + r} ${y2} L ${x2} ${y2}`;
    }
    return [
      `M ${x1} ${y1}`,
      `L ${x1} ${ey - r}`,
      `Q ${x1} ${ey} ${x1 + dirX * r} ${ey}`,
      `L ${sx - dirX * r} ${ey}`,
      `Q ${sx} ${ey} ${sx} ${ey + r}`,
      `L ${sx} ${y2 - r}`,
      `Q ${sx} ${y2} ${sx + r} ${y2}`,
      `L ${x2} ${y2}`,
    ].join(' ');
  }

  if (orientation === 'vertical') {
    if (edgeStyle === 'orthogonal') {
      const midY = y1 + (y2 - y1) * 0.52;
      const r = Math.min(10, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 4);
      if (Math.abs(x2 - x1) < 2) {
        return `M ${x1} ${y1} L ${x2} ${y2}`;
      }
      const dirX = x2 > x1 ? 1 : -1;
      return `M ${x1} ${y1} L ${x1} ${midY - r} Q ${x1} ${midY} ${x1 + dirX * r} ${midY} L ${x2 - dirX * r} ${midY} Q ${x2} ${midY} ${x2} ${midY + r} L ${x2} ${y2}`;
    }
    const dy = (y2 - y1) * 0.55;
    return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
  } else {
    if (edgeStyle === 'orthogonal') {
      const midX = x1 + (x2 - x1) * 0.52;
      const r = Math.min(10, Math.abs(y2 - y1) / 2, Math.abs(x2 - x1) / 4);
      if (Math.abs(y2 - y1) < 2) {
        return `M ${x1} ${y1} L ${x2} ${y2}`;
      }
      const dirY = y2 > y1 ? 1 : -1;
      return `M ${x1} ${y1} L ${midX - r} ${y1} Q ${midX} ${y1} ${midX} ${y1 + dirY * r} L ${midX} ${y2 - dirY * r} Q ${midX} ${y2} ${midX + r} ${y2} L ${x2} ${y2}`;
    }
    const dx = (x2 - x1) * 0.55;
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }
}
