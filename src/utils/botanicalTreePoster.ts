/**
 * Planche A3 « Arbre illustré ».
 *
 * Véritable dessin d’arbre généalogique : la personne fondatrice est portée par
 * le tronc, ses unions sont posées sur les racines, et chaque génération
 * s’épanouit en éventail sur des branches organiques effilées couvertes de
 * feuillage. Chaque membre est un médaillon (photo ou initiales) avec son nom
 * et ses dates. Le rendu est un SVG autonome calibré pour l’A3 à 300 DPI.
 */
import { Person, TreeSettings, getInitials, GENERATION_LABELS } from '../data/wiciFamily';

export interface BotanicalTreeOptions {
  orientation: 'landscape' | 'portrait';
  title?: string;
  subtitle?: string;
}

interface Pt {
  x: number;
  y: number;
}

interface TNode {
  person: Person;
  depth: number;
  parent: TNode | null;
  children: TNode[];
  leaves: number;
  weight: number;
  angle: number;
  rf: number;
  pos: Pt;
  lineage: number;
  spouses: Person[];
}

interface FounderSpouse {
  person: Person;
  childNames: string[];
  meanAngle: number;
  pos: Pt;
}

interface Geometry {
  W: number;
  H: number;
  cx: number;
  crownY: number;
  groundY: number;
  rx: number;
  ry: number;
  angStart: number;
  angEnd: number;
  trunkTopW: number;
  trunkBaseW: number;
  spouseDX: number;
  titleY: number;
}

interface TextLine {
  text: string;
  size: number;
  family: 'serif' | 'sans';
  fill: string;
  weight?: number;
  italic?: boolean;
  spacing?: number;
}

const SERIF = "'Cormorant Garamond', 'EB Garamond', Georgia, 'Times New Roman', serif";
const SANS = "'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif";

const INK = '#2A241D';
const INK_SOFT = '#5A4E40';
const GOLD = '#A8834F';
const GOLD_LIGHT = '#C9AE7C';
const PAPER = '#FBF7EE';

/** One harmonious palette per generation-II lineage (ring colour + foliage tones). */
const LINEAGES = [
  { ring: '#9A6A3A', light: '#F6EEE2', leaves: ['#6F8A4E', '#8FA060', '#5E7A45', '#A9A862'] },
  { ring: '#3E6A50', light: '#EDF3EE', leaves: ['#4C7A57', '#6C9470', '#3B6447', '#87AC82'] },
  { ring: '#35587A', light: '#EDF2F7', leaves: ['#557C73', '#77998F', '#456B66', '#90AFA3'] },
  { ring: '#9A4E40', light: '#F8EDEA', leaves: ['#8A8A4A', '#A99A58', '#B07C4A', '#768049'] },
  { ring: '#6C4F78', light: '#F3EEF5', leaves: ['#71805A', '#8E9070', '#62714D', '#A39B80'] },
  { ring: '#8A7A3A', light: '#F6F2E4', leaves: ['#6E8650', '#8C9C5E', '#5C7444', '#A7A565'] },
];
const ROOT_STYLE = { ring: '#8C6A3E', light: '#F4ECDD', leaves: ['#6F8A4E', '#8FA060', '#5E7A45', '#A9A862'] };
const WOOD_BY_DEPTH = ['#4B3826', '#56412D', '#624C37', '#6E5841', '#7A644C', '#857057'];

const xml = (value: string | undefined | null) =>
  (value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const f = (n: number) => (Math.round(n * 10) / 10).toString();
const rad = (deg: number) => (deg * Math.PI) / 180;
const birthYear = (p: Person) => parseInt((p.birth || '').replace(/\D/g, ''), 10) || 9999;
const fullName = (p: Person) => [p.first, p.last].filter(Boolean).join(' ');
const shortFirst = (p: Person) => (p.first || '').replace(/\s*\(.*?\)\s*/g, ' ').trim().split(/\s+/)[0] || p.first;

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Small deterministic PRNG so the foliage is identical on every export. */
function seededRandom(seedText: string): () => number {
  let seed = hashString(seedText);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

function bezierTangent(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const x = 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x);
  const y = 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y);
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

/** Filled, tapered outline of a cubic bezier — gives branches a natural wooden taper. */
function taperedPath(p0: Pt, p1: Pt, p2: Pt, p3: Pt, w0: number, w1: number, steps = 30): string {
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = bezier(p0, p1, p2, p3, t);
    const d = bezierTangent(p0, p1, p2, p3, t);
    const w = (w0 + (w1 - w0) * Math.pow(t, 0.85)) / 2;
    left.push({ x: p.x - d.y * w, y: p.y + d.x * w });
    right.push({ x: p.x + d.y * w, y: p.y - d.x * w });
  }
  const end = right[right.length - 1];
  const capR = w1 / 2;
  return (
    `M${f(left[0].x)} ${f(left[0].y)}` +
    left.slice(1).map((p) => `L${f(p.x)} ${f(p.y)}`).join('') +
    `A${f(capR)} ${f(capR)} 0 0 1 ${f(end.x)} ${f(end.y)}` +
    right
      .slice(0, -1)
      .reverse()
      .map((p) => `L${f(p.x)} ${f(p.y)}`)
      .join('') +
    'Z'
  );
}

function curvePath(p0: Pt, p1: Pt, p2: Pt, p3: Pt): string {
  return `M${f(p0.x)} ${f(p0.y)}C${f(p1.x)} ${f(p1.y)} ${f(p2.x)} ${f(p2.y)} ${f(p3.x)} ${f(p3.y)}`;
}

