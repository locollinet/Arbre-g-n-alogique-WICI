import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, INITIAL_WICI_PEOPLE, type Person } from '../src/data/wiciFamily';
import { computeTreeLayout } from '../src/utils/treeLayout';
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
