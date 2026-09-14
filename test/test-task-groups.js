import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';




globalThis.HTMLElement = globalThis.HTMLElement ?? class {};
globalThis.customElements = globalThis.customElements ?? { define() {}, get() {} };

const { __test: tasks } = await import('../public/pages/tasks.js');

const task = (over = {}) => ({ id: 1, title: 'X', category: 'household', due_date: null, ...over });




const dateKey = (date) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const heute = () => dateKey(new Date());
const inTagen = (n) => dateKey(new Date(Date.now() + n * 86400000));

test('groupBy liefert Gruppen mit id, label und Aufgaben', () => {
  const groups = tasks.groupBy([task({ id: 1 }), task({ id: 2, category: 'school' })], 'category');
  assert.equal(groups.length, 2);
  for (const g of groups) {
    assert.ok(typeof g.id === 'string' && g.id.length > 0, 'jede Gruppe braucht eine id');
    assert.ok(typeof g.label === 'string', 'und ein Label');
    assert.ok(Array.isArray(g.tasks), 'und ihre Aufgaben');
  }
});

test('die id einer Kategorie ist ihr Schlüssel, nicht ihr übersetztes Label', () => {
  const [gruppe] = tasks.groupBy([task({ category: 'household' })], 'category');
  assert.equal(gruppe.id, 'household',
    'das Label kann "Haushalt" oder "Household" sein - gespeichert wird der Schlüssel');
});

test('die Fälligkeits-Gruppen tragen feste ids', () => {
  const groups = tasks.groupBy([
    task({ id: 1, due_date: inTagen(-3) }),
    task({ id: 2, due_date: heute() }),
    task({ id: 3, due_date: inTagen(30) }),
    task({ id: 4, due_date: null }),
  ], 'due');

  const ids = groups.map((g) => g.id);
  assert.deepEqual(ids, ['overdue', 'today', 'later', 'noDate'],
    'ids UND ihre fachliche Reihenfolge: überfällig zuerst, ohne Datum zuletzt');
  for (const g of groups) {
    assert.notEqual(g.id, g.label, 'wäre id === label, hinge der gespeicherte Zustand an der Sprache');
  }
});




// beiden Sortierungen nicht auseinanderhalten.
const CATEGORIES = [
  { key: 'household', name: null,     label_key: 'tasks.categoryHousehold', sort_order: 0 },
  { key: 'ca-rental', name: 'CA Rental', label_key: null,                   sort_order: 1 },
  { key: 'misc',      name: null,     label_key: 'tasks.categoryMisc',      sort_order: 2 },
  { key: 'finance',   name: 'Finance',   label_key: null,                   sort_order: 3 },
];

test('die Kategorie-Gruppen folgen der verwalteten Reihenfolge, nicht dem Alphabet', () => {


  const groups = tasks.groupBy([
    task({ id: 1, category: 'finance' }),
    task({ id: 2, category: 'household' }),
    task({ id: 3, category: 'ca-rental' }),
  ], 'category', CATEGORIES);

  assert.deepEqual(groups.map((g) => g.id), ['household', 'ca-rental', 'finance'],
    'die Reihenfolge kommt aus sort_order - alphabetisch stuende CA Rental zuerst');
});

test('eine Kategorie ohne Eintrag in der Liste steht hinten, nicht vorne', () => {


  const groups = tasks.groupBy([
    task({ id: 1, category: 'ghost' }),
    task({ id: 2, category: 'misc' }),
  ], 'category', CATEGORIES);

  assert.deepEqual(groups.map((g) => g.id), ['misc', 'ghost'],
    'ein unbekannter Key faellt ans Ende');
});

test('die Kategorie-Sortierung liest weder den rohen Key noch eine feste Sprache', () => {


  // fest verdrahtetem Deutsch. Beides bleibt gruen, solange die Testdaten

  const source = readFileSync(new URL('../public/pages/tasks.js', import.meta.url), 'utf8');
  const groupBySource = source
    .slice(source.indexOf('function groupBy(tasks, mode'), source.indexOf('// Render-Bausteine'))
    .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');

  assert.ok(
    !/localeCompare\([^)]*'de'/.test(groupBySource),
    'die Gruppierung sortiert in fest verdrahtetem Deutsch statt in der aktiven Sprache',
  );
  assert.ok(
    groupBySource.includes('catSortIndex('),
    'die Gruppierung fragt nicht catSortIndex() - damit ignoriert sie sort_order (#845)',
  );
});

test('der Speicher-Schlüssel trennt die beiden Gruppierungen', () => {

  assert.notEqual(tasks.groupKey('category', 'today'), tasks.groupKey('due', 'today'));
  assert.equal(tasks.groupKey('due', 'overdue'), 'due:overdue');
});

