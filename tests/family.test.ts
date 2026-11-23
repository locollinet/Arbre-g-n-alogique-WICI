import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, INITIAL_WICI_PEOPLE, type Person } from '../src/data/wiciFamily';
import {
  computeTreeLayout,
  getKnownPartnerIds,
  getSiblingGroups,
  isCoreLineagePerson,
  resolveBranchId
} from '../src/utils/treeLayout';
import { validatePeople } from '../src/utils/validateFamily';
import { buildPosterSvg } from '../src/utils/posterExport';

test('les cinq enfants de Victoria ont les bons parents', () => {
  const children = INITIAL_WICI_PEOPLE.filter(p => p.parents.includes('victoria'));
  assert.equal(children.length, 5);
  for (const id of ['lydia', 'flore']) assert.deepEqual(new Set(children.find(p => p.id === id)?.parents), new Set(['victoria', 'fiodor']));
  for (const id of ['peter', 'therese', 'regine']) assert.deepEqual(new Set(children.find(p => p.id === id)?.parents), new Set(['victoria', 'aloisi']));
  assert.equal(validatePeople(INITIAL_WICI_PEOPLE), null);
});

test('les cycles, doublons et parents inexistants sont refusés', () => {
  const cycle = structuredClone(INITIAL_WICI_PEOPLE);
  cycle.find(p => p.id === 'victoria')!.parents = ['louis'];
  assert.match(validatePeople(cycle) || '', /boucle/);
  assert.match(validatePeople([...INITIAL_WICI_PEOPLE, INITIAL_WICI_PEOPLE[0]]) || '', /identifiant/);
  const invalid = structuredClone(INITIAL_WICI_PEOPLE);
  invalid[0].parents = ['inconnu'];
  assert.match(validatePeople(invalid) || '', /Parents invalides/);
});

test('affiche complète avec les deux co-parents et les portraits intégrés', () => {
  const people = structuredClone(INITIAL_WICI_PEOPLE);
  people[0].photo = 'data:image/png;base64,iVBORw0KGgo=';
  const layout = computeTreeLayout(people, 'all', new Set(), DEFAULT_SETTINGS);
  assert.equal(new Set([...layout.nodes.map(n => n.id), ...layout.partners.map(n => n.person.id)]).size, people.length);
  const {svg} = buildPosterSvg(people, DEFAULT_SETTINGS);
  for (const name of ['Fiodor Belawski', 'Aloïsi Wicikowski', 'Victoria', 'Salomé']) assert.ok(svg.includes(name), name);
  assert.ok(svg.includes('data:image/png;base64,'));
  people[0].photo = 'https://example.com/photo.png';
  assert.throws(() => buildPosterSvg(people, DEFAULT_SETTINGS), /portraits externes/);
});

test('les nouvelles générations ne sont pas limitées à cinq', () => {
  const extra: Person = { id: 'generation-six', first: 'Test', last: '', parents: ['ines'] };
  const people = [...INITIAL_WICI_PEOPLE, extra];
  assert.equal(validatePeople(people), null);
  assert.ok(computeTreeLayout(people, 'all', new Set(), DEFAULT_SETTINGS).nodes.some(n => n.id === extra.id));
});


test('un conjoint sans enfants ne disparaît pas de l’arbre exporté', () => {
  const people = structuredClone(INITIAL_WICI_PEOPLE);
  people.push({ id: 'conjoint-test', first: 'Conjoint', last: 'Test', parents: [], spouses: ['louis'] });
  people.find(p => p.id === 'louis')!.spouses = ['conjoint-test'];
  const layout = computeTreeLayout(people, 'all', new Set(), DEFAULT_SETTINGS);
  assert.ok([...layout.nodes.map(n => n.id), ...layout.partners.map(n => n.person.id)].includes('conjoint-test'));
  assert.ok(buildPosterSvg(people, DEFAULT_SETTINGS).svg.includes('Conjoint Test'));
});

test('l’arbre vertical empile les fratries terminales pour rester compact et lisible en entier', () => {
  const layout = computeTreeLayout(INITIAL_WICI_PEOPLE, 'all', new Set(), DEFAULT_SETTINGS);
  assert.ok(layout.width < 3400, `La largeur de l'arbre (${layout.width}px) doit être compacte (< 3400px)`);
  const louis = layout.nodes.find(n => n.id === 'louis')!;
  const jeanne = layout.nodes.find(n => n.id === 'jeanne')!;
  assert.equal(louis.x, jeanne.x);
  assert.ok(jeanne.y > louis.y);
});

