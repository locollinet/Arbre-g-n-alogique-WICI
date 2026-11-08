import React, { useState } from 'react';
import { Person, TreeSettings } from '../data/wiciFamily';
import { exportPosterPng, exportPosterSvg, printPoster } from '../utils/posterExport';

export function ExportControls({people,settings}:{people:Person[];settings:TreeSettings}) {
  const [open,setOpen]=useState(false); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  const run=async (action:()=>void|Promise<void>)=>{setError('');setBusy(true);try{await action();}catch(e){setError(e instanceof Error?e.message:'Export impossible.');}finally{setBusy(false);}};
  return <div className="relative shrink-0 z-20">
    <button type="button" aria-expanded={open} onClick={()=>setOpen(v=>!v)} className="min-h-[44px] px-4 bg-[#493e32] text-white text-xs font-medium hover:bg-[#302b25]">Partager l’arbre</button>
    {open && <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-[#ded3c3] shadow-lg p-3 space-y-2" role="group" aria-label="Partager l’arbre complet">
      <p className="font-serif text-lg">L’arbre complet</p><p className="text-xs text-[#61574d]">Toutes les personnes, leurs liens et portraits disponibles.</p>
      <button type="button" disabled={busy} onClick={()=>run(()=>exportPosterPng(people,settings))} className="w-full text-left min-h-[44px] px-3 bg-[#493e32] text-white text-xs">Télécharger l’image PNG</button>
      <button type="button" disabled={busy} onClick={()=>run(()=>printPoster(people,settings))} className="w-full text-left min-h-[44px] px-3 border border-[#ded3c3] text-xs">Imprimer / enregistrer en PDF</button>
      <button type="button" disabled={busy} onClick={()=>run(()=>exportPosterSvg(people,settings))} className="w-full text-left min-h-[44px] px-3 border border-[#ded3c3] text-xs">Télécharger le SVG</button>
      {error && <p role="alert" className="text-xs text-red-800">{error}</p>}
    </div>}
  </div>;
}
