export interface Person {
  id: string;
  first: string;
  last: string;
  maidenName?: string;
  birth?: string;
  death?: string;
  location?: string;
  occupation?: string;
  parents: string[];
  spouses?: string[];
  photo?: string;
  notes?: string;
}

export interface TreeSettings {
  familyName: string;
  subtitle: string;
  motto: string;
  orientation: 'vertical' | 'horizontal';
  cardStyle: 'editorial' | 'minimal' | 'medallion';
  edgeStyle: 'bezier' | 'orthogonal';
  palette: 'ivory-bronze' | 'porcelain-cypress' | 'alabaster-slate';
  showGenerations: boolean;
  showSpouses: boolean;
  showDates: boolean;
  showInitialsAvatar: boolean;
  showMinimap: boolean;
  compactSpacing: boolean;
}

export const DEFAULT_SETTINGS: TreeSettings = {
  familyName: "L’Arbre des Wici",
  subtitle: "Archives & Lignée Familiale",
  motto: "Chaque lien raconte une histoire, de génération en génération.",
  orientation: 'vertical',
  cardStyle: 'editorial',
  edgeStyle: 'bezier',
  palette: 'ivory-bronze',
  showGenerations: true,
  showSpouses: true,
  showDates: true,
  showInitialsAvatar: true,
  showMinimap: true,
  compactSpacing: false,
};