test('les portraits au format data URL s’intègrent parfaitement sur les cartes de l’arbre', () => {
  const people = structuredClone(INITIAL_WICI_PEOPLE);
  people.find(p => p.id === 'flore')!.photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  const { svg } = buildPosterSvg(people, DEFAULT_SETTINGS);
  assert.ok(svg.includes('data:image/jpeg;base64,'));
  assert.ok(svg.includes('Flore'));
});

test('la planche photo A3 génère les bonnes dimensions et inclut tous les membres par branche', async () => {
  const { buildPhotoPosterSvg } = await import('../src/utils/photoPosterGenerator');
  const landscape = buildPhotoPosterSvg(INITIAL_WICI_PEOPLE, DEFAULT_SETTINGS, { orientation: 'landscape' });
  assert.equal(landscape.width, 4960);
  assert.equal(landscape.height, 3508);
  assert.ok(landscape.svg.includes('BRANCHE FLORE'));
  assert.ok(landscape.svg.includes('BRANCHE LYDIA'));
  assert.ok(landscape.svg.includes('Laurence'));
  assert.ok(landscape.svg.includes('Victoria'));
  assert.ok(landscape.svg.includes('bt-trunk'));
  assert.ok(landscape.svg.includes('bt-leaf'));
  for (const person of INITIAL_WICI_PEOPLE) {
    assert.ok(landscape.svg.includes(person.first), `Membre manquant sur l'arbre A3: ${person.first}`);
  }

  const portrait = buildPhotoPosterSvg(INITIAL_WICI_PEOPLE, DEFAULT_SETTINGS, { orientation: 'portrait' });
  assert.equal(portrait.width, 3508);
  assert.equal(portrait.height, 4960);
  assert.ok(portrait.svg.includes('BRANCHE FLORE'));

  const gallery = buildPhotoPosterSvg(INITIAL_WICI_PEOPLE, DEFAULT_SETTINGS, { orientation: 'landscape', style: 'gallery' });
  assert.equal(gallery.width, 4960);
  assert.equal(gallery.height, 3508);
  assert.ok(gallery.svg.includes('BRANCHE FLORE'));
});

