import { Person } from '../data/wiciFamily';

/** Reject malformed data and ancestry cycles before replacing or saving a tree. */
export function validatePeople(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return 'La sauvegarde ne contient aucune personne.';
  if (value.length > 10000) return 'La sauvegarde contient trop de personnes.';
  const ids = new Set<string>();
  for (const p of value) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !p.id.trim() || typeof p.first !== 'string' || !p.first.trim() || typeof p.last !== 'string' || !Array.isArray(p.parents) || !p.parents.every((id: unknown) => typeof id === 'string') || (p.spouses !== undefined && (!Array.isArray(p.spouses) || !p.spouses.every((id:unknown)=>typeof id === 'string')))) return 'Une fiche est incomplète ou mal formée.';
    if (ids.has(p.id)) return 'Deux fiches ont le même identifiant.';
    for (const field of ['birth','death','location','occupation','notes','photo','maidenName']) if (p[field] !== undefined && typeof p[field] !== 'string') return `Champ ${field} invalide.`;
    ids.add(p.id);
  }
  const people = value as Person[];
  for (const p of people) {
    if (new Set(p.parents).size !== p.parents.length || p.parents.some(id=>!ids.has(id))) return `Parents invalides ou manquants pour ${p.first}.`;
    if ((p.spouses || []).some(id=>!ids.has(id) || id===p.id)) return `Conjoint invalide pour ${p.first}.`;
  }
  const byId=new Map(people.map(p=>[p.id,p])); const visiting=new Set<string>();const done=new Set<string>();
  const visit=(id:string):boolean=>{if(visiting.has(id))return false;if(done.has(id))return true;visiting.add(id);for(const parent of byId.get(id)!.parents)if(!visit(parent))return false;visiting.delete(id);done.add(id);return true;};
  return people.every(p=>visit(p.id)) ? null : 'Cette modification crée une boucle de filiation.';
}