export const INITIAL_WICI_PEOPLE: Person[] = [
  // GÉNÉRATION I — LES FONDATEURS
  {
    id: "victoria",
    first: "Victoria",
    last: "Tripel",
    birth: "1914",
    death: "1997",
    parents: [],
    spouses: ["fiodor", "aloisi"],
    notes: "Matriarche à l'origine des cinq grandes branches de la famille (Lydia, Flore, Peter, Thérèse et Régine)."
  },
  {
    id: "fiodor",
    first: "Fiodor",
    last: "Belawski",
    birth: "",
    death: "",
    parents: [],
    spouses: ["victoria"],
    notes: "Père de Lydia et Flore. Dates de naissance et de décès à compléter."
  },
  {
    id: "aloisi",
    first: "Aloïsi",
    last: "Wicikowski",
    birth: "1915",
    death: "1972",
    parents: [],
    spouses: ["victoria"],
    notes: "Père de Peter (Pierre), Thérèse et Régine."
  },

  // GÉNÉRATION II — LES CINQ BRANCHES
  {
    id: "lydia",
    first: "Lydia",
    last: "Pêcheux-Wicikowski",
    birth: "1936",
    death: "2012",
    parents: ["victoria", "fiodor"],
    notes: "Branche aînée issue de Victoria Tripel et Fiodor Belawski. Mère de Sophie, Julie et Valentine."
  },
  {
    id: "flore",
    first: "Flore",
    last: "Pilon",
    birth: "1939",
    death: "",
    parents: ["victoria", "fiodor"],
    notes: "Seconde branche issue de Victoria Tripel et Fiodor Belawski. Mère de Laurence, Frédéric et Hubert."
  },
  {
    id: "peter",
    first: "Peter (Pierre)",
    last: "Wicikowski",
    birth: "1946",
    death: "201?",
    parents: ["victoria", "aloisi"],
    notes: "Branche issue de Victoria Tripel et Aloïsi Wicikowski. Père de Nicolas, Justine et Alexis. Année exacte de décès (201?) à préciser."
  },
  {
    id: "therese",
    first: "Thérèse",
    last: "Sailly",
    birth: "1949",
    death: "",
    parents: ["victoria", "aloisi"],
    notes: "Branche issue de Victoria Tripel et Aloïsi Wicikowski. Mère d'Alexandra et Charlotte."
  },
  {
    id: "regine",
    first: "Régine",
    last: "Simon",
    birth: "1949",
    death: "1979",
    parents: ["victoria", "aloisi"],
    notes: "Branche issue de Victoria Tripel et Aloïsi Wicikowski. Mère d'Alexandre Simon."
  },

  // GÉNÉRATION III — LES PETITS-ENFANTS
  // Enfants de Lydia
  {
    id: "sophie",
    first: "Sophie",
    last: "Pécheux",
    birth: "1959",
    parents: ["lydia"]
  },
  {
    id: "julie",
    first: "Julie",
    last: "Pêcheux",
    birth: "1964",
    parents: ["lydia"]
  },
  {
    id: "valentine",
    first: "Valentine",
    last: "Péresson",
    birth: "1971",
    parents: ["lydia"]
  },

  // Enfants de Flore
  {
    id: "laurence",
    first: "Laurence",
    last: "Crespel",
    birth: "1961",
    parents: ["flore"]
  },
  {
    id: "frederic",
    first: "Frédéric",
    last: "Pilon",
    birth: "1964",
    parents: ["flore"]
  },
  {
    id: "hubert",
    first: "Hubert",
    last: "Pilon",
    birth: "1966",
    parents: ["flore"]
  },

  // Enfants de Peter (Pierre)
  {
    id: "nicolas",
    first: "Nicolas",
    last: "Wicikowski",
    birth: "1978",
    parents: ["peter"],
    notes: "Dans le schéma PDF d'origine, deux emplacements supplémentaires d'enfants figurent sous Hugo."
  },
  {
    id: "justine",
    first: "Justine",
    last: "Wicikowski",
    birth: "1984",
    parents: ["peter"]
  },
  {
    id: "alexis",
    first: "Alexis",
    last: "Wicikowski",
    birth: "2003",
    parents: ["peter"]
  },

  // Enfants de Thérèse
  {
    id: "alexandra",
    first: "Alexandra",
    last: "Lambert",
    birth: "1976",
    parents: ["therese"]
  },
  {
    id: "charlotte",
    first: "Charlotte",
    last: "Golay",
    birth: "1979",
    parents: ["therese"]
  },

  // Enfant de Régine
  {
    id: "alexandre",
    first: "Alexandre",
    last: "Simon",
    birth: "1977",
    parents: ["regine"]
  },

  // GÉNÉRATION IV — LES ARRIÈRE-PETITS-ENFANTS
  // Branche Lydia -> Sophie, Julie, Valentine
  {
    id: "romane",
    first: "Romane",
    last: "",
    birth: "2000",
    parents: ["sophie"]
  },
  {
    id: "louis",
    first: "Louis",
    last: "Collinet",
    birth: "1993",
    parents: ["julie"]
  },
  {
    id: "jeanne",
    first: "Jeanne-Julie",
    last: "Collinet",
    birth: "1997",
    parents: ["julie"]
  },
  {
    id: "victoria2",
    first: "Victoria",
    last: "Péresson",
    birth: "2001",
    parents: ["valentine"]
  },
  {
    id: "clementine",
    first: "Clémentine",
    last: "Péresson",
    birth: "2004",
    parents: ["valentine"]
  },
  {
    id: "jean",
    first: "Jean",
    last: "Péresson",
    birth: "2007",
    parents: ["valentine"]
  },

  // Branche Flore -> Laurence, Frédéric
  {
    id: "gaelle",
    first: "Gaelle",
    last: "Crespel",
    birth: "1988",
    parents: ["laurence"]
  },
  {
    id: "marie",
    first: "Marie",
    last: "Gonzalez",
    birth: "1989",
    parents: ["laurence"]
  },
  {
    id: "antoine",
    first: "Antoine",
    last: "Crespel",
    birth: "1993",
    parents: ["laurence"]
  },
  {
    id: "arthur",
    first: "Arthur",
    last: "Pilon",
    birth: "1994",
    parents: ["frederic"]
  },
  {
    id: "victor",
    first: "Victor",
    last: "Pilon",
    birth: "1996",
    parents: ["frederic"]
  },
  {
    id: "lucie",
    first: "Lucie",
    last: "Pilon",
    birth: "1998",
    parents: ["frederic"]
  },

  // Branche Peter -> Nicolas
  {
    id: "hugo",
    first: "Hugo",
    last: "Wicikowski",
    birth: "",
    parents: ["nicolas"],
    notes: "Année de naissance à compléter."
  },

  // Branche Thérèse -> Alexandra, Charlotte
  {
    id: "celestin",
    first: "Célestin",
    last: "Lambert",
    birth: "2005",
    parents: ["alexandra"]
  },
  {
    id: "clemence",
    first: "Clémence",
    last: "Lambert",
    birth: "2007",
    parents: ["alexandra"]
  },
  {
    id: "antonin",
    first: "Antonin",
    last: "Lambert",
    birth: "2010",
    parents: ["alexandra"]
  },
  {
    id: "auguste",
    first: "Auguste",
    last: "Golay",
    birth: "2009",
    parents: ["charlotte"]
  },
  {
    id: "gustave",
    first: "Gustave",
    last: "Golay",
    birth: "2011",
    parents: ["charlotte"]
  },
  {
    id: "bertille",
    first: "Bertille",
    last: "Golay",
    birth: "2013",
    parents: ["charlotte"]
  },
  {
    id: "unknown2016",
    first: "Prénom à confirmer",
    last: "Golay",
    birth: "2016",
    parents: ["charlotte"],
    notes: "Indiqué « ? (2016) » sous Charlotte Golay dans l'arbre PDF initial."
  },

  // GÉNÉRATION V — LA NOUVELLE GÉNÉRATION
  // Enfants de Marie Gonzalez
  {
    id: "ines",
    first: "Inès",
    last: "",
    birth: "2017",
    parents: ["marie"]
  },
  {
    id: "salome",
    first: "Salomé",
    last: "",
    birth: "2018",
    parents: ["marie"]
  }
];