test('die Faelligkeits-Rechnung vergleicht Kalendertage, keine Zeitpunkte', () => {




  // wo er entwickelt wird.
  //



  const source = readFileSync(new URL('../public/pages/tasks.js', import.meta.url), 'utf8');
  const groupBySource = source
    .slice(source.indexOf('function groupBy(tasks, mode'), source.indexOf('// Render-Bausteine'))



    .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');

  assert.ok(
    !/new Date\(task\.due_date\)/.test(groupBySource),
    'die Gruppierung parst ein Datum als Instant - `parseLocalDateKey()` liest es als Kalendertag',
  );
  assert.ok(
    !/setHours\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(groupBySource),
    'die Gruppierung baut ihre Tagesgrenze aus der Wanduhr statt aus `todayKey()`',
  );
  assert.ok(
    groupBySource.includes('todayKey()'),
    'die Gruppierung fragt nicht `todayKey()` - damit folgt sie nicht der Haushaltszone (#829)',
  );
});



const tzModule = await import('/utils/timezone.js');

test('die Faelligkeits-Beschriftung folgt der Anzeigezone, nicht dem Browser', () => {
  const p2 = (n) => String(n).padStart(2, '0');
  try {
    for (const zone of ['Pacific/Honolulu', 'Pacific/Kiritimati']) {
      tzModule.setDisplayTimeZone(zone);
      const now = tzModule.nowFields();
      const today = `${now.year}-${p2(now.month)}-${p2(now.day)}`;
      const shift = (days) => {
        const [y, m, d] = today.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
      };

      assert.match(tasks.formatDueDate(today, '21:00:00').label, /tasks\.(dueToday|overdue)/,
        `${zone}: der heutige Tag der Anzeigezone muss als heute gelten`);
      assert.match(tasks.formatDueDate(shift(1), '09:30:00').label, /tasks\.dueTomorrow/,
        `${zone}: der Folgetag der Anzeigezone ist morgen`);
      assert.match(tasks.formatDueDate(shift(-1), '21:00:00').label, /tasks\.overdue/,
        `${zone}: gestern ist ueberfaellig`);


      const groups = tasks.groupBy([
        task({ id: 1, due_date: today }),
        task({ id: 2, due_date: shift(1) }),
        task({ id: 3, due_date: shift(-1) }),
      ], 'due');
      assert.ok(groups.some((g) => g.id === 'today'), `${zone}: Gruppe "heute" fehlt`);
      assert.ok(groups.some((g) => g.id === 'overdue'), `${zone}: Gruppe "ueberfaellig" fehlt`);
    }
  } finally {
    tzModule.setDisplayTimeZone(null);
  }
});

test('die Wanduhrzeit geht als Stempel an die Formatierer, nicht als Date', () => {
  try {
    tzModule.setDisplayTimeZone('Pacific/Honolulu');
    const now = tzModule.nowFields();
    const p2 = (n) => String(n).padStart(2, '0');
    const [y, m, d] = [now.year, now.month, now.day];
    const yesterday = new Date(Date.UTC(y, m - 1, d) - 86400000).toISOString().slice(0, 10);
    const label = tasks.formatDueDate(yesterday, '21:00:00').label;
    assert.match(label, new RegExp(`${yesterday}T21:00|21:00`),
      `die eingetippte Uhrzeit muss erhalten bleiben, erhalten: ${label}`);
    assert.ok(!/GMT/.test(label),
      `ein Date-Umweg friert die Zeit in der Browser-Zone ein, erhalten: ${label}`);
  } finally {
    tzModule.setDisplayTimeZone(null);
  }
});

// --------------------------------------------------------
// Filterachse Kategorie (D#1017): der Server kannte `?category=` seit #825,



test('normalizeFilterSet traegt die Kategorie-Achse als Liste', () => {
  const set = tasks.normalizeFilterSet({ status: 'open', category: 'garden' });
  assert.deepEqual(set.category, ['garden']);
  assert.deepEqual(tasks.normalizeFilterSet({}).category, []);
  assert.deepEqual(tasks.normalizeFilterSet({ category: ['a', 'b'] }).category, ['a', 'b']);
});

test('taskQuery sendet jede gewaehlte Kategorie als eigenen Parameter, auch im Kanban', () => {
  const before = { filters: tasks.state.filters, viewMode: tasks.state.viewMode, showFuture: tasks.state.showFuture };
  try {
    tasks.state.showFuture = false;
    tasks.state.filters = tasks.normalizeFilterSet({ status: ['open'], category: ['garden', 'household'] });
    tasks.state.viewMode = 'list';
    const list = new URLSearchParams(tasks.taskQuery().slice(1));
    assert.deepEqual(list.getAll('category'), ['garden', 'household']);
    assert.deepEqual(list.getAll('status'), ['open']);
    tasks.state.viewMode = 'kanban';
    const board = new URLSearchParams(tasks.taskQuery().slice(1));
    assert.deepEqual(board.getAll('category'), ['garden', 'household']);
    assert.deepEqual(board.getAll('status'), [], 'im Kanban sind die Spalten der Status');
  } finally {
    Object.assign(tasks.state, before);
  }
});