function leafUse(at: Pt, angleDeg: number, size: number, fill: string, opacity: number): string {
  return `<use href="#bt-leaf" fill="${fill}" fill-opacity="${opacity.toFixed(2)}" transform="translate(${f(at.x)} ${f(
    at.y
  )}) rotate(${f(angleDeg)}) scale(${(size / 100).toFixed(3)})"/>`;
}

// ---------------------------------------------------------------------------
// Family structure
// ---------------------------------------------------------------------------

function buildFamilyTree(people: Person[]) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const kids = new Map<string, Person[]>();
  for (const p of people) {
    for (const pid of p.parents || []) {
      if (pid === p.id || !byId.has(pid)) continue;
      if (!kids.has(pid)) kids.set(pid, []);
      kids.get(pid)!.push(p);
    }
  }

  const countDescendants = (id: string) => {
    const seen = new Set<string>([id]);
    const queue = [id];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const k of kids.get(cur) || []) {
        if (!seen.has(k.id)) {
          seen.add(k.id);
          queue.push(k.id);
        }
      }
    }
    return seen.size - 1;
  };

  const parentless = people.filter((p) => !(p.parents || []).some((pid) => byId.has(pid) && pid !== p.id));
  let rootPerson = parentless[0] || people[0];
  let best = -1;
  for (const p of parentless) {
    const c = countDescendants(p.id);
    if (c > best) {
      best = c;
      rootPerson = p;
    }
  }

  // Breadth-first walk: every descendant is placed once, at its shallowest depth.
  const orderIndex = new Map(people.map((p, i) => [p.id, i]));
  const nodes = new Map<string, TNode>();
  const makeNode = (person: Person, depth: number, parent: TNode | null): TNode => ({
    person,
    depth,
    parent,
    children: [],
    leaves: 0,
    weight: 0,
    angle: 90,
    rf: 0,
    pos: { x: 0, y: 0 },
    lineage: -1,
    spouses: [],
  });
  const root = makeNode(rootPerson, 0, null);
  nodes.set(rootPerson.id, root);
  const queue: TNode[] = [root];
  while (queue.length) {
    const cur = queue.shift()!;
    const children = (kids.get(cur.person.id) || [])
      .filter((k) => !nodes.has(k.id))
      .sort(
        (a, b) =>
          birthYear(a) - birthYear(b) ||
          (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0)
      );
    for (const k of children) {
      if (nodes.has(k.id)) continue;
      const child = makeNode(k, cur.depth + 1, cur);
      cur.children.push(child);
      nodes.set(k.id, child);
      queue.push(child);
    }
  }

  // Spouses and co-parents (people outside the bloodline).
  const founderSpouses: FounderSpouse[] = [];
  const others: Person[] = [];
  for (const p of people) {
    if (nodes.has(p.id)) continue;
    const partners: string[] = [];
    for (const k of kids.get(p.id) || []) {
      for (const pid of k.parents || []) if (pid !== p.id && nodes.has(pid)) partners.push(pid);
    }
    for (const sid of p.spouses || []) if (nodes.has(sid)) partners.push(sid);
    for (const q of people) if (nodes.has(q.id) && (q.spouses || []).includes(p.id)) partners.push(q.id);

    if (partners.includes(root.person.id)) {
      const childNames = (kids.get(p.id) || [])
        .filter((k) => (k.parents || []).includes(root.person.id))
        .sort((a, b) => birthYear(a) - birthYear(b))
        .map(shortFirst);
      founderSpouses.push({ person: p, childNames, meanAngle: 90, pos: { x: 0, y: 0 } });
    } else if (partners.length > 0) {
      nodes.get(partners[0])!.spouses.push(p);
    } else {
      others.push(p);
    }
  }

  return { root, nodes, founderSpouses, others, kids };
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function geometryFor(orientation: 'landscape' | 'portrait'): Geometry {
  if (orientation === 'portrait') {
    return {
      W: 3508,
      H: 4960,
      cx: 1754,
      crownY: 3320,
      groundY: 4000,
      rx: 1350,
      ry: 2520,
      angStart: 175,
      angEnd: 5,
      trunkTopW: 170,
      trunkBaseW: 330,
      spouseDX: 860,
      titleY: 4600,
    };
  }
  return {
    W: 4960,
    H: 3508,
    cx: 2480,
    crownY: 2170,
    groundY: 2770,
    rx: 2150,
    ry: 1900,
    angStart: 175,
    angEnd: 5,
    trunkTopW: 170,
    trunkBaseW: 330,
    spouseDX: 1080,
    titleY: 3240,
  };
}

function computeWeights(n: TNode): void {
  if (n.children.length === 0) {
    n.leaves = 1;
    n.weight = n.depth <= 2 ? 1.2 : 1.0;
    return;
  }
  n.children.forEach(computeWeights);
  const gap = n.depth === 0 ? 0.95 : n.depth === 1 ? 0.28 : 0.16;
  n.leaves = n.children.reduce((s, c) => s + c.leaves, 0);
  const childSum = n.children.reduce((s, c) => s + c.weight, 0) + gap * (n.children.length - 1);
  const minByDepth = n.depth === 1 ? 1.8 : n.depth === 2 ? 1.2 : 1.0;
  n.weight = Math.max(minByDepth, childSum);
}