test('détection des co-parents et séparation cohérente frères/sœurs vs demi-frères/demi-sœurs', () => {
  assert.deepEqual(getKnownPartnerIds('victoria', INITIAL_WICI_PEOPLE), ['fiodor', 'aloisi']);
  assert.deepEqual(getKnownPartnerIds('fiodor', INITIAL_WICI_PEOPLE), ['victoria']);
  assert.deepEqual(getKnownPartnerIds('aloisi', INITIAL_WICI_PEOPLE), ['victoria']);

  const withElsa: Person[] = [
    ...INITIAL_WICI_PEOPLE,
    { id: 'elsa', first: 'Elsa', last: '', birth: '1941', death: '1943', parents: ['victoria', 'fiodor'] },
  ];

  // Pour Elsa (Victoria + Fiodor) : Lydia & Flore sont sœurs germaines ; Peter, Thérèse, Régine sont demi-frères/sœurs
  const elsaSibs = getSiblingGroups(['victoria', 'fiodor'], 'elsa', withElsa);
  assert.deepEqual(elsaSibs.fullSiblings.map((p) => p.id), ['lydia', 'flore']);
  assert.deepEqual(elsaSibs.halfSiblings.map((h) => h.person.id), ['peter', 'therese', 'regine']);
  assert.deepEqual(elsaSibs.halfSiblings.map((h) => h.sharedParents.map((p) => p.id)), [['victoria'], ['victoria'], ['victoria']]);

  // Pour Flore : Lydia (1936) et Elsa (1941) sont ses sœurs germaines
  const floreSibs = getSiblingGroups(['victoria', 'fiodor'], 'flore', withElsa);
  assert.deepEqual(floreSibs.fullSiblings.map((p) => p.id), ['lydia', 'elsa']);
  assert.deepEqual(floreSibs.halfSiblings.map((h) => h.person.id), ['peter', 'therese', 'regine']);

  // Pour Peter (Victoria + Aloïsi) : Thérèse & Régine sont germaines ; Lydia, Flore, Elsa sont demi-sœurs
  const peterSibs = getSiblingGroups(['victoria', 'aloisi'], 'peter', withElsa);
  assert.deepEqual(peterSibs.fullSiblings.map((p) => p.id), ['therese', 'regine']);
  assert.deepEqual(peterSibs.halfSiblings.map((h) => h.person.id), ['lydia', 'flore', 'elsa']);

  // Si seul le parent maternel est coché, aucune sœur germaine tant que le père n'est pas précisé
  const motherOnlySibs = getSiblingGroups(['victoria'], 'elsa', withElsa);
  assert.deepEqual(motherOnlySibs.fullSiblings, []);
  assert.equal(motherOnlySibs.halfSiblings.length, 5);

  // Sans date de naissance sur un enfant de Fiodor, Fiodor reste un seul médaillon groupé à gauche d'Aloïsi
  const withUndatedFiodorChild: Person[] = [
    ...withElsa,
    { id: 'sans-date', first: 'SansDate', last: '', parents: ['victoria', 'fiodor'] },
  ];
  const layout = computeTreeLayout(withUndatedFiodorChild, 'all', new Set(), DEFAULT_SETTINGS);
  assert.equal(layout.partners.filter((p) => p.person.id === 'fiodor').length, 1);
  assert.equal(layout.partners.filter((p) => p.person.id === 'aloisi').length, 1);
  const elsaNode = layout.nodes.find((n) => n.id === 'elsa')!;
  const undatedNode = layout.nodes.find((n) => n.id === 'sans-date')!;
  const peterNode = layout.nodes.find((n) => n.id === 'peter')!;
  assert.ok(elsaNode.x < peterNode.x);
  assert.ok(undatedNode.x < peterNode.x);
});

test('distinction souche vs belle-famille et rattachement prioritaire sur la lignée Victoria', () => {
  assert.equal(isCoreLineagePerson('victoria', INITIAL_WICI_PEOPLE), true);
  assert.equal(isCoreLineagePerson('salome', INITIAL_WICI_PEOPLE), true);
  assert.equal(isCoreLineagePerson('fiodor', INITIAL_WICI_PEOPLE), false);
  assert.equal(isCoreLineagePerson('aloisi', INITIAL_WICI_PEOPLE), false);

  // Conjoint sans enfant rattaché en médaillon à son époux/épouse (pas en racine flottante)
  const withChildlessSpouse = structuredClone(INITIAL_WICI_PEOPLE);
  withChildlessSpouse.push({ id: 'conjoint-louis', first: 'Camille', last: 'Dupont', parents: [], spouses: ['louis'] });
  withChildlessSpouse.find((p) => p.id === 'louis')!.spouses = ['conjoint-louis'];
  const spouseLayout = computeTreeLayout(withChildlessSpouse, 'all', new Set(), DEFAULT_SETTINGS);
  assert.ok(spouseLayout.partners.some((p) => p.person.id === 'conjoint-louis' && p.primaryParentId === 'louis'));
  assert.equal(spouseLayout.nodes.some((n) => n.id === 'conjoint-louis'), false);

  // Belle-famille avec ses propres parents : l'enfant reste rattaché à la branche Victoria et la belle-famille est identifiée
  const withInLawBranch: Person[] = [
    ...INITIAL_WICI_PEOPLE,
    { id: 'pere-marc', first: 'Jean', last: 'Martin', parents: [] },
    { id: 'marc', first: 'Marc', last: 'Martin', parents: ['pere-marc'], spouses: ['sophie'] },
    { id: 'enfant-sophie', first: 'Léo', last: 'Martin', birth: '1990', parents: ['marc', 'sophie'] },
  ];
  const byId = new Map(withInLawBranch.map((p) => [p.id, p]));
  assert.equal(resolveBranchId('marc', byId, withInLawBranch), 'lydia');
  assert.equal(isCoreLineagePerson('marc', withInLawBranch), false);
  assert.equal(isCoreLineagePerson('enfant-sophie', withInLawBranch), true);

  const layout = computeTreeLayout(withInLawBranch, 'all', new Set(), DEFAULT_SETTINGS);
  assert.ok(layout.edges.some((e) => e.fromId === 'sophie' && e.toId === 'enfant-sophie'));
  assert.equal(layout.edges.some((e) => e.fromId === 'marc' && e.toId === 'enfant-sophie'), false);
  assert.equal(layout.nodes.find((n) => n.id === 'marc')?.isInLaw, true);
  assert.equal(layout.nodes.find((n) => n.id === 'pere-marc')?.isInLaw, true);
  assert.equal(layout.nodes.find((n) => n.id === 'enfant-sophie')?.isInLaw, false);
});