export const BRANCH_DEFINITIONS = [
  { id: 'all', label: 'Toute la lignée', founderId: 'victoria', subtitle: 'Les 5 générations réunies' },
  { id: 'lydia', label: 'Branche Lydia', founderId: 'lydia', subtitle: 'Pêcheux · Collinet · Péresson' },
  { id: 'flore', label: 'Branche Flore', founderId: 'flore', subtitle: 'Pilon · Crespel · Gonzalez' },
  { id: 'peter', label: 'Branche Peter', founderId: 'peter', subtitle: 'Wicikowski' },
  { id: 'therese', label: 'Branche Thérèse', founderId: 'therese', subtitle: 'Sailly · Lambert · Golay' },
  { id: 'regine', label: 'Branche Régine', founderId: 'regine', subtitle: 'Simon' },
];

export const GENERATION_LABELS: Record<number, { roman: string; title: string; era: string }> = {
  0: { roman: 'I', title: 'Les Fondateurs', era: '1914 – 1997' },
  1: { roman: 'II', title: 'Les Cinq Branches', era: '1936 – 1949' },
  2: { roman: 'III', title: 'Les Petits-Enfants', era: '1959 – 2003' },
  3: { roman: 'IV', title: 'Les Arrière-Petits-Enfants', era: '1988 – 2016' },
  4: { roman: 'V', title: 'La Cinquième Génération', era: '2017 – Présent' },
  5: { roman: 'VI', title: 'Sixième Génération', era: 'Futur' },
};

export function getFullName(person?: Person | null): string {
  if (!person) return '';
  return [person.first, person.last].filter(Boolean).join(' ');
}

export function getInitials(person?: Person | null): string {
  if (!person) return '?';
  const f = (person.first || '').trim().charAt(0);
  const l = (person.last || '').trim().charAt(0);
  return (f + l).toUpperCase() || '?';
}

export function getLifeDates(person?: Person | null): string {
  if (!person) return '';
  if (person.birth && person.death) return `${person.birth} – ${person.death}`;
  if (person.birth) return `Né(e) en ${person.birth}`;
  if (person.death) return `Décédé(e) en ${person.death}`;
  return 'Dates à compléter';
}

export function isPersonIncomplete(person: Person): boolean {
  if (!person.first || person.first.toLowerCase().includes('confirmer') || person.first.includes('?')) return true;
  if (!person.birth || person.birth.includes('?')) return true;
  if (person.death && person.death.includes('?')) return true;
  return false;
}