function assignAngles(n: TNode, a0: number, a1: number): void {
  if (n.children.length === 0) {
    n.angle = (a0 + a1) / 2;
    return;
  }
  const gap = n.depth === 0 ? 0.95 : n.depth === 1 ? 0.28 : 0.16;
  const rawTotal = n.children.reduce((s, c) => s + c.weight, 0) + gap * (n.children.length - 1);
  const unit = (a0 - a1) / rawTotal;
  let cursor = a0;
  for (const c of n.children) {
    const span = c.weight * unit;
    assignAngles(c, cursor, cursor - span);
    cursor -= span + gap * unit;
  }
  n.angle = (n.children[0].angle + n.children[n.children.length - 1].angle) / 2;
}

function medallionRadius(depth: number): number {
  return [118, 88, 72, 62, 56][Math.min(depth, 4)];
}

function lineageStyle(n: TNode) {
  return n.lineage < 0 ? ROOT_STYLE : LINEAGES[n.lineage % LINEAGES.length];
}

// ---------------------------------------------------------------------------
// Text blocks
// ---------------------------------------------------------------------------

function measureLine(l: TextLine): number {
  const factor = l.family === 'sans' ? 0.6 : 0.5;
  return l.text.length * (l.size * factor + (l.spacing || 0));
}

function blockSize(lines: TextLine[]) {
  const w = Math.max(...lines.map(measureLine));
  const h = lines.reduce((s, l) => s + l.size * 1.2, 0);
  return { w, h };
}

function renderBlock(lines: TextLine[], center: Pt, plate: boolean): string {
  const { w, h } = blockSize(lines);
  let y = center.y - h / 2;
  let out = '';
  if (plate) {
    out += `<rect x="${f(center.x - w / 2 - 22)}" y="${f(y - 12)}" width="${f(w + 44)}" height="${f(
      h + 22
    )}" rx="18" fill="${PAPER}" fill-opacity="0.86"/>`;
  }
  for (const l of lines) {
    y += l.size * 1.2;
    const baseline = y - l.size * 0.28;
    out += `<text x="${f(center.x)}" y="${f(baseline)}" text-anchor="middle" font-family="${
      l.family === 'serif' ? SERIF : SANS
    }" font-size="${l.size}"${l.weight ? ` font-weight="${l.weight}"` : ''}${l.italic ? ' font-style="italic"' : ''}${
      l.spacing ? ` letter-spacing="${l.spacing}"` : ''
    } fill="${l.fill}">${xml(l.text)}</text>`;
  }
  return out;
}

function personLines(p: Person, depth: number, opts: { tag?: string; tagColor?: string; spouses?: Person[]; note?: string }): TextLine[] {
  const sizes = depth === 0 ? [58, 40, 30] : depth === 1 ? [46, 34, 28] : depth === 2 ? [40, 30, 26] : [36, 28, 24];
  const lines: TextLine[] = [];
  if (opts.tag) lines.push({ text: opts.tag.toUpperCase(), size: Math.round(sizes[2] * 0.85), family: 'sans', fill: opts.tagColor || GOLD, weight: 700, spacing: 4 });
  lines.push({ text: p.first || '—', size: sizes[0], family: 'serif', fill: INK, weight: 700 });
  if (p.last) lines.push({ text: p.last, size: sizes[1], family: 'serif', fill: INK_SOFT, weight: 500 });
  if (p.maidenName) lines.push({ text: `née ${p.maidenName}`, size: sizes[2], family: 'serif', fill: INK_SOFT, italic: true });
  for (const s of opts.spouses || []) lines.push({ text: `∞ ${fullName(s)}`, size: sizes[2], family: 'serif', fill: INK_SOFT, italic: true });
  const dates = [p.birth, p.death].filter(Boolean).join(' – ');
  if (dates) lines.push({ text: dates, size: sizes[2], family: 'sans', fill: GOLD, weight: 600, spacing: 1 });
  if (opts.note) lines.push({ text: opts.note, size: sizes[2], family: 'serif', fill: INK_SOFT, italic: true });
  return lines;
}

// ---------------------------------------------------------------------------
// Drawing primitives
// ---------------------------------------------------------------------------

function renderMedallion(p: Person, c: Pt, r: number, ring: string, light: string, clipId: string): string {
  const photo = p.photo
    ? `<image x="${f(c.x - r)}" y="${f(c.y - r)}" width="${f(r * 2)}" height="${f(r * 2)}" href="${xml(
        p.photo
      )}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`
    : `<text x="${f(c.x)}" y="${f(c.y + r * 0.24)}" text-anchor="middle" font-family="${SERIF}" font-size="${f(
        r * 0.72
      )}" font-style="italic" font-weight="600" fill="${ring}">${xml(getInitials(p))}</text>`;
  return (
    `<g>` +
    `<circle cx="${f(c.x + 4)}" cy="${f(c.y + 8)}" r="${f(r + 13)}" fill="#2A1E12" fill-opacity="0.16"/>` +
    `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(r + 13)}" fill="${PAPER}" stroke="${ring}" stroke-width="5"/>` +
    `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(r + 5)}" fill="none" stroke="${GOLD_LIGHT}" stroke-width="2.2"/>` +
    `<clipPath id="${clipId}"><circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(r)}"/></clipPath>` +
    `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(r)}" fill="${light}"/>` +
    photo +
    `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(r)}" fill="none" stroke="${ring}" stroke-opacity="0.55" stroke-width="2"/>` +
    `</g>`
  );
}