test('l’arbre illustré A3 et la galerie permettent de masquer ou afficher les conjoints', async () => {
  const { buildPhotoPosterSvg } = await import('../src/utils/photoPosterGenerator');
  const treeWithoutSpouses = buildPhotoPosterSvg(INITIAL_WICI_PEOPLE, DEFAULT_SETTINGS, {
    orientation: 'landscape',
    style: 'tree',
    showSpouses: false,
  });
  assert.equal(treeWithoutSpouses.svg.includes('Fiodor'), false);
  assert.equal(treeWithoutSpouses.svg.includes('Aloïsi'), false);
  assert.ok(treeWithoutSpouses.svg.includes('Victoria'));
  assert.ok(treeWithoutSpouses.svg.includes('Salomé'));

  const galleryWithoutSpouses = buildPhotoPosterSvg(INITIAL_WICI_PEOPLE, DEFAULT_SETTINGS, {
    orientation: 'landscape',
    style: 'gallery',
    showSpouses: false,
  });
  assert.equal(galleryWithoutSpouses.svg.includes('Fiodor'), false);
  assert.equal(galleryWithoutSpouses.svg.includes('Aloïsi'), false);
  assert.ok(galleryWithoutSpouses.svg.includes('Victoria'));
});

test('avec Elsa sans descendance, Hubert et Nicolas comblent le haut sans franchir l’axe central', async () => {
  const { buildBotanicalTreeSvg } = await import('../src/utils/botanicalTreePoster');
  const withElsa: Person[] = [
    ...INITIAL_WICI_PEOPLE.filter((p) => p.id !== 'enfant-nicolas'),
    { id: 'elsa', first: 'Elsa', last: 'Belawski', birth: '1941', death: '1943', parents: ['victoria', 'fiodor'] },
    { id: 'hugo', first: 'Hugo', last: 'Wicikowski', birth: '2016', parents: ['nicolas'] },
    { id: 'louise', first: 'Louise', last: 'Wicikowski', birth: '2018', parents: ['nicolas'] },
    { id: 'pauline', first: 'Pauline', last: 'Wicikowski', birth: '2020', parents: ['nicolas'] },
  ];

  const getMedallion = (svg: string, id: string) => {
    const m = svg.match(new RegExp(`clipPath id="bt-clip-\\d+-${id}"><circle cx="([\\d.]+)" cy="([\\d.]+)" r="([\\d.]+)"`));
    assert.ok(m, `Médaillon introuvable pour ${id}`);
    return { x: parseFloat(m[1]), y: parseFloat(m[2]), r: parseFloat(m[3]) };
  };

  for (const orientation of ['landscape', 'portrait'] as const) {
    const { svg, width } = buildBotanicalTreeSvg(withElsa, DEFAULT_SETTINGS, { orientation });
    const cx = width / 2;
    const elsa = getMedallion(svg, 'elsa');
    const hubert = getMedallion(svg, 'hubert');
    const nicolas = getMedallion(svg, 'nicolas');
    const hugo = getMedallion(svg, 'hugo');

    // Chacun reste strictement de son côté de l'axe vertical central
    assert.ok(hubert.x + hubert.r < cx, `${orientation}: Hubert ne doit pas franchir le centre`);
    assert.ok(nicolas.x - nicolas.r > cx, `${orientation}: Nicolas ne doit pas franchir le centre`);
    assert.ok(hugo.x - hugo.r > cx, `${orientation}: Hugo ne doit pas franchir le centre`);

    // Hubert se positionne bien au-dessus d'Elsa (proche horizontalement, nettement au-dessus)
    assert.ok(hubert.y < elsa.y - 400);
    assert.ok(Math.abs(hubert.x - elsa.x) < 120);
  }
});


