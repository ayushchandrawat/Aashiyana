import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.HTMLElement = globalThis.HTMLElement ?? class {};
globalThis.customElements = globalThis.customElements ?? { define() {}, get() {} };


const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};

const { __test: tasks } = await import('../public/pages/tasks.js');

const KEY = 'aashiyana:recentTaskFilters';
const emptySet = { status: [], priority: [], assigned_to: [], category: [], tags: [] };

function withKnown({ categories = [], tags = [], users = [], loadError = null, fromCache = false } = {}) {
  store.clear();
  tasks.state.categories = categories.map((key) => ({ key, name: key, sort_order: 0 }));
  tasks.state.allTags = tags.map((tag) => ({ tag, count: 1 }));
  tasks.state.users = users.map((id) => ({ id, display_name: `U${id}` }));
  tasks.state.loadError = loadError;
  tasks.state.metaStale = { users: fromCache, categories: fromCache, tags: fromCache };
}

const put = (...sets) => store.set(KEY, JSON.stringify(sets.map((s) => ({ ...emptySet, ...s }))));
const raw = () => JSON.parse(store.get(KEY));

test('eine geloeschte Kategorie wird nicht mehr angeboten, der Rest des Sets bleibt', () => {
  withKnown({ categories: ['haushalt'] });
  put({ status: ['open'], category: ['garten', 'haushalt'] });

  const [set] = tasks.getRecentFilters();
  assert.deepEqual(set.category, ['haushalt'], 'der tote Key faellt weg');
  assert.deepEqual(set.status, ['open'], 'was noch gilt, bleibt stehen');
});

test('dieselbe Veraltung trifft Tags und Zustaendige, nicht nur Kategorien', () => {


  withKnown({ categories: ['haushalt'], tags: ['Garten'], users: [3] });
  put({ category: ['haushalt'], tags: ['garten', 'urlaub'], assigned_to: ['3', '9'] });

  const [set] = tasks.getRecentFilters();
  assert.deepEqual(set.tags, ['garten'], 'der Tag-Vergleich ignoriert die Schreibweise');
  assert.deepEqual(set.assigned_to, ['3'], 'das entfernte Mitglied faellt weg');
});

test('ein Set, von dem nichts uebrig bleibt, verschwindet ganz', () => {
  withKnown({ categories: ['haushalt'] });
  put({ category: ['garten'] }, { status: ['open'] });

  const sets = tasks.getRecentFilters();
  assert.equal(sets.length, 1, 'ein leeres Set waere eine Pille, die alles zuruecksetzt');
  assert.deepEqual(sets[0].status, ['open']);
});

test('Status und Prioritaet veralten nicht - sie sind Konstanten dieser Datei', () => {
  withKnown({});
  put({ status: ['open', 'done'], priority: ['high'] });

  const [set] = tasks.getRecentFilters();
  assert.deepEqual(set.status, ['open', 'done']);
  assert.deepEqual(set.priority, ['high']);
});

test('der Speicher wird nicht umgeschrieben - auch nicht beim naechsten Sichern', () => {
  withKnown({ categories: ['haushalt'] });
  put({ category: ['garten'] });

  // Lesen allein aendert nichts.
  tasks.getRecentFilters();
  assert.deepEqual(raw()[0].category, ['garten'], 'Lesen darf nicht schreiben');




  tasks.saveRecentFilter({ ...emptySet, status: ['done'] });
  const keys = raw().flatMap((f) => f.category);
  assert.ok(keys.includes('garten'), 'der gemerkte Wert ueberlebt das Sichern');


  tasks.state.categories.push({ key: 'garten', name: 'Garten', sort_order: 1 });
  assert.ok(tasks.getRecentFilters().some((f) => f.category.includes('garten')));
});

test('nach einem Ladefehler wird NICHT gefiltert', () => {



  withKnown({ loadError: new Error('500') });
  put({ category: ['garten'], tags: ['urlaub'], assigned_to: ['9'] });

  const [set] = tasks.getRecentFilters();
  assert.deepEqual(set.category, ['garten']);
  assert.deepEqual(set.tags, ['urlaub']);
  assert.deepEqual(set.assigned_to, ['9']);
});

test('zwei Sets, die nach dem Beschneiden gleich aussehen, geben EIN Chip', () => {





  withKnown({ categories: ['haushalt'] });
  put({ status: ['open'], category: ['garten'] }, { status: ['open'] });

  const sets = tasks.getRecentFilters();
  assert.equal(sets.length, 1, 'die Dublette gehoert weg');
  assert.deepEqual(sets[0].status, ['open']);


  // wieder zwei verschiedene Sets.
  assert.equal(raw().length, 2, 'entdoppelt wird die ANSICHT, nicht der Speicher');
  tasks.state.categories.push({ key: 'garten', name: 'Garten', sort_order: 1 });
  assert.equal(tasks.getRecentFilters().length, 2);
});