function cornerSprig(x: number, y: number, dirX: number, dirY: number): string {
  const base = Math.atan2(dirY, dirX) * (180 / Math.PI);
  let out = `<circle cx="${f(x)}" cy="${f(y)}" r="9" fill="${GOLD}"/>`;
  const sprigs = [
    { a: base - 28, s: 74, c: '#6F8A4E' },
    { a: base + 28, s: 74, c: '#8FA060' },
    { a: base, s: 92, c: '#5E7A45' },
    { a: base - 62, s: 52, c: '#A9A862' },
    { a: base + 62, s: 52, c: '#A9A862' },
  ];
  for (const s of sprigs) out += leafUse({ x, y }, s.a, s.s, s.c, 0.85);
  return out;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildBotanicalTreeSvg(
  people: Person[],
  settings: TreeSettings,
  options: BotanicalTreeOptions
): { svg: string; width: number; height: number } {
  const g = geometryFor(options.orientation);
  const { W, H, cx, crownY, groundY } = g;
  const { root, nodes, founderSpouses, others } = buildFamilyTree(people);
  const rand = seededRandom(`${people.length}-${root.person.id}`);

  // 1. Angular & radial layout of the crown
  computeWeights(root);
  assignAngles(root, g.angStart, g.angEnd);
  root.children.forEach((c, i) => {
    const mark = (n: TNode) => {
      n.lineage = i;
      n.children.forEach(mark);
    };
    mark(c);
  });

  const all = Array.from(nodes.values());
  const maxDepth = Math.max(1, ...all.map((n) => n.depth));
  for (const n of all) {
    if (n.depth === 0) {
      n.rf = 0;
    } else if (maxDepth <= 3) {
      n.rf = 0.38 + ((n.depth - 1) * 0.52) / Math.max(1, maxDepth - 1);
    } else {
      // With 5 generations (depths 0..4) where depth 3 holds most leaves and depth 4 crowns the top:
      const baseByDepth = [0, 0.36, 0.62, 0.88, 1.0];
      n.rf = baseByDepth[Math.min(n.depth, 4)];
      if (n.depth === 2 && n.children.length === 0) n.rf = 0.74;
      if (n.depth === 3 && n.children.length > 0) n.rf = 0.78;
    }
  }
  // Gentle radial alternation along the outer leaf arc so adjacent sibling medallions never kiss
  const outerLeaves = all.filter((n) => n.children.length === 0 && n.depth >= 3).sort((a, b) => b.angle - a.angle);
  outerLeaves.forEach((n, idx) => {
    if (n.depth === 3) {
      n.rf += idx % 2 === 0 ? -0.025 : 0.03;
    }
  });

  const placeAt = (angle: number, rf: number): Pt => ({
    x: cx + rf * g.rx * Math.cos(rad(angle)),
    y: crownY - rf * g.ry * Math.sin(rad(angle)),
  });
  for (const n of all) n.pos = n.depth === 0 ? { x: cx, y: crownY + (groundY - crownY) * 0.46 } : placeAt(n.angle, n.rf);

  // Founders’ unions on the roots: left / right according to their children.
  for (const s of founderSpouses) {
    const childAngles = root.children
      .filter((c) => (c.person.parents || []).includes(s.person.id))
      .map((c) => c.angle);
    s.meanAngle = childAngles.length ? childAngles.reduce((a, b) => a + b, 0) / childAngles.length : 90;
  }
  founderSpouses.sort((a, b) => b.meanAngle - a.meanAngle);
  founderSpouses.forEach((s, i) => {
    let side: number;
    let rank: number;
    if (founderSpouses.length === 1) {
      side = s.meanAngle >= 90 ? -1 : 1;
      rank = 0;
    } else {
      const half = Math.ceil(founderSpouses.length / 2);
      side = i < half ? -1 : 1;
      rank = side < 0 ? half - 1 - i : i - half;
    }
    s.pos = { x: cx + side * (g.spouseDX + rank * 420), y: groundY + 70 + rank * 30 };
  });

  const wood: string[] = [];
  const bark: string[] = [];
  const foliage: string[] = [];
  const medallions: string[] = [];
  const labels: string[] = [];
  let clipCounter = 0;
  const nextClip = (id: string) => `bt-clip-${++clipCounter}-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const thickness = (n: TNode) => 14 + 11 * Math.sqrt(n.leaves);

  // 2. Branches (thickest first so finer twigs overlay them)
  const branchNodes = all.filter((n) => n.parent).sort((a, b) => a.depth - b.depth);
  for (const n of branchNodes) {
    const parent = n.parent!;
    const style = lineageStyle(n);
    let p0: Pt;
    let p1: Pt;
    const p3 = n.pos;
    const uChild = { x: Math.cos(rad(n.angle)), y: -Math.sin(rad(n.angle)) };
    let w0: number;
    if (parent.depth === 0) {
      const idx = root.children.indexOf(n);
      const count = root.children.length;
      p0 = { x: cx + ((idx + 0.5) / count - 0.5) * g.trunkTopW * 0.9, y: crownY + 40 };
      const len = Math.hypot(p3.x - p0.x, p3.y - p0.y);
      const dir = { x: (p3.x - p0.x) / len, y: (p3.y - p0.y) / len };
      const v = { x: dir.x * 0.45, y: dir.y * 0.45 - 0.55 };
      const vl = Math.hypot(v.x, v.y);
      p1 = { x: p0.x + (v.x / vl) * len * 0.42, y: p0.y + (v.y / vl) * len * 0.42 };
      w0 = thickness(n) * 1.45;
    } else {
      p0 = parent.pos;
      const uParent = { x: Math.cos(rad(parent.angle)), y: -Math.sin(rad(parent.angle)) };
      const len0 = Math.hypot(p3.x - p0.x, p3.y - p0.y);
      p1 = { x: p0.x + uParent.x * len0 * 0.42, y: p0.y + uParent.y * len0 * 0.42 };
      w0 = thickness(n) * 1.1;
    }
    const len = Math.hypot(p3.x - p0.x, p3.y - p0.y);
    const p2 = { x: p3.x - uChild.x * len * 0.36, y: p3.y - uChild.y * len * 0.36 };
    const w1 = Math.max(9, thickness(n) * 0.5);
    const woodColor = WOOD_BY_DEPTH[Math.min(n.depth, WOOD_BY_DEPTH.length - 1)];
    wood.push(`<path d="${taperedPath(p0, p1, p2, p3, w0, w1)}" fill="${woodColor}"/>`);
    bark.push(`<path d="${curvePath(p0, p1, p2, p3)}" fill="none" stroke="#E9D9BF" stroke-opacity="0.22" stroke-width="${f(Math.max(2, w1 * 0.22))}" stroke-linecap="round"/>`);

    // Foliage along the branch
    const leafCount = Math.max(2, Math.floor(len / 95));
    for (let i = 0; i < leafCount; i++) {
      const t = 0.22 + (0.72 * (i + rand() * 0.6)) / leafCount;
      const at = bezier(p0, p1, p2, p3, t);
      const tan = bezierTangent(p0, p1, p2, p3, t);
      const side = i % 2 === 0 ? 1 : -1;
      const wHere = (w0 + (w1 - w0) * t) / 2;
      const base = { x: at.x - tan.y * wHere * side * 0.8, y: at.y + tan.x * wHere * side * 0.8 };
      const tanDeg = Math.atan2(tan.y, tan.x) * (180 / Math.PI);
      const angle = tanDeg + side * (38 + rand() * 30);
      const size = (n.depth <= 1 ? 58 : 48) + rand() * 22;
      const color = style.leaves[Math.floor(rand() * style.leaves.length)];
      foliage.push(leafUse(base, angle, size, color, 0.82 + rand() * 0.15));
    }
  }

  // Leaf crowns around each medallion
  for (const n of all) {
    if (n.depth === 0) continue;
    const style = lineageStyle(n);
    const r = medallionRadius(n.depth);
    const outward = n.angle;
    const count = n.children.length === 0 ? 9 : 6;
    for (let i = 0; i < count; i++) {
      const spread = n.children.length === 0 ? 260 : 200;
      const a = outward - spread / 2 + (spread * (i + 0.5)) / count + (rand() - 0.5) * 14;
      const at = { x: n.pos.x + Math.cos(rad(a)) * (r + 2), y: n.pos.y - Math.sin(rad(a)) * (r + 2) };
      const size = 46 + rand() * 30;
      const color = style.leaves[Math.floor(rand() * style.leaves.length)];
      foliage.push(leafUse(at, -a + (rand() - 0.5) * 20, size, color, 0.8 + rand() * 0.15));
    }
  }

  // 3. Trunk, roots and ground
  const h = groundY - crownY;
  const tl = cx - g.trunkTopW / 2;
  const tr = cx + g.trunkTopW / 2;
  const bl = cx - g.trunkBaseW / 2;
  const br = cx + g.trunkBaseW / 2;
  const trunk =
    `<path d="M${f(tl)} ${f(crownY)}C${f(tl - 16)} ${f(crownY + h * 0.45)} ${f(tl + 22)} ${f(groundY - h * 0.28)} ${f(bl)} ${f(
      groundY
    )}Q${f(cx)} ${f(groundY + 30)} ${f(br)} ${f(groundY)}C${f(tr - 22)} ${f(groundY - h * 0.28)} ${f(tr + 16)} ${f(
      crownY + h * 0.45
    )} ${f(tr)} ${f(crownY)}Q${f(cx)} ${f(crownY - 46)} ${f(tl)} ${f(crownY)}Z" fill="url(#bt-trunk)"/>` +
    [-2, -1, 0, 1, 2]
      .map((k) => {
        const x0 = cx + k * g.trunkTopW * 0.17;
        const x1 = cx + k * g.trunkBaseW * 0.2;
        const wob = (rand() - 0.5) * 28;
        return `<path d="M${f(x0)} ${f(crownY + 34)}C${f(x0 + wob)} ${f(crownY + h * 0.35)} ${f(x1 - wob)} ${f(
          groundY - h * 0.35
        )} ${f(x1)} ${f(groundY - 18)}" fill="none" stroke="#2E2116" stroke-opacity="0.32" stroke-width="3.5" stroke-linecap="round"/>`;
      })
      .join('');

  let roots = '';
  for (const s of founderSpouses) {
    const side = s.pos.x < cx ? -1 : 1;
    const r = medallionRadius(1);
    const p0 = { x: cx + side * g.trunkBaseW * 0.3, y: groundY - 8 };
    const p1 = { x: p0.x + side * 170, y: groundY + 70 };
    const p2 = { x: s.pos.x - side * 280, y: s.pos.y + 14 };
    const p3 = { x: s.pos.x - side * r * 0.5, y: s.pos.y };
    roots += `<path d="${taperedPath(p0, p1, p2, p3, 62, 18)}" fill="${WOOD_BY_DEPTH[0]}"/>`;
  }
  for (let k = 0; k < 6; k++) {
    const side = k % 2 === 0 ? -1 : 1;
    const spread = 0.12 + (Math.floor(k / 2) * 0.16);
    const p0 = { x: cx + side * g.trunkBaseW * spread, y: groundY - 4 };
    const len = 150 + rand() * 120;
    const p3 = { x: p0.x + side * len * (0.6 + Math.floor(k / 2) * 0.25), y: groundY + 70 + rand() * 60 };
    const p1 = { x: p0.x + side * 30, y: groundY + 40 };
    const p2 = { x: p3.x - side * 60, y: p3.y - 10 };
    roots += `<path d="${taperedPath(p0, p1, p2, p3, 30, 4)}" fill="${WOOD_BY_DEPTH[0]}"/>`;
  }

  const groundHalf = g.spouseDX + 520;
  let ground =
    `<ellipse cx="${f(cx)}" cy="${f(groundY + 40)}" rx="${f(groundHalf * 0.75)}" ry="70" fill="#5B4632" fill-opacity="0.07"/>` +
    `<path d="M${f(cx - groundHalf)} ${f(groundY + 34)}Q${f(cx)} ${f(groundY + 4)} ${f(cx + groundHalf)} ${f(
      groundY + 34
    )}" fill="none" stroke="#8C7756" stroke-opacity="0.55" stroke-width="3"/>`;
  for (let i = 0; i < 26; i++) {
    const x = cx - groundHalf + 40 + ((groundHalf * 2 - 80) * (i + rand() * 0.5)) / 26;
    if (Math.abs(x - cx) < g.trunkBaseW * 0.7) continue;
    const t = (x - (cx - groundHalf)) / (groundHalf * 2);
    const y = groundY + 34 - 30 * 4 * t * (1 - t);
    const hh = 22 + rand() * 26;
    ground += `<path d="M${f(x - 10)} ${f(y)}Q${f(x - 6)} ${f(y - hh * 0.6)} ${f(x - 14)} ${f(y - hh)}M${f(x)} ${f(y)}Q${f(
      x + 2
    )} ${f(y - hh * 0.7)} ${f(x + 6)} ${f(y - hh * 1.15)}M${f(x + 10)} ${f(y)}Q${f(x + 12)} ${f(y - hh * 0.5)} ${f(
      x + 20
    )} ${f(y - hh * 0.8)}" fill="none" stroke="#6F8A4E" stroke-opacity="0.6" stroke-width="2.5" stroke-linecap="round"/>`;
  }

  // 4. Medallions & collision-free labels
  const circles: { id: string; x: number; y: number; r: number }[] = [
    ...all.map((n) => ({ id: n.person.id, x: n.pos.x, y: n.pos.y, r: medallionRadius(n.depth) + 15 })),
    ...founderSpouses.map((s) => ({ id: s.person.id, x: s.pos.x, y: s.pos.y, r: medallionRadius(1) + 15 })),
  ];
  interface PlacedLabel {
    ownerId: string;
    anchor: Pt;
    anchorR: number;
    lines: TextLine[];
    w: number;
    h: number;
    cx: number;
    cy: number;
    locked?: boolean;
  }
  const placedLabels: PlacedLabel[] = [];

  const rectCircleOverlap = (rx: number, ry: number, rw: number, rh: number, cx0: number, cy0: number, cr: number) => {
    const nx = Math.max(rx - rw / 2, Math.min(cx0, rx + rw / 2));
    const ny = Math.max(ry - rh / 2, Math.min(cy0, ry + rh / 2));
    const d = Math.hypot(cx0 - nx, cy0 - ny);
    return Math.max(0, cr - d);
  };
  const rectRectOverlap = (ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) => {
    const ox = Math.max(0, (aw + bw) / 2 + 10 - Math.abs(ax - bx));
    const oy = Math.max(0, (ah + bh) / 2 + 8 - Math.abs(ay - by));
    return ox > 0 && oy > 0 ? ox * oy : 0;
  };

  for (const n of all) {
    const style = lineageStyle(n);
    const r = medallionRadius(n.depth);
    medallions.push(renderMedallion(n.person, n.pos, r, style.ring, style.light, nextClip(n.person.id)));

    const tag = n.depth === 1 ? `Branche ${shortFirst(n.person)}` : undefined;
    const lines = personLines(n.person, n.depth, { tag, tagColor: style.ring, spouses: n.spouses });
    const { w: rawW, h: rawH } = blockSize(lines);
    const w = rawW + 44;
    const h = rawH + 22;

    if (n.depth === 0) {
      placedLabels.push({
        ownerId: n.person.id,
        anchor: n.pos,
        anchorR: r,
        lines,
        w,
        h,
        cx: n.pos.x,
        cy: n.pos.y + r + 24 + h / 2,
        locked: true,
      });
      continue;
    }

    const candidateAngles: number[] =
      n.children.length === 0
        ? [n.angle, n.angle - 10, n.angle + 10, n.angle - 20, n.angle + 20, n.angle - 32, n.angle + 32]
        : n.depth === 1
        ? [-90, -72, -108, -55, -125]
        : [
            -90,
            n.angle + 180,
            -65,
            -115,
            -40,
            -140,
            n.angle - 90,
            n.angle + 90,
            n.angle,
          ];

    let bestCenter: Pt = { x: n.pos.x, y: n.pos.y + r + 18 + h / 2 };
    let bestCost = Infinity;
    for (const aDeg of candidateAngles) {
      const u = { x: Math.cos(rad(aDeg)), y: -Math.sin(rad(aDeg)) };
      const ext = Math.abs(u.x) * (w / 2) + Math.abs(u.y) * (h / 2);
      const dist = r + 18 + ext;
      const cand = { x: n.pos.x + u.x * dist, y: n.pos.y + u.y * dist };
      let cost = candidateAngles.indexOf(aDeg) * 18;
      for (const c of circles) {
        if (c.id === n.person.id) continue;
        const ov = rectCircleOverlap(cand.x, cand.y, w, h, c.x, c.y, c.r + 8);
        if (ov > 0) cost += ov * ov * 40 + 5000;
      }
      for (const pl of placedLabels) {
        const ov = rectRectOverlap(cand.x, cand.y, w, h, pl.cx, pl.cy, pl.w, pl.h);
        if (ov > 0) cost += ov * 8 + 2000;
      }
      if (cost < bestCost) {
        bestCost = cost;
        bestCenter = cand;
      }
    }

    placedLabels.push({
      ownerId: n.person.id,
      anchor: n.pos,
      anchorR: r,
      lines,
      w,
      h,
      cx: bestCenter.x,
      cy: bestCenter.y,
    });
  }

  for (const s of founderSpouses) {
    const r = medallionRadius(1);
    medallions.push(renderMedallion(s.person, s.pos, r, ROOT_STYLE.ring, ROOT_STYLE.light, nextClip(s.person.id)));
    const note = s.childNames.length
      ? s.childNames.length === 1
        ? `Parent de ${s.childNames[0]}`
        : `Parent de ${s.childNames.slice(0, -1).join(', ')} & ${s.childNames[s.childNames.length - 1]}`
      : undefined;
    const lines = personLines(s.person, 1, { tag: `Union avec ${shortFirst(root.person)}`, tagColor: GOLD, note });
    const { w: rawW, h: rawH } = blockSize(lines);
    placedLabels.push({
      ownerId: s.person.id,
      anchor: s.pos,
      anchorR: r,
      lines,
      w: rawW + 44,
      h: rawH + 22,
      cx: s.pos.x,
      cy: s.pos.y + r + 20 + (rawH + 22) / 2,
      locked: true,
    });
  }

  // Gentle relaxation pass so no label touches any medallion or other label
  for (let iter = 0; iter < 50; iter++) {
    for (const pl of placedLabels) {
      if (pl.locked) continue;
      for (const c of circles) {
        const ov = rectCircleOverlap(pl.cx, pl.cy, pl.w, pl.h, c.x, c.y, c.r + 4);
        if (ov > 0) {
          const dx = pl.cx - c.x;
          const dy = pl.cy - c.y;
          const len = Math.hypot(dx, dy) || 1;
          pl.cx += (dx / len) * (ov * 0.65);
          pl.cy += (dy / len) * (ov * 0.65);
        }
      }
      for (const other of placedLabels) {
        if (other === pl) continue;
        const ox = (pl.w + other.w) / 2 + 8 - Math.abs(pl.cx - other.cx);
        const oy = (pl.h + other.h) / 2 + 6 - Math.abs(pl.cy - other.cy);
        if (ox > 0 && oy > 0) {
          if (ox < oy) {
            const dir = pl.cx >= other.cx ? 1 : -1;
            pl.cx += dir * ox * (other.locked ? 0.8 : 0.45);
          } else {
            const dir = pl.cy >= other.cy ? 1 : -1;
            pl.cy += dir * oy * (other.locked ? 0.8 : 0.45);
          }
        }
      }
      // Keep tethered to anchor medallion
      const adx = pl.cx - pl.anchor.x;
      const ady = pl.cy - pl.anchor.y;
      const alen = Math.hypot(adx, ady) || 1;
      const u = { x: adx / alen, y: ady / alen };
      const minD = pl.anchorR + 14 + Math.abs(u.x) * (pl.w / 2) + Math.abs(u.y) * (pl.h / 2);
      const maxD = minD + 42;
      if (alen < minD) {
        pl.cx = pl.anchor.x + u.x * minD;
        pl.cy = pl.anchor.y + u.y * minD;
      } else if (alen > maxD) {
        pl.cx = pl.anchor.x + u.x * maxD;
        pl.cy = pl.anchor.y + u.y * maxD;
      }
      // Strictly keep inside the inner gold border
      const minX = 115 + pl.w / 2;
      const maxX = W - 115 - pl.w / 2;
      const minY = 115 + pl.h / 2;
      const maxY = H - 115 - pl.h / 2;
      pl.cx = Math.max(minX, Math.min(maxX, pl.cx));
      pl.cy = Math.max(minY, Math.min(maxY, pl.cy));
    }
  }

  for (const pl of placedLabels) {
    labels.push(renderBlock(pl.lines, { x: pl.cx, y: pl.cy }, true));
  }

  // 5. Title cartouche, legends, frame
  const genCount = maxDepth + 1;
  const years = people.map(birthYear).filter((y) => y < 9999);
  const since = years.length ? Math.min(...years) : undefined;
  const title = options.title || settings.familyName || 'Notre arbre de famille';
  const subtitle =
    options.subtitle ||
    `${genCount} générations · ${people.length} membres${since ? ` · depuis ${since}` : ''}`;
  const ty = g.titleY;
  const titleSvg =
    `<text x="${f(cx)}" y="${f(ty - 150)}" text-anchor="middle" font-family="${SANS}" font-size="30" font-weight="700" letter-spacing="14" fill="${GOLD}">ARBRE GÉNÉALOGIQUE</text>` +
    `<text x="${f(cx)}" y="${f(ty)}" text-anchor="middle" font-family="${SERIF}" font-size="150" font-style="italic" font-weight="600" fill="${INK}">${xml(
      title
    )}</text>` +
    `<path d="M${f(cx - 420)} ${f(ty + 42)}H${f(cx - 40)}M${f(cx + 40)} ${f(ty + 42)}H${f(cx + 420)}" stroke="${GOLD_LIGHT}" stroke-width="2.5"/>` +
    leafUse({ x: cx, y: ty + 42 }, -150, 46, '#6F8A4E', 0.9) +
    leafUse({ x: cx, y: ty + 42 }, -30, 46, '#8FA060', 0.9) +
    `<circle cx="${f(cx)}" cy="${f(ty + 42)}" r="7" fill="${GOLD}"/>` +
    `<text x="${f(cx)}" y="${f(ty + 106)}" text-anchor="middle" font-family="${SERIF}" font-size="44" font-style="italic" fill="${INK_SOFT}">${xml(
      subtitle
    )}</text>`;

  // Branch legend (top-left)
  const legendX = 230;
  let legendY = 270;
  let legend = `<text x="${legendX}" y="${legendY}" font-family="${SANS}" font-size="28" font-weight="700" letter-spacing="10" fill="${GOLD}">LES BRANCHES</text>`;
  legendY += 30;
  root.children.forEach((c, i) => {
    const st = LINEAGES[i % LINEAGES.length];
    legendY += 66;
    const members = 1 + countSubtree(c);
    legend +=
      `<circle cx="${legendX + 22}" cy="${legendY - 14}" r="20" fill="${st.light}" stroke="${st.ring}" stroke-width="5"/>` +
      `<text x="${legendX + 62}" y="${legendY}" font-family="${SERIF}" font-size="44" font-weight="700" fill="${INK}">${xml(
        shortFirst(c.person)
      )}<tspan dx="16" font-size="34" font-weight="400" font-style="italic" fill="${INK_SOFT}">· ${members} membre${
        members > 1 ? 's' : ''
      }</tspan></text>`;
  });

  // Generation legend (top-right)
  const genX = W - 230;
  let genY = 270;
  let genLegend = `<text x="${genX}" y="${genY}" text-anchor="end" font-family="${SANS}" font-size="28" font-weight="700" letter-spacing="10" fill="${GOLD}">LES GÉNÉRATIONS</text>`;
  genY += 30;
  for (let d = 0; d <= maxDepth; d++) {
    const meta = GENERATION_LABELS[d] || { roman: `${d + 1}`, title: `Génération ${d + 1}`, era: '' };
    const count = all.filter((n) => n.depth === d).length + (d === 0 ? founderSpouses.length : 0);
    genY += 62;
    genLegend +=
      `<text x="${genX}" y="${genY}" text-anchor="end" font-family="${SERIF}" font-size="40" fill="${INK}"><tspan font-style="italic" font-weight="700" fill="${GOLD}">${xml(
        meta.roman
      )}</tspan>  ${xml(meta.title)} <tspan font-size="32" font-style="italic" fill="${INK_SOFT}">· ${count}</tspan></text>`;
  }

  const othersSvg = others.length
    ? `<text x="230" y="${H - 170}" font-family="${SERIF}" font-size="30" font-style="italic" fill="${INK_SOFT}">Également dans nos archives : ${xml(
        others.map(fullName).join(', ')
      )}</text>`
    : '';

  const now = new Date();
  const edition = now.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const a3Dim = options.orientation === 'portrait' ? '297 × 420 MM' : '420 × 297 MM';
  const footer =
    `<text x="230" y="${H - 118}" font-family="${SANS}" font-size="22" letter-spacing="5" fill="${GOLD}">FORMAT A3 · ${a3Dim}</text>` +
    `<text x="${W - 230}" y="${H - 118}" text-anchor="end" font-family="${SANS}" font-size="22" letter-spacing="5" fill="${GOLD}">${xml(
      `ÉDITION DE FAMILLE · ${edition.toUpperCase()}`
    )}</text>`;

  const frame =
    `<rect x="60" y="60" width="${W - 120}" height="${H - 120}" fill="none" stroke="${GOLD}" stroke-width="6"/>` +
    `<rect x="88" y="88" width="${W - 176}" height="${H - 176}" fill="none" stroke="${GOLD_LIGHT}" stroke-width="2"/>` +
    cornerSprig(88, 88, 1, 1) +
    cornerSprig(W - 88, 88, -1, 1) +
    cornerSprig(88, H - 88, 1, -1) +
    cornerSprig(W - 88, H - 88, -1, -1);

  const defs =
    `<defs>` +
    `<radialGradient id="bt-paper" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#FCF9F2"/><stop offset="0.7" stop-color="#F5EEDF"/><stop offset="1" stop-color="#EADDC4"/></radialGradient>` +
    `<linearGradient id="bt-trunk" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3A2A1B"/><stop offset="0.38" stop-color="#6A4F36"/><stop offset="0.58" stop-color="#7B5E43"/><stop offset="1" stop-color="#43311F"/></linearGradient>` +
    `<g id="bt-leaf"><path d="M0 0C28 -36 72 -32 100 0C72 32 28 36 0 0Z"/><path d="M4 0L90 0" fill="none" stroke="#24301A" stroke-opacity="0.28" stroke-width="2.4"/></g>` +
    `</defs>`;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
${defs}
<rect width="${W}" height="${H}" fill="url(#bt-paper)"/>
${frame}
<g>${ground}</g>
<g>${roots}</g>
<g>${wood.join('')}</g>
<g>${trunk}</g>
<g>${bark.join('')}</g>
<g>${foliage.join('')}</g>
<g>${medallions.join('')}</g>
<g>${labels.join('')}</g>
${titleSvg}
${legend}
${genLegend}
${othersSvg}
${footer}
</svg>`;

  return { svg, width: W, height: H };
}

function countSubtree(n: TNode): number {
  return n.children.reduce((s, c) => s + 1 + countSubtree(c), 0);
}
