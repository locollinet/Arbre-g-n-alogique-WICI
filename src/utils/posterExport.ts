import { Person, TreeSettings, getInitials } from '../data/wiciFamily';
import { computeTreeLayout, buildEdgeSvgPath } from './treeLayout';

const xml = (value: string | undefined) => (value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// Portable, self-contained artwork: the SVG contains every displayed person,
// union and portrait rather than taking a screenshot of the visible viewport.
export function buildPosterSvg(people: Person[], settings: TreeSettings): { svg: string; width: number; height: number } {
  if (people.some(p => p.photo && !p.photo.startsWith('data:image/'))) throw new Error('Certains portraits externes ne peuvent pas être intégrés : réenregistrez-les dans l’atelier photo avant l’export.');
  const layout = computeTreeLayout(people, 'all', new Set(), { ...settings, showSpouses: true });
  const displayed = new Set([...layout.nodes.map(n => n.id), ...layout.partners.map(p => p.person.id)]);
  if (people.some(p => !displayed.has(p.id))) throw new Error('L’export ne peut pas représenter toutes les fiches. Vérifiez les liens familiaux avant de réessayer.');
  const pad = 100, heading = 100;
  const width = layout.width + 2 * pad, height = layout.height + 2 * pad + heading;
  const edges = layout.edges.map(e => `<path d="${buildEdgeSvgPath(e, settings.orientation, settings.edgeStyle)}" fill="none" stroke="#b7a185" stroke-width="1.7" stroke-linecap="round"/>`).join('');
  const nameLines = (text: string, max: number) => {
    const words = text.split(/\s+/); const lines: string[] = [];
    for (const word of words) { const last = lines[lines.length-1]; if (last && (last + ' ' + word).length <= max) lines[lines.length-1] += ' ' + word; else lines.push(word); }
    return lines;
  };
  const cards = layout.nodes.map((n, i) => {
    const p = n.person, dates = [p.birth, p.death].filter(Boolean).join(' – ');
    const lines = nameLines([p.first, p.last].filter(Boolean).join(' '), 19);
    const maxLines = Math.max(1, Math.floor((n.height - 30) / 17));
    const fontSize = lines.length > maxLines ? 11 : 14;
    const rendered = nameLines([p.first, p.last].filter(Boolean).join(' '), fontSize === 11 ? 25 : 19);
    const r = Math.min(24, n.height / 2 - 10), cy = n.height / 2, sr = r * 1.09;
    const photo = p.photo?.startsWith('data:image/') ? `<image x="${28-sr}" y="${cy-sr}" width="${sr*2}" height="${sr*2}" href="${xml(p.photo)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatar-${i})"/>` : `<text x="28" y="${cy+5}" text-anchor="middle" fill="#887660" font-family="Georgia,serif" font-size="14">${xml(getInitials(p))}</text>`;
    return `<g transform="translate(${n.x} ${n.y})"><rect width="${n.width}" height="${n.height}" rx="3" fill="#fffdfa" stroke="#ded3c3"/><defs><clipPath id="avatar-${i}"><circle cx="28" cy="${cy}" r="${r}"/></clipPath></defs><circle cx="28" cy="${cy}" r="${r}" fill="#f1ede6"/>${photo}<text x="60" y="${Math.max(16,cy - ((rendered.length-1)*fontSize*1.1)/2 - (dates ? 5 : 0))}" font-family="Georgia,serif" font-size="${fontSize}" fill="#302e2a">${rendered.map((s,j)=>`<tspan x="60" dy="${j ? fontSize*1.15 : 0}">${xml(s)}</tspan>`).join('')}</text>${dates ? `<text x="60" y="${n.height-9}" font-family="Arial,sans-serif" font-size="9" fill="#70685e">${xml(dates)}</text>` : ''}</g>`;
  }).join('');
  const partners = layout.partners.map((q,i) => {
    const p=q.person, r=13, cy=q.height/2, sr = r * 1.09;
    const photo=p.photo?.startsWith('data:image/') ? `<image x="${18-sr}" y="${cy-sr}" width="${sr*2}" height="${sr*2}" href="${xml(p.photo)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#partner-${i})"/>` : `<text x="18" y="${cy+4}" text-anchor="middle" font-family="Georgia,serif" font-size="10" fill="#887660">${xml(getInitials(p))}</text>`;
    return `<g transform="translate(${q.x} ${q.y})"><rect width="${q.width}" height="${q.height}" rx="${q.height/2}" fill="#f3efe8" stroke="#ded3c3"/><defs><clipPath id="partner-${i}"><circle cx="18" cy="${cy}" r="${r}"/></clipPath></defs><circle cx="18" cy="${cy}" r="${r}" fill="#e8e0d5"/>${photo}<text x="36" y="${cy+4}" font-family="Arial,sans-serif" font-size="10" fill="#514a42">avec ${xml([p.first,p.last].filter(Boolean).join(' '))}</text></g>`;
  }).join('');
  const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#faf8f5"/><text x="${pad}" y="42" font-family="Arial,sans-serif" font-size="12" letter-spacing="3" fill="#8c7355">UNE HISTOIRE DE FAMILLE</text><text x="${pad}" y="84" font-family="Georgia,serif" font-size="38" fill="#302e2a">${xml(settings.familyName)}</text><text x="${width-pad}" y="75" text-anchor="end" font-family="Arial,sans-serif" font-size="12" fill="#85796c">${people.length} PERSONNES · UNE HISTOIRE À TRANSMETTRE</text><path d="M ${pad} 101 H ${width-pad}" stroke="#ded3c3"/><g transform="translate(${pad} ${heading+pad})">${edges}${cards}${partners}</g></svg>`;
  return { svg, width, height };
}
function download(blob: Blob, name: string) { const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url), 60000); }
export function exportPosterSvg(people: Person[], settings: TreeSettings) { const {svg}=buildPosterSvg(people,settings); download(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}),'arbre-des-wici.svg'); }
export async function exportPosterPng(people: Person[], settings: TreeSettings) {
  const {svg,width,height}=buildPosterSvg(people,settings); const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
  try { const img=new Image(); await new Promise<void>((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(new Error('Impossible de générer l’image.'));img.src=url;});
    const scale=Math.min(1, 5000/Math.max(width,height), Math.sqrt(12000000/(width*height))); const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));const ctx=canvas.getContext('2d');if(!ctx) throw new Error('Canvas indisponible.');ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Impossible de créer le PNG.')),'image/png'));download(blob,'arbre-des-wici.png');
  } finally {URL.revokeObjectURL(url);}
}
export function printPoster(people: Person[], settings: TreeSettings) {
  const { svg } = buildPosterSvg(people, settings);
  const existing = document.getElementById('poster-print-iframe');
  if (existing) existing.remove();
  const iframe = document.createElement('iframe');
  iframe.id = 'poster-print-iframe';
  iframe.setAttribute('style', 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;visibility:hidden;');
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document || iframe.contentDocument;
  if (!doc) throw new Error('Impossible d’ouvrir l’impression.');
  doc.open();
  doc.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Arbre des Wici</title><style>@page{size:landscape;margin:8mm}@media print{body{margin:0;background:#faf8f5}svg{display:block;width:100%;height:auto}}</style></head><body>${svg.replace(/^<\?xml[^?]*\?>/,'')}</body></html>`);
  doc.close();
  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      window.print();
    } finally {
      setTimeout(() => iframe.remove(), 60000);
    }
  }, 400);
}