test('gegen Referenzlisten aus dem Offline-Cache wird NICHT gefiltert', () => {




  //




  withKnown({ categories: ['haushalt'], fromCache: true });
  put({ category: ['garten'], tags: ['urlaub'], assigned_to: ['9'] });

  const [set] = tasks.getRecentFilters();
  assert.deepEqual(set.category, ['garten'], 'der Cache darf kein Chip wegnehmen');
  assert.deepEqual(set.tags, ['urlaub']);
  assert.deepEqual(set.assigned_to, ['9']);


  tasks.state.metaStale = { users: false, categories: false, tags: false };
  assert.equal(tasks.getRecentFilters().length, 0, 'netzfrisch wird wieder beschnitten');
});

test('refreshTags haelt fest, ob die neue Tag-Liste nachweislich frisch ist', async () => {




  withKnown({ tags: ['garten'] });

  globalThis.__apiStub = { getWithSource: async () => ({ data: { data: [{ tag: 'garten', count: 1 }] }, fromCache: false }) };
  await tasks.refreshTags();
  assert.equal(tasks.state.metaStale.tags, false, 'netzfrisch');

  globalThis.__apiStub = { getWithSource: async () => ({ data: { data: [] }, fromCache: true }) };
  await tasks.refreshTags();
  assert.equal(tasks.state.metaStale.tags, true, 'aus dem Cache');

  globalThis.__apiStub = { getWithSource: async () => { throw new Error('offline'); } };
  tasks.state.metaStale = { users: false, categories: false, tags: false };
  const vorher = tasks.state.allTags;
  await tasks.refreshTags();
  assert.equal(tasks.state.metaStale.tags, true, 'ein Fehlschlag laesst die alte Liste stehen');
  assert.equal(tasks.state.allTags, vorher, 'und die alte Liste bleibt wirklich stehen');




  tasks.state.metaStale = { users: true, categories: true, tags: true };
  globalThis.__apiStub = { getWithSource: async () => ({ data: { data: [] }, fromCache: false }) };
  await tasks.refreshTags();
  assert.deepEqual(tasks.state.metaStale, { users: true, categories: true, tags: false },
    'eine frische Tag-Auffrischung sagt nichts ueber die anderen beiden Listen');

  delete globalThis.__apiStub;
});

test('eine stale Achse beschneidet nicht, die frischen schon', () => {

  // wegnehmen, waehrend frische Tags ihres sehr wohl beschneiden.
  withKnown({ categories: ['haushalt'], tags: ['garten'], users: [3] });
  tasks.state.metaStale = { users: false, categories: true, tags: false };
  put({ category: ['weg'], tags: ['weg'], assigned_to: ['9'] });

  const [set] = tasks.getRecentFilters();
  assert.deepEqual(set.category, ['weg'], 'die stale Kategorienliste faellt kein Urteil');
  assert.deepEqual(set.tags, [], 'die frische Tag-Liste beschneidet');
  assert.deepEqual(set.assigned_to, [], 'die frische Mitgliederliste ebenso');
});

test('ein Tag mit Komma kollidiert nicht mit zwei Tags', () => {
  // Codex-Befund P2 zu PR #1072, am Code nachgemessen: `normalizeTags`




  //



  withKnown({ tags: ['a,b', 'a', 'b'] });
  put({ tags: ['a,b'] }, { tags: ['a', 'b'] });

  assert.equal(tasks.getRecentFilters().length, 2,
    'zwei verschiedene Filter, zwei Chips');


  store.clear();
  tasks.saveRecentFilter({ ...emptySet, tags: ['a,b'] });
  tasks.saveRecentFilter({ ...emptySet, tags: ['a', 'b'] });
  assert.equal(raw().length, 2, 'beide Sets stehen im Speicher');
});

test('derselbe Filter verdraengt sich weiterhin selbst', () => {


  withKnown({ tags: ['garten', 'urlaub'] });
  store.clear();
  tasks.saveRecentFilter({ ...emptySet, tags: ['garten', 'urlaub'] });
  tasks.saveRecentFilter({ ...emptySet, tags: ['Urlaub', 'Garten'] });

  assert.equal(raw().length, 1, 'Reihenfolge und Schreibweise machen kein neues Set');
  assert.equal(tasks.getRecentFilters().length, 1);
});
