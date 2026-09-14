import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const { MODULE_KEYS } = await import('../server/scopes.js');
const { PERMISSION_MODULES } = await import('../server/permissions.js');
const { KITCHEN_CHILD_IDS } = await import('../public/settings/module-order.js');

function arrayLiteral(source, name) {
  const match = source.match(new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
  assert.ok(match, `${name} nicht gefunden`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function objectKeys(source, name) {
  const match = source.match(new RegExp(`${name}\\s*=\\s*(?:Object\\.freeze\\()?\\{([\\s\\S]*?)\\}`));
  assert.ok(match, `${name} nicht gefunden`);
  return [...match[1].matchAll(/^\s*([A-Za-z_][\w-]*)\s*:/gm)].map((m) => m[1]);
}

// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
test('admin-api.js CORE_SCOPE_MODULE_KEYS deckt jeden Scope-Modulschlüssel ab', () => {
  const client = arrayLiteral(read('../public/settings/pages/admin-api.js'), 'CORE_SCOPE_MODULE_KEYS');
  const missing = MODULE_KEYS.filter((key) => !client.includes(key));
  const extra = client.filter((key) => !MODULE_KEYS.includes(key));

  assert.deepEqual(missing, [], 'Scopes ohne UI: diese Module lassen sich nicht an ein Token vergeben');
  assert.deepEqual(extra, [], 'UI bietet Scopes an, die der Server nicht kennt');
});

// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
test('permissions.js NAV_TO_MODULE kennt jede navId aus PERMISSION_MODULES', () => {
  const client = objectKeys(read('../public/permissions.js'), 'NAV_TO_MODULE');
  const navIds = PERMISSION_MODULES.flatMap((m) => m.navIds);
  const missing = navIds.filter((id) => !client.includes(id));


  // Eintrag sperrt also nichts, sondern zeigt das Modul trotz Recht "none".
  assert.deepEqual(missing, [], 'ungegatete navIds: das Modul bleibt trotz Recht "none" sichtbar');
});

test('admin-permissions.js MODULE_ACCENT deckt jedes Permissions-Modul ab', () => {
  const client = objectKeys(read('../public/settings/pages/admin-permissions.js'), 'MODULE_ACCENT');
  const missing = PERMISSION_MODULES.map((m) => m.key).filter((key) => !client.includes(key));

  assert.deepEqual(missing, [], 'Module ohne Akzentpunkt in der Rechte-Verwaltung');
});

// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
test('die drei Kitchen-Child-Listen tragen dieselben IDs', () => {



  const source = read('../public/settings/module-order.js');
  const labels = objectKeys(source, 'KITCHEN_CHILD_LABEL_KEYS');


  assert.deepEqual(labels, [...KITCHEN_CHILD_IDS], 'KITCHEN_CHILD_LABEL_KEYS weicht ab');


  // `KITCHEN_CHILD_ICONS` aus derselben Datei; seit 2026-08-17 steht jedes
  // Modulzeichen in `MODULE_ICON` (nav-icons.js), weil dieselbe Zuordnung


  // `data-lucide="undefined"` und damit gar nichts.
  const icons = objectKeys(read('../public/nav-icons.js'), 'MODULE_ICON');
  const fehlend = KITCHEN_CHILD_IDS.filter((id) => !icons.includes(id));
  assert.deepEqual(fehlend, [], 'Kitchen-Kind ohne Zeichen in MODULE_ICON');
});

test('server KITCHEN_NAV_IDS enthält jedes Kitchen-Kind des Clients', () => {
  const source = read('../server/routes/preferences.js');
  const match = source.match(/KITCHEN_NAV_IDS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(match, 'KITCHEN_NAV_IDS nicht gefunden');
  const serverIds = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

  const missing = KITCHEN_CHILD_IDS.filter((id) => !serverIds.includes(id));
  assert.deepEqual(missing, [], 'Kitchen-Kind fehlt in der serverseitigen Nav-Validierung');
});

// --------------------------------------------------------------------------

// sonst rendert die Seite offline unformatiert
// --------------------------------------------------------------------------


function swArray(sw, name) {
  const start = sw.indexOf(`const ${name} = [`);
  assert.notEqual(start, -1, `const ${name} = [ nicht gefunden`);
  const end = sw.indexOf('];', start);
  assert.notEqual(end, -1, `Ende von ${name} nicht gefunden`);
  return sw.slice(start, end);
}

test('sw.js APP_SHELL cacht das Stylesheet jedes Kitchen-Moduls', () => {
  const shell = swArray(read('../public/sw.js'), 'APP_SHELL');

  for (const id of KITCHEN_CHILD_IDS) {
    assert.ok(
      shell.includes(`'/styles/${id}.css'`),
      `/styles/${id}.css fehlt in APP_SHELL - die Seite rendert offline ungestylt`
    );
  }
});

test('sw.js PAGE_MODULES cacht die Seite jedes Kitchen-Moduls', () => {
  const modules = swArray(read('../public/sw.js'), 'PAGE_MODULES');

  for (const id of KITCHEN_CHILD_IDS) {
    assert.ok(
      modules.includes(`'/pages/${id}.js'`),
      `/pages/${id}.js fehlt in PAGE_MODULES`
    );
  }
});

// --------------------------------------------------------------------------


// --------------------------------------------------------------------------
test('TOGGLEABLE_MODULES enthält jedes Kitchen-Kind', () => {
  const source = read('../server/routes/preferences.js');
  const match = source.match(/TOGGLEABLE_MODULES\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(match, 'TOGGLEABLE_MODULES nicht gefunden');
  const toggleable = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

  const missing = KITCHEN_CHILD_IDS.filter((id) => !toggleable.includes(id));
  assert.deepEqual(missing, [], 'Kitchen-Kind ohne Abschalt-Möglichkeit');
});

// --------------------------------------------------------------------------
// Die kanonische Modulliste: README.md
//





// gehalten.
//



// Test fallen - eine Allowlist wuerde ihn durchwinken.
//

// traegt, haelt `test:readme-consistency` fest.
// --------------------------------------------------------------------------
const README_HEADINGS = {
  tasks: 'Tasks',
  shopping: 'Shopping',
  meals: 'Meals',
  pantry: 'Pantry',
  inventory: 'Inventory',
  calendar: 'Calendar',
  notes: 'Notes &amp; Contacts',
  contacts: 'Notes &amp; Contacts',
  schedule: 'Schedule',
  budget: 'Budget',
  documents: 'Documents',
  health: 'Health',
  rewards: 'Rewards',
  housekeeping: 'Housekeeping',
  waste: 'Waste collection',
};

function readmeModuleHeadings(md) {
  return [...md.matchAll(/^\|\s\*\*([^*]+)\*\*\s\|/gm)].map((m) => m[1].trim());
}

test('jedes rechteverwaltete Modul hat eine Zeile in der README-Modultabelle', () => {
  const headings = readmeModuleHeadings(read('../README.md'));
  assert.ok(headings.length >= 15, `nur ${headings.length} Tabellenzeilen gefunden - der Leser greift nicht mehr`);

  const unmapped = PERMISSION_MODULES.map((m) => m.key).filter((key) => !(key in README_HEADINGS));
  assert.deepEqual(unmapped, [], 'Modul ohne Zuordnung zu einer README-Ueberschrift - Zuordnung ergaenzen, nicht den Test lockern');

  const missing = PERMISSION_MODULES
    .map((m) => README_HEADINGS[m.key])
    .filter((heading) => !headings.includes(heading));
  assert.deepEqual([...new Set(missing)], [], 'Modul fehlt in der kanonischen Modulliste (README.md)');
});



test('der README-Leser findet die Tabelle wirklich', () => {
  const headings = readmeModuleHeadings('| Module | In one line |\n|---|---|\n| **Foo** | Bar. |\n| **Baz** | Qux. |\n');
  assert.deepEqual(headings, ['Foo', 'Baz']);
  assert.deepEqual(readmeModuleHeadings('kein Markup'), []);
});

// --------------------------------------------------------------------------

//





// --------------------------------------------------------------------------

function navModuleKeys(source) {
  const start = source.indexOf('function navItems(');
  assert.notEqual(start, -1, 'navItems() nicht gefunden');
  const end = source.indexOf('\n}', start);
  assert.notEqual(end, -1, 'Ende von navItems() nicht gefunden');
  return [...source.slice(start, end).matchAll(/module:\s*'([a-z-]+)'/g)].map((m) => m[1]);
}

test('jedes rechteverwaltete Modul hat einen Eintrag in navItems()', () => {
  const keys = navModuleKeys(read('../public/router.js'));
  assert.ok(keys.length >= 15, `nur ${keys.length} Nav-Eintraege gefunden - der Leser greift nicht mehr`);

  const missing = PERMISSION_MODULES.map((m) => m.key).filter((key) => !keys.includes(key));
  assert.deepEqual(missing, [],
    'Modul ohne Nav-Eintrag: die Route bleibt registriert, aber Seitenleiste, Mobilnavigation und Katalog verlieren es');
});


test('der navItems-Leser findet die Eintraege wirklich', () => {
  const fake = "function navItems({ x } = {}) {\n  return [\n    { path: '/a', module: 'alpha' },\n    { path: '/b', module: 'beta' },\n  ];\n}\n";
  assert.deepEqual(navModuleKeys(fake), ['alpha', 'beta']);
});
